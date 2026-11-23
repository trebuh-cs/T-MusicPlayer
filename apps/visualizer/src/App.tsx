import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Maximize2,
  Minimize2,
  Minus,
  SlidersHorizontal,
  Wallpaper,
  X,
} from "lucide-react";
import tpxLogoUrl from "./assets/tpx-logo.svg";
import { CircularVisualizerCanvas } from "./components/CircularVisualizerCanvas";
import { CustomizeStudioModal } from "./components/CustomizeStudioModal";
import { api } from "./services/api";
import { applyThemeToDocument, getThemeById } from "./themes";
import {
  DEFAULT_VISUALIZER_CONFIG,
  type AudioDeviceInfo,
  type AudioStatus,
  type MonitorInfo,
  type VisualizerConfig,
} from "./types";

const STORAGE_KEY = "t_visualizer_config_v1";

function loadSavedConfig(): VisualizerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISUALIZER_CONFIG;
    const parsed = JSON.parse(raw) as Partial<VisualizerConfig>;
    // Migrate legacy "all" (stretched) to "mirrored" (native per-monitor)
    if (parsed.selectedMonitorId === "all") {
      parsed.selectedMonitorId = "mirrored";
    }
    return { ...DEFAULT_VISUALIZER_CONFIG, ...parsed };
  } catch {
    return DEFAULT_VISUALIZER_CONFIG;
  }
}

function isWallpaperSurfaceWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("wallpaper") === "1";
  } catch {
    return false;
  }
}

/**
 * Pure full-bleed wallpaper surface rendered on each individual monitor in Live Wallpaper Mode.
 * Zero HUD, zero margins, synced live with the main Customize Studio.
 */
