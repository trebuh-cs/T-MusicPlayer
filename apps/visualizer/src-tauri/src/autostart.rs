//! Native Windows startup registration (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`)
//! for launching `T - Visualizer` directly into Live Wallpaper Mode on PC boot.

#[cfg(windows)]
mod win_autostart {
    use windows::core::w;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ, REG_VALUE_TYPE,
    };

    const VALUE_NAME: windows::core::PCWSTR = w!("T-Visualizer");
    const RUN_SUBKEY: windows::core::PCWSTR =
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");

    fn to_wide_null(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn build_command_line() -> Result<String, String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Could not resolve executable path: {e}"))?;
        let exe_str = exe
            .to_str()
            .ok_or_else(|| "Executable path contains non-UTF-8 characters.".to_string())?;
        Ok(format!("\"{exe_str}\" --wallpaper"))
    }

    pub fn is_enabled() -> bool {
        unsafe {
            let mut hkey = HKEY::default();
            let status = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                RUN_SUBKEY,
                0,
                KEY_QUERY_VALUE,
                &mut hkey,
            );
            if status != ERROR_SUCCESS {
                return false;
            }
            let mut val_type = REG_VALUE_TYPE::default();
            let mut size: u32 = 0;
            let q = RegQueryValueExW(
                hkey,
                VALUE_NAME,
                None,
                Some(&mut val_type),
                None,
                Some(&mut size),
            );
            let _ = RegCloseKey(hkey);
            q == ERROR_SUCCESS && size > 2
        }
    }

    pub fn set_enabled(enabled: bool) -> Result<bool, String> {
        unsafe {
            let mut hkey = HKEY::default();
            let status = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                RUN_SUBKEY,
                0,
                KEY_SET_VALUE | KEY_QUERY_VALUE,
                &mut hkey,
            );
            if status != ERROR_SUCCESS {
                return Err(format!(
                    "Could not open Windows Startup registry key (code {}).",
                    status.0
                ));
            }

            let res = if enabled {
                let cmd = build_command_line()?;
                let wide = to_wide_null(&cmd);
                let byte_slice = std::slice::from_raw_parts(
                    wide.as_ptr() as *const u8,
                    wide.len() * std::mem::size_of::<u16>(),
                );
                let s = RegSetValueExW(hkey, VALUE_NAME, 0, REG_SZ, Some(byte_slice));
                if s != ERROR_SUCCESS {
                    Err(format!(
                        "Failed writing Windows Startup entry (code {}).",
                        s.0
                    ))
                } else {
                    Ok(true)
                }
            } else {
                let _ = RegDeleteValueW(hkey, VALUE_NAME);
                Ok(false)
            };

            let _ = RegCloseKey(hkey);
            res
        }
    }
}

pub fn is_autostart_wallpaper_enabled() -> bool {
    #[cfg(windows)]
    {
        win_autostart::is_enabled()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn set_autostart_wallpaper_enabled(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        win_autostart::set_enabled(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Autostart wallpaper is only supported on Windows.".to_string())
    }
}

pub fn has_wallpaper_launch_flag() -> bool {
    std::env::args().any(|a| a == "--wallpaper" || a == "--autostart-wallpaper")
}
