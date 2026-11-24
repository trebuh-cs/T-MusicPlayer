import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../services/api";
import { applyThemeToDocument, getThemeById } from "../themes/themes";
import {
  DEFAULT_CINEMATIC_CONFIG,
  mergeVisualizerConfig,
  type DesktopWallpaperPayload,
} from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";

const DEFAULT_PAYLOAD: DesktopWallpaperPayload = {
  config: DEFAULT_CINEMATIC_CONFIG,
  themeId: "tpx",
  isPlaying: false,
  isRadio: false,
  title: "",
  artist: "",
  coverUrl: null,
};

/**
 * Ultra-lightweight wallpaper surface mounted exclusively in dedicated `wallpaper-*` windows
 * spawned by T - MusicPlayer. Receives 60fps FFT & live track/config updates from `main`.
 */
export function DesktopWallpaperSurface() {
  const [payload, setPayload] = useState<DesktopWallpaperPayload>(DEFAULT_PAYLOAD);
  const liveFftRef = useRef<Uint8Array>(new Uint8Array(256));

  useEffect(() => {
    applyThemeToDocument(getThemeById(payload.themeId));
  }, [payload.themeId]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const applyRaw = (raw: string | null | undefined) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<DesktopWallpaperPayload>;
        setPayload((prev) => ({
          ...prev,
          ...parsed,
          config: mergeVisualizerConfig(parsed.config, DEFAULT_CINEMATIC_CONFIG),
        }));
      } catch {
        // Ignore malformed payload
      }
    };

    void api.getWallpaperPayload().then(applyRaw).catch(() => {});
    void listen<string>("desktop-wallpaper-payload", (event) => {
      applyRaw(event.payload);
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

    const tick = () => {
      if (cancelled) return;
      if (!inFlight) {
        inFlight = true;
        api
          .getWallpaperFft()
          .then((bins) => {
            if (cancelled) return;
            const target = liveFftRef.current;
            const len = Math.min(target.length, bins.length);
            for (let i = 0; i < len; i++) target[i] = bins[i];
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

  const cfg = payload.config;
  const displayTitle =
    cfg.titleSource === "custom" ? cfg.customTitle.trim() : payload.title.trim();
  const displayArtist =
    cfg.titleSource === "custom" ? cfg.customSubtitle.trim() : payload.artist.trim();
  const showSub = cfg.showSubtitle || cfg.showArtistInTitle;

  const titlePosClass =
    cfg.titlePosition === "above"
      ? "top-12 inset-x-10 text-center"
      : cfg.titlePosition === "below"
      ? "bottom-14 inset-x-10 text-center"
      : cfg.titlePosition === "bottom-left"
      ? "bottom-10 left-10 max-w-[60vw] text-left"
      : "bottom-8 inset-x-10 text-center";

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-[var(--bg-base)] select-none">
      <CircularVisualizerCanvas
        config={cfg}
        liveFftRef={liveFftRef}
        isPlaying={payload.isPlaying}
        isRadio={payload.isRadio}
        themeId={payload.themeId}
        coverUrl={payload.coverUrl}
      />

      {cfg.titlePosition !== "hidden" && (displayTitle || displayArtist) && (
        <div className={`absolute z-10 pointer-events-none select-none ${titlePosClass}`}>
          <div
            className={`inline-flex flex-col ${
              cfg.titlePosition === "bottom-left" ? "items-start" : "items-center"
            } px-4 py-2 rounded-xl bg-[var(--bg-elevated)]/85 border border-[var(--border-subtle)]`}
          >
            {displayTitle && (
              <div
                className="font-bold tracking-tight text-[var(--text-primary)] leading-tight truncate max-w-full"
                style={{ fontSize: `${Math.round(24 * cfg.titleScale)}px` }}
              >
                {displayTitle}
              </div>
            )}
            {showSub && displayArtist && (
              <div
                className="text-[var(--text-secondary)] mt-0.5 truncate max-w-full"
                style={{ fontSize: `${Math.round(14 * cfg.titleScale)}px` }}
              >
                {displayArtist}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
