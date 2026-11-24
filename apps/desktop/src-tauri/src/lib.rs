//! Tauri v2 application entry library: SQLite state, IPC commands, and custom `tmusic` streaming protocol.

mod commands;
mod db;
mod sync;
mod wallpaper;

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use base64::Engine as _;
use http::{Method, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

use crate::db::Database;
use crate::wallpaper::{MonitorInfo, WallpaperManager};

const MAX_STREAM_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

struct WallpaperFftBuffer(Mutex<[u8; 256]>);
struct WallpaperPayloadState(Mutex<Option<String>>);

#[tauri::command]
fn list_monitors(wp: State<'_, WallpaperManager>) -> Vec<MonitorInfo> {
    wp.list_monitors()
}

#[tauri::command]
fn is_wallpaper_mode(wp: State<'_, WallpaperManager>) -> bool {
    wp.is_active()
}

#[tauri::command]
async fn set_wallpaper_mode(
    app: AppHandle,
    wp: State<'_, WallpaperManager>,
    enabled: bool,
    monitor_id: Option<String>,
) -> Result<bool, String> {
    if enabled {
        // Keep the T - MusicPlayer main window visible so the user can keep browsing music
        // while the live visualizer runs behind desktop icons.
        wp.enter(&app, monitor_id, false)
    } else {
        wp.exit(&app, false)
    }
}

#[tauri::command]
fn push_wallpaper_fft(fft: State<'_, WallpaperFftBuffer>, bins: Vec<u8>) {
    if let Ok(mut guard) = fft.0.lock() {
        let len = bins.len().min(256);
        guard[..len].copy_from_slice(&bins[..len]);
        if len < 256 {
            guard[len..].fill(0);
        }
    }
}

#[tauri::command]
fn get_wallpaper_fft(fft: State<'_, WallpaperFftBuffer>) -> tauri::ipc::Response {
    let snapshot = fft
        .0
        .lock()
        .map(|g| g.to_vec())
        .unwrap_or_else(|_| vec![0u8; 256]);
    tauri::ipc::Response::new(snapshot)
}

#[tauri::command]
fn sync_wallpaper_payload(
    app: AppHandle,
    state: State<'_, WallpaperPayloadState>,
    payload_json: String,
) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(payload_json.clone());
    }
    let _ = app.emit("desktop-wallpaper-payload", payload_json);
}

#[tauri::command]
fn get_wallpaper_payload(state: State<'_, WallpaperPayloadState>) -> Option<String> {
    state.0.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn load_image_as_data_url(path: String) -> Result<String, String> {
    let img_path = Path::new(&path);
    let data = fs::read(img_path).map_err(|e| format!("Failed reading image: {e}"))?;
    if data.len() > 18 * 1024 * 1024 {
        return Err("Image is larger than 18 MB. Please pick a smaller image.".to_string());
    }
    let mime = match img_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("gif") => "image/gif",
        _ => return Err("Unsupported image format (use PNG, JPG, WebP, SVG, or GIF).".to_string()),
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| format!("Failed saving file: {e}"))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Failed reading file: {e}"))?;
    if meta.len() > 30 * 1024 * 1024 {
        return Err("Theme file is larger than 30 MB.".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed reading file: {e}"))
}

/// Runs the Tauri v2 desktop application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not resolve app data directory: {e}"))?;
            let db_path = app_data_dir.join("t-music-library.db");
            let database = Database::open(&db_path)?;
            app.manage(database);
            app.manage(WallpaperManager::new());
            app.manage(WallpaperFftBuffer(Mutex::new([0u8; 256])));
            app.manage(WallpaperPayloadState(Mutex::new(None)));
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
            commands::record_skip,
            commands::set_track_auto_excluded,
            commands::get_auto_playlist_config,
            commands::save_auto_playlist_config,
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
            list_monitors,
            is_wallpaper_mode,
            set_wallpaper_mode,
            push_wallpaper_fft,
            get_wallpaper_fft,
            sync_wallpaper_payload,
            get_wallpaper_payload,
            load_image_as_data_url,
            save_text_file,
            read_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building T - MusicPlayer");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let wp = app_handle.state::<WallpaperManager>();
            let _ = wp.exit(app_handle, false);
        }
    });
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
