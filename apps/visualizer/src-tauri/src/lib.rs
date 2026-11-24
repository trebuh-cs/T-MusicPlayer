//! Tauri v2 standalone Windows visualizer with WASAPI loopback FFT, Windows GSMTC Now Playing
//! detection, portable .tviz theme export/import, System Tray, and multi-monitor native-resolution
//! Live Desktop Wallpaper mode.

mod audio;
mod autostart;
mod media;
mod presenter;
mod wallpaper;

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use base64::Engine as _;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow};

use crate::audio::{AudioDeviceInfo, AudioEngine, AudioStatus};
use crate::media::{MediaTracker, NowPlayingMedia};
use crate::presenter::{PresenterManager, PresenterStatus};
use crate::wallpaper::{MonitorInfo, WallpaperManager};

struct SyncedConfigState(Mutex<Option<String>>);

#[tauri::command]
fn get_fft_frame(audio: State<'_, AudioEngine>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(audio.snapshot_bins())
}

#[tauri::command]
fn get_audio_status(audio: State<'_, AudioEngine>) -> AudioStatus {
    audio.get_status()
}

#[tauri::command]
fn list_audio_devices(audio: State<'_, AudioEngine>) -> Vec<AudioDeviceInfo> {
    audio.list_devices()
}

#[tauri::command]
fn select_audio_device(audio: State<'_, AudioEngine>, device_id: Option<String>) {
    audio.select_device(device_id);
}

#[tauri::command]
fn get_now_playing(tracker: State<'_, MediaTracker>) -> Option<NowPlayingMedia> {
    tracker.get_current()
}

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
    keep_main_visible: Option<bool>,
) -> Result<bool, String> {
    if enabled {
        let hide_main = !keep_main_visible.unwrap_or(false);
        wp.enter(&app, monitor_id, hide_main)
    } else {
        wp.exit(&app, true)
    }
}

#[tauri::command]
fn sync_visualizer_config(
    app: AppHandle,
    cfg_state: State<'_, SyncedConfigState>,
    config_json: String,
) {
    if let Ok(mut guard) = cfg_state.0.lock() {
        *guard = Some(config_json.clone());
    }
    let _ = app.emit("visualizer-config-sync", config_json);
}

#[tauri::command]
fn get_synced_visualizer_config(cfg_state: State<'_, SyncedConfigState>) -> Option<String> {
    cfg_state.0.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn set_window_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<bool, String> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("Failed toggling fullscreen: {e}"))?;
    window
        .is_fullscreen()
        .map_err(|e| format!("Failed reading fullscreen state: {e}"))
}

#[tauri::command]
fn is_window_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window
        .is_fullscreen()
        .map_err(|e| format!("Failed reading fullscreen state: {e}"))
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

#[tauri::command]
fn get_autostart_wallpaper() -> bool {
    autostart::is_autostart_wallpaper_enabled()
}

#[tauri::command]
fn set_autostart_wallpaper(enabled: bool) -> Result<bool, String> {
    autostart::set_autostart_wallpaper_enabled(enabled)
}

#[tauri::command]
fn launched_in_wallpaper_autostart() -> bool {
    autostart::has_wallpaper_launch_flag()
}

#[tauri::command]
fn get_presenter_status(pres: State<'_, PresenterManager>) -> PresenterStatus {
    pres.status()
}

#[tauri::command]
async fn set_presenter_mode(
    app: AppHandle,
    pres: State<'_, PresenterManager>,
    enabled: bool,
    monitor_id: Option<String>,
    always_on_top: Option<bool>,
) -> Result<PresenterStatus, String> {
    if enabled {
        pres.enter(&app, monitor_id, always_on_top.unwrap_or(true))
    } else {
        pres.exit(&app)
    }
}

#[tauri::command]
fn hide_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    let wp = app.state::<WallpaperManager>();
    let _ = wp.exit(&app, false);
    let pres = app.state::<PresenterManager>();
    let _ = pres.exit(&app);
    app.state::<AudioEngine>().stop();
    app.state::<MediaTracker>().stop();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AudioEngine::start());
            app.manage(MediaTracker::start());
            app.manage(WallpaperManager::new());
            app.manage(PresenterManager::new());
            app.manage(SyncedConfigState(Mutex::new(None)));

            let open_item = MenuItem::with_id(
                app,
                "open_studio",
                "Open / Customize Studio",
                true,
                None::<&str>,
            )?;
            let wp_item = MenuItem::with_id(
                app,
                "toggle_wallpaper",
                "Toggle Live Wallpaper Mode",
                true,
                None::<&str>,
            )?;
            let pres_item = MenuItem::with_id(
                app,
                "toggle_presenter",
                "Toggle Beamer / Stage Output",
                true,
                None::<&str>,
            )?;
            let fs_item = MenuItem::with_id(
                app,
                "toggle_fullscreen",
                "Toggle Fullscreen",
                true,
                None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit T - Visualizer", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[&open_item, &wp_item, &pres_item, &fs_item, &sep, &quit_item],
            )?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("T - Visualizer (Live Audio & Wallpaper)")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_studio" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("open-customize", ());
                        }
                    }
                    "toggle_wallpaper" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let wp = app_handle.state::<WallpaperManager>();
                            let _ = wp.toggle(&app_handle, None);
                        });
                    }
                    "toggle_presenter" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let pres = app_handle.state::<PresenterManager>();
                            let _ = pres.toggle(&app_handle, None);
                        });
                    }
                    "toggle_fullscreen" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let next = !window.is_fullscreen().unwrap_or(false);
                            let _ = window.set_fullscreen(next);
                        }
                    }
                    "quit" => {
                        let wp = app.state::<WallpaperManager>();
                        let _ = wp.exit(app, false);
                        let pres = app.state::<PresenterManager>();
                        let _ = pres.exit(app);
                        app.state::<AudioEngine>().stop();
                        app.state::<MediaTracker>().stop();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _ = tray_builder.build(app)?;

            // When launched via Windows Startup (`--wallpaper`), hide `main` immediately
            // so there is zero window flash on PC boot; frontend hydrates saved settings
            // and enters Live Wallpaper Mode automatically.
            if autostart::has_wallpaper_launch_flag() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_fft_frame,
            get_audio_status,
            list_audio_devices,
            select_audio_device,
            get_now_playing,
            list_monitors,
            is_wallpaper_mode,
            set_wallpaper_mode,
            sync_visualizer_config,
            get_synced_visualizer_config,
            set_window_fullscreen,
            is_window_fullscreen,
            load_image_as_data_url,
            save_text_file,
            read_text_file,
            get_autostart_wallpaper,
            set_autostart_wallpaper,
            launched_in_wallpaper_autostart,
            get_presenter_status,
            set_presenter_mode,
            hide_main_window,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building T - Visualizer");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let wp = app_handle.state::<WallpaperManager>();
            let _ = wp.exit(app_handle, false);
            let pres = app_handle.state::<PresenterManager>();
            let _ = pres.exit(app_handle);
            app_handle.state::<AudioEngine>().stop();
            app_handle.state::<MediaTracker>().stop();
        }
    });
}
