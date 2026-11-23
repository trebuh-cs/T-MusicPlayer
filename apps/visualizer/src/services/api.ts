import { invoke } from "@tauri-apps/api/core";
import type { AudioDeviceInfo, AudioStatus, MonitorInfo } from "../types";

export const api = {
  async getFftFrame(): Promise<Uint8Array> {
    const raw = await invoke<ArrayBuffer | number[] | Uint8Array>("get_fft_frame");
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    return new Uint8Array(raw);
  },

  getAudioStatus: () => invoke<AudioStatus>("get_audio_status"),

  listAudioDevices: () => invoke<AudioDeviceInfo[]>("list_audio_devices"),

  selectAudioDevice: (deviceId: string | null) =>
    invoke<void>("select_audio_device", { deviceId }),

  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),

  isWallpaperMode: () => invoke<boolLike>("is_wallpaper_mode") as Promise<boolean>,

  setWallpaperMode: (enabled: boolean, monitorId: string | null) =>
    invoke<boolean>("set_wallpaper_mode", { enabled, monitorId }),

  setWindowFullscreen: (fullscreen: boolean) =>
    invoke<boolean>("set_window_fullscreen", { fullscreen }),

  isWindowFullscreen: () => invoke<boolean>("is_window_fullscreen"),

  loadImageAsDataUrl: (path: string) =>
    invoke<string>("load_image_as_data_url", { path }),

  quitApp: () => invoke<void>("quit_app"),
};

type boolLike = boolean;
