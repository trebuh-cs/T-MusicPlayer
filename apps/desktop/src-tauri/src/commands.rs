//! Tauri IPC commands exposing library management, WMP playlist import, playlists, and settings.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use t_music_core::models::{
    AuthResponse, DetectedPlaylistFile, ImportPlaylistReport, ParsedPlaylist, Playlist,
    RadioStation, ScanReport, ServerHealth, Track,
};
use t_music_core::scanner::{extract_track_metadata, scan_directory};
use t_music_core::wmp::{export_m3u8, is_supported_playlist_file, parse_playlist_file};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::db::{Database, LibrarySnapshot, UpsertOutcome};
use crate::sync::{self, SyncSummary};

#[tauri::command]
pub fn get_library(db: State<'_, Database>) -> Result<LibrarySnapshot, String> {
    db.get_library_snapshot()
}

#[tauri::command]
pub fn add_music_folder(db: State<'_, Database>, path: String) -> Result<ScanReport, String> {
    let folder_path = Path::new(&path);
    if !folder_path.is_dir() {
        return Err(format!("Selected path is not a directory: {path}"));
    }

    let canonical = folder_path
        .canonicalize()
        .unwrap_or_else(|_| folder_path.to_path_buf());
    let clean_path = strip_windows_verbatim_prefix(&canonical);
    let folder = db.register_folder(&clean_path)?;

    let (added, updated, removed) = scan_single_folder(&db, &folder.id, Path::new(&clean_path))?;
    let total_tracks = db.count_tracks()?;

    Ok(ScanReport {
        folders_scanned: 1,
        tracks_added: added,
        tracks_updated: updated,
        tracks_removed: removed,
        total_tracks,
    })
}

#[tauri::command]
pub fn remove_music_folder(db: State<'_, Database>, folder_id: String) -> Result<(), String> {
    db.remove_folder(&folder_id)
}

#[tauri::command]
pub fn rescan_library(db: State<'_, Database>) -> Result<ScanReport, String> {
    let folders = db.list_folders()?;
    let mut tracks_added = 0;
    let mut tracks_updated = 0;
    let mut tracks_removed = 0;

    for folder in &folders {
        let path = Path::new(&folder.path);
        let (added, updated, removed) = scan_single_folder(&db, &folder.id, path)?;
        tracks_added += added;
        tracks_updated += updated;
        tracks_removed += removed;
    }

    let total_tracks = db.count_tracks()?;
    Ok(ScanReport {
        folders_scanned: folders.len(),
        tracks_added,
        tracks_updated,
        tracks_removed,
        total_tracks,
    })
}

#[tauri::command]
pub fn detect_wmp_playlists(db: State<'_, Database>) -> Result<Vec<DetectedPlaylistFile>, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(music_dir) = dirs::audio_dir() {
        roots.push(music_dir.join("Playlists"));
        roots.push(music_dir);
    }
    if let Ok(folders) = db.list_folders() {
        for folder in folders {
            roots.push(PathBuf::from(folder.path));
        }
    }

    let mut seen_paths = HashSet::new();
    let mut detected = Vec::new();

    for root in roots {
        if !root.is_dir() {
            continue;
        }
        collect_playlists_recursive(&root, 0, 3, &mut seen_paths, &mut detected);
    }

    detected.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(detected)
}

