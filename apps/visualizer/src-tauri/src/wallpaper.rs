//! Native Windows Live Desktop Wallpaper integration supporting:
//! - Windows 11 24H2 / 25H2 / 26H2 Raised Desktop (`Progman` + `SHELLDLL_DefView` Z-order sandwich)
//! - Classic Windows 10 / Windows 11 <=23H2 (`WorkerW` sibling)
//! - True multi-monitor **Mirrored** mode (one pixel-exact native-resolution window per monitor,
//!   handling mixed resolutions & mixed DPI scaling such as 200% + 100% with zero borders)
//! - Zero interference with desktop icons (`SHELLDLL_DefView` / `SysListView32` are never altered or invalidated).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_primary: bool,
}

#[derive(Default)]
struct WallpaperState {
    active: bool,
    mode_id: Option<String>,
    window_labels: Vec<String>,
    classic_workerw_hwnd: isize,
    generation: u64,
}

pub struct WallpaperManager {
    state: Mutex<WallpaperState>,
}

impl WallpaperManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(WallpaperState::default()),
        }
    }

    pub fn is_active(&self) -> bool {
        self.state.lock().map(|s| s.active).unwrap_or(false)
    }

    pub fn list_monitors(&self) -> Vec<MonitorInfo> {
        #[cfg(windows)]
        {
            win_wallpaper::enumerate_monitors()
        }
        #[cfg(not(windows))]
        {
            Vec::new()
        }
    }

    /// Enter (or reconfigure) Live Desktop Wallpaper mode using dedicated borderless child windows.
    /// The `main` window itself is never reparented — it simply hides to the System Tray so users
    /// can reopen Customize Studio cleanly at any time while wallpapers keep running live.
    pub fn enter(
        &self,
        app: &AppHandle,
        mode_id: Option<String>,
        hide_main: bool,
    ) -> Result<bool, String> {
        #[cfg(windows)]
        {
            // Cleanly close any previously spawned wallpaper surfaces first.
            self.destroy_surfaces(app)?;

            let all_monitors = win_wallpaper::enumerate_physical_monitors();
            if all_monitors.is_empty() {
                return Err("No displays detected.".to_string());
            }

            let effective_mode = mode_id.unwrap_or_else(|| {
                if all_monitors.len() > 1 {
                    "mirrored".to_string()
                } else {
                    all_monitors[0].id.clone()
                }
            });

            let targets: Vec<MonitorInfo> = match effective_mode.as_str() {
                "mirrored" => all_monitors.clone(),
                "span" | "all" => vec![win_wallpaper::virtual_span_monitor(&all_monitors)],
                specific => {
                    if let Some(m) = all_monitors.iter().find(|m| m.id == specific) {
                        vec![m.clone()]
                    } else if let Some(primary) = all_monitors.iter().find(|m| m.is_primary) {
                        vec![primary.clone()]
                    } else {
                        vec![all_monitors[0].clone()]
                    }
                }
            };

            let gen = {
                let mut guard = self.state.lock().map_err(|e| e.to_string())?;
                guard.generation = guard.generation.wrapping_add(1);
                guard.generation
            };

            let host = win_wallpaper::resolve_desktop_host();
            let mut spawned_labels: Vec<String> = Vec::with_capacity(targets.len());

            for (idx, target) in targets.iter().enumerate() {
                let label = format!("wallpaper-{gen}-{idx}");
                let wp_win = WebviewWindowBuilder::new(
                    app,
                    &label,
                    WebviewUrl::App("index.html?wallpaper=1".into()),
                )
                .title("T - Visualizer Wallpaper")
                .decorations(false)
                .shadow(false)
                .resizable(false)
                .skip_taskbar(true)
                .visible(false)
                .inner_size(640.0, 480.0)
                .build()
                .map_err(|e| format!("Failed creating wallpaper window for {}: {e}", target.name))?;

                // Move & size while still top-level so Windows delivers the target monitor's
                // true DPI (e.g. 200% vs 100%) to WebView2 before reparenting as WS_CHILD.
                let _ = wp_win.set_position(tauri::PhysicalPosition::new(target.x, target.y));
                let _ = wp_win.set_size(tauri::PhysicalSize::new(
                    target.width.max(1) as u32,
                    target.height.max(1) as u32,
                ));

                // Execute Win32 SetParent/SetWindowPos strictly on the HWND's owning main UI thread.
                let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
                let wp_win_main = wp_win.clone();
                let target_main = target.clone();
                app.run_on_main_thread(move || {
                    let res = win_wallpaper::attach_surface_to_desktop(
                        &wp_win_main,
                        &target_main,
                        host,
                    );
                    let _ = tx.send(res);
                })
                .map_err(|e| format!("Failed scheduling wallpaper attach on UI thread: {e}"))?;

                let attach_res = rx
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .map_err(|_| "Timed out attaching wallpaper surface".to_string())?;

                if let Err(err) = attach_res {
                    let _ = wp_win.destroy();
                    for prev in &spawned_labels {
                        if let Some(w) = app.get_webview_window(prev) {
                            let _ = w.destroy();
                        }
                    }
                    return Err(err);
                }

                // Re-pulse WM_SIZE briefly after WebView2 finishes mounting so Chromium fills
                // 100% of the monitor edge-to-edge even on mixed-DPI (200% + 100%) setups.
                let app_clone = app.clone();
                let label_clone = label.clone();
                let target_w = target.width;
                let target_h = target.height;
                std::thread::spawn(move || {
                    for delay_ms in [150u64, 450u64] {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        let app_inner = app_clone.clone();
                        let lbl = label_clone.clone();
                        let _ = app_clone.run_on_main_thread(move || {
                            if let Some(w) = app_inner.get_webview_window(&lbl) {
                                win_wallpaper::sync_surface_size(&w, target_w, target_h);
                            }
                        });
                    }
                });

                spawned_labels.push(label);
            }

            {
                let mut guard = self.state.lock().map_err(|e| e.to_string())?;
                guard.active = true;
                guard.mode_id = Some(effective_mode);
                guard.window_labels = spawned_labels;
                guard.classic_workerw_hwnd = host.classic_worker_raw();
            }

            if hide_main {
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.set_fullscreen(false);
                    let _ = main_win.hide();
                }
            }

            let _ = app.emit("wallpaper-mode-changed", true);
            Ok(true)
        }
        #[cfg(not(windows))]
        {
            let _ = (app, mode_id, hide_main);
            Err("Wallpaper mode is only supported on Windows.".to_string())
        }
    }

    /// Exit Live Desktop Wallpaper mode, cleanly destroying all wallpaper surfaces and restoring `main`.
    pub fn exit(&self, app: &AppHandle, show_main: bool) -> Result<bool, String> {
        #[cfg(windows)]
        {
            let was_active = self.destroy_surfaces(app)?;
            if show_main {
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.show();
                    let _ = main_win.unminimize();
                    let _ = main_win.set_focus();
                }
            }
            if was_active {
                let _ = app.emit("wallpaper-mode-changed", false);
            }
            Ok(false)
        }
        #[cfg(not(windows))]
        {
            let _ = (app, show_main);
            Ok(false)
        }
    }

    pub fn toggle(&self, app: &AppHandle, mode_id: Option<String>) -> Result<bool, String> {
        if self.is_active() {
            self.exit(app, true)
        } else {
            let saved_mode = mode_id.or_else(|| {
                self.state
                    .lock()
                    .ok()
                    .and_then(|s| s.mode_id.clone())
            });
            self.enter(app, saved_mode, true)
        }
    }

    #[cfg(windows)]
    fn destroy_surfaces(&self, app: &AppHandle) -> Result<bool, String> {
        let (was_active, labels, classic_worker) = {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            let was = guard.active || !guard.window_labels.is_empty();
            let labels = std::mem::take(&mut guard.window_labels);
            let cw = guard.classic_workerw_hwnd;
            guard.active = false;
            guard.classic_workerw_hwnd = 0;
            (was, labels, cw)
        };

        for label in labels {
            if let Some(w) = app.get_webview_window(&label) {
                win_wallpaper::detach_and_destroy_surface(&w);
            }
        }

        if was_active && classic_worker != 0 {
            win_wallpaper::refresh_classic_worker_only(classic_worker);
        }

        Ok(was_active)
    }
}

