//! Desktop client sync engine connecting to `t-music-server` over HTTPS/HTTP.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use chrono::Utc;
use reqwest::multipart::{Form, Part};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use t_music_core::models::{
    AuthResponse, CheckHashesRequest, CheckHashesResponse, ServerHealth, ServerTrack,
    SyncFavoritePayload, SyncPlaylistPayload, SyncPullResponse, SyncPushRequest,
    SyncPushResponse,
};
use t_music_core::scanner::compute_file_hash;
use tauri::{AppHandle, Emitter};

use crate::db::Database;

/// Live progress event emitted over `"sync-progress"` during two-way sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgressEvent {
    pub phase: String,
    pub percent: u8,
    pub current: usize,
    pub total: usize,
    pub file_name: Option<String>,
    pub bytes_sent: u64,
    pub bytes_total: u64,
    pub message: String,
}

#[derive(Debug, Serialize)]
struct UploadInitPayload<'a> {
    content_hash: &'a str,
    filename: &'a str,
    total_size: u64,
    title: &'a str,
    artist: &'a str,
    album: &'a str,
}

#[derive(Debug, Deserialize)]
struct UploadInitResp {
    status: String,
    upload_id: Option<String>,
    chunk_size: usize,
    track: Option<ServerTrack>,
}

#[derive(Debug, Deserialize)]
struct AdminUploadResp {
    filename: String,
    size_bytes: u64,
}

/// Summary returned to the UI after a full bidirectional sync cycle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSummary {
    pub uploaded_tracks: usize,
    pub pulled_tracks: usize,
    pub synced_playlists: usize,
    pub synced_favorites: usize,
    pub server_time: i64,
}

#[derive(Debug, Serialize)]
struct LoginBody<'a> {
    username: &'a str,
    password: &'a str,
}

#[derive(Debug, Serialize)]
struct RegisterBody<'a> {
    username: &'a str,
    password: &'a str,
    invite_code: Option<&'a str>,
}

fn normalize_base_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim().trim_end_matches('/').to_string();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Server URL must start with https:// or http://".to_string());
    }
    Ok(trimmed)
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed creating HTTP client: {e}"))
}

fn build_upload_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed creating upload client: {e}"))
}

fn emit_progress(app: &AppHandle, event: SyncProgressEvent) {
    let _ = app.emit("sync-progress", event);
}

/// Checks `/api/v1/health` on the target home server.
pub async fn check_health(server_url: &str) -> Result<ServerHealth, String> {
    let base = normalize_base_url(server_url)?;
    let client = build_client()?;
    let resp = client
        .get(format!("{base}/api/v1/health"))
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server health error HTTP {}", resp.status()));
    }
    resp.json::<ServerHealth>()
        .await
        .map_err(|e| format!("Invalid health response: {e}"))
}

/// Authenticates against `/api/v1/auth/login` and stores session keys in local settings.
pub async fn login(
    db: &Database,
    server_url: &str,
    username: &str,
    password: &str,
) -> Result<AuthResponse, String> {
    let base = normalize_base_url(server_url)?;
    let client = build_client()?;
    let resp = client
        .post(format!("{base}/api/v1/auth/login"))
        .json(&LoginBody {
            username: username.trim(),
            password,
        })
        .send()
        .await
        .map_err(|e| format!("Login request failed: {e}"))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(if msg.is_empty() {
            "Invalid username or password".to_string()
        } else {
            msg
        });
    }

    let auth = resp
        .json::<AuthResponse>()
        .await
        .map_err(|e| format!("Invalid auth response: {e}"))?;
    save_session_settings(db, &base, &auth)?;
    Ok(auth)
}

/// Registers a new account against `/api/v1/auth/register` and stores session keys.
pub async fn register(
    db: &Database,
    server_url: &str,
    username: &str,
    password: &str,
    invite_code: Option<&str>,
) -> Result<AuthResponse, String> {
    let base = normalize_base_url(server_url)?;
    let client = build_client()?;
    let clean_invite = invite_code.map(str::trim).filter(|s| !s.is_empty());
    let resp = client
        .post(format!("{base}/api/v1/auth/register"))
        .json(&RegisterBody {
            username: username.trim(),
            password,
            invite_code: clean_invite,
        })
        .send()
        .await
        .map_err(|e| format!("Registration request failed: {e}"))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(if msg.is_empty() {
            "Registration rejected by server".to_string()
        } else {
            msg
        });
    }

    let auth = resp
        .json::<AuthResponse>()
        .await
        .map_err(|e| format!("Invalid auth response: {e}"))?;
    save_session_settings(db, &base, &auth)?;
    Ok(auth)
}

