//! Axum HTTP API routes for authentication, library uploads, streaming, and two-way sync.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
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
use uuid::Uuid;

use crate::auth::{hash_password, sign_token, verify_password, AuthUser};
use crate::db::ServerDb;
use crate::AppState;

const MAX_STREAM_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES: usize = 250 * 1024 * 1024;

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
}

#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub added_or_existing: usize,
    pub total_tracks: usize,
}

/// Constructs the complete Axum router with CORS and upload size limits configured.
pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS, Method::HEAD])
        .allow_headers(Any);

    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/tracks", get(list_tracks))
        .route("/api/v1/tracks/check-hashes", post(check_hashes))
        .route(
            "/api/v1/tracks/upload",
            post(upload_track).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
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
    _auth: AuthUser,
) -> Result<Json<Vec<ServerTrack>>, (StatusCode, String)> {
    state
        .db
        .list_tracks()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn check_hashes(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(req): Json<CheckHashesRequest>,
) -> Result<Json<CheckHashesResponse>, (StatusCode, String)> {
    let existing = state
        .db
        .check_existing_hashes(&req.hashes)
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

    if let Some(existing) = state
        .db
        .get_track_by_hash(&content_hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
    {
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
        .insert_track_if_missing(&content_hash, &scanned, cover.as_ref(), Some(&auth.id))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok((StatusCode::CREATED, Json(inserted)))
}

async fn scan_music_dir(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<ScanResponse>, (StatusCode, String)> {
    let added_or_existing = scan_server_music_directory(&state.db, &state.config.music_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let total_tracks = state
        .db
        .list_tracks()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .len();
    Ok(Json(ScanResponse {
        added_or_existing,
        total_tracks,
    }))
}

/// Scans `music_dir` and inserts any tracks not yet present in `ServerDb`.
pub fn scan_server_music_directory(db: &ServerDb, music_dir: &Path) -> Result<usize, String> {
    let files = scan_directory(music_dir);
    let mut count = 0;
    for path in files {
        let Ok(hash) = compute_file_hash(&path) else {
            continue;
        };
        if let Ok(Some(_)) = db.get_track_by_hash(&hash) {
            count += 1;
            continue;
        }
        if let Ok((scanned, cover)) = extract_track_metadata(&path) {
            if db
                .insert_track_if_missing(&hash, &scanned, cover.as_ref(), None)
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
    _auth: AuthUser,
    AxumPath(track_id): AxumPath<String>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> Response {
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

    let mut buf = Vec::with_capacity(total_len as usize);
    if file.read_to_end(&mut buf).is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed reading file").into_response();
    }

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

    builder.body(Body::from(buf)).unwrap()
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
