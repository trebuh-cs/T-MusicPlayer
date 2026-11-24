import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Projector } from "lucide-react";
import { createStageChannel, type StageSyncMessage } from "../services/stageSync";
import { ScreenWakeLockController } from "../services/wakeLock";
import { applyThemeToDocument, getThemeById } from "../themes";
import {
  DEFAULT_VISUALIZER_CONFIG,
  mergeVisualizerConfig,
  type NowPlayingMedia,
  type VisualizerConfig,
} from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";
import { NowPlayingOverlay } from "./NowPlayingOverlay";

const STORAGE_KEY = "t_visualizer_web_config_v1";

function loadInitialConfig(): VisualizerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISUALIZER_CONFIG;
    return mergeVisualizerConfig(JSON.parse(raw) as Partial<VisualizerConfig>);
  } catch {
    return DEFAULT_VISUALIZER_CONFIG;
  }
}

/**
 * Dedicated zero-HUD Fullscreen Beamer / Stage Projector output window (`?projector=1`).
 * Receives live 60fps FFT frames, Visualize Studio config edits, Spotify Now Playing,
 * and Blackout state over BroadcastChannel from the main Control Deck tab.
 */
export function ProjectorSurfaceApp() {
  const [config, setConfig] = useState<VisualizerConfig>(() => loadInitialConfig());
  const [nowPlaying, setNowPlaying] = useState<NowPlayingMedia | null>(null);
  const [hasAudioSignal, setHasAudioSignal] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [linked, setLinked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const liveFftRef = useRef<Uint8Array>(new Uint8Array(256));
  const hideTimerRef = useRef<number | null>(null);
  const projectorIdRef = useRef(`proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  useEffect(() => {
    document.title = "T - Visualizer · Beamer Output";
    applyThemeToDocument(getThemeById(config.themeId));
  }, [config.themeId]);

  // Keep Beamer / External Display awake
  useEffect(() => {
    const wl = new ScreenWakeLockController(() => {});
    if (ScreenWakeLockController.isSupported()) {
      void wl.enable();
    }
    return () => wl.dispose();
  }, []);

  // BroadcastChannel receiver + handshake + heartbeat
  useEffect(() => {
    const channel = createStageChannel();
    const id = projectorIdRef.current;

    const sendHello = () => {
      channel?.postMessage({ type: "projector-hello", id } satisfies StageSyncMessage);
    };

    if (channel) {
      channel.onmessage = (event: MessageEvent<StageSyncMessage>) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "state-sync") {
          setLinked(true);
          setConfig(mergeVisualizerConfig(msg.config));
          setNowPlaying(msg.nowPlaying);
          setHasAudioSignal(msg.hasAudioSignal);
          setBlackout(msg.blackout);
        } else if (msg.type === "fft-frame") {
          setLinked(true);
          const target = liveFftRef.current;
          const src = msg.bins;
          const len = Math.min(target.length, src.length);
          for (let i = 0; i < len; i++) {
            target[i] = src[i];
          }
          setHasAudioSignal(msg.hasAudioSignal);
        } else if (msg.type === "blackout") {
          setLinked(true);
          setBlackout(msg.enabled);
        }
      };

      sendHello();
    }

    const heartbeatId = window.setInterval(() => {
      channel?.postMessage({ type: "projector-heartbeat", id } satisfies StageSyncMessage);
    }, 2500);

    // Fallback config sync via localStorage storage events
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setConfig(mergeVisualizerConfig(JSON.parse(e.newValue) as Partial<VisualizerConfig>));
        } catch {
          // Ignore malformed JSON
        }
      }
    };
    window.addEventListener("storage", onStorage);

    const onBye = () => {
      channel?.postMessage({ type: "projector-bye", id } satisfies StageSyncMessage);
    };
    window.addEventListener("beforeunload", onBye);
    window.addEventListener("pagehide", onBye);

    return () => {
      window.clearInterval(heartbeatId);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onBye);
      window.removeEventListener("pagehide", onBye);
      onBye();
      channel?.close();
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (fs) {
        setShowControls(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3200);
  }, []);

  const toggleFullscreen = useCallback(async () => {
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
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        setIsFullscreen(false);
      } else if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
        setIsFullscreen(true);
        setShowControls(false);
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
        setIsFullscreen(true);
        setShowControls(false);
      }
    } catch {
      // Ignore if browser restricts fullscreen
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFullscreen]);

  return (
    <div
      className={`fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-black select-none ${
        isFullscreen && !showControls ? "cursor-none" : ""
      }`}
      onMouseMove={bumpControls}
      onClick={bumpControls}
      onDoubleClick={() => void toggleFullscreen()}
    >
      {/* Pure Stage Visualizer Surface */}
      <div
        className={`w-full h-full relative transition-opacity duration-200 ${
          blackout ? "opacity-0" : "opacity-100"
        }`}
      >
        <CircularVisualizerCanvas
          config={config}
          liveFftRef={liveFftRef}
          hasAudioSignal={hasAudioSignal}
          albumArtUrl={nowPlaying?.thumbnail_data_url ?? null}
        />
        <NowPlayingOverlay config={config} nowPlaying={nowPlaying} />
      </div>

      {/* Auto-hiding Minimal Beamer Fullscreen Pill (disappears completely when fullscreen & idle) */}
      {(showControls || !isFullscreen) && (
        <div
          className={`fixed bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs transition-opacity duration-200 ${
            showControls ? "opacity-100" : "opacity-65 hover:opacity-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: linked ? "var(--accent)" : "var(--text-muted)" }}
          />
          <Projector className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
          <span className="text-[var(--text-secondary)] hidden sm:inline">
            {blackout
              ? "BLACKOUT ACTIVE"
              : linked
              ? "Beamer Live Sync"
              : "Waiting for Control Window..."}
          </span>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold cursor-pointer"
            style={{
              background: "var(--accent)",
              color: "var(--accent-contrast)",
            }}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                Exit
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                Fullscreen
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
