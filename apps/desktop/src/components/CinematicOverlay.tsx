import { useEffect, useRef, useState } from "react";
import { Sliders, Wallpaper, X } from "lucide-react";
import { getCoverUrl } from "../services/api";
import type { CinematicConfig, PlayingItem } from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";

interface CinematicOverlayProps {
  config: CinematicConfig;
  nowPlaying: PlayingItem | null;
  analyserRef: React.RefObject<AnalyserNode | null>;
  isPlaying: boolean;
  themeId: string;
  wallpaperMode: boolean;
  onToggleWallpaper: () => void;
  onOpenSettings: () => void;
  onExit: () => void;
}

export function CinematicOverlay({
  config,
  nowPlaying,
  analyserRef,
  isPlaying,
  themeId,
  wallpaperMode,
  onToggleWallpaper,
  onOpenSettings,
  onExit,
}: CinematicOverlayProps) {
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const revealTemporarily = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2200);
    };

    window.addEventListener("mousemove", revealTemporarily);
    return () => {
      window.removeEventListener("mousemove", revealTemporarily);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const coverUrl =
    nowPlaying?.kind === "track"
      ? getCoverUrl(nowPlaying.track.cover_hash)
      : nowPlaying?.kind === "radio"
      ? nowPlaying.station.favicon
      : null;

  const autoTitle =
    nowPlaying?.kind === "track"
      ? nowPlaying.track.title
      : nowPlaying?.kind === "radio"
      ? nowPlaying.station.name
      : "T - MusicPlayer";

  const autoArtist =
    nowPlaying?.kind === "track"
      ? nowPlaying.track.artist
      : nowPlaying?.kind === "radio"
      ? "Live Internet Radio"
      : "";

  const displayTitle =
    config.titleSource === "custom" ? config.customTitle.trim() : autoTitle;
  const displayArtist =
    config.titleSource === "custom" ? config.customSubtitle.trim() : autoArtist;
  const showSub = config.showSubtitle || config.showArtistInTitle;

  const titlePosClass =
    config.titlePosition === "above"
      ? "top-12 inset-x-10 text-center"
      : config.titlePosition === "below"
      ? "bottom-14 inset-x-10 text-center"
      : config.titlePosition === "bottom-left"
      ? "bottom-10 left-10 max-w-[60vw] text-left"
      : "bottom-8 inset-x-10 text-center";

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--bg-base)] overflow-hidden"
      style={{
        cursor: controlsVisible ? "default" : "none",
      }}
    >
      {/* Subtle auto-hiding exit, wallpaper & settings controls */}
      <div
        className={`fixed top-5 right-5 z-20 flex items-center gap-2 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          type="button"
          onClick={onToggleWallpaper}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer"
          style={
            wallpaperMode
              ? {
                  background: "var(--bg-elevated)",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)",
                }
              : {
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                }
          }
        >
          <Wallpaper className="w-3.5 h-3.5" />
          {wallpaperMode ? "Stop Wallpaper" : "Live Wallpaper"}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
        >
          <Sliders className="w-3.5 h-3.5 text-[var(--accent)]" />
          Customize
        </button>
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          Exit (Esc)
        </button>
      </div>

      <div className="w-full h-full relative">
        <CircularVisualizerCanvas
          config={config}
          analyserRef={analyserRef}
          isPlaying={isPlaying}
          isRadio={nowPlaying?.kind === "radio"}
          themeId={themeId}
          coverUrl={coverUrl}
        />

        {config.titlePosition !== "hidden" && (displayTitle || displayArtist) && (
          <div className={`absolute z-10 pointer-events-none select-none ${titlePosClass}`}>
            <div
              className={`inline-flex flex-col ${
                config.titlePosition === "bottom-left" ? "items-start" : "items-center"
              } px-4 py-2 rounded-xl bg-[var(--bg-elevated)]/85 border border-[var(--border-subtle)]`}
            >
              {displayTitle && (
                <div
                  className="font-bold tracking-tight text-[var(--text-primary)] leading-tight truncate max-w-full"
                  style={{ fontSize: `${Math.round(24 * config.titleScale)}px` }}
                >
                  {displayTitle}
                </div>
              )}
              {showSub && displayArtist && (
                <div
                  className="text-[var(--text-secondary)] mt-0.5 truncate max-w-full"
                  style={{ fontSize: `${Math.round(14 * config.titleScale)}px` }}
                >
                  {displayArtist}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
