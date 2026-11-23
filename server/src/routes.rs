//! Axum HTTP API routes for authentication, library uploads, streaming, and two-way sync.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use t_music_core::models::{
    AuthResponse, CheckHashesRequest, CheckHashesResponse, ScannedTrack, ServerHealth,
    ServerTrack, SyncPullResponse, SyncPushRequest, SyncPushResponse, UserProfile,
};
use t_music_core::scanner::{compute_file_hash, extract_track_metadata, scan_directory};
use tower_http::cors::{Any, CorsLayer};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::auth::{hash_password, sign_token, verify_password, AuthUser};
use crate::db::ServerDb;
use crate::AppState;

const MAX_STREAM_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES: usize = 512 * 1024 * 1024;
const CHUNK_UPLOAD_DEFAULT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SINGLE_CHUNK_BYTES: usize = 32 * 1024 * 1024;
const MAX_DOWNLOAD_ARTIFACT_BYTES: usize = 95 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub invite_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    pub quality: Option<String>,
    pub download: Option<u8>,
    pub format: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub added_or_existing: usize,
    pub total_tracks: usize,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UploadInitRequest {
    pub content_hash: String,
    pub filename: String,
    pub total_size: u64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadInitResponse {
    pub status: String,
    pub upload_id: Option<String>,
    pub chunk_size: usize,
    pub track: Option<ServerTrack>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkQuery {
    pub offset: Option<u64>,
}

/// Constructs the complete Axum router with CORS, download portal, and chunked upload routes.
pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS, Method::HEAD])
        .allow_headers(Any);

    Router::new()
        .route("/", get(downloads_page))
        .route("/downloads", get(downloads_page))
        .route("/downloads/android.apk", get(download_android_apk))
        .route("/downloads/windows.exe", get(download_windows_exe))
        .route("/api/v1/health", get(health))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/me", get(me))
        .route(
            "/api/v1/admin/downloads/{platform}",
            post(upload_download_artifact).layer(DefaultBodyLimit::max(MAX_DOWNLOAD_ARTIFACT_BYTES)),
        )
        .route("/api/v1/tracks", get(list_tracks))
        .route("/api/v1/tracks/check-hashes", post(check_hashes))
        .route(
            "/api/v1/tracks/upload",
            post(upload_track).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        .route("/api/v1/tracks/upload/init", post(upload_track_init))
        .route(
            "/api/v1/tracks/upload/{upload_id}/chunk",
            post(upload_track_chunk).layer(DefaultBodyLimit::max(MAX_SINGLE_CHUNK_BYTES)),
        )
        .route(
            "/api/v1/tracks/upload/{upload_id}/complete",
            post(upload_track_complete),
        )
        .route("/api/v1/library/scan", post(scan_music_dir))
        .route("/api/v1/stream/{track_id}", get(stream_track))
        .route("/api/v1/covers/{hash}", get(get_cover))
        .route("/api/v1/sync/pull", get(sync_pull))
        .route("/api/v1/sync/push", post(sync_push))
        .layer(cors)
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<ServerHealth> {
    Json(ServerHealth {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        registration_open: state.config.allow_registration,
        invite_required: state.config.invite_code.is_some(),
    })
}

async fn register(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, String)> {
    if !state.config.allow_registration {
        return Err((
            StatusCode::FORBIDDEN,
            "Registration is disabled on this server".into(),
        ));
    }

    if let Some(expected_code) = &state.config.invite_code {
        if payload.invite_code.as_deref() != Some(expected_code.as_str()) {
            return Err((StatusCode::FORBIDDEN, "Invalid invite code".into()));
        }
    }

    let username = payload.username.trim();
    if username.len() < 2 || payload.password.len() < 4 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Username must be >= 2 chars and password >= 4 chars".into(),
        ));
    }

    let password_hash =
        hash_password(&payload.password).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let user = state
        .db
        .create_user(username, &password_hash)
        .map_err(|e| (StatusCode::CONFLICT, e))?;

    let token = sign_token(&state.config.jwt_secret, &user)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok((StatusCode::CREATED, Json(AuthResponse { token, user })))
}

async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let username = payload.username.trim();
    let Some((user, stored_hash)) = state
        .db
        .find_user_for_login(username)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
    else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Invalid username or password".into(),
        ));
    };

    if !verify_password(&payload.password, &stored_hash) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Invalid username or password".into(),
        ));
    }

    let token = sign_token(&state.config.jwt_secret, &user)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(AuthResponse { token, user }))
}

