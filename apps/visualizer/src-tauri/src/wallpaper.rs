//! Native Windows Live Desktop Wallpaper integration via `Progman` / `WorkerW`.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, WebviewWindow};

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
    monitor_id: Option<String>,
    saved_style: isize,
    saved_ex_style: isize,
    saved_rect: (i32, i32, i32, i32),
    workerw_hwnd: isize,
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

    pub fn enter(
        &self,
        window: &WebviewWindow,
        monitor_id: Option<String>,
    ) -> Result<bool, String> {
        #[cfg(windows)]
        {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            win_wallpaper::attach_to_desktop(window, monitor_id.as_deref(), &mut guard)?;
            let _ = window.emit("wallpaper-mode-changed", true);
            Ok(true)
        }
        #[cfg(not(windows))]
        {
            let _ = (window, monitor_id);
            Err("Wallpaper mode is only supported on Windows.".to_string())
        }
    }

    pub fn exit(&self, window: &WebviewWindow) -> Result<bool, String> {
        #[cfg(windows)]
        {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            if !guard.active {
                return Ok(false);
            }
            win_wallpaper::detach_from_desktop(window, &mut guard)?;
            let _ = window.emit("wallpaper-mode-changed", false);
            Ok(false)
        }
        #[cfg(not(windows))]
        {
            let _ = window;
            Ok(false)
        }
    }

    pub fn toggle(
        &self,
        window: &WebviewWindow,
        monitor_id: Option<String>,
    ) -> Result<bool, String> {
        if self.is_active() {
            self.exit(window)
        } else {
            self.enter(window, monitor_id)
        }
    }
}

#[cfg(windows)]
mod win_wallpaper {
    use super::*;
    use std::ffi::c_void;