function WallpaperSurfaceApp() {
  const [config, setConfig] = useState<VisualizerConfig>(() => loadSavedConfig());
  const [hasAudioSignal, setHasAudioSignal] = useState(false);
  const liveFftRef = useRef<Uint8Array>(new Uint8Array(256));

  useEffect(() => {
    applyThemeToDocument(getThemeById(config.themeId));
  }, [config.themeId]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void api
      .getSyncedVisualizerConfig()
      .then((json) => {
        if (!json) return;
        try {
          const parsed = JSON.parse(json) as Partial<VisualizerConfig>;
          setConfig({ ...DEFAULT_VISUALIZER_CONFIG, ...parsed });
        } catch {
          // Ignore malformed JSON
        }
      })
      .catch(() => {});

    void listen<string>("visualizer-config-sync", (event) => {
      try {
        const parsed = JSON.parse(event.payload) as Partial<VisualizerConfig>;
        setConfig({ ...DEFAULT_VISUALIZER_CONFIG, ...parsed });
      } catch {
        // Ignore malformed JSON
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let rafId = 0;
    let lastSignalState = false;
    let silentFrames = 0;

    const tick = () => {
      if (cancelled) return;
      if (!inFlight) {
        inFlight = true;
        api
          .getFftFrame()
          .then((bins) => {
            if (cancelled) return;
            const target = liveFftRef.current;
            const len = Math.min(target.length, bins.length);
            let peak = 0;
            for (let i = 0; i < len; i++) {
              const v = bins[i];
              target[i] = v;
              if (v > peak) peak = v;
            }
            if (peak > 2) {
              silentFrames = 0;
              if (!lastSignalState) {
                lastSignalState = true;
                setHasAudioSignal(true);
              }
            } else {
              silentFrames++;
              if (lastSignalState && silentFrames > 45) {
                lastSignalState = false;
                setHasAudioSignal(false);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            inFlight = false;
          });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-[var(--bg-base)] select-none">
      {config.titlePosition === "above" && config.customTitle.trim() && (
        <div className="absolute top-12 inset-x-8 z-10 text-center pointer-events-none">
          <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {config.customTitle}
          </div>
          {config.showSubtitle && config.customSubtitle.trim() && (
            <div className="text-sm text-[var(--text-secondary)] mt-1">
              {config.customSubtitle}
            </div>
          )}
        </div>
      )}

      <CircularVisualizerCanvas
        config={config}
        liveFftRef={liveFftRef}
        hasAudioSignal={hasAudioSignal}
      />

      {config.titlePosition === "below" && config.customTitle.trim() && (
        <div className="absolute bottom-12 inset-x-8 z-10 text-center pointer-events-none">
          <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {config.customTitle}
          </div>
          {config.showSubtitle && config.customSubtitle.trim() && (
            <div className="text-sm text-[var(--text-secondary)] mt-1">
              {config.customSubtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MainApp() {
  const [config, setConfig] = useState<VisualizerConfig>(() => loadSavedConfig());
  const [studioOpen, setStudioOpen] = useState(false);
  const [wallpaperMode, setWallpaperMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [hasAudioSignal, setHasAudioSignal] = useState(false);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const liveFftRef = useRef<Uint8Array>(new Uint8Array(256));
  const hideTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setStatusToast(null);
    }, 3600);
  }, []);

  // Apply theme CSS vars immediately whenever theme changes
  useEffect(() => {
    applyThemeToDocument(getThemeById(config.themeId));
  }, [config.themeId]);

  // Persist config to localStorage AND broadcast live to all active wallpaper surfaces
  useEffect(() => {
    const serialized = JSON.stringify(config);
    void api.syncVisualizerConfig(serialized).catch(() => {});
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      try {
        const trimmed: VisualizerConfig = {
          ...config,
          backgroundImageDataUrl: null,
          customImageDataUrl: null,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Ignore storage errors
      }
    }
  }, [config]);

  const refreshHardware = useCallback(async () => {
    try {
      const [devs, mons, wpActive, fsActive, status] = await Promise.all([
        api.listAudioDevices(),
        api.listMonitors(),
        api.isWallpaperMode(),
        api.isWindowFullscreen(),
        api.getAudioStatus(),
      ]);
      setDevices(devs);
      setMonitors(mons);
      setWallpaperMode(wpActive);
      setIsFullscreen(fsActive);
      setAudioStatus(status);
    } catch {
      // Ignore during initial mount
    }
  }, []);

  // Initial sync of hardware + saved audio device selection
  useEffect(() => {
    void refreshHardware();
    if (configRef.current.selectedDeviceId) {
      void api.selectAudioDevice(configRef.current.selectedDeviceId);
    }
  }, [refreshHardware]);

  // Subscribe to Tauri system tray events
  useEffect(() => {
    let unlistenWp: (() => void) | null = null;
    let unlistenStudio: (() => void) | null = null;

    void listen<boolean>("wallpaper-mode-changed", (event) => {
      const active = Boolean(event.payload);
      setWallpaperMode(active);
      if (active) {
        setIsFullscreen(false);
      }
    }).then((fn) => {
      unlistenWp = fn;
    });

    void listen("open-customize", () => {
      setStudioOpen(true);
      setHudVisible(true);
      void refreshHardware();
    }).then((fn) => {
      unlistenStudio = fn;
    });

    return () => {
      unlistenWp?.();
      unlistenStudio?.();
    };
  }, [refreshHardware]);

  // High-frequency non-overlapping WASAPI FFT frame loop
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let rafId = 0;
    let lastSignalState = false;
    let silentFrames = 0;

    const tick = () => {
      if (cancelled) return;
      if (!inFlight) {
        inFlight = true;
        api
          .getFftFrame()
          .then((bins) => {
            if (cancelled) return;
            const target = liveFftRef.current;
            const len = Math.min(target.length, bins.length);
            let peak = 0;
            for (let i = 0; i < len; i++) {
              const v = bins[i];
              target[i] = v;
              if (v > peak) peak = v;
            }
            if (peak > 2) {
              silentFrames = 0;
              if (!lastSignalState) {
                lastSignalState = true;
                setHasAudioSignal(true);
              }
            } else {
              silentFrames++;
              if (lastSignalState && silentFrames > 45) {
                lastSignalState = false;
                setHasAudioSignal(false);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            inFlight = false;
          });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Poll audio capture status every 1.5s
  useEffect(() => {
    const id = window.setInterval(() => {
      void api
        .getAudioStatus()
        .then((s) => setAudioStatus(s))
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(id);
  }, []);

  // Auto-hide HUD after mouse inactivity when not in studio
  const bumpHud = useCallback(() => {
    setHudVisible(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setHudVisible(false);
    }, 2800);
  }, []);

  useEffect(() => {
    if (studioOpen) {
      setHudVisible(true);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      return;
    }
    bumpHud();
  }, [studioOpen, bumpHud]);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      const next = await api.setWindowFullscreen(!isFullscreen);
      setIsFullscreen(next);
    } catch (err) {
      showToast(String(err));
    }
  }, [isFullscreen, showToast]);

  const handleToggleWallpaper = useCallback(async () => {
    try {
      const target = !wallpaperMode;
      // Ensure latest config is synced before spawning wallpaper surfaces
      await api.syncVisualizerConfig(JSON.stringify(configRef.current));
      const active = await api.setWallpaperMode(
        target,
        configRef.current.selectedMonitorId,
        false
      );
      setWallpaperMode(active);
      if (active) {
        setStudioOpen(false);
        setIsFullscreen(false);
      } else {
        setHudVisible(true);
        showToast("Live Wallpaper Mode disabled");
      }
    } catch (err) {
      showToast(`Wallpaper error: ${String(err)}`);
    }
  }, [wallpaperMode, showToast]);

  const handleSelectMonitor = useCallback(
    async (monitorId: string | null) => {
      if (!wallpaperMode) return;
      try {
        await api.syncVisualizerConfig(JSON.stringify({
          ...configRef.current,
          selectedMonitorId: monitorId,
        }));
        await api.setWallpaperMode(true, monitorId, true);
        showToast("Wallpaper monitor layout updated");
      } catch (err) {
        showToast(`Wallpaper error: ${String(err)}`);
      }
    },
    [wallpaperMode, showToast]
  );

  const handleSelectDevice = useCallback(
    async (deviceId: string | null) => {
      try {
        await api.selectAudioDevice(deviceId);
        const s = await api.getAudioStatus();
        setAudioStatus(s);
      } catch (err) {
        showToast(String(err));
      }
    },
    [showToast]
  );

  // Global hotkeys: F11 fullscreen, Esc close studio / exit fullscreen, C customize
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "F11") {
        e.preventDefault();
        void handleToggleFullscreen();
        return;
      }
      if (e.key === "Escape") {
        if (studioOpen) {
          setStudioOpen(false);
        } else if (isFullscreen) {
          void api.setWindowFullscreen(false).then(setIsFullscreen);
        }
        return;
      }
      if (!typing && (e.key === "c" || e.key === "C")) {
        setStudioOpen((v) => !v);
        void refreshHardware();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [studioOpen, isFullscreen, handleToggleFullscreen, refreshHardware]);

  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const handleCloseButton = () => {
    if (wallpaperMode) {
      // Keep live wallpapers running cleanly in the background; hide Studio back to tray.
      void api.hideMainWindow();
    } else {
      void api.quitApp();
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-[var(--bg-base)] select-none"
      onMouseMove={bumpHud}
      onMouseDown={bumpHud}
    >
      {/* Full-bleed Live Audio Circular Visualizer */}
      <div
        className="w-full h-full relative"
        onDoubleClick={() => {
          if (!studioOpen) {
            void handleToggleFullscreen();
          }
        }}
      >
        {config.titlePosition === "above" && config.customTitle.trim() && (
          <div className="absolute top-12 inset-x-8 z-10 text-center pointer-events-none">
            <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {config.customTitle}
            </div>
            {config.showSubtitle && config.customSubtitle.trim() && (
              <div className="text-sm text-[var(--text-secondary)] mt-1">
                {config.customSubtitle}
              </div>
            )}
          </div>
        )}

        <CircularVisualizerCanvas
          config={config}
          liveFftRef={liveFftRef}
          hasAudioSignal={hasAudioSignal}
        />

        {config.titlePosition === "below" && config.customTitle.trim() && (
          <div className="absolute bottom-12 inset-x-8 z-10 text-center pointer-events-none">
            <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {config.customTitle}
            </div>
            {config.showSubtitle && config.customSubtitle.trim() && (
              <div className="text-sm text-[var(--text-secondary)] mt-1">
                {config.customSubtitle}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auto-hiding Matte Top HUD Bar */}
      <header
        data-tauri-drag-region
        className={`fixed top-0 inset-x-0 z-30 h-12 px-4 flex items-center justify-between gap-3 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] transition-opacity duration-200 ${
          hudVisible || studioOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Left: App Brand + Live System Audio Indicator (Draggable) */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-3 min-w-0 flex-1 h-full"
        >
          <img
            src={tpxLogoUrl}
            alt="TPX"
            className="w-6 h-6 shrink-0 pointer-events-none"
          />
          <span className="text-xs font-bold tracking-wide text-[var(--text-primary)] shrink-0 pointer-events-none">
            T - Visualizer
          </span>

          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] max-w-[300px] pointer-events-none">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: hasAudioSignal
                  ? "var(--accent)"
                  : audioStatus?.error
                  ? "#f43f5e"
                  : "var(--text-muted)",
              }}
            />
            <span className="truncate">
              {hasAudioSignal
                ? `Live: ${audioStatus?.device_name ?? "System Audio"}`
                : audioStatus?.error
                ? "Audio Error"
                : `Listening: ${audioStatus?.device_name ?? "System Default"}`}
            </span>
          </span>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleToggleWallpaper()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
            style={
              wallpaperMode
                ? {
                    background: "var(--bg-surface)",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                  }
                : {
                    background: "var(--accent)",
                    color: "var(--accent-contrast)",
                  }
            }
            title={
              wallpaperMode
                ? "Stop Live Desktop Wallpaper"
                : "Run visualizer behind Windows desktop icons (Tray icon to restore)"
            }
          >
            <Wallpaper className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {wallpaperMode ? "Stop Wallpaper" : "Live Wallpaper"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStudioOpen(true);
              void refreshHardware();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
            title="Customize Studio (C)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="hidden sm:inline">Customize</span>
          </button>

          <button
            type="button"
            onClick={() => void handleToggleFullscreen()}
            className="p-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            title="Toggle Fullscreen (F11)"
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="w-px h-5 bg-[var(--border-subtle)] mx-1" />

          <button
            type="button"
            onClick={handleMinimize}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            title="Minimize"
            aria-label="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCloseButton}
            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[var(--text-secondary)] hover:text-rose-400 cursor-pointer"
            title={
              wallpaperMode
                ? "Hide window to tray (Wallpaper keeps running)"
                : "Quit T - Visualizer"
            }
            aria-label={wallpaperMode ? "Hide to tray" : "Quit"}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Subtle status toast */}
      {statusToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]">
          {statusToast}
        </div>
      )}

      {/* Customize Studio Modal */}
      {studioOpen && (
        <CustomizeStudioModal
          config={config}
          onChange={setConfig}
          onClose={() => setStudioOpen(false)}
          onToggleWallpaper={() => void handleToggleWallpaper()}
          wallpaperMode={wallpaperMode}
          liveFftRef={liveFftRef}
          hasAudioSignal={hasAudioSignal}
          audioStatus={audioStatus}
          devices={devices}
          monitors={monitors}
          onRefreshHardware={() => void refreshHardware()}
          onSelectDevice={(id) => void handleSelectDevice(id)}
          onSelectMonitor={(id) => void handleSelectMonitor(id)}
        />
      )}
    </div>
  );
}

export default function App() {
  return isWallpaperSurfaceWindow() ? <WallpaperSurfaceApp /> : <MainApp />;
}
