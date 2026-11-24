//! Native Windows Beamer / Presenter Stage Output window manager.
//!
//! Spawns a dedicated borderless fullscreen surface on a chosen external monitor / projector
//! in exact physical coordinates without stealing focus or minimizing when the operator
//! adjusts settings in Customize Studio or controls Spotify on the primary display.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::wallpaper::{MonitorInfo, WallpaperManager};

#[derive(Debug, Clone, Serialize)]
pub struct PresenterStatus {
    pub active: bool,
    pub monitor_id: Option<String>,
    pub monitor_name: Option<String>,
    pub always_on_top: bool,
}

#[derive(Default)]
struct PresenterState {
    active: bool,
    monitor_id: Option<String>,
    monitor_name: Option<String>,
    always_on_top: bool,
    window_label: Option<String>,
    generation: u64,
}

pub struct PresenterManager {
    state: Mutex<PresenterState>,
}

impl PresenterManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(PresenterState::default()),
        }
    }

    pub fn status(&self) -> PresenterStatus {
        self.state
            .lock()
            .map(|s| PresenterStatus {
                active: s.active,
                monitor_id: s.monitor_id.clone(),
                monitor_name: s.monitor_name.clone(),
                always_on_top: s.always_on_top,
            })
            .unwrap_or(PresenterStatus {
                active: false,
                monitor_id: None,
                monitor_name: None,
                always_on_top: true,
            })
    }

    fn resolve_target_monitor(
        monitors: &[MonitorInfo],
        requested_id: Option<&str>,
    ) -> Option<MonitorInfo> {
        if monitors.is_empty() {
            return None;
        }
        if let Some(req) = requested_id {
            if let Some(found) = monitors.iter().find(|m| m.id == req) {
                return Some(found.clone());
            }
        }
        // Smart default for Presenter / Beamer Mode: pick the first external (non-primary) display
        // so the operator keeps their laptop/main screen free for Studio & Spotify!
        if let Some(external) = monitors.iter().find(|m| !m.is_primary) {
            return Some(external.clone());
        }
        monitors.iter().find(|m| m.is_primary).cloned().or_else(|| monitors.first().cloned())
    }

    fn close_existing(&self, app: &AppHandle) {
        let prev_label = self
            .state
            .lock()
            .ok()
            .and_then(|mut s| s.window_label.take());
        if let Some(label) = prev_label {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.destroy();
            }
        }
    }

    /// Opens (or relocates) the dedicated borderless fullscreen Beamer/Stage Output window.
    /// Must run off the UI thread (inside an `async` Tauri command or async runtime task).
    pub fn enter(
        &self,
        app: &AppHandle,
        monitor_id: Option<String>,
        always_on_top: bool,
    ) -> Result<PresenterStatus, String> {
        self.close_existing(app);

        let physical = app.state::<WallpaperManager>().list_physical_monitors();
        let target = Self::resolve_target_monitor(&physical, monitor_id.as_deref())
            .ok_or_else(|| "No monitors detected for Beamer Output.".to_string())?;

        let gen = {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            guard.generation = guard.generation.wrapping_add(1);
            guard.generation
        };

        let label = format!("presenter-{gen}");
        let pres_win = WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::App("index.html?presenter=1".into()),
        )
        .title(format!("T - Visualizer Stage Output ({})", target.name))
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .always_on_top(always_on_top)
        .visible(true)
        .inner_size(640.0, 480.0)
        .build()
        .map_err(|e| format!("Failed creating Beamer output window: {e}"))?;

        let _ = pres_win.set_position(tauri::PhysicalPosition::new(target.x, target.y));
        let _ = pres_win.set_size(tauri::PhysicalSize::new(
            target.width.max(1) as u32,
            target.height.max(1) as u32,
        ));
        let _ = pres_win.show();

        // Position edge-to-edge in physical coordinates without stealing focus from main/Spotify
        #[cfg(windows)]
        {
            let win_main = pres_win.clone();
            let target_main = target.clone();
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            let _ = app.run_on_main_thread(move || {
                position_presenter_window_win32(&win_main, &target_main, always_on_top);
                let _ = tx.send(());
            });
            let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
        }

        // Keep state clean if the Beamer window is closed manually (Alt+F4 / Esc)
        let app_clone = app.clone();
        let expected_label = label.clone();
        pres_win.on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event {
                let mgr = app_clone.state::<PresenterManager>();
                let should_emit = if let Ok(mut s) = mgr.state.lock() {
                    if s.window_label.as_deref() == Some(expected_label.as_str()) {
                        s.active = false;
                        s.window_label = None;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                };
                if should_emit {
                    let _ = app_clone.emit("presenter-mode-changed", mgr.status());
                }
            }
        });

        let status = {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            guard.active = true;
            guard.monitor_id = Some(target.id.clone());
            guard.monitor_name = Some(target.name.clone());
            guard.always_on_top = always_on_top;
            guard.window_label = Some(label);
            PresenterStatus {
                active: true,
                monitor_id: Some(target.id),
                monitor_name: Some(target.name),
                always_on_top,
            }
        };

        let _ = app.emit("presenter-mode-changed", status.clone());
        Ok(status)
    }

    pub fn exit(&self, app: &AppHandle) -> Result<PresenterStatus, String> {
        self.close_existing(app);
        let status = {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            guard.active = false;
            guard.window_label = None;
            PresenterStatus {
                active: false,
                monitor_id: guard.monitor_id.clone(),
                monitor_name: guard.monitor_name.clone(),
                always_on_top: guard.always_on_top,
            }
        };
        let _ = app.emit("presenter-mode-changed", status.clone());
        Ok(status)
    }

    pub fn toggle(&self, app: &AppHandle, monitor_id: Option<String>) -> Result<PresenterStatus, String> {
        if self.status().active {
            self.exit(app)
        } else {
            self.enter(app, monitor_id, true)
        }
    }
}

#[cfg(windows)]
fn position_presenter_window_win32(
    window: &WebviewWindow,
    target: &MonitorInfo,
    always_on_top: bool,
) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, HWND_NOTOPMOST, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW, WS_BORDER, WS_CAPTION, WS_POPUP,
        WS_THICKFRAME,
    };

    let Ok(raw_hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = HWND(raw_hwnd.0);

    unsafe {
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let clean = (style & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_BORDER.0)) | WS_POPUP.0;
        let _ = SetWindowLongW(hwnd, GWL_STYLE, clean as i32);

        let z_order = if always_on_top {
            HWND_TOPMOST
        } else {
            HWND_NOTOPMOST
        };
        let _ = SetWindowPos(
            hwnd,
            z_order,
            target.x,
            target.y,
            target.width.max(1),
            target.height.max(1),
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );
    }
}