async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<UserProfile>, (StatusCode, String)> {
    let user = state
        .db
        .get_user_by_id(&auth.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Account no longer exists".into()))?;
    Ok(Json(user))
}

async fn list_tracks(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ServerTrack>>, (StatusCode, String)> {
    state
        .db
        .list_tracks_for_user(&auth.id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn check_hashes(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CheckHashesRequest>,
) -> Result<Json<CheckHashesResponse>, (StatusCode, String)> {
    let existing = state
        .db
        .claim_existing_hashes_for_user(&auth.id, &req.hashes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(CheckHashesResponse { existing }))
}

async fn upload_track(
    State(state): State<AppState>,
    auth: AuthUser,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ServerTrack>), (StatusCode, String)> {
    let uploads_dir = state.config.data_dir.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut temp_path: Option<std::path::PathBuf> = None;
    let mut file_hash: Option<String> = None;
    let mut original_name = "upload.mp3".to_string();
    let mut file_size: u64 = 0;
    let mut title_hint: Option<String> = None;
    let mut artist_hint: Option<String> = None;
    let mut album_hint: Option<String> = None;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "file" {
            if let Some(fname) = field.file_name() {
                if !fname.trim().is_empty() {
                    original_name = fname.trim().to_string();
                }
            }
            let ext = Path::new(&original_name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .filter(|e| !e.is_empty())
                .unwrap_or_else(|| "mp3".to_string());

            let tmp = uploads_dir.join(format!("tmp-{}.{ext}", Uuid::new_v4()));
            let mut out_file = File::create(&tmp)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let mut hasher = Sha256::new();
            let mut total: u64 = 0;

            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Upload chunk error: {e}")))?
            {
                total += chunk.len() as u64;
                hasher.update(&chunk);
                out_file
                    .write_all(&chunk)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
            out_file
                .flush()
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            let digest = hasher.finalize();
            file_hash = Some(digest.iter().map(|b| format!("{b:02x}")).collect());
            file_size = total;
            temp_path = Some(tmp);
        } else if field_name == "title" {
            title_hint = field.text().await.ok().filter(|s| !s.trim().is_empty());
        } else if field_name == "artist" {
            artist_hint = field.text().await.ok().filter(|s| !s.trim().is_empty());
        } else if field_name == "album" {
            album_hint = field.text().await.ok().filter(|s| !s.trim().is_empty());
        }
    }

    let tmp_path = temp_path
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing 'file' multipart field".into()))?;
    let content_hash = file_hash
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Failed hashing upload".into()))?;

    finalize_uploaded_file(
        &state,
        &auth.id,
        &uploads_dir,
        tmp_path,
        content_hash,
        original_name,
        file_size,
        title_hint,
        artist_hint,
        album_hint,
    )
}

#[allow(clippy::too_many_arguments)]
fn finalize_uploaded_file(
    state: &AppState,
    user_id: &str,
    uploads_dir: &Path,
    tmp_path: PathBuf,
    content_hash: String,
    original_name: String,
    file_size: u64,
    title_hint: Option<String>,
    artist_hint: Option<String>,
    album_hint: Option<String>,
) -> Result<(StatusCode, Json<ServerTrack>), (StatusCode, String)> {
    if let Some(existing) = state
        .db
        .get_track_by_hash(&content_hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
    {
        state
            .db
            .link_track_to_user(user_id, &existing.id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        let _ = fs::remove_file(&tmp_path);
        return Ok((StatusCode::OK, Json(existing)));
    }

    let ext = Path::new(&original_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "mp3".to_string());
    let final_path = uploads_dir.join(format!("{content_hash}.{ext}"));

    if fs::rename(&tmp_path, &final_path).is_err() {
        fs::copy(&tmp_path, &final_path)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let _ = fs::remove_file(&tmp_path);
    }

    let (scanned, cover) = match extract_track_metadata(&final_path) {
        Ok((mut meta, cover)) => {
            if let Some(t) = title_hint {
                if meta.title == final_path.file_stem().and_then(|s| s.to_str()).unwrap_or("") {
                    meta.title = t;
                }
            }
            if let Some(a) = artist_hint {
                if meta.artist == "Unknown Artist" {
                    meta.artist = a;
                }
            }
            if let Some(al) = album_hint {
                if meta.album == "Unknown Album" {
                    meta.album = al;
                }
            }
            (meta, cover)
        }
        Err(_) => {
            let fallback_title = title_hint.unwrap_or_else(|| {
                Path::new(&original_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Uploaded Track")
                    .to_string()
            });
            (
                ScannedTrack {
                    file_path: final_path.to_string_lossy().into_owned(),
                    title: fallback_title,
                    artist: artist_hint.unwrap_or_else(|| "Unknown Artist".to_string()),
                    album: album_hint.unwrap_or_else(|| "Unknown Album".to_string()),
                    album_artist: None,
                    track_number: None,
                    disc_number: None,
                    year: None,
                    genre: None,
                    duration_ms: 0,
                    format: ext,
                    bitrate_kbps: None,
                    file_size,
                    modified_at: chrono::Utc::now().timestamp(),
                    cover_hash: None,
                },
                None,
            )
        }
    };

    let inserted = state
        .db
        .insert_track_if_missing(&content_hash, &scanned, cover.as_ref(), Some(user_id))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok((StatusCode::CREATED, Json(inserted)))
}

fn session_dir_for_upload(data_dir: &Path, upload_id: &str) -> Result<PathBuf, (StatusCode, String)> {
    let parsed = Uuid::parse_str(upload_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid upload_id".to_string()))?;
    Ok(data_dir
        .join("uploads")
        .join("sessions")
        .join(parsed.to_string()))
}

/// Removes abandoned chunked-upload staging directories older than `max_age_secs`.
pub fn cleanup_stale_upload_sessions(data_dir: &Path, max_age_secs: u64) -> usize {
    let sessions_root = data_dir.join("uploads").join("sessions");
    let Ok(entries) = fs::read_dir(&sessions_root) else {
        return 0;
    };
    let now = std::time::SystemTime::now();
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        let age_secs = now
            .duration_since(modified)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if age_secs >= max_age_secs && fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

async fn upload_track_init(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UploadInitRequest>,
) -> Result<Json<UploadInitResponse>, (StatusCode, String)> {
    if req.content_hash.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "content_hash is required".into()));
    }

    if let Some(existing) = state
        .db
        .get_track_by_hash(&req.content_hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
    {
        state
            .db
            .link_track_to_user(&auth.id, &existing.id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        return Ok(Json(UploadInitResponse {
            status: "exists".to_string(),
            upload_id: None,
            chunk_size: CHUNK_UPLOAD_DEFAULT_BYTES,
            track: Some(existing),
        }));
    }

    let upload_id = Uuid::new_v4().to_string();
    let session_dir = session_dir_for_upload(&state.config.data_dir, &upload_id)?;
    fs::create_dir_all(&session_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let meta_json = serde_json::to_vec(&req)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    fs::write(session_dir.join("meta.json"), meta_json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    File::create(session_dir.join("payload.part"))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(UploadInitResponse {
        status: "ready".to_string(),
        upload_id: Some(upload_id),
        chunk_size: CHUNK_UPLOAD_DEFAULT_BYTES,
        track: None,
    }))
}

async fn upload_track_chunk(
    State(state): State<AppState>,
    _auth: AuthUser,
    AxumPath(upload_id): AxumPath<String>,
    Query(query): Query<ChunkQuery>,
    body: Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let session_dir = session_dir_for_upload(&state.config.data_dir, &upload_id)?;
    let part_path = session_dir.join("payload.part");
    if !part_path.exists() {
        return Err((StatusCode::NOT_FOUND, "Upload session not found".into()));
    }

    let current_len = fs::metadata(&part_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .len();

    if let Some(expected_offset) = query.offset {
        if expected_offset + body.len() as u64 == current_len {
            // Idempotent retry of a chunk already appended.
            return Ok(Json(serde_json::json!({ "received_bytes": current_len })));
        }
        if expected_offset != current_len {
            return Err((
                StatusCode::CONFLICT,
                format!(
                    "Chunk offset mismatch: expected {current_len}, got {expected_offset}"
                ),
            ));
        }
    }

    let mut file = OpenOptions::new()
        .read(true)
        .append(true)
        .open(&part_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    file.write_all(&body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    file.flush()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let updated_len = current_len + body.len() as u64;
    Ok(Json(serde_json::json!({ "received_bytes": updated_len })))
}

async fn upload_track_complete(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(upload_id): AxumPath<String>,
) -> Result<(StatusCode, Json<ServerTrack>), (StatusCode, String)> {
    let session_dir = session_dir_for_upload(&state.config.data_dir, &upload_id)?;
    let meta_path = session_dir.join("meta.json");
    let part_path = session_dir.join("payload.part");

    if !meta_path.exists() || !part_path.exists() {
        return Err((StatusCode::NOT_FOUND, "Upload session not found".into()));
    }

    let meta_bytes = fs::read(&meta_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let meta: UploadInitRequest = serde_json::from_slice(&meta_bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let part_len = fs::metadata(&part_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .len();
    if meta.total_size > 0 && part_len != meta.total_size {
        let _ = fs::remove_dir_all(&session_dir);
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "Incomplete upload: expected {} bytes, received {} bytes",
                meta.total_size, part_len
            ),
        ));
    }

    let part_path_for_hash = part_path.clone();
    let computed_hash = tokio::task::spawn_blocking(move || compute_file_hash(&part_path_for_hash))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !computed_hash.eq_ignore_ascii_case(&meta.content_hash) {
        let _ = fs::remove_dir_all(&session_dir);
        return Err((
            StatusCode::BAD_REQUEST,
            "SHA-256 verification failed for chunked upload".into(),
        ));
    }

    let uploads_dir = state.config.data_dir.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let res = finalize_uploaded_file(
        &state,
        &auth.id,
        &uploads_dir,
        part_path,
        meta.content_hash,
        meta.filename,
        part_len,
        meta.title.filter(|s| !s.trim().is_empty()),
        meta.artist.filter(|s| !s.trim().is_empty()),
        meta.album.filter(|s| !s.trim().is_empty()),
    );
    let _ = fs::remove_dir_all(&session_dir);
    res
}

async fn scan_music_dir(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ScanResponse>, (StatusCode, String)> {
    let added_or_existing =
        scan_server_music_directory(&state.db, &state.config.music_dir, Some(&auth.id))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let total_tracks = state
        .db
        .list_tracks_for_user(&auth.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .len();
    Ok(Json(ScanResponse {
        added_or_existing,
        total_tracks,
    }))
}

/// Scans `music_dir` and inserts any tracks not yet present in `ServerDb`, assigning them to `owner_user_id`.
pub fn scan_server_music_directory(
    db: &ServerDb,
    music_dir: &Path,
    owner_user_id: Option<&str>,
) -> Result<usize, String> {
    let files = scan_directory(music_dir);
    let mut count = 0;
    for path in files {
        let Ok(hash) = compute_file_hash(&path) else {
            continue;
        };
        if let Ok(Some(existing)) = db.get_track_by_hash(&hash) {
            if let Some(uid) = owner_user_id {
                let _ = db.link_track_to_user(uid, &existing.id);
            }
            count += 1;
            continue;
        }
        if let Ok((scanned, cover)) = extract_track_metadata(&path) {
            if db
                .insert_track_if_missing(&hash, &scanned, cover.as_ref(), owner_user_id)
                .is_ok()
            {
                count += 1;
            }
        }
    }
    Ok(count)
}

async fn stream_track(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(track_id): AxumPath<String>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> Response {
    let Ok(allowed) = state.db.user_can_access_track(&auth.id, &track_id) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Access check failed").into_response();
    };
    if !allowed {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    let Ok(Some(stored)) = state.db.get_track_for_stream(&track_id) else {
        return (StatusCode::NOT_FOUND, "Track not found").into_response();
    };

    let file_path = Path::new(&stored.file_path);
    if !file_path.is_file() {
        return (StatusCode::NOT_FOUND, "Audio file missing on server").into_response();
    }

    let range_header = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    // Optional MP3 download transcode when requested (`?format=mp3`) for non-MP3 source files.
    if query
        .format
        .as_deref()
        .is_some_and(|f| f.eq_ignore_ascii_case("mp3"))
        && !stored.meta.format.eq_ignore_ascii_case("mp3")
    {
        let mp3_filename = format!(
            "{} - {}.mp3",
            stored.meta.artist.replace('"', ""),
            stored.meta.title.replace('"', "")
        );
        match tokio::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-i",
                &stored.file_path,
                "-vn",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "0",
                "-f",
                "mp3",
                "pipe:1",
            ])
            .output()
            .await
        {
            Ok(output) if output.status.success() && !output.stdout.is_empty() => {
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "audio/mpeg")
                    .header(
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{mp3_filename}\""),
                    )
                    .header(header::CONTENT_LENGTH, output.stdout.len().to_string())
                    .body(Body::from(output.stdout))
                    .unwrap();
            }
            _ => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "FFmpeg MP3 transcode failed on server",
                )
                    .into_response();
            }
        }
    }

    // Optional mobile data-saver transcode when FFmpeg is installed and no Range/download requested.
    if query.quality.as_deref() == Some("saver")
        && query.download != Some(1)
        && range_header.is_none()
        && stored.meta.format != "opus"
    {
        if let Ok(output) = tokio::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-i",
                &stored.file_path,
                "-vn",
                "-c:a",
                "libopus",
                "-b:a",
                "160k",
                "-f",
                "ogg",
                "pipe:1",
            ])
            .output()
            .await
        {
            if output.status.success() && !output.stdout.is_empty() {
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "audio/ogg")
                    .header(header::CONTENT_LENGTH, output.stdout.len().to_string())
                    .body(Body::from(output.stdout))
                    .unwrap();
            }
        }
    }

    let Ok(mut file) = File::open(file_path) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed opening file").into_response();
    };
    let Ok(meta) = file.metadata() else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Metadata unavailable").into_response();
    };

    let total_len = meta.len();
    let mime = audio_mime_type(&stored.meta.format);
    let safe_filename = format!(
        "{} - {}.{}",
        stored.meta.artist.replace(['"', '/', '\\'], "_"),
        stored.meta.title.replace(['"', '/', '\\'], "_"),
        stored.meta.format
    );

    if let Some(range_str) = range_header {
        let Some((start, end)) = parse_http_range(&range_str, total_len) else {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total_len}"))
                .body(Body::empty())
                .unwrap();
        };

        let chunk_len = end - start + 1;
        let mut buf = vec![0u8; chunk_len as usize];
        if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed reading slice").into_response();
        }

        let mut builder = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total_len}"),
            )
            .header(header::CONTENT_LENGTH, chunk_len.to_string());

        if query.download == Some(1) {
            builder = builder.header(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{safe_filename}\""),
            );
        }
        return builder.body(Body::from(buf)).unwrap();
    }

    let Ok(async_file) = tokio::fs::File::open(file_path).await else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed reading file").into_response();
    };
    let stream = ReaderStream::with_capacity(async_file, 64 * 1024);

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total_len.to_string());

    if query.download == Some(1) {
        builder = builder.header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{safe_filename}\""),
        );
    }

    builder.body(Body::from_stream(stream)).unwrap()
}

