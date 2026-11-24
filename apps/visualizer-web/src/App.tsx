import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Music2,
  Projector,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import { parseThemePresetFile } from "@shared/visualizer/presets";
import tpxLogoUrl from "./assets/tpx-logo.svg";
import { CircularVisualizerCanvas } from "./components/CircularVisualizerCanvas";
import { CustomizeStudioModal } from "./components/CustomizeStudioModal";
import { NowPlayingOverlay } from "./components/NowPlayingOverlay";
import { ProjectorSurfaceApp } from "./components/ProjectorSurfaceApp";
import { pickTextFile } from "./services/fileIO";
import {
  disconnectSpotify,
  handleSpotifyCallbackIfPresent,
  loadSavedSpotifyClientId,
  loadStoredSpotifyTokens,
  pollSpotifyNowPlaying,
  saveSpotifyClientId,
  startSpotifyLogin,
} from "./services/spotify";
import {
  createStageChannel,
  isProjectorWindow,
  openProjectorWindow,
  type StageSyncMessage,
} from "./services/stageSync";
import { ScreenWakeLockController } from "./services/wakeLock";
import { WebAudioCaptureEngine } from "./services/webAudio";
import { applyThemeToDocument, getThemeById } from "./themes";
import {
  DEFAULT_VISUALIZER_CONFIG,
  applyPortableTheme,
  mergeVisualizerConfig,
  stripHostFields,
  type NowPlayingMedia,
  type SavedVisualizerTheme,
  type SpotifyConnectionState,
  type VisualizerConfig,
  type WebAudioDeviceInfo,
  type WebAudioStatus,
} from "./types";

const STORAGE_KEY = "t_visualizer_web_config_v1";
const PRESETS_STORAGE_KEY = "t_visualizer_web_saved_themes_v1";
const AUDIO_CAL_KEY = "t_visualizer_web_audio_cal_v1";

function loadSavedConfig(): VisualizerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISUALIZER_CONFIG;
    return mergeVisualizerConfig(JSON.parse(raw) as Partial<VisualizerConfig>);
  } catch {
    return DEFAULT_VISUALIZER_CONFIG;
  }
}

function loadSavedThemes(): SavedVisualizerTheme[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedVisualizerTheme[]) : [];
  } catch {
    return [];
  }
}

function loadAudioCalibration(): { gain: number; gate: number } {
  try {
    const raw = localStorage.getItem(AUDIO_CAL_KEY);
    if (!raw) return { gain: 1.15, gate: 8 };
    const parsed = JSON.parse(raw) as { gain?: number; gate?: number };
    return {
      gain: typeof parsed.gain === "number" ? parsed.gain : 1.15,
      gate: typeof parsed.gate === "number" ? parsed.gate : 8,
    };
  } catch {
    return { gain: 1.15, gate: 8 };
  }
}

function isStandalonePwa(): boolean {
  const nav = navigator as unknown as { standalone?: boolean };
  return (
    Boolean(nav.standalone) ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true
  );
}