#[tauri::command]
pub fn preview_playlist_file(path: String) -> Result<ParsedPlaylist, String> {
    parse_playlist_file(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_playlist_file(
    db: State<'_, Database>,
    path: String,
    custom_name: Option<String>,
) -> Result<ImportPlaylistReport, String> {
    let parsed = parse_playlist_file(Path::new(&path)).map_err(|e| e.to_string())?;
    let playlist_name = custom_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| parsed.name.clone());

    let mut track_ids = Vec::new();
    let mut missing_entries = Vec::new();

    for entry in &parsed.entries {
        if !entry.exists {
            missing_entries.push(entry.raw_src.clone());
            continue;
        }
        let Some(resolved) = &entry.resolved_path else {
            missing_entries.push(entry.raw_src.clone());
            continue;
        };

        let resolved_path = Path::new(resolved);
        match ensure_track_indexed(&db, None, resolved_path) {
            Ok((track_id, _)) => track_ids.push(track_id),
            Err(_) => missing_entries.push(entry.raw_src.clone()),
        }
    }

    let source_type = match parsed.format.as_str() {
        "wpl" | "zpl" => "wmp",
        _ => "m3u",
    };

    let created = db.create_playlist(&playlist_name, "", source_type, Some(&path))?;
    let playlist = if track_ids.is_empty() {
        created
    } else {
        db.add_tracks_to_playlist(&created.id, &track_ids)?
    };

    Ok(ImportPlaylistReport {
        imported_count: track_ids.len(),
        playlist,
        missing_entries,
    })
}

#[tauri::command]
pub fn create_playlist(
    db: State<'_, Database>,
    name: String,
    description: Option<String>,
) -> Result<Playlist, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Playlist name cannot be empty".to_string());
    }
    db.create_playlist(clean_name, description.as_deref().unwrap_or(""), "custom", None)
}

#[tauri::command]
pub fn rename_playlist(
    db: State<'_, Database>,
    playlist_id: String,
    name: String,
) -> Result<Playlist, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Playlist name cannot be empty".to_string());
    }
    db.rename_playlist(&playlist_id, clean_name)
}

#[tauri::command]
pub fn delete_playlist(db: State<'_, Database>, playlist_id: String) -> Result<(), String> {
    db.delete_playlist(&playlist_id)
}

#[tauri::command]
pub fn get_playlist_tracks(
    db: State<'_, Database>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    db.get_playlist_tracks(&playlist_id)
}

#[tauri::command]
pub fn add_tracks_to_playlist(
    db: State<'_, Database>,
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<Playlist, String> {
    db.add_tracks_to_playlist(&playlist_id, &track_ids)
}

#[tauri::command]
pub fn remove_track_from_playlist(
    db: State<'_, Database>,
    playlist_id: String,
    track_id: String,
) -> Result<Playlist, String> {
    db.remove_track_from_playlist(&playlist_id, &track_id)
}

#[tauri::command]
pub fn reorder_playlist_tracks(
    db: State<'_, Database>,
    playlist_id: String,
    ordered_track_ids: Vec<String>,
) -> Result<Vec<Track>, String> {
    db.reorder_playlist_tracks(&playlist_id, &ordered_track_ids)
}

#[tauri::command]
pub fn export_playlist_m3u8(
    db: State<'_, Database>,
    playlist_id: String,
    dest_path: String,
) -> Result<(), String> {
    let playlist = db.get_playlist(&playlist_id)?;
    let tracks = db.get_playlist_tracks(&playlist_id)?;
    let content = export_m3u8(&playlist.name, &tracks);
    fs::write(&dest_path, content).map_err(|e| format!("Failed to export playlist: {e}"))
}

#[tauri::command]
pub fn toggle_favorite(db: State<'_, Database>, track_id: String) -> Result<bool, String> {
    db.toggle_favorite(&track_id)
}

#[tauri::command]
pub fn record_play(db: State<'_, Database>, track_id: String) -> Result<u64, String> {
    db.record_play(&track_id)
}

#[tauri::command]
pub fn toggle_radio_favorite(
    db: State<'_, Database>,
    station: RadioStation,
) -> Result<bool, String> {
    db.toggle_radio_favorite(&station)
}

#[tauri::command]
pub fn save_setting(
    db: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    db.save_setting(&key, &value)
}

#[tauri::command]
pub fn import_cinematic_image(db: State<'_, Database>, path: String) -> Result<String, String> {
    let img_path = Path::new(&path);
    let data = fs::read(img_path).map_err(|e| format!("Failed to read image file: {e}"))?;
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
        _ => return Err("Unsupported image format. Please choose PNG, JPG, WebP, SVG, or GIF.".to_string()),
    };

    let hash = format!("cinematic-custom-{}", Uuid::new_v4());
    db.save_cover(&hash, mime, &data)?;
    Ok(hash)
}