async fn get_cover(
    State(state): State<AppState>,
    AxumPath(hash): AxumPath<String>,
) -> Response {
    match state.db.get_cover(&hash) {
        Ok(Some((mime, data))) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(header::CONTENT_LENGTH, data.len().to_string())
            .body(Body::from(data))
            .unwrap(),
        _ => (StatusCode::NOT_FOUND, "Cover not found").into_response(),
    }
}

async fn sync_pull(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<SyncPullResponse>, (StatusCode, String)> {
    state
        .db
        .pull_sync(&auth.id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn sync_push(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<SyncPushRequest>,
) -> Result<Json<SyncPushResponse>, (StatusCode, String)> {
    state
        .db
        .push_sync(&auth.id, &req)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

fn find_download_file(dir: &Path, ext: &str, preferred_name: &str) -> Option<(PathBuf, u64, i64)> {
    let preferred = dir.join(preferred_name);
    if preferred.is_file() {
        if let Ok(meta) = fs::metadata(&preferred) {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            return Some((preferred, meta.len(), modified));
        }
    }

    let entries = fs::read_dir(dir).ok()?;
    let mut best: Option<(PathBuf, u64, i64)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let matches_ext = path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case(ext));
        if !matches_ext {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            if best.as_ref().is_none_or(|(_, _, prev_ts)| modified > *prev_ts) {
                best = Some((path, meta.len(), modified));
            }
        }
    }
    best
}

fn format_artifact_meta(info: Option<&(PathBuf, u64, i64)>) -> (bool, String) {
    match info {
        Some((_, size_bytes, modified)) => {
            let mb = *size_bytes as f64 / (1024.0 * 1024.0);
            let date = chrono::DateTime::from_timestamp(*modified, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M UTC").to_string())
                .unwrap_or_else(|| "Ready".to_string());
            (true, format!("{mb:.1} MB · Updated {date}"))
        }
        None => (
            false,
            "Not uploaded yet — ask the server admin to upload or copy it to downloads".to_string(),
        ),
    }
}

async fn downloads_page(State(state): State<AppState>) -> Html<String> {
    let apk_info = find_download_file(&state.config.downloads_dir, "apk", "T-MusicPlayer.apk");
    let exe_info = find_download_file(&state.config.downloads_dir, "exe", "T-MusicPlayer.exe");

    let (apk_ready, apk_meta) = format_artifact_meta(apk_info.as_ref());
    let (exe_ready, exe_meta) = format_artifact_meta(exe_info.as_ref());

    let apk_cta = if apk_ready {
        r#"<a class="btn btn-primary" href="/downloads/android.apk" download="T-MusicPlayer.apk">Download Android APK</a>"#
    } else {
        r#"<span class="btn btn-disabled">Android APK Not Uploaded Yet</span>"#
    };

    let exe_cta = if exe_ready {
        r#"<a class="btn btn-secondary" href="/downloads/windows.exe" download="T-MusicPlayer.exe">Download Windows .EXE</a>"#
    } else {
        r#"<span class="btn btn-disabled">Windows .EXE Not Uploaded Yet</span>"#
    };

    let version = env!("CARGO_PKG_VERSION");
    let invite_note = if state.config.invite_code.is_some() {
        "Ask the host for the invite code when registering your account."
    } else {
        "Open registration is enabled — create your account right inside the app."
    };

    let html = format!(
        r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>T - MusicPlayer Downloads</title>
  <style>
    :root {{
      --bg: #090A09;
      --surface: #111311;
      --card: #181B18;
      --border: rgba(10, 249, 42, 0.16);
      --text: #F2F5F2;
      --muted: #A0B0A2;
      --accent: #0AF92A;
      --accent-contrast: #061108;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      padding: 28px 16px 48px;
    }}
    .wrap {{
      width: 100%;
      max-width: 720px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }}
    .hero {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 18px;
    }}
    .logo-box {{
      width: 60px;
      height: 60px;
      border-radius: 14px;
      background: var(--card);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }}
    .badge {{
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      background: rgba(10, 249, 42, 0.12);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 10px;
      margin-bottom: 8px;
    }}
    h1 {{
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
    }}
    .sub {{
      margin: 6px 0 0;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }}
    .card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }}
    .card h2 {{
      margin: 0;
      font-size: 16px;
    }}
    .meta {{
      font-size: 12px;
      color: var(--muted);
      line-height: 1.4;
      min-height: 34px;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      border: 1px solid var(--border);
      cursor: pointer;
    }}
    .btn-primary {{
      background: var(--accent);
      color: var(--accent-contrast);
      border-color: var(--accent);
    }}
    .btn-secondary {{
      background: var(--card);
      color: var(--text);
    }}
    .btn-disabled {{
      background: var(--card);
      color: var(--muted);
      opacity: 0.65;
      cursor: default;
    }}
    .url-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
    }}
    .url-row code {{
      flex: 1;
      font-size: 13px;
      color: var(--accent);
      word-break: break-all;
    }}
    .copy-btn {{
      background: rgba(10, 249, 42, 0.14);
      color: var(--accent);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }}
    ol {{
      margin: 4px 0 0;
      padding-left: 20px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.65;
    }}
    strong {{ color: var(--text); }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="logo-box">
        <svg width="38" height="38" viewBox="224 210 630 630" xmlns="http://www.w3.org/2000/svg">
          <path d="M 496.01 267.02 C 523.31 265.31 550.65 267.46 577.08 274.72 C 599.40 280.46 620.31 290.10 639.94 302.07 C 649.41 308.45 658.55 314.50 666.95 322.08 C 687.14 339.48 704.78 360.86 716.30 384.99 C 697.68 358.41 673.86 335.67 645.99 318.97 C 617.40 302.01 585.10 291.44 551.97 288.46 C 505.42 284.14 457.94 295.03 417.66 318.67 C 384.52 337.83 356.34 365.54 336.52 398.28 C 328.43 392.11 320.56 386.75 314.03 378.77 C 326.08 356.09 344.13 336.16 363.73 319.73 C 401.26 289.50 447.89 270.61 496.01 267.02 Z" fill="#49ecc1"/>
          <path d="M 329.16 334.36 C 320.70 345.84 312.52 357.34 306.15 370.15 C 290.86 398.86 282.39 430.61 280.01 462.99 C 278.14 487.31 280.59 512.07 286.15 535.78 C 290.18 551.83 295.25 567.55 302.59 582.43 C 314.46 607.32 330.85 630.15 350.82 649.18 C 362.69 660.83 376.20 670.85 390.16 679.84 C 425.84 701.95 467.06 716.00 508.98 719.11 C 512.94 719.46 516.92 719.58 520.88 719.94 C 517.59 720.31 514.29 720.51 510.99 720.70 C 489.51 722.38 467.32 719.63 446.42 714.57 C 419.80 707.79 394.09 696.45 370.42 682.58 C 362.02 678.19 354.51 672.41 345.76 669.40 C 347.96 675.19 351.65 679.75 355.34 684.62 C 361.54 693.06 368.89 700.36 376.42 707.59 C 388.23 718.64 402.48 728.09 415.55 737.61 C 411.60 737.25 407.68 736.69 403.79 735.94 C 377.56 730.93 352.14 720.23 330.63 704.34 C 317.55 694.51 306.03 682.95 295.74 670.26 C 286.12 658.27 278.37 645.08 271.82 631.19 C 255.88 598.26 247.66 561.55 247.22 525.00 C 247.29 481.26 257.53 436.92 278.31 398.32 C 291.68 374.30 308.33 352.42 329.16 334.36 Z" fill="#1eee76"/>
          <path d="M 316.01 398.72 C 320.75 401.66 324.74 405.53 329.42 408.56 C 336.60 413.18 344.13 417.34 351.67 421.34 C 364.74 427.80 378.51 433.16 392.38 437.63 C 421.37 446.39 450.91 451.23 481.02 454.13 C 487.21 454.96 493.17 455.47 499.37 454.23 C 514.91 455.22 530.39 456.58 545.97 456.74 C 556.99 457.31 567.96 457.53 578.99 456.87 C 589.01 456.55 599.35 456.53 608.71 460.62 C 617.00 464.16 623.28 470.28 628.50 477.50 C 634.63 485.96 639.93 495.07 644.58 504.43 C 651.07 518.26 658.86 531.66 668.26 543.73 C 676.37 554.57 685.80 565.19 696.71 573.29 C 703.58 578.14 711.32 582.55 720.04 581.89 C 725.61 581.91 730.20 578.75 733.30 574.30 C 739.86 565.51 741.56 554.60 740.14 543.91 C 739.51 539.59 737.38 535.70 733.62 533.35 C 727.03 528.82 717.71 528.94 710.00 528.36 C 698.85 527.51 685.91 525.91 676.69 519.05 C 681.13 518.77 685.45 518.84 689.80 517.82 C 697.47 515.88 704.46 512.09 708.21 504.82 C 702.34 502.92 696.46 501.22 690.87 498.57 C 696.04 497.97 700.97 497.63 706.02 496.20 C 716.04 493.30 724.68 488.62 733.78 483.76 C 742.86 479.15 752.67 475.56 762.97 475.48 C 769.54 475.25 776.48 476.01 782.81 474.71 C 791.43 473.14 798.43 468.45 807.02 466.03 C 815.52 463.56 824.02 461.87 832.11 466.60 C 822.29 472.31 813.07 478.82 805.00 486.86 C 802.42 488.69 799.86 490.30 797.84 492.80 C 787.51 505.87 781.26 521.00 777.18 537.04 C 774.03 552.65 771.62 568.49 767.91 583.98 C 762.68 603.97 755.59 623.67 746.01 642.01 C 739.42 655.13 731.42 667.02 722.98 678.99 C 700.84 708.61 672.16 733.05 639.66 750.66 C 625.65 757.93 611.37 764.39 596.37 769.35 C 585.00 772.73 573.73 776.05 562.05 778.20 C 556.71 779.02 551.32 778.90 546.00 780.02 C 539.11 781.56 532.34 780.66 525.38 781.46 C 514.21 782.65 503.16 781.99 492.00 781.09 C 482.68 781.19 473.59 779.72 464.38 778.54 C 433.77 773.87 405.18 762.77 378.18 747.84 C 373.37 744.94 369.00 741.70 363.49 740.15 C 356.47 735.60 349.88 730.36 343.53 724.92 C 351.11 728.25 358.68 731.61 366.41 734.61 C 391.89 744.59 418.57 750.77 446.00 751.45 C 453.55 751.45 460.52 751.78 467.75 749.22 C 466.14 747.39 464.34 745.88 462.11 744.88 C 452.53 740.33 442.58 736.57 433.01 732.00 C 421.46 726.59 410.35 720.29 399.68 713.30 C 394.59 709.87 389.34 706.25 384.88 702.03 C 392.11 704.46 399.05 707.98 406.11 710.93 C 421.81 717.47 437.09 723.82 453.75 727.59 C 478.85 733.42 505.78 734.68 531.07 729.31 C 557.08 723.57 582.05 709.77 599.63 689.60 C 603.03 685.41 606.83 680.92 608.79 675.85 C 610.02 672.42 609.58 668.59 605.91 667.03 C 599.95 664.70 592.32 665.91 586.00 665.83 C 564.28 666.64 541.66 662.67 522.50 652.08 C 529.37 652.66 536.09 653.69 543.00 653.43 C 559.82 652.96 577.77 649.06 593.28 642.52 C 597.37 640.55 603.98 637.81 605.41 633.10 C 606.05 628.54 600.58 626.55 597.02 625.89 C 585.38 624.21 572.81 626.55 561.00 626.44 C 531.99 627.12 503.44 623.64 476.01 613.97 C 465.68 609.92 454.58 605.39 446.13 598.12 C 451.78 598.95 457.34 600.16 463.01 600.86 C 476.97 602.79 490.94 603.02 505.00 602.76 C 514.95 602.54 525.07 601.59 534.78 599.36 C 539.43 598.20 544.19 596.70 548.34 594.29 C 551.38 592.41 553.97 589.75 554.21 586.00 C 553.72 582.16 549.91 579.76 546.67 578.33 C 538.80 575.04 529.44 574.42 521.00 574.57 C 509.52 574.79 498.24 574.98 486.78 573.75 C 458.07 570.91 430.29 562.65 405.79 547.21 C 395.60 540.72 386.29 533.23 378.89 523.61 C 388.79 527.04 398.77 529.69 409.07 531.63 C 429.02 535.14 448.70 537.36 468.99 535.83 C 478.92 535.37 489.23 534.40 498.85 531.82 C 502.34 530.84 506.26 529.47 508.66 526.62 C 510.45 524.72 510.23 521.32 508.75 519.30 C 506.14 515.54 501.69 513.00 497.57 511.21 C 492.30 508.98 486.82 507.20 481.24 505.89 C 461.58 501.54 441.68 498.62 422.22 493.61 C 410.31 490.74 398.14 487.21 387.02 481.99 C 366.02 472.52 347.08 457.05 334.63 437.56 C 333.81 434.82 332.74 432.29 331.08 429.94 C 327.36 424.57 324.99 418.79 321.99 413.01 C 319.60 408.39 317.35 403.77 316.01 398.72 Z" fill="#0af92a"/>
        </svg>
      </div>
      <div>
        <span class="badge">Self-Hosted Music Ecosystem · v{version}</span>
        <h1>T - MusicPlayer Downloads</h1>
        <p class="sub">Direct installers for Android &amp; Windows, hosted right from your personal server.</p>
      </div>
    </section>

    <section class="grid">
      <div class="card">
        <h2>Android (Pixel &amp; Phones)</h2>
        <div class="meta">{apk_meta}</div>
        {apk_cta}
      </div>
      <div class="card">
        <h2>Windows Desktop App</h2>
        <div class="meta">{exe_meta}</div>
        {exe_cta}
      </div>
    </section>

    <section class="card">
      <h2>Quick Phone Setup</h2>
      <div class="url-row">
        <span style="font-size:12px;color:var(--muted)">Server URL:</span>
        <code id="srv-url">...</code>
        <button class="copy-btn" type="button" id="copy-btn">Copy</button>
      </div>
      <ol>
        <li>Tap <strong>Download Android APK</strong> above and open the downloaded file (allow your browser to install apps if Android prompts).</li>
        <li>Open <strong>T - MusicPlayer</strong> and paste the Server URL shown above.</li>
        <li>Tap <strong>Create Account</strong> (or Sign In) to sync your private music library and save playlists offline. {invite_note}</li>
      </ol>
    </section>
  </main>
  <script>
    const el = document.getElementById("srv-url");
    el.textContent = window.location.origin;
    const btn = document.getElementById("copy-btn");
    btn.addEventListener("click", async () => {{
      try {{
        await navigator.clipboard.writeText(window.location.origin);
        btn.textContent = "Copied!";
        setTimeout(() => {{ btn.textContent = "Copy"; }}, 1800);
      }} catch (_) {{}}
    }});
  </script>
</body>
</html>"##
    );

    Html(html)
}

