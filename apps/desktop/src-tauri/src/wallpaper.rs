//! Native Windows Live Desktop Wallpaper integration supporting:
//! - Windows 11 24H2 / 25H2 / 26H2 Raised Desktop (`Progman` -> child `WorkerW`)
//! - Classic Windows 10 / Windows 11 <=23H2 (sibling `WorkerW`)
//! - True multi-monitor **Mirrored** mode (one dedicated visible WebView2 window per monitor,
//!   edge-to-edge in each monitor's native physical resolution & DPI)
//! - Zero interference with desktop icons (`SHELLDLL_DefView` / `SysListView32` are never altered or invalidated).

use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;
#[cfg(windows)]
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
    workerw_hwnd: isize,
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
    /// Must be invoked off the UI main thread (e.g. `async fn` command or async runtime task)
    /// because `WebviewWindowBuilder::build()` dispatches synchronously onto the Windows UI loop.
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
            win_wallpaper::log_host_info(host, &targets);

            let mut spawned_labels: Vec<String> = Vec::with_capacity(targets.len());

            for (idx, target) in targets.iter().enumerate() {
                let label = format!("wallpaper-{gen}-{idx}");
                // CRITICAL: `visible(true)` ensures WebView2 initializes with
                // `ICoreWebView2Controller::put_IsVisible(TRUE)` so Chromium actually renders!
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
                .focused(false)
                .visible(true)
                .inner_size(640.0, 480.0)
                .build()
                .map_err(|e| format!("Failed creating wallpaper window for {}: {e}", target.name))?;

                // Place & size on the exact target monitor in physical pixels while top-level
                // so Windows delivers that monitor's true DPI (e.g. 200% vs 100%) to WebView2
                // before parenting as WS_CHILD.
                let _ = wp_win.set_position(tauri::PhysicalPosition::new(target.x, target.y));
                let _ = wp_win.set_size(tauri::PhysicalSize::new(
                    target.width.max(1) as u32,
                    target.height.max(1) as u32,
                ));
                let _ = wp_win.show();

                // Execute Win32 SetParent/SetWindowPos strictly on the HWND's owning main UI thread.
                let (tx, rx) = std::sync::mpsc::channel::<Result<(i32, i32), String>>();
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

                let (local_x, local_y) = match attach_res {
                    Ok(pos) => pos,
                    Err(err) => {
                        let _ = wp_win.destroy();
                        for prev in &spawned_labels {
                            if let Some(w) = app.get_webview_window(prev) {
                                let _ = w.destroy();
                            }
                        }
                        return Err(err);
                    }
                };

                // Re-sync HWND rect + WebView2 bounds briefly after WebView2 finishes mounting
                // so Chromium fills 100% of every monitor edge-to-edge even on mixed-DPI setups.
                let app_clone = app.clone();
                let label_clone = label.clone();
                let target_w = target.width;
                let target_h = target.height;
                std::thread::spawn(move || {
                    for delay_ms in [180u64, 550u64] {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        let app_inner = app_clone.clone();
                        let lbl = label_clone.clone();
                        let _ = app_clone.run_on_main_thread(move || {
                            if let Some(w) = app_inner.get_webview_window(&lbl) {
                                win_wallpaper::sync_surface_bounds(
                                    &w, local_x, local_y, target_w, target_h,
                                );
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
                guard.workerw_hwnd = host.worker_raw();
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
        let (was_active, labels, worker_raw) = {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            let was = guard.active || !guard.window_labels.is_empty();
            let labels = std::mem::take(&mut guard.window_labels);
            let wr = guard.workerw_hwnd;
            guard.active = false;
            guard.workerw_hwnd = 0;
            (was, labels, wr)
        };

        for label in labels {
            if let Some(w) = app.get_webview_window(&label) {
                win_wallpaper::detach_and_destroy_surface(&w);
            }
        }

        if was_active && worker_raw != 0 {
            win_wallpaper::refresh_worker_only(worker_raw);
        }

        Ok(was_active)
    }
}

#[cfg(windows)]
mod win_wallpaper {
    use super::*;
    use std::ffi::c_void;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::thread;
    use std::time::Duration;

    use windows::core::w;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, InvalidateRect, HDC, HMONITOR, MONITORINFOEXW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetClientRect, GetSystemMetrics,
        GetWindowLongPtrW, GetWindowRect, IsWindowVisible, PostMessageW, SendMessageTimeoutW,
        SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE,
        HWND_BOTTOM, HWND_TOP, SMTO_NORMAL, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN,
        SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOSENDCHANGING, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNA, WM_SIZE,
        WS_BORDER, WS_CAPTION, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_DLGFRAME,
        WS_EX_APPWINDOW, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_NOACTIVATE,
        WS_EX_STATICEDGE, WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
    };

    const MONITORINFOF_PRIMARY: u32 = 1;

    #[derive(Clone, Copy, Debug)]
    pub enum DesktopHost {
        /// Dedicated `WorkerW` wallpaper surface (either Win11 24H2/25H2/26H2 child `WorkerW`
        /// under `Progman` OR classic Win10/Win11 <=23H2 sibling `WorkerW` behind `SHELLDLL_DefView`).
        /// WebView2 DirectComposition renders natively inside `WorkerW` without `WS_EX_LAYERED`,
        /// and `SHELLDLL_DefView` (desktop icons) is never touched.
        WorkerW { workerw: isize, #[allow(dead_code)] is_child_of_progman: bool },
        /// Safe fallback if shell hides WorkerW: bottom-most borderless desktop window.
        FallbackBottom,
    }

    impl DesktopHost {
        pub fn worker_raw(self) -> isize {
            match self {
                DesktopHost::WorkerW { workerw, .. } => workerw,
                DesktopHost::FallbackBottom => 0,
            }
        }
    }

    fn log_line(msg: &str) {
        let path = std::env::temp_dir().join("t-visualizer-wallpaper.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{msg}");
        }
    }

    pub fn log_host_info(host: DesktopHost, targets: &[MonitorInfo]) {
        let rect_str = if host.worker_raw() != 0 {
            let mut r = RECT::default();
            let hwnd = HWND(host.worker_raw() as *mut c_void);
            unsafe {
                let vis = IsWindowVisible(hwnd).as_bool();
                let _ = GetWindowRect(hwnd, &mut r);
                format!(
                    "vis={vis} rect=({}, {}, {}x{})",
                    r.left,
                    r.top,
                    r.right - r.left,
                    r.bottom - r.top
                )
            }
        } else {
            "none".to_string()
        };
        log_line(&format!(
            "--- ENTER WALLPAPER host={host:?} {rect_str} targets={} ---",
            targets.len()
        ));
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
            name: format!(
                "All Monitors · Stretched Span ({}×{})",
                max_x - min_x,
                max_y - min_y
            ),
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

    unsafe fn is_usable_worker(hwnd: HWND) -> bool {
        if hwnd.0.is_null() {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(hwnd, &mut r).is_err() {
            return false;
        }
        (r.right - r.left) >= 200 && (r.bottom - r.top) >= 200
    }

    unsafe extern "system" fn find_classic_workerw_proc(top_hwnd: HWND, lparam: LPARAM) -> BOOL {
        if let Ok(def_view) = FindWindowExW(top_hwnd, HWND::default(), w!("SHELLDLL_DefView"), None)
        {
            if !def_view.0.is_null() {
                if let Ok(worker) = FindWindowExW(HWND::default(), top_hwnd, w!("WorkerW"), None) {
                    if is_usable_worker(worker) {
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

    unsafe fn find_existing_progman_child_workerw(progman: HWND) -> Option<HWND> {
        let mut child = HWND::default();
        while let Ok(w) = FindWindowExW(progman, child, w!("WorkerW"), None) {
            if w.0.is_null() {
                break;
            }
            if is_usable_worker(w) {
                return Some(w);
            }
            child = w;
        }
        None
    }

    /// Detects the desktop wallpaper `WorkerW` WITHOUT disturbing desktop icons.
    /// 1. Checks FIRST if a usable `WorkerW` ALREADY exists (either classic sibling OR Win11 24H2/26H2
    ///    direct child of `Progman`) — avoiding any unnecessary `0x052C` broadcast!
    /// 2. Only if no `WorkerW` exists yet, sends `0x052C` ONCE (never twice) and re-checks.
    pub fn resolve_desktop_host() -> DesktopHost {
        unsafe {
            let Ok(progman) = FindWindowW(w!("Progman"), None) else {
                return DesktopHost::FallbackBottom;
            };
            if progman.0.is_null() {
                return DesktopHost::FallbackBottom;
            }

            // 1. Check already-existing Win11 24H2/25H2/26H2 child WorkerW under Progman FIRST.
            if let Some(child_worker) = find_existing_progman_child_workerw(progman) {
                if !IsWindowVisible(child_worker).as_bool() {
                    let _ = ShowWindow(child_worker, SW_SHOWNA);
                }
                return DesktopHost::WorkerW {
                    workerw: child_worker.0 as isize,
                    is_child_of_progman: true,
                };
            }

            // 2. Check already-existing classic sibling WorkerW (Win10 / Win11 <=23H2).
            if let Some(workerw) = find_existing_classic_workerw() {
                if !IsWindowVisible(workerw).as_bool() {
                    let _ = ShowWindow(workerw, SW_SHOWNA);
                }
                return DesktopHost::WorkerW {
                    workerw: workerw.0 as isize,
                    is_child_of_progman: false,
                };
            }

            // 3. No WorkerW exists yet — send 0x052C ONCE (never twice) to create it.
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
            thread::sleep(Duration::from_millis(60));

            if let Some(workerw) = find_existing_classic_workerw() {
                if !IsWindowVisible(workerw).as_bool() {
                    let _ = ShowWindow(workerw, SW_SHOWNA);
                }
                return DesktopHost::WorkerW {
                    workerw: workerw.0 as isize,
                    is_child_of_progman: false,
                };
            }

            if let Some(child_worker) = find_existing_progman_child_workerw(progman) {
                if !IsWindowVisible(child_worker).as_bool() {
                    let _ = ShowWindow(child_worker, SW_SHOWNA);
                }
                return DesktopHost::WorkerW {
                    workerw: child_worker.0 as isize,
                    is_child_of_progman: true,
                };
            }

            DesktopHost::FallbackBottom
        }
    }

    pub fn attach_surface_to_desktop(
        window: &WebviewWindow,
        target: &MonitorInfo,
        host: DesktopHost,
    ) -> Result<(i32, i32), String> {
        let raw_hwnd = window
            .hwnd()
            .map_err(|e| format!("Could not get wallpaper HWND: {e}"))?;
        let hwnd = HWND(raw_hwnd.0 as *mut c_void);

        unsafe {
            // Strip EVERY border/frame/edge style so zero invisible margin or shadow remains.
            // Crucially: do NOT set WS_EX_LAYERED on a WebView2/DirectComposition child HWND!
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

            let (local_x, local_y) = match host {
                DesktopHost::WorkerW { workerw, .. } => {
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
                    let lx = target.x - parent_rect.left;
                    let ly = target.y - parent_rect.top;

                    let _ = SetWindowPos(
                        hwnd,
                        HWND_TOP,
                        lx,
                        ly,
                        target.width,
                        target.height,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOSENDCHANGING,
                    );
                    (lx, ly)
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
                    (target.x, target.y)
                }
            };

            let _ = ShowWindow(hwnd, SW_SHOWNA);

            // Sync WebView2 controller surface bounds to the exact physical width x height.
            let packed_size = (((target.height as u16) as usize) << 16)
                | ((target.width as u16) as usize);
            let _ = PostMessageW(hwnd, WM_SIZE, WPARAM(0), LPARAM(packed_size as isize));

            let mut cr = RECT::default();
            let _ = GetClientRect(hwnd, &mut cr);
            log_line(&format!(
                "  attached '{}' target=({}, {}, {}x{}) local=({}, {}) client={}x{}",
                target.name,
                target.x,
                target.y,
                target.width,
                target.height,
                local_x,
                local_y,
                cr.right - cr.left,
                cr.bottom - cr.top
            ));

            Ok((local_x, local_y))
        }
    }

    pub fn sync_surface_bounds(
        window: &WebviewWindow,
        local_x: i32,
        local_y: i32,
        width: i32,
        height: i32,
    ) {
        if let Ok(raw_hwnd) = window.hwnd() {
            let hwnd = HWND(raw_hwnd.0 as *mut c_void);
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOP,
                    local_x,
                    local_y,
                    width,
                    height,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING,
                );
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

    /// Only invalidates the wallpaper `WorkerW` itself (never `Progman` or `SHELLDLL_DefView`).
    pub fn refresh_worker_only(worker_raw: isize) {
        if worker_raw == 0 {
            return;
        }
        unsafe {
            let worker = HWND(worker_raw as *mut c_void);
            let _ = InvalidateRect(worker, None, true);
        }
    }
}
