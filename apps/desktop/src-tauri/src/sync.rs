//! Desktop client sync engine connecting to `t-music-server` over HTTPS/HTTP.

use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use t_music_core::models::{
    AuthResponse, CheckHashesRequest, CheckHashesResponse, ServerHealth, ServerTrack,
    SyncFavoritePayload, SyncPlaylistPayload, SyncPullResponse, SyncPushRequest,
    SyncPushResponse,
};
use t_music_core::scanner::compute_file_hash;

use crate::db::Database;

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
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed creating HTTP client: {e}"))
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

/// Clears saved server auth session keys (keeps server URL for convenience).
pub fn logout(db: &Database) -> Result<(), String> {
    db.delete_setting("server_token")?;
    db.delete_setting("server_username")?;
    db.delete_setting("server_role")?;
    Ok(())
}

/// Performs full two-way sync:
/// 1. Hashes local files and checks which already exist on server.
/// 2. Uploads missing local tracks (including WMP-imported tracks).
/// 3. Pushes local playlist changes/deletions and favorites.
/// 4. Pulls remote tracks, missing cover artwork, playlists, and favorites.
pub async fn sync_library(db: &Database) -> Result<SyncSummary, String> {
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

    // 1. Compute missing SHA-256 content hashes for local tracks.
    let mut local_tracks = db.list_tracks_for_sync()?;
    let mut hashes_to_check = Vec::new();
    for track in &mut local_tracks {
        if track.is_remote {
            continue;
        }
        if track.content_hash.is_none() {
            let p = Path::new(&track.file_path);
            if p.is_file() {
                if let Ok(h) = compute_file_hash(p) {
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

    // 3. Upload local tracks still missing on the server.
    let mut uploaded_tracks = 0;
    for track in &mut local_tracks {
        if track.is_remote || track.server_track_id.is_some() {
            continue;
        }
        let path = Path::new(&track.file_path);
        if !path.is_file() {
            continue;
        }
        let path_owned = path.to_path_buf();
        let display_path = track.file_path.clone();
        let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path_owned))
            .await
            .map_err(|e| format!("Failed joining upload reader: {e}"))?
            .map_err(|e| format!("Failed reading {display_path}: {e}"))?;
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("track.mp3")
            .to_string();

        let file_part = Part::bytes(bytes).file_name(filename);
        let form = Form::new()
            .text("title", track.title.clone())
            .text("artist", track.artist.clone())
            .text("album", track.album.clone())
            .part("file", file_part);

        let resp = client
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
        uploaded_tracks += 1;
    }

    // 4. Push local playlists and favorites to server.
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

    for cover_hash in missing_covers {
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

    Ok(SyncSummary {
        uploaded_tracks,
        pulled_tracks,
        synced_playlists,
        synced_favorites,
        server_time: pulled.server_time,
    })
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