#[tauri::command]
pub fn set_window_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<bool, String> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("Failed to set fullscreen: {e}"))?;
    window
        .is_fullscreen()
        .map_err(|e| format!("Failed to read fullscreen state: {e}"))
}

#[tauri::command]
pub fn is_window_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window
        .is_fullscreen()
        .map_err(|e| format!("Failed to read fullscreen state: {e}"))
}

#[tauri::command]
pub fn close_app_window(window: WebviewWindow) -> Result<(), String> {
    window
        .destroy()
        .map_err(|e| format!("Failed to close window: {e}"))
}

#[tauri::command]
pub async fn server_health(server_url: String) -> Result<ServerHealth, String> {
    sync::check_health(&server_url).await
}

#[tauri::command]
pub async fn server_login(
    db: State<'_, Database>,
    server_url: String,
    username: String,
    password: String,
) -> Result<AuthResponse, String> {
    sync::login(&db, &server_url, &username, &password).await
}

#[tauri::command]
pub async fn server_register(
    db: State<'_, Database>,
    server_url: String,
    username: String,
    password: String,
    invite_code: Option<String>,
) -> Result<AuthResponse, String> {
    sync::register(&db, &server_url, &username, &password, invite_code.as_deref()).await
}

#[tauri::command]
pub fn server_logout(db: State<'_, Database>) -> Result<(), String> {
    sync::logout(&db)
}

#[tauri::command]
pub async fn sync_with_server(db: State<'_, Database>) -> Result<SyncSummary, String> {
    sync::sync_library(&db).await
}

fn scan_single_folder(
    db: &Database,
    folder_id: &str,
    folder_path: &Path,
) -> Result<(usize, usize, usize), String> {
    let audio_files = scan_directory(folder_path);
    let mut present_paths = HashSet::with_capacity(audio_files.len());
    let mut added = 0;
    let mut updated = 0;

    for path in audio_files {
        let path_str = path.to_string_lossy().into_owned();
        present_paths.insert(path_str.to_ascii_lowercase());

        if let Ok((_, outcome)) = ensure_track_indexed(db, Some(folder_id), &path) {
            match outcome {
                UpsertOutcome::Added => added += 1,
                UpsertOutcome::Updated => updated += 1,
                UpsertOutcome::Unchanged => {}
            }
        }
    }

    let removed = db.prune_missing_folder_tracks(folder_id, &present_paths)?;
    Ok((added, updated, removed))
}

fn ensure_track_indexed(
    db: &Database,
    folder_id: Option<&str>,
    path: &Path,
) -> Result<(String, UpsertOutcome), String> {
    let path_str = path.to_string_lossy().into_owned();
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let size = meta.len();
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    if let Some((existing_id, old_size, old_mod)) = db.get_track_fingerprint(&path_str)? {
        if old_size == size && old_mod == modified_at {
            if let Some(fid) = folder_id {
                db.attach_track_to_folder(&existing_id, fid)?;
            }
            return Ok((existing_id, UpsertOutcome::Unchanged));
        }
    }

    let (scanned, cover) = extract_track_metadata(path).map_err(|e| e.to_string())?;
    db.upsert_track(folder_id, &scanned, cover.as_ref())
}

fn collect_playlists_recursive(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    seen: &mut HashSet<String>,
    out: &mut Vec<DetectedPlaylistFile>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth < max_depth {
                collect_playlists_recursive(&path, depth + 1, max_depth, seen, out);
            }
            continue;
        }
        if !is_supported_playlist_file(&path) {
            continue;
        }

        let key = path.to_string_lossy().to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }

        if let Ok(parsed) = parse_playlist_file(&path) {
            out.push(DetectedPlaylistFile {
                name: parsed.name,
                path: parsed.source_path,
                format: parsed.format,
                entry_count: parsed.entries.len(),
            });
        }
    }
}

fn strip_windows_verbatim_prefix(path: &Path) -> String {
    let s = path.to_string_lossy().into_owned();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}