function ControlDeckApp() {
  const [config, setConfig] = useState<VisualizerConfig>(() => loadSavedConfig());
  const [savedThemes, setSavedThemes] = useState<SavedVisualizerTheme[]>(() =>
    loadSavedThemes()
  );
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioInitialTab, setStudioInitialTab] = useState<
    "style" | "bars" | "presets" | "output"
  >("style");
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [connectedProjectors, setConnectedProjectors] = useState(0);
  const [blackout, setBlackout] = useState(false);

  const stageChannelRef = useRef<BroadcastChannel | null>(null);
  const projectorPeersRef = useRef<Map<string, number>>(new Map());
  const projectorWinRef = useRef<Window | null>(null);
  const connectedProjectorsRef = useRef(0);
  connectedProjectorsRef.current = connectedProjectors;

  const audioEngineRef = useRef<WebAudioCaptureEngine | null>(null);
  if (!audioEngineRef.current) {
    const engine = new WebAudioCaptureEngine();
    const cal = loadAudioCalibration();
    engine.setInputGain(cal.gain);
    engine.setNoiseGate(cal.gate);
    audioEngineRef.current = engine;
  }

  const [audioStatus, setAudioStatus] = useState<WebAudioStatus>(() =>
    audioEngineRef.current!.getStatus()
  );
  const [devices, setDevices] = useState<WebAudioDeviceInfo[]>([]);
  const [hasAudioSignal, setHasAudioSignal] = useState(false);

  const [spotify, setSpotify] = useState<SpotifyConnectionState>(() => {
    const tokens = loadStoredSpotifyTokens();
    return {
      clientId: tokens?.clientId || loadSavedSpotifyClientId(),
      connected: Boolean(tokens),
      connecting: false,
      userName: tokens?.userName ?? null,
      error: null,
      lastUpdatedAt: null,
    };
  });
  const [nowPlaying, setNowPlaying] = useState<NowPlayingMedia | null>(null);

  const wakeLockSupported = ScreenWakeLockController.isSupported();
  const [wakeLockEnabled, setWakeLockEnabled] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<ScreenWakeLockController | null>(null);

  const [statusToast, setStatusToast] = useState<string | null>(null);
  const liveFftRef = useRef<Uint8Array>(new Uint8Array(256));
  const hideTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const nowPlayingRef = useRef(nowPlaying);
  nowPlayingRef.current = nowPlaying;
  const hasAudioSignalRef = useRef(hasAudioSignal);
  hasAudioSignalRef.current = hasAudioSignal;
  const blackoutRef = useRef(blackout);
  blackoutRef.current = blackout;

  const broadcastStateSnapshot = useCallback(() => {
    stageChannelRef.current?.postMessage({
      type: "state-sync",
      config: configRef.current,
      nowPlaying: nowPlayingRef.current,
      hasAudioSignal: hasAudioSignalRef.current,
      blackout: blackoutRef.current,
    } satisfies StageSyncMessage);
  }, []);

  // BroadcastChannel stage sync for Beamer / Presenter Output windows
  useEffect(() => {
    const channel = createStageChannel();
    stageChannelRef.current = channel;
    if (!channel) return;

    const syncPeerCount = () => {
      const now = Date.now();
      for (const [id, lastSeen] of projectorPeersRef.current.entries()) {
        if (now - lastSeen > 7500) {
          projectorPeersRef.current.delete(id);
        }
      }
      setConnectedProjectors(projectorPeersRef.current.size);
    };

    channel.onmessage = (event: MessageEvent<StageSyncMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "projector-hello") {
        projectorPeersRef.current.set(msg.id, Date.now());
        syncPeerCount();
        broadcastStateSnapshot();
      } else if (msg.type === "projector-heartbeat") {
        projectorPeersRef.current.set(msg.id, Date.now());
        syncPeerCount();
      } else if (msg.type === "projector-bye") {
        projectorPeersRef.current.delete(msg.id);
        syncPeerCount();
      }
    };

    const pruneId = window.setInterval(syncPeerCount, 3000);
    return () => {
      window.clearInterval(pruneId);
      channel.close();
      stageChannelRef.current = null;
    };
  }, [broadcastStateSnapshot]);

  // Push live state updates whenever config, Spotify track, signal, or blackout changes
  useEffect(() => {
    broadcastStateSnapshot();
  }, [config, nowPlaying, hasAudioSignal, blackout, broadcastStateSnapshot]);

  const showToast = useCallback((msg: string, durationMs = 3800) => {
    setStatusToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setStatusToast(null);
    }, durationMs);
  }, []);

  const handleOpenBeamer = useCallback(async () => {
    const win = await openProjectorWindow();
    if (!win) {
      showToast(
        "Popup blocked — allow popups or copy the Projector URL from Audio & Spotify tab",
        5000
      );
      return;
    }
    projectorWinRef.current = win;
    showToast("Beamer Output window opened — drag to Beamer & tap Fullscreen!");
    window.setTimeout(() => broadcastStateSnapshot(), 450);
  }, [broadcastStateSnapshot, showToast]);

  const handleCloseBeamer = useCallback(() => {
    try {
      if (projectorWinRef.current && !projectorWinRef.current.closed) {
        projectorWinRef.current.close();
      }
    } catch {
      // Ignore
    }
    projectorWinRef.current = null;
    showToast("Beamer Output closed");
  }, [showToast]);

  const handleToggleBlackout = useCallback(() => {
    setBlackout((prev) => {
      const next = !prev;
      stageChannelRef.current?.postMessage({
        type: "blackout",
        enabled: next,
      } satisfies StageSyncMessage);
      showToast(next ? "Beamer BLACKOUT active" : "Beamer Output live again");
      return next;
    });
  }, [showToast]);

  // Apply base theme palette CSS variables
  useEffect(() => {
    applyThemeToDocument(getThemeById(config.themeId));
  }, [config.themeId]);

  // Persist VisualizerConfig locally
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            ...config,
            backgroundImageDataUrl: null,
            customImageDataUrl: null,
          })
        );
      } catch {
        // Ignore storage quota errors
      }
    }
  }, [config]);

  const handleSaveThemes = useCallback((next: SavedVisualizerTheme[]) => {
    setSavedThemes(next);
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }, []);

  // Wake Lock lifecycle
  useEffect(() => {
    const controller = new ScreenWakeLockController((active) => {
      setWakeLockActive(active);
    });
    wakeLockRef.current = controller;
    if (wakeLockEnabled && wakeLockSupported) {
      void controller.enable();
    }
    return () => {
      controller.dispose();
      wakeLockRef.current = null;
    };
  }, [wakeLockSupported]);

  const handleToggleWakeLock = useCallback(async () => {
    const next = !wakeLockEnabled;
    setWakeLockEnabled(next);
    if (next) {
      const ok = await wakeLockRef.current?.enable();
      showToast(
        ok
          ? "Screen Wake Lock active — iPad stays awake"
          : "Wake Lock armed (activates after screen tap)"
      );
    } else {
      await wakeLockRef.current?.disable();
      showToast("Screen Wake Lock disabled");
    }
  }, [wakeLockEnabled, showToast]);

  // Refresh Web Audio device list & listen for USB-C hot-plug events
  const refreshDevices = useCallback(async () => {
    const list = await audioEngineRef.current!.listDevices();
    setDevices(list);
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onDeviceChange = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      audioEngineRef.current?.dispose();
    };
  }, [refreshDevices]);

  // Start / Stop Live Web Audio Capture
  const handleStartAudio = useCallback(
    async (deviceId?: string | null) => {
      const targetId = deviceId !== undefined ? deviceId : configRef.current.selectedDeviceId;
      const status = await audioEngineRef.current!.start(targetId);
      setAudioStatus(status);
      await refreshDevices();
      if (wakeLockEnabled && wakeLockSupported) {
        void wakeLockRef.current?.enable();
      }
      if (status.error) {
        showToast(status.error, 5000);
      } else {
        showToast(`Live audio active: ${status.deviceName}`);
      }
    },
    [refreshDevices, wakeLockEnabled, wakeLockSupported, showToast]
  );

  const handleStopAudio = useCallback(() => {
    audioEngineRef.current!.stop();
    setAudioStatus(audioEngineRef.current!.getStatus());
    setHasAudioSignal(false);
    showToast("Audio input stopped");
  }, [showToast]);

  const handleToggleDemoBeat = useCallback(() => {
    const engine = audioEngineRef.current!;
    const nextDemo = !engine.getStatus().demoMode;
    if (nextDemo && engine.getStatus().capturing) {
      engine.stop();
    }
    engine.setDemoMode(nextDemo);
    setAudioStatus(engine.getStatus());
    showToast(nextDemo ? "Demo Beat Preview enabled" : "Demo Beat Preview disabled");
  }, [showToast]);

  const handleSetInputGain = useCallback((gain: number) => {
    const engine = audioEngineRef.current!;
    engine.setInputGain(gain);
    const st = engine.getStatus();
    setAudioStatus(st);
    try {
      localStorage.setItem(
        AUDIO_CAL_KEY,
        JSON.stringify({ gain: st.inputGain, gate: st.noiseGate })
      );
    } catch {
      // Ignore
    }
  }, []);

  const handleSetNoiseGate = useCallback((gate: number) => {
    const engine = audioEngineRef.current!;
    engine.setNoiseGate(gate);
    const st = engine.getStatus();
    setAudioStatus(st);
    try {
      localStorage.setItem(
        AUDIO_CAL_KEY,
        JSON.stringify({ gain: st.inputGain, gate: st.noiseGate })
      );
    } catch {
      // Ignore
    }
  }, []);

  // High-frequency 60fps FFT sampling loop
  useEffect(() => {
    let rafId = 0;
    let lastSignal = false;
    let silentFrames = 0;
    let lastMeterSync = 0;

    const tick = (now: number) => {
      const engine = audioEngineRef.current!;
      const hasLive = engine.sampleInto(liveFftRef.current, now);
      if (hasLive) {
        silentFrames = 0;
        if (!lastSignal) {
          lastSignal = true;
          setHasAudioSignal(true);
        }
      } else {
        silentFrames++;
        if (lastSignal && silentFrames > 40) {
          lastSignal = false;
          setHasAudioSignal(false);
        }
      }
      if (connectedProjectorsRef.current > 0 && stageChannelRef.current) {
        stageChannelRef.current.postMessage({
          type: "fft-frame",
          bins: liveFftRef.current,
          hasAudioSignal: hasLive,
        } satisfies StageSyncMessage);
      }
      // Refresh status meter smoothly ~8x/sec while Studio is open
      if (now - lastMeterSync > 125) {
        lastMeterSync = now;
        const st = engine.getStatus();
        setAudioStatus((prev) =>
          prev.peakLevel === st.peakLevel &&
          prev.capturing === st.capturing &&
          prev.demoMode === st.demoMode &&
          prev.error === st.error
            ? prev
            : st
        );
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Handle Spotify PKCE OAuth callback on initial mount
  useEffect(() => {
    let active = true;
    void handleSpotifyCallbackIfPresent().then((res) => {
      if (!active) return;
      if (res.handled) {
        if (res.tokens) {
          setSpotify((prev) => ({
            ...prev,
            clientId: res.tokens!.clientId,
            connected: true,
            connecting: false,
            userName: res.tokens!.userName,
            error: null,
          }));
          showToast(
            `Spotify connected${res.tokens.userName ? ` (${res.tokens.userName})` : ""}!`
          );
        } else if (res.error) {
          setSpotify((prev) => ({
            ...prev,
            connected: false,
            connecting: false,
            error: res.error,
          }));
          setStudioInitialTab("output");
          setStudioOpen(true);
          showToast(res.error, 5000);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [showToast]);

  // Poll Spotify Currently Playing when connected
  const runSpotifyPoll = useCallback(async () => {
    if (!loadStoredSpotifyTokens()) return;
    const result = await pollSpotifyNowPlaying();
    setSpotify((prev) => ({
      ...prev,
      connected: result.connected,
      error: result.error,
      lastUpdatedAt: Date.now(),
    }));
    if (result.media !== null || !result.connected) {
      setNowPlaying(result.media);
    } else if (!result.error) {
      // 204 No Content -> clear stale track cleanly
      setNowPlaying(null);
    }
  }, []);

  useEffect(() => {
    if (!spotify.connected) return;
    void runSpotifyPoll();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSpotifyPoll();
      }
    }, 2500);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void runSpotifyPoll();
        void audioEngineRef.current?.resumeContextIfSuspended();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [spotify.connected, runSpotifyPoll]);

  const handleChangeSpotifyClientId = useCallback((clientId: string) => {
    saveSpotifyClientId(clientId);
    setSpotify((prev) => ({ ...prev, clientId, error: null }));
  }, []);

  const handleConnectSpotify = useCallback(async () => {
    try {
      setSpotify((prev) => ({ ...prev, connecting: true, error: null }));
      await startSpotifyLogin(spotify.clientId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSpotify((prev) => ({ ...prev, connecting: false, error: msg }));
      showToast(msg, 4500);
    }
  }, [spotify.clientId, showToast]);

  const handleDisconnectSpotify = useCallback(() => {
    disconnectSpotify();
    setNowPlaying(null);
    setSpotify((prev) => ({
      ...prev,
      connected: false,
      connecting: false,
      userName: null,
      error: null,
    }));
    showToast("Spotify disconnected");
  }, [showToast]);

  // Quick .tviz theme import from first-launch dock
  const handleQuickImportTheme = useCallback(async () => {
    try {
      const picked = await pickTextFile(".tviz,.json,application/json");
      if (!picked) return;
      const { name, config: importedCfg } = parseThemePresetFile(picked.text);
      const applied = applyPortableTheme(configRef.current, importedCfg);
      setConfig(applied);
      const now = Date.now();
      const entry: SavedVisualizerTheme = {
        id: `imported-${now}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        createdAt: now,
        updatedAt: now,
        config: stripHostFields(applied),
      };
      handleSaveThemes([entry, ...savedThemes]);
      showToast(`Imported & applied theme "${name}"`);
    } catch (err) {
      showToast(String(err), 4500);
    }
  }, [handleSaveThemes, savedThemes, showToast]);

  // Auto-hiding HUD logic (keeps HUD visible when idle / studio open; auto-hides cleanly on live stage)
  const bumpHud = useCallback(
    (autoHide = true) => {
      setHudVisible(true);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      if (autoHide && !studioOpen && (audioStatus.capturing || audioStatus.demoMode)) {
        hideTimerRef.current = window.setTimeout(() => {
          setHudVisible(false);
        }, 3800);
      }
    },
    [studioOpen, audioStatus.capturing, audioStatus.demoMode]
  );

  useEffect(() => {
    if (studioOpen) {
      setHudVisible(true);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      return;
    }
    bumpHud(true);
  }, [studioOpen, audioStatus.capturing, audioStatus.demoMode, bumpHud]);

  // Fullscreen API + iPad Safari Add-to-Home-Screen hint
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element | null;
    };
    const active = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
    try {
      if (active) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        setIsFullscreen(false);
      } else if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
        setIsFullscreen(true);
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
        setIsFullscreen(true);
      } else if (isStandalonePwa()) {
        showToast("Already running in iPad Fullscreen Home Screen mode");
      } else {
        showToast(
          "iPad Fullscreen: Tap Safari Share ↑ → 'Add to Home Screen' for borderless fullscreen!",
          5500
        );
      }
    } catch {
      showToast(
        "iPad Fullscreen: Tap Safari Share ↑ → 'Add to Home Screen' for borderless fullscreen!",
        5500
      );
    }
  }, [showToast]);

  // Keyboard shortcuts (great when using an iPad keyboard / desktop browser)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape" && studioOpen) {
        setStudioOpen(false);
      } else if (!typing && (e.key === "c" || e.key === "C")) {
        setStudioOpen((v) => !v);
      } else if (!typing && (e.key === "f" || e.key === "F")) {
        void handleToggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [studioOpen, handleToggleFullscreen]);

  const openStudioTab = (tab: "style" | "bars" | "presets" | "output") => {
    setStudioInitialTab(tab);
    setStudioOpen(true);
  };

  const showQuickStartDock = !audioStatus.capturing && !audioStatus.demoMode && !studioOpen;

  return (
    <div
      className="relative w-screen h-[100dvh] overflow-hidden bg-[var(--bg-base)] select-none"
      onMouseMove={() => bumpHud(true)}
    >
      {/* Full-bleed Multi-Style Live Audio Visualizer */}
      <div
        className="w-full h-full relative"
        onClick={() => {
          void audioEngineRef.current?.resumeContextIfSuspended();
          if (hudVisible && (audioStatus.capturing || audioStatus.demoMode)) {
            setHudVisible(false);
          } else {
            bumpHud(true);
          }
        }}
      >
        <CircularVisualizerCanvas
          config={config}
          liveFftRef={liveFftRef}
          hasAudioSignal={hasAudioSignal}
          albumArtUrl={nowPlaying?.thumbnail_data_url ?? null}
        />
        <NowPlayingOverlay
          config={config}
          nowPlaying={nowPlaying}
          snapEnabled={snapEnabled}
          onMovePosition={(x, y) =>
            setConfig((prev) => ({
              ...prev,
              titlePosition: "custom",
              titlePosX: x,
              titlePosY: y,
            }))
          }
        />
      </div>

      {/* Auto-hiding Matte Top HUD Bar */}
      <header
        className={`fixed top-0 inset-x-0 z-30 safe-pt bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] transition-opacity duration-200 ${
          hudVisible || studioOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="h-13 px-3 sm:px-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <img
              src={tpxLogoUrl}
              alt="TPX"
              className="w-6 h-6 shrink-0 pointer-events-none"
            />
            <span className="text-xs font-bold tracking-wide text-[var(--text-primary)] shrink-0">
              T - Visualizer
            </span>

            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] max-w-[360px]">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor: hasAudioSignal
                    ? "var(--accent)"
                    : audioStatus.error
                    ? "#f43f5e"
                    : "var(--text-muted)",
                }}
              />
              <span className="truncate">
                {nowPlaying && (nowPlaying.title || nowPlaying.artist)
                  ? `Spotify: ${nowPlaying.title}${
                      nowPlaying.artist ? ` — ${nowPlaying.artist}` : ""
                    }`
                  : audioStatus.capturing
                  ? `Live: ${audioStatus.deviceName}`
                  : audioStatus.demoMode
                  ? "Demo Beat Preview"
                  : "Audio Standby"}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                connectedProjectors > 0 ? openStudioTab("output") : void handleOpenBeamer()
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={
                connectedProjectors > 0
                  ? {
                      background: "var(--accent)",
                      color: "var(--accent-contrast)",
                    }
                  : {
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-subtle)",
                    }
              }
              title={
                connectedProjectors > 0
                  ? `Beamer Output live (${connectedProjectors} connected)`
                  : "Open dedicated fullscreen Beamer / Stage Projector window"
              }
            >
              <Projector
                className={`w-3.5 h-3.5 ${
                  connectedProjectors > 0 ? "" : "text-[var(--accent)]"
                }`}
              />
              <span className="hidden md:inline">
                {connectedProjectors > 0
                  ? `Beamer Live${connectedProjectors > 1 ? ` (${connectedProjectors})` : ""}`
                  : "Beamer"}
              </span>
            </button>

            {connectedProjectors > 0 && (
              <button
                type="button"
                onClick={handleToggleBlackout}
                className={`p-1.5 rounded-lg border cursor-pointer ${
                  blackout
                    ? "bg-rose-500/20 border-rose-500/50 text-rose-300"
                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title={blackout ? "Disable Beamer Blackout" : "Blackout Beamer Output"}
                aria-label="Toggle Beamer Blackout"
              >
                {blackout ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                audioStatus.capturing ? handleStopAudio() : void handleStartAudio()
              }
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={
                audioStatus.capturing
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
            >
              {audioStatus.capturing ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Stop Audio</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>Start Audio</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => openStudioTab("output")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                spotify.connected
                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                  : "bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
              }`}
              title="Spotify Song Recognition & Audio Settings"
            >
              <Music2 className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="hidden sm:inline">
                {spotify.connected ? "Spotify Live" : "Spotify"}
              </span>
            </button>

            {wakeLockSupported && (
              <button
                type="button"
                onClick={() => void handleToggleWakeLock()}
                className={`p-1.5 rounded-lg border cursor-pointer ${
                  wakeLockActive || wakeLockEnabled
                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                }`}
                title={
                  wakeLockActive
                    ? "Screen Wake Lock active (iPad won't sleep)"
                    : "Keep Screen Awake"
                }
                aria-label="Toggle Keep Screen Awake"
              >
                <Sun className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => openStudioTab("style")}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
              title="Customize Studio (C)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="hidden sm:inline">Customize</span>
            </button>

            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              className="p-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              title="Fullscreen (F)"
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* First-launch / Standby Festival Stage Dock (iPad requires a user tap to start Web Audio) */}
      {showQuickStartDock && (
        <div className="fixed bottom-5 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-20 safe-pb flex justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-xl w-full sm:w-auto px-4 py-3 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col sm:flex-row items-center gap-2.5">
            <button
              type="button"
              onClick={() => void handleStartAudio()}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              <Mic className="w-4 h-4" />
              Start Live Audio (USB-C / Mic)
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {!spotify.connected && (
                <button
                  type="button"
                  onClick={() => openStudioTab("output")}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
                >
                  <Music2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                  Connect Spotify
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleDemoBeat}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                Demo Beat
              </button>

              <button
                type="button"
                onClick={() => void handleQuickImportTheme()}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
                title="Import .tviz Theme"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">.tviz</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {statusToast && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] px-4 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] text-center">
          {statusToast}
        </div>
      )}

      {studioOpen && (
        <CustomizeStudioModal
          config={config}
          onChange={setConfig}
          savedThemes={savedThemes}
          onSaveThemes={handleSaveThemes}
          onClose={() => setStudioOpen(false)}
          initialTab={studioInitialTab}
          liveFftRef={liveFftRef}
          hasAudioSignal={hasAudioSignal}
          audioStatus={audioStatus}
          devices={devices}
          onStartAudio={(id) => void handleStartAudio(id)}
          onStopAudio={handleStopAudio}
          onToggleDemoBeat={handleToggleDemoBeat}
          onSetInputGain={handleSetInputGain}
          onSetNoiseGate={handleSetNoiseGate}
          onRefreshDevices={() => void refreshDevices()}
          spotify={spotify}
          nowPlaying={nowPlaying}
          onChangeSpotifyClientId={handleChangeSpotifyClientId}
          onConnectSpotify={() => void handleConnectSpotify()}
          onDisconnectSpotify={handleDisconnectSpotify}
          onRefreshSpotify={() => void runSpotifyPoll()}
          wakeLockSupported={wakeLockSupported}
          wakeLockEnabled={wakeLockEnabled}
          wakeLockActive={wakeLockActive}
          onToggleWakeLock={() => void handleToggleWakeLock()}
          snapEnabled={snapEnabled}
          onToggleSnap={() => setSnapEnabled((v) => !v)}
          connectedProjectors={connectedProjectors}
          blackout={blackout}
          onOpenBeamer={() => void handleOpenBeamer()}
          onCloseBeamer={handleCloseBeamer}
          onToggleBlackout={handleToggleBlackout}
        />
      )}
    </div>
  );
}

export default function App() {
  return isProjectorWindow() ? <ProjectorSurfaceApp /> : <ControlDeckApp />;
}
