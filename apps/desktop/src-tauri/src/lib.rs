//! Tauri v2 application entry library: SQLite state, IPC commands, and custom `tmusic` streaming protocol.

mod commands;
mod db;
mod sync;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use http::{Method, Request, Response, StatusCode};
use tauri::Manager;

use crate::db::Database;

const MAX_STREAM_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

/// Runs the Tauri v2 desktop application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not resolve app data directory: {e}"))?;
            let db_path = app_data_dir.join("t-music-library.db");
            let database = Database::open(&db_path)?;
            app.manage(database);
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("tmusic", |ctx, request, responder| {
            let app_handle = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let db = app_handle.state::<Database>();
                let response = handle_tmusic_protocol(&db, &request);
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library,
            commands::add_music_folder,
            commands::remove_music_folder,
            commands::rescan_library,
            commands::detect_wmp_playlists,
            commands::preview_playlist_file,
            commands::import_playlist_file,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::get_playlist_tracks,
            commands::add_tracks_to_playlist,
            commands::remove_track_from_playlist,
            commands::reorder_playlist_tracks,
            commands::export_playlist_m3u8,
            commands::toggle_favorite,
            commands::record_play,
            commands::toggle_radio_favorite,
            commands::save_setting,
            commands::import_cinematic_image,
            commands::set_window_fullscreen,
            commands::is_window_fullscreen,
            commands::close_app_window,
            commands::server_health,
            commands::server_login,
            commands::server_register,
            commands::server_logout,
            commands::sync_with_server,
            commands::upload_app_download,
            commands::save_track_edit,
            commands::reset_track_edit,
            commands::reveal_track_in_explorer,
            commands::export_track_as_mp3,
        ])
        .run(tauri::generate_context!())
        .expect("error while running T - MusicPlayer");
}

fn handle_tmusic_protocol(db: &Database, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return cors_builder(StatusCode::NO_CONTENT)
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            .header("Access-Control-Allow-Headers", "Range")
            .body(Vec::new())
            .unwrap();
    }

    let path = request.uri().path().trim_start_matches('/');
    if let Some(track_id) = path.strip_prefix("stream/") {
        return serve_audio_stream(db, track_id, request);
    }
    if let Some(cover_hash) = path.strip_prefix("cover/") {
        return serve_cover_image(db, cover_hash);
    }

    text_response(StatusCode::NOT_FOUND, "Not found")
}

fn serve_audio_stream(
    db: &Database,
    track_id: &str,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Ok(Some(file_path)) = db.get_track_file_path(track_id) else {
        return text_response(StatusCode::NOT_FOUND, "Track not found");
    };

    let path = Path::new(&file_path);
    let Ok(mut file) = File::open(path) else {
        return text_response(StatusCode::NOT_FOUND, "Audio file missing on disk");
    };
    let Ok(meta) = file.metadata() else {
        return text_response(StatusCode::INTERNAL_SERVER_ERROR, "Metadata unavailable");
    };

    let total_len = meta.len();
    let mime = audio_mime_type(path);
    let is_head = request.method() == Method::HEAD;

    if total_len == 0 {
        return cors_builder(StatusCode::OK)
            .header("Content-Type", mime)
            .header("Content-Length", "0")
            .header("Accept-Ranges", "bytes")
            .body(Vec::new())
            .unwrap();
    }

    if let Some(range_header) = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
    {
        let Some((start, end)) = parse_http_range(range_header, total_len) else {
            return cors_builder(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("Content-Range", format!("bytes */{total_len}"))
                .body(Vec::new())
                .unwrap();
        };

        let chunk_len = end - start + 1;
        let body = if is_head {
            Vec::new()
        } else {
            let mut buf = vec![0u8; chunk_len as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return text_response(StatusCode::INTERNAL_SERVER_ERROR, "Failed reading slice");
            }
            buf
        };

        return cors_builder(StatusCode::PARTIAL_CONTENT)
            .header("Content-Type", mime)
            .header("Accept-Ranges", "bytes")
            .header("Content-Range", format!("bytes {start}-{end}/{total_len}"))
            .header("Content-Length", chunk_len.to_string())
            .body(body)
            .unwrap();
    }

    let body = if is_head {
        Vec::new()
    } else {
        let mut buf = Vec::with_capacity(total_len as usize);
        if file.read_to_end(&mut buf).is_err() {
            return text_response(StatusCode::INTERNAL_SERVER_ERROR, "Failed reading file");
        }
        buf
    };

    cors_builder(StatusCode::OK)
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", total_len.to_string())
        .body(body)
        .unwrap()
}

fn serve_cover_image(db: &Database, cover_hash: &str) -> Response<Vec<u8>> {
    match db.get_cover(cover_hash) {
        Ok(Some((mime, data))) => cors_builder(StatusCode::OK)
            .header("Content-Type", mime)
            .header("Cache-Control", "public, max-age=86400")
            .header("Content-Length", data.len().to_string())
            .body(data)
            .unwrap(),
        _ => text_response(StatusCode::NOT_FOUND, "Cover not found"),
    }
}

fn parse_http_range(header: &str, total_len: u64) -> Option<(u64, u64)> {
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

fn audio_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("webm") => "audio/webm",
        _ => "application/octet-stream",
    }
}

fn cors_builder(status: StatusCode) -> http::response::Builder {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Accept-Ranges, Content-Length",
        )
}

fn text_response(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    cors_builder(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}