#[cfg(windows)]
mod win_wallpaper {
    use super::*;
    use std::ffi::c_void;
    use std::thread;
    use std::time::Duration;

    use windows::core::w;
    use windows::Win32::Foundation::{BOOL, COLORREF, HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, InvalidateRect, HDC, HMONITOR, MONITORINFOEXW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetSystemMetrics, GetWindowLongPtrW,
        GetWindowRect, PostMessageW, SendMessageTimeoutW, SetLayeredWindowAttributes, SetParent,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM, HWND_TOP,
        LWA_ALPHA, SMTO_NORMAL, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOSENDCHANGING,
        SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNA, WM_SIZE, WS_BORDER, WS_CAPTION, WS_CHILD,
        WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_DLGFRAME, WS_EX_APPWINDOW, WS_EX_CLIENTEDGE,
        WS_EX_DLGMODALFRAME, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP,
        WS_EX_STATICEDGE, WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
    };

    const MONITORINFOF_PRIMARY: u32 = 1;

    #[derive(Clone, Copy)]
    pub enum DesktopHost {
        /// Windows 11 24H2 / 25H2 / 26H2 Raised Desktop:
        /// `SHELLDLL_DefView` is a direct child of `Progman`.
        /// We attach our layered child window directly to `Progman` and insert it strictly
        /// BEHIND `def_view` — never modifying or invalidating desktop icons.
        RaisedProgman { progman: isize, def_view: isize },
        /// Classic Windows 10 & Windows 11 <=23H2:
        /// Standalone top-level `WorkerW` behind the `WorkerW` holding `SHELLDLL_DefView`.
        ClassicWorkerW { workerw: isize },
        /// Safe fallback if shell hides both layers.
        FallbackBottom,
    }