    use windows::core::w;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, RedrawWindow, ScreenToClient, HDC, HMONITOR,
        MONITORINFOEXW, RDW_ALLCHILDREN, RDW_ERASE, RDW_INVALIDATE, RDW_UPDATENOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetSystemMetrics, GetWindowLongPtrW,
        GetWindowRect, SendMessageTimeoutW, SetForegroundWindow, SetParent, SetWindowLongPtrW,
        SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM, HWND_NOTOPMOST, HWND_TOP,
        SMTO_NORMAL, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW,
        SW_SHOW, WS_CAPTION, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_APPWINDOW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU,
        WS_THICKFRAME, WS_VISIBLE,
    };

    const MONITORINFOF_PRIMARY: u32 = 1;

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

    pub fn enumerate_monitors() -> Vec<MonitorInfo> {
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
        if list.len() > 1 {
            unsafe {
                let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
                let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
                let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
                let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
                list.push(MonitorInfo {
                    id: "all".to_string(),
                    name: format!("All Monitors Span ({vw}×{vh})"),
                    x: vx,
                    y: vy,
                    width: vw,
                    height: vh,
                    is_primary: false,
                });
            }
        }
        list
    }

    unsafe extern "system" fn find_workerw_enum_proc(top_hwnd: HWND, lparam: LPARAM) -> BOOL {
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

    fn resolve_workerw() -> Option<HWND> {
        unsafe {
            let progman = FindWindowW(w!("Progman"), None).ok()?;
            if progman.0.is_null() {
                return None;
            }
            // Ask Explorer / Progman to spawn the behind-icons WorkerW layer.
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
            let _ = SendMessageTimeoutW(
                progman,
                0x052C,
                WPARAM(0),
                LPARAM(0),
                SMTO_NORMAL,
                1000,
                Some(&mut result),
            );

            // 1. Classic Win10 & Win11 (<= 23H2): top-level WorkerW sibling behind SHELLDLL_DefView.
            let mut found: isize = 0;
            let _ = EnumWindows(
                Some(find_workerw_enum_proc),
                LPARAM(&mut found as *mut isize as isize),
            );
            if found != 0 {
                return Some(HWND(found as *mut c_void));
            }

            // 2. Win11 24H2 raised Progman: WorkerW is a direct child of Progman behind SHELLDLL_DefView.
            if let Ok(child_worker) =
                FindWindowExW(progman, HWND::default(), w!("WorkerW"), None)
            {
                if !child_worker.0.is_null() {
                    return Some(child_worker);
                }
            }

            None
        }
    }

    pub fn attach_to_desktop(
        window: &WebviewWindow,
        monitor_id: Option<&str>,
        state: &mut WallpaperState,
    ) -> Result<(), String> {
        let raw_hwnd = window
            .hwnd()
            .map_err(|e| format!("Could not get window handle: {e}"))?;
        let hwnd = HWND(raw_hwnd.0 as *mut c_void);

        // Exit fullscreen cleanly first so Windows restores normal framing before parenting.
        let _ = window.set_fullscreen(false);

        let monitors = enumerate_monitors();
        let target = monitor_id
            .and_then(|id| monitors.iter().find(|m| m.id == id))
            .or_else(|| monitors.iter().find(|m| m.is_primary))
            .or_else(|| monitors.first())
            .ok_or_else(|| "No monitor detected".to_string())?;

        unsafe {
            if !state.active {
                state.saved_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                state.saved_ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let mut rect = RECT::default();
                if GetWindowRect(hwnd, &mut rect).is_ok() {
                    state.saved_rect = (
                        rect.left,
                        rect.top,
                        (rect.right - rect.left).max(640),
                        (rect.bottom - rect.top).max(420),
                    );
                } else {
                    state.saved_rect = (120, 120, 1160, 740);
                }
            }

            let workerw = resolve_workerw();
            if let Some(worker) = workerw {
                let clean_style = (state.saved_style
                    & !(WS_CAPTION.0
                        | WS_THICKFRAME.0
                        | WS_MINIMIZEBOX.0
                        | WS_MAXIMIZEBOX.0
                        | WS_SYSMENU.0
                        | WS_POPUP.0) as isize)
                    | (WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPSIBLINGS.0 | WS_CLIPCHILDREN.0) as isize;
                let clean_ex = (state.saved_ex_style & !(WS_EX_APPWINDOW.0 as isize))
                    | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;

                SetWindowLongPtrW(hwnd, GWL_STYLE, clean_style);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, clean_ex);
                let _ = SetParent(hwnd, worker);

                let mut pt = POINT {
                    x: target.x,
                    y: target.y,
                };
                let _ = ScreenToClient(worker, &mut pt);

                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOP,
                    pt.x,
                    pt.y,
                    target.width,
                    target.height,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
                );
                state.workerw_hwnd = worker.0 as isize;
            } else {
                // Safe fallback if shell does not expose WorkerW: bottom-most borderless desktop window.
                let clean_style = (state.saved_style
                    & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0) as isize)
                    | (WS_POPUP.0 | WS_VISIBLE.0) as isize;
                let clean_ex = (state.saved_ex_style & !(WS_EX_APPWINDOW.0 as isize))
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
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
                );
                state.workerw_hwnd = 0;
            }

            state.active = true;
            state.monitor_id = Some(target.id.clone());
        }

        Ok(())
    }

    pub fn detach_from_desktop(
        window: &WebviewWindow,
        state: &mut WallpaperState,
    ) -> Result<(), String> {
        let raw_hwnd = window
            .hwnd()
            .map_err(|e| format!("Could not get window handle: {e}"))?;
        let hwnd = HWND(raw_hwnd.0 as *mut c_void);

        unsafe {
            let _ = SetParent(hwnd, HWND::default());
            if state.saved_style != 0 {
                SetWindowLongPtrW(hwnd, GWL_STYLE, state.saved_style);
            }
            if state.saved_ex_style != 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, state.saved_ex_style);
            }
            let (rx, ry, rw, rh) = state.saved_rect;
            let _ = SetWindowPos(
                hwnd,
                HWND_NOTOPMOST,
                rx,
                ry,
                rw.max(640),
                rh.max(420),
                SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            );
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);

            // Trigger Windows Explorer to repaint the user's original desktop wallpaper cleanly.
            if state.workerw_hwnd != 0 {
                let worker = HWND(state.workerw_hwnd as *mut c_void);
                let _ = RedrawWindow(
                    worker,
                    None,
                    None,
                    RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW,
                );
            }
            if let Ok(progman) = FindWindowW(w!("Progman"), None) {
                if !progman.0.is_null() {
                    let _ = RedrawWindow(
                        progman,
                        None,
                        None,
                        RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW,
                    );
                }
            }

            state.active = false;
            state.workerw_hwnd = 0;
        }
        Ok(())
    }
}