async fn download_android_apk(State(state): State<AppState>) -> Response {
    serve_download_artifact(
        &state.config.downloads_dir,
        "apk",
        "T-MusicPlayer.apk",
        "application/vnd.android.package-archive",
    )
    .await
}

async fn download_windows_exe(State(state): State<AppState>) -> Response {
    serve_download_artifact(
        &state.config.downloads_dir,
        "exe",
        "T-MusicPlayer.exe",
        "application/octet-stream",
    )
    .await
}

async fn serve_download_artifact(
    downloads_dir: &Path,
    ext: &str,
    preferred_name: &str,
    content_type: &'static str,
) -> Response {
    let Some((path, size_bytes, _)) = find_download_file(downloads_dir, ext, preferred_name) else {
        return (
            StatusCode::NOT_FOUND,
            format!("No .{ext} installer uploaded yet"),
        )
            .into_response();
    };

    let Ok(file) = tokio::fs::File::open(&path).await else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed reading installer").into_response();
    };
    let stream = ReaderStream::with_capacity(file, 64 * 1024);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{preferred_name}\""),
        )
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONTENT_LENGTH, size_bytes.to_string())
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn upload_download_artifact(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(platform): AxumPath<String>,
    body: Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if auth.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            "Admin privileges required to upload client binaries".into(),
        ));
    }

    let filename = match platform.to_ascii_lowercase().as_str() {
        "android" => "T-MusicPlayer.apk",
        "windows" => "T-MusicPlayer.exe",
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "Platform must be 'android' or 'windows'".into(),
            ));
        }
    };

    if body.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Empty installer payload".into()));
    }

    fs::create_dir_all(&state.config.downloads_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let tmp_path = state
        .config
        .downloads_dir
        .join(format!(".{filename}.{}.part", Uuid::new_v4()));
    let final_path = state.config.downloads_dir.join(filename);

    let size_bytes = body.len() as u64;
    let body_vec = body.to_vec();
    let tmp_clone = tmp_path.clone();
    let final_clone = final_path.clone();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        fs::write(&tmp_clone, &body_vec).map_err(|e| e.to_string())?;
        if fs::rename(&tmp_clone, &final_clone).is_err() {
            fs::copy(&tmp_clone, &final_clone).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&tmp_clone);
        }
        Ok(())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({
        "platform": platform,
        "filename": filename,
        "size_bytes": size_bytes,
    })))
}

fn parse_http_range(header: &str, total_len: u64) -> Option<(u64, u64)> {
    if total_len == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?;
    let first_range = spec.split(',').next()?.trim();
    let (start_str, end_str) = first_range.split_once('-')?;

    if start_str.is_empty() {
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix);
        return Some((start, total_len - 1));
    }

    let start: u64 = start_str.parse().ok()?;
    if start >= total_len {
        return None;
    }

    let requested_end = if end_str.is_empty() {
        total_len - 1
    } else {
        end_str.parse::<u64>().ok()?.min(total_len - 1)
    };

    if requested_end < start {
        return None;
    }

    let capped_end = requested_end.min(start + MAX_STREAM_CHUNK_BYTES - 1);
    Some((start, capped_end))
}

fn audio_mime_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "webm" => "audio/webm",
        _ => "application/octet-stream",
    }
}