    impl DesktopHost {
        pub fn classic_worker_raw(self) -> isize {
            match self {
                DesktopHost::ClassicWorkerW { workerw } => workerw,
                _ => 0,
            }
        }
    }

    unsafe extern "system" fn monitor_enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<MonitorInfo>);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(hmonitor, &mut info.monitorInfo as *mut _).as_bool() {
            let r = info.monitorInfo.rcMonitor;
            let w = r.right - r.left;
            let h = r.bottom - r.top;
            let is_primary = (info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0;
            let idx = list.len() + 1;
            let name = if is_primary {
                format!("Monitor {idx} (Primary · {w}×{h})")
            } else {
                format!("Monitor {idx} ({w}×{h})")
            };
            list.push(MonitorInfo {
                id: format!("monitor-{idx}"),
                name,
                x: r.left,
                y: r.top,
                width: w,
                height: h,
                is_primary,
            });
        }
        BOOL(1)
    }

    pub fn enumerate_physical_monitors() -> Vec<MonitorInfo> {
        let mut list: Vec<MonitorInfo> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(monitor_enum_proc),
                LPARAM(&mut list as *mut Vec<MonitorInfo> as isize),
            );
        }
        if list.is_empty() {
            unsafe {
                let w = GetSystemMetrics(SM_CXSCREEN).max(1280);
                let h = GetSystemMetrics(SM_CYSCREEN).max(720);
                list.push(MonitorInfo {
                    id: "monitor-1".to_string(),
                    name: format!("Primary Monitor ({w}×{h})"),
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    is_primary: true,
                });
            }
        }
        list
    }

    pub fn virtual_span_monitor(monitors: &[MonitorInfo]) -> MonitorInfo {
        unsafe {
            let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if vw > 0 && vh > 0 {
                return MonitorInfo {
                    id: "span".to_string(),
                    name: format!("All Monitors · Stretched Span ({vw}×{vh})"),
                    x: vx,
                    y: vy,
                    width: vw,
                    height: vh,
                    is_primary: false,
                };
            }
        }
        let min_x = monitors.iter().map(|m| m.x).min().unwrap_or(0);
        let min_y = monitors.iter().map(|m| m.y).min().unwrap_or(0);
        let max_x = monitors
            .iter()
            .map(|m| m.x + m.width)
            .max()
            .unwrap_or(1920);
        let max_y = monitors
            .iter()
            .map(|m| m.y + m.height)
            .max()
            .unwrap_or(1080);
        MonitorInfo {
            id: "span".to_string(),
            name: format!("All Monitors · Stretched Span ({}×{})", max_x - min_x, max_y - min_y),
            x: min_x,
            y: min_y,
            width: max_x - min_x,
            height: max_y - min_y,
            is_primary: false,
        }
    }

    /// Returns the list shown in the UI monitor selector:
    /// - When multiple monitors exist: `mirrored` first (native per-monitor windows),
    ///   then each individual monitor, then optional `span`.
    pub fn enumerate_monitors() -> Vec<MonitorInfo> {
        let physical = enumerate_physical_monitors();
        if physical.len() <= 1 {
            return physical;
        }
        let mut options = Vec::with_capacity(physical.len() + 2);
        options.push(MonitorInfo {
            id: "mirrored".to_string(),
            name: format!(
                "All {} Monitors · Mirrored (Native Resolution)",
                physical.len()
            ),
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            is_primary: false,
        });
        options.extend(physical.iter().cloned());
        options.push(virtual_span_monitor(&physical));
        options
    }

    unsafe extern "system" fn find_classic_workerw_proc(top_hwnd: HWND, lparam: LPARAM) -> BOOL {
        if let Ok(def_view) = FindWindowExW(top_hwnd, HWND::default(), w!("SHELLDLL_DefView"), None)
        {
            if !def_view.0.is_null() {
                if let Ok(worker) = FindWindowExW(HWND::default(), top_hwnd, w!("WorkerW"), None) {
                    if !worker.0.is_null() {
                        *(lparam.0 as *mut isize) = worker.0 as isize;
                        return BOOL(0);
                    }
                }
            }
        }
        BOOL(1)
    }

    unsafe fn find_existing_classic_workerw() -> Option<HWND> {
        let mut found: isize = 0;
        let _ = EnumWindows(
            Some(find_classic_workerw_proc),
            LPARAM(&mut found as *mut isize as isize),
        );
        if found != 0 {
            Some(HWND(found as *mut c_void))
        } else {
            None
        }
    }

    /// Detects the desktop host layer WITHOUT disturbing desktop icons.
    /// Crucially, on Windows 11 24H2/25H2/26H2 (`WS_EX_NOREDIRECTIONBITMAP` Progman),
    /// `SHELLDLL_DefView` and `WorkerW` already exist as direct children of `Progman`,
    /// so we NEVER spam `0x052C` (which can reset mixed-DPI icon layouts).
    pub fn resolve_desktop_host() -> DesktopHost {
        unsafe {
            let Ok(progman) = FindWindowW(w!("Progman"), None) else {
                return DesktopHost::FallbackBottom;
            };
            if progman.0.is_null() {
                return DesktopHost::FallbackBottom;
            }

            // 1. Check for Windows 11 24H2+ Raised Desktop FIRST (without sending 0x052C).
            let progman_ex = GetWindowLongPtrW(progman, GWL_EXSTYLE) as u32;
            let is_raised = (progman_ex & WS_EX_NOREDIRECTIONBITMAP.0) != 0;
            let direct_def_view =
                FindWindowExW(progman, HWND::default(), w!("SHELLDLL_DefView"), None)
                    .ok()
                    .filter(|h| !h.0.is_null());
            let direct_worker = FindWindowExW(progman, HWND::default(), w!("WorkerW"), None)
                .ok()
                .filter(|h| !h.0.is_null());

            if let Some(def_view) = direct_def_view {
                if is_raised || direct_worker.is_some() {
                    return DesktopHost::RaisedProgman {
                        progman: progman.0 as isize,
                        def_view: def_view.0 as isize,
                    };
                }
            }

            // 2. Check if a Classic WorkerW already exists (again, no 0x052C needed).
            if let Some(workerw) = find_existing_classic_workerw() {
                return DesktopHost::ClassicWorkerW {
                    workerw: workerw.0 as isize,
                };
            }

            // 3. Only on Win10 / Win11 <=23H2 where WorkerW has not been spawned yet:
            //    send 0x052C ONCE to spawn the classic WorkerW behind SHELLDLL_DefView.
            let mut result: usize = 0;
            let _ = SendMessageTimeoutW(
                progman,
                0x052C,
                WPARAM(0xD),
                LPARAM(0x1),
                SMTO_NORMAL,
                1000,
                Some(&mut result),
            );
            thread::sleep(Duration::from_millis(40));

            if let Some(workerw) = find_existing_classic_workerw() {
                return DesktopHost::ClassicWorkerW {
                    workerw: workerw.0 as isize,
                };
            }

            // Re-check raised Progman if 0x052C spawned a child WorkerW under Progman.
            if let Ok(def_view) =
                FindWindowExW(progman, HWND::default(), w!("SHELLDLL_DefView"), None)
            {
                if !def_view.0.is_null() {
                    return DesktopHost::RaisedProgman {
                        progman: progman.0 as isize,
                        def_view: def_view.0 as isize,
                    };
                }
            }

            DesktopHost::FallbackBottom
        }
    }

    pub fn attach_surface_to_desktop(
        window: &WebviewWindow,
        target: &MonitorInfo,
        host: DesktopHost,
    ) -> Result<(), String> {
        let raw_hwnd = window
            .hwnd()
            .map_err(|e| format!("Could not get wallpaper HWND: {e}"))?;
        let hwnd = HWND(raw_hwnd.0 as *mut c_void);

        unsafe {
            // Strip EVERY border/frame/edge style so zero invisible margin or shadow remains.
            let orig_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            let orig_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let strip_style = (WS_CAPTION.0
                | WS_THICKFRAME.0
                | WS_BORDER.0
                | WS_DLGFRAME.0
                | WS_MINIMIZEBOX.0
                | WS_MAXIMIZEBOX.0
                | WS_SYSMENU.0
                | WS_POPUP.0) as isize;
            let strip_ex = (WS_EX_APPWINDOW.0
                | WS_EX_DLGMODALFRAME.0
                | WS_EX_WINDOWEDGE.0
                | WS_EX_CLIENTEDGE.0
                | WS_EX_STATICEDGE.0) as isize;

            match host {
                DesktopHost::RaisedProgman { progman, def_view } => {
                    let progman_hwnd = HWND(progman as *mut c_void);
                    let def_view_hwnd = HWND(def_view as *mut c_void);
                    let clean_style = (orig_style & !strip_style)
                        | (WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPSIBLINGS.0 | WS_CLIPCHILDREN.0)
                            as isize;
                    let clean_ex = (orig_ex & !strip_ex)
                        | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_LAYERED.0) as isize;

                    SetWindowLongPtrW(hwnd, GWL_STYLE, clean_style);
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, clean_ex);
                    let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
                    let _ = SetParent(hwnd, progman_hwnd);

                    let mut parent_rect = RECT::default();
                    let _ = GetWindowRect(progman_hwnd, &mut parent_rect);
                    let local_x = target.x - parent_rect.left;
                    let local_y = target.y - parent_rect.top;

                    // Insert strictly BEHIND `def_view` (desktop icons stay on top, 100% untouched).
                    let _ = SetWindowPos(
                        hwnd,
                        def_view_hwnd,
                        local_x,
                        local_y,
                        target.width,
                        target.height,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOSENDCHANGING,
                    );
                }
                DesktopHost::ClassicWorkerW { workerw } => {
                    let workerw_hwnd = HWND(workerw as *mut c_void);
                    let clean_style = (orig_style & !strip_style)
                        | (WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPSIBLINGS.0 | WS_CLIPCHILDREN.0)
                            as isize;
                    let clean_ex = (orig_ex & !strip_ex)
                        | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;

                    SetWindowLongPtrW(hwnd, GWL_STYLE, clean_style);
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, clean_ex);
                    let _ = SetParent(hwnd, workerw_hwnd);

                    let mut parent_rect = RECT::default();
                    let _ = GetWindowRect(workerw_hwnd, &mut parent_rect);
                    let local_x = target.x - parent_rect.left;
                    let local_y = target.y - parent_rect.top;

                    let _ = SetWindowPos(
                        hwnd,
                        HWND_TOP,
                        local_x,
                        local_y,
                        target.width,
                        target.height,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOSENDCHANGING,
                    );
                }
                DesktopHost::FallbackBottom => {
                    let clean_style =
                        (orig_style & !strip_style) | (WS_POPUP.0 | WS_VISIBLE.0) as isize;
                    let clean_ex = (orig_ex & !strip_ex)
                        | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;

                    SetWindowLongPtrW(hwnd, GWL_STYLE, clean_style);
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, clean_ex);
                    let _ = SetWindowPos(
                        hwnd,
                        HWND_BOTTOM,
                        target.x,
                        target.y,
                        target.width,
                        target.height,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOSENDCHANGING,
                    );
                }
            }

            let _ = ShowWindow(hwnd, SW_SHOWNA);

            // Step 3: Explicitly sync WebView2 controller surface bounds to the exact physical
            // width x height so Chromium fills every pixel edge-to-edge with zero borders.
            let packed_size = (((target.height as u16) as usize) << 16)
                | ((target.width as u16) as usize);
            let _ = PostMessageW(hwnd, WM_SIZE, WPARAM(0), LPARAM(packed_size as isize));
        }

        Ok(())
    }

    pub fn sync_surface_size(window: &WebviewWindow, width: i32, height: i32) {
        if let Ok(raw_hwnd) = window.hwnd() {
            let hwnd = HWND(raw_hwnd.0 as *mut c_void);
            unsafe {
                let packed_size =
                    (((height as u16) as usize) << 16) | ((width as u16) as usize);
                let _ = PostMessageW(hwnd, WM_SIZE, WPARAM(0), LPARAM(packed_size as isize));
            }
        }
    }

    pub fn detach_and_destroy_surface(window: &WebviewWindow) {
        if let Ok(raw_hwnd) = window.hwnd() {
            let hwnd = HWND(raw_hwnd.0 as *mut c_void);
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
                let _ = SetParent(hwnd, HWND::default());
            }
        }
        let _ = window.destroy();
    }

    /// Only invalidates the classic background WorkerW (never `Progman` or `SHELLDLL_DefView`).
    pub fn refresh_classic_worker_only(classic_worker_raw: isize) {
        if classic_worker_raw == 0 {
            return;
        }
        unsafe {
            let worker = HWND(classic_worker_raw as *mut c_void);
            let _ = InvalidateRect(worker, None, true);
        }
    }
}
