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
import { NowPlayingOverlay } from "./NowPlayingOverlay";

const DEFAULT_PAYLOAD: DesktopWallpaperPayload = {
  config: DEFAULT_CINEMATIC_CONFIG,
  themeId: "tpx",
  isPlaying: false,
  isRadio: false,
  title: "",
  artist: "",
  coverUrl: null,
};

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

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-[var(--bg-base)] select-none">
      <CircularVisualizerCanvas
        config={payload.config}
        liveFftRef={liveFftRef}
        isPlaying={payload.isPlaying}
        isRadio={payload.isRadio}
        themeId={payload.themeId}
        coverUrl={payload.coverUrl}
      />
      <NowPlayingOverlay
        config={payload.config}
        title={payload.title}
        artist={payload.artist}
        sourceLabel={payload.isRadio ? "Internet Radio" : "T - MusicPlayer"}
      />
    </div>
  );
}