/// Clears saved server auth session keys and removes cached remote tracks from the previous account.
pub fn logout(db: &Database) -> Result<(), String> {
    db.delete_setting("server_token")?;
    db.delete_setting("server_username")?;
    db.delete_setting("server_role")?;
    db.clear_remote_tracks()?;
    Ok(())
}

/// Performs full two-way sync with chunked uploads for large tracks and live UI progress events.
pub async fn sync_library(app: &AppHandle, db: &Database) -> Result<SyncSummary, String> {
    let result = sync_library_inner(app, db).await;
    if let Err(ref err) = result {
        emit_progress(
            app,
            SyncProgressEvent {
                phase: "error".to_string(),
                percent: 0,
                current: 0,
                total: 0,
                file_name: None,
                bytes_sent: 0,
                bytes_total: 0,
                message: err.clone(),
            },
        );
    }
    result
}

async fn sync_library_inner(app: &AppHandle, db: &Database) -> Result<SyncSummary, String> {
    let server_url = db
        .get_setting("server_url")?
        .ok_or_else(|| "No home server URL configured".to_string())?;
    let token = db
        .get_setting("server_token")?
        .ok_or_else(|| "Not signed in to a home server".to_string())?;
    let username = db
        .get_setting("server_username")?
        .unwrap_or_else(|| "me".to_string());

    let base = normalize_base_url(&server_url)?;
    let client = build_client()?;
    let upload_client = build_upload_client()?;

    // 1. Compute missing SHA-256 content hashes for local tracks off the async executor.
    let mut local_tracks = db.list_tracks_for_sync()?;
    let need_hash_total = local_tracks
        .iter()
        .filter(|t| !t.is_remote && t.content_hash.is_none())
        .count();
    let mut hashed_count = 0usize;
    let mut hashes_to_check = Vec::new();

    for track in &mut local_tracks {
        if track.is_remote {
            continue;
        }
        if track.content_hash.is_none() {
            hashed_count += 1;
            let pct = 2 + ((hashed_count * 13) / need_hash_total.max(1)) as u8;
            emit_progress(
                app,
                SyncProgressEvent {
                    phase: "hashing".to_string(),
                    percent: pct.min(15),
                    current: hashed_count,
                    total: need_hash_total,
                    file_name: Some(track.title.clone()),
                    bytes_sent: 0,
                    bytes_total: 0,
                    message: format!("Hashing tracks ({hashed_count}/{need_hash_total})…"),
                },
            );

            let p = Path::new(&track.file_path).to_path_buf();
            if p.is_file() {
                if let Ok(Ok(h)) =
                    tauri::async_runtime::spawn_blocking(move || compute_file_hash(&p)).await
                {
                    db.set_track_content_hash(&track.id, &h)?;
                    track.content_hash = Some(h);
                }
            }
        }
        if track.server_track_id.is_none() {
            if let Some(h) = &track.content_hash {
                hashes_to_check.push(h.clone());
            }
        }
    }

    // 2. Ask server which content hashes already exist so we avoid duplicate uploads.
    if !hashes_to_check.is_empty() {
        emit_progress(
            app,
            SyncProgressEvent {
                phase: "checking".to_string(),
                percent: 17,
                current: hashes_to_check.len(),
                total: hashes_to_check.len(),
                file_name: None,
                bytes_sent: 0,
                bytes_total: 0,
                message: format!("Checking {} tracks on server…", hashes_to_check.len()),
            },
        );

        let resp = client
            .post(format!("{base}/api/v1/tracks/check-hashes"))
            .bearer_auth(&token)
            .json(&CheckHashesRequest {
                hashes: hashes_to_check,
            })
            .send()
            .await
            .map_err(|e| format!("Hash check failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {} on hash check", resp.status()));
        }
        let checked = resp
            .json::<CheckHashesResponse>()
            .await
            .map_err(|e| format!("Invalid hash check payload: {e}"))?;

        for track in &mut local_tracks {
            if track.server_track_id.is_none() {
                if let Some(h) = &track.content_hash {
                    if let Some(srv_id) = checked.existing.get(h) {
                        db.set_track_server_id(&track.id, srv_id)?;
                        track.server_track_id = Some(srv_id.clone());
                    }
                }
            }
        }
    }

    // 3. Upload local tracks still missing on the server using 8 MB chunked streaming.
    let pending_indices: Vec<usize> = local_tracks
        .iter()
        .enumerate()
        .filter(|(_, t)| !t.is_remote && t.server_track_id.is_none() && Path::new(&t.file_path).is_file())
        .map(|(i, _)| i)
        .collect();

    let total_upload_files = pending_indices.len();
    let total_upload_bytes: u64 = pending_indices
        .iter()
        .map(|&i| {
            std::fs::metadata(&local_tracks[i].file_path)
                .map(|m| m.len())
                .unwrap_or(0)
        })
        .sum();
    let mut bytes_sent_total: u64 = 0;
    let mut uploaded_tracks = 0;

    for (pos, idx) in pending_indices.into_iter().enumerate() {
        let track = &mut local_tracks[idx];
        let path = Path::new(&track.file_path);
        let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("track.mp3")
            .to_string();

        if track.content_hash.is_none() {
            let p_clone = path.to_path_buf();
            if let Ok(Ok(h)) =
                tauri::async_runtime::spawn_blocking(move || compute_file_hash(&p_clone)).await
            {
                db.set_track_content_hash(&track.id, &h)?;
                track.content_hash = Some(h);
            }
        }
        let content_hash = track
            .content_hash
            .clone()
            .ok_or_else(|| format!("Failed computing hash for '{}'", track.title))?;

        let current_file_num = pos + 1;
        let base_pct = if total_upload_bytes > 0 {
            20 + ((bytes_sent_total as f64 / total_upload_bytes as f64) * 60.0) as u8
        } else {
            20
        };
        emit_progress(
            app,
            SyncProgressEvent {
                phase: "uploading".to_string(),
                percent: base_pct.min(79),
                current: current_file_num,
                total: total_upload_files,
                file_name: Some(track.title.clone()),
                bytes_sent: bytes_sent_total,
                bytes_total: total_upload_bytes,
                message: format!(
                    "Uploading {current_file_num}/{total_upload_files}: {}",
                    track.title
                ),
            },
        );

        let init_resp = client
            .post(format!("{base}/api/v1/tracks/upload/init"))
            .bearer_auth(&token)
            .json(&UploadInitPayload {
                content_hash: &content_hash,
                filename: &filename,
                total_size: file_size,
                title: &track.title,
                artist: &track.artist,
                album: &track.album,
            })
            .send()
            .await
            .map_err(|e| format!("Upload init failed for {}: {e}", track.title))?;

        if init_resp.status() == StatusCode::NOT_FOUND {
            // Backward compatibility with servers running before chunked upload support.
            if file_size > 24 * 1024 * 1024 {
                return Err(format!(
                    "Track '{}' ({:.1} MB) requires updating your home server first (git pull && docker compose up -d --build) to enable chunked uploads.",
                    track.title,
                    file_size as f64 / (1024.0 * 1024.0)
                ));
            }
            let path_owned = path.to_path_buf();
            let display_path = track.file_path.clone();
            let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path_owned))
                .await
                .map_err(|e| format!("Failed joining upload reader: {e}"))?
                .map_err(|e| format!("Failed reading {display_path}: {e}"))?;

            let file_part = Part::bytes(bytes).file_name(filename);
            let form = Form::new()
                .text("title", track.title.clone())
                .text("artist", track.artist.clone())
                .text("album", track.album.clone())
                .part("file", file_part);

            let resp = upload_client
                .post(format!("{base}/api/v1/tracks/upload"))
                .bearer_auth(&token)
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("Upload failed for {}: {e}", track.title))?;

            if !resp.status().is_success() {
                return Err(format!(
                    "Upload failed for '{}' (HTTP {})",
                    track.title,
                    resp.status()
                ));
            }

            let srv_track = resp
                .json::<ServerTrack>()
                .await
                .map_err(|e| format!("Invalid upload response: {e}"))?;
            db.set_track_server_id(&track.id, &srv_track.id)?;
            track.server_track_id = Some(srv_track.id);
            bytes_sent_total += file_size;
            uploaded_tracks += 1;
            continue;
        }

        if !init_resp.status().is_success() {
            let status = init_resp.status();
            let body = init_resp.text().await.unwrap_or_default();
            return Err(format!(
                "Upload init failed for '{}' ({status}): {body}",
                track.title
            ));
        }

        let init_data = init_resp
            .json::<UploadInitResp>()
            .await
            .map_err(|e| format!("Invalid upload init payload: {e}"))?;

        if init_data.status == "exists" {
            if let Some(existing_track) = init_data.track {
                db.set_track_server_id(&track.id, &existing_track.id)?;
                track.server_track_id = Some(existing_track.id);
                bytes_sent_total += file_size;
                continue;
            }
        }

        let upload_id = init_data
            .upload_id
            .ok_or_else(|| "Server omitted upload_id".to_string())?;
        let chunk_size = init_data.chunk_size.clamp(512 * 1024, 16 * 1024 * 1024);

        let mut offset = 0u64;
        while offset < file_size {
            let read_path = path.to_path_buf();
            let to_read = chunk_size;
            let chunk_bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
                let mut f = File::open(&read_path).map_err(|e| e.to_string())?;
                f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
                let mut buf = vec![0u8; to_read];
                let mut filled = 0usize;
                while filled < to_read {
                    let n = f.read(&mut buf[filled..]).map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    filled += n;
                }
                buf.truncate(filled);
                Ok(buf)
            })
            .await
            .map_err(|e| format!("Chunk reader task failed: {e}"))??;

            if chunk_bytes.is_empty() {
                break;
            }
            let chunk_len = chunk_bytes.len() as u64;

            let mut last_err: Option<String> = None;
            for attempt in 0..3 {
                let send_res = upload_client
                    .post(format!(
                        "{base}/api/v1/tracks/upload/{upload_id}/chunk?offset={offset}"
                    ))
                    .bearer_auth(&token)
                    .body(chunk_bytes.clone())
                    .send()
                    .await;

                match send_res {
                    Ok(r) if r.status().is_success() => {
                        last_err = None;
                        break;
                    }
                    Ok(r) if r.status().is_server_error() && attempt < 2 => {
                        let status = r.status();
                        let txt = r.text().await.unwrap_or_default();
                        last_err = Some(format!("HTTP {status}: {txt}"));
                        let _ = tauri::async_runtime::spawn_blocking(|| {
                            std::thread::sleep(std::time::Duration::from_secs(1));
                        })
                        .await;
                    }
                    Ok(r) => {
                        let status = r.status();
                        let txt = r.text().await.unwrap_or_default();
                        return Err(format!(
                            "Upload chunk failed for '{}' ({status}): {txt}",
                            track.title
                        ));
                    }
                    Err(e) if attempt < 2 => {
                        last_err = Some(e.to_string());
                        let _ = tauri::async_runtime::spawn_blocking(|| {
                            std::thread::sleep(std::time::Duration::from_secs(1));
                        })
                        .await;
                    }
                    Err(e) => {
                        return Err(format!("Upload chunk failed for '{}': {e}", track.title));
                    }
                }
            }
            if let Some(err) = last_err {
                return Err(format!("Upload chunk failed for '{}': {err}", track.title));
            }

            offset += chunk_len;
            bytes_sent_total += chunk_len;
            let pct = if total_upload_bytes > 0 {
                20 + ((bytes_sent_total as f64 / total_upload_bytes as f64) * 60.0) as u8
            } else {
                80
            };
            emit_progress(
                app,
                SyncProgressEvent {
                    phase: "uploading".to_string(),
                    percent: pct.min(80),
                    current: current_file_num,
                    total: total_upload_files,
                    file_name: Some(track.title.clone()),
                    bytes_sent: bytes_sent_total,
                    bytes_total: total_upload_bytes,
                    message: format!(
                        "Uploading {current_file_num}/{total_upload_files}: {}",
                        track.title
                    ),
                },
            );
        }

        emit_progress(
            app,
            SyncProgressEvent {
                phase: "uploading".to_string(),
                percent: 80,
                current: current_file_num,
                total: total_upload_files,
                file_name: Some(track.title.clone()),
                bytes_sent: bytes_sent_total,
                bytes_total: total_upload_bytes,
                message: format!("Finalizing '{}' on server…", track.title),
            },
        );

        let complete_resp = upload_client
            .post(format!("{base}/api/v1/tracks/upload/{upload_id}/complete"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Failed finalizing upload for {}: {e}", track.title))?;

        if !complete_resp.status().is_success() {
            let status = complete_resp.status();
            let txt = complete_resp.text().await.unwrap_or_default();
            return Err(format!(
                "Upload finalize failed for '{}' ({status}): {txt}",
                track.title
            ));
        }

        let srv_track = complete_resp
            .json::<ServerTrack>()
            .await
            .map_err(|e| format!("Invalid upload completion response: {e}"))?;
        db.set_track_server_id(&track.id, &srv_track.id)?;
        track.server_track_id = Some(srv_track.id);
        uploaded_tracks += 1;
    }

    // 4. Push local playlists and favorites to server.
    emit_progress(
        app,
        SyncProgressEvent {
            phase: "pushing".to_string(),
            percent: 83,
            current: 0,
            total: 0,
            file_name: None,
            bytes_sent: bytes_sent_total,
            bytes_total: total_upload_bytes,
            message: "Syncing playlists & favorites to server…".to_string(),
        },
    );
    let local_playlists = db.list_playlists_for_sync()?;
    let push_playlists: Vec<SyncPlaylistPayload> = local_playlists
        .into_iter()
        .map(|p| SyncPlaylistPayload {
            id: p.id,
            name: p.name,
            description: p.description,
            track_ids: p.track_server_ids,
            is_shared: p.is_shared,
            owner_username: username.clone(),
            updated_at: p.updated_at,
            deleted: p.deleted,
        })
        .collect();

    let push_favorites: Vec<SyncFavoritePayload> = db
        .list_tracks_for_sync()?
        .into_iter()
        .filter_map(|t| {
            t.server_track_id.and_then(|sid| {
                if t.favorite_updated_at > 0 || t.is_favorite {
                    Some(SyncFavoritePayload {
                        track_id: sid,
                        is_favorite: t.is_favorite,
                        updated_at: if t.favorite_updated_at > 0 {
                            t.favorite_updated_at
                        } else {
                            Utc::now().timestamp()
                        },
                    })
                } else {
                    None
                }
            })
        })
        .collect();

    let push_resp = client
        .post(format!("{base}/api/v1/sync/push"))
        .bearer_auth(&token)
        .json(&SyncPushRequest {
            playlists: push_playlists,
            favorites: push_favorites,
        })
        .send()
        .await
        .map_err(|e| format!("Sync push failed: {e}"))?;

    if !push_resp.status().is_success() {
        return Err(format!("Sync push rejected (HTTP {})", push_resp.status()));
    }
    let _push_ack = push_resp
        .json::<SyncPushResponse>()
        .await
        .map_err(|e| format!("Invalid push response: {e}"))?;

    // 5. Pull remote tracks, covers, playlists, and favorites.
    emit_progress(
        app,
        SyncProgressEvent {
            phase: "pulling".to_string(),
            percent: 88,
            current: 0,
            total: 0,
            file_name: None,
            bytes_sent: bytes_sent_total,
            bytes_total: total_upload_bytes,
            message: "Pulling server catalog & playlists…".to_string(),
        },
    );

    let pull_resp = client
        .get(format!("{base}/api/v1/sync/pull"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Sync pull failed: {e}"))?;

    if !pull_resp.status().is_success() {
        return Err(format!("Sync pull failed (HTTP {})", pull_resp.status()));
    }
    let pulled = pull_resp
        .json::<SyncPullResponse>()
        .await
        .map_err(|e| format!("Invalid pull payload: {e}"))?;

    let mut pulled_tracks = 0;
    let mut missing_covers = HashSet::new();
    let pulled_server_ids: Vec<String> = pulled.tracks.iter().map(|t| t.id.clone()).collect();
    for srv_track in &pulled.tracks {
        if db.upsert_remote_track(srv_track)? {
            pulled_tracks += 1;
        }
        if let Some(ch) = &srv_track.cover_hash {
            if !db.has_cover(ch)? {
                missing_covers.insert(ch.clone());
            }
        }
    }
    let _ = db.prune_remote_tracks_not_in(&pulled_server_ids)?;

    let total_covers = missing_covers.len();
    for (cover_idx, cover_hash) in missing_covers.into_iter().enumerate() {
        let pct = 93 + (((cover_idx + 1) * 6) / total_covers.max(1)) as u8;
        emit_progress(
            app,
            SyncProgressEvent {
                phase: "covers".to_string(),
                percent: pct.min(99),
                current: cover_idx + 1,
                total: total_covers,
                file_name: None,
                bytes_sent: bytes_sent_total,
                bytes_total: total_upload_bytes,
                message: format!("Downloading cover art ({}/{total_covers})…", cover_idx + 1),
            },
        );
        if let Ok(resp) = client
            .get(format!("{base}/api/v1/covers/{cover_hash}"))
            .send()
            .await
        {
            if resp.status().is_success() {
                let mime = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/jpeg")
                    .to_string();
                if let Ok(bytes) = resp.bytes().await {
                    let _ = db.save_cover(&cover_hash, &mime, &bytes);
                }
            }
        }
    }

    let mut synced_playlists = 0;
    for pl in &pulled.playlists {
        if db.apply_remote_playlist_sync(pl)? {
            synced_playlists += 1;
        }
    }

    let mut synced_favorites = 0;
    for fav in &pulled.favorites {
        if db.apply_remote_favorite_sync(fav)? {
            synced_favorites += 1;
        }
    }

    db.save_setting("last_sync_at", &pulled.server_time.to_string())?;

    emit_progress(
        app,
        SyncProgressEvent {
            phase: "done".to_string(),
            percent: 100,
            current: total_upload_files,
            total: total_upload_files,
            file_name: None,
            bytes_sent: bytes_sent_total,
            bytes_total: total_upload_bytes,
            message: format!(
                "Synced: +{uploaded_tracks} uploaded, +{pulled_tracks} pulled, {synced_playlists} playlists"
            ),
        },
    );

    Ok(SyncSummary {
        uploaded_tracks,
        pulled_tracks,
        synced_playlists,
        synced_favorites,
        server_time: pulled.server_time,
    })
}

/// Uploads an Android `.apk` or Windows `.exe` installer to the server's `/downloads` portal (admin only).
pub async fn upload_app_download(
    db: &Database,
    platform: &str,
    file_path: &str,
) -> Result<String, String> {
    let server_url = db
        .get_setting("server_url")?
        .ok_or_else(|| "No home server URL configured".to_string())?;
    let token = db
        .get_setting("server_token")?
        .ok_or_else(|| "Not signed in to a home server".to_string())?;
    let base = normalize_base_url(&server_url)?;
    let path_owned = Path::new(file_path).to_path_buf();
    let display_path = file_path.to_string();

    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path_owned))
        .await
        .map_err(|e| format!("Failed reading installer: {e}"))?
        .map_err(|e| format!("Failed reading {display_path}: {e}"))?;

    if bytes.is_empty() {
        return Err("Selected installer file is empty".to_string());
    }

    let client = build_upload_client()?;
    let resp = client
        .post(format!("{base}/api/v1/admin/downloads/{platform}"))
        .bearer_auth(&token)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server rejected installer ({status}): {body}"));
    }

    let parsed = resp
        .json::<AdminUploadResp>()
        .await
        .map_err(|e| format!("Invalid upload response: {e}"))?;
    let mb = parsed.size_bytes as f64 / (1024.0 * 1024.0);
    Ok(format!(
        "Published {} ({:.1} MB) to {}/downloads",
        parsed.filename, mb, base
    ))
}

fn save_session_settings(
    db: &Database,
    server_url: &str,
    auth: &AuthResponse,
) -> Result<(), String> {
    db.save_setting("server_url", server_url)?;
    db.save_setting("server_token", &auth.token)?;
    db.save_setting("server_username", &auth.user.username)?;
    db.save_setting("server_role", &auth.user.role)?;
    Ok(())
}
