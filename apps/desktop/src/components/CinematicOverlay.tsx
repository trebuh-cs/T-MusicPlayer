import { useEffect, useRef, useState } from "react";
import { Sliders, X } from "lucide-react";
import { getCoverUrl } from "../services/api";
import type { CinematicConfig, PlayingItem } from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";

interface CinematicOverlayProps {
  config: CinematicConfig;
  nowPlaying: PlayingItem | null;
  analyserRef: React.RefObject<AnalyserNode | null>;
  isPlaying: boolean;
  themeId: string;
  onOpenSettings: () => void;
  onExit: () => void;
}

export function CinematicOverlay({
  config,
  nowPlaying,
  analyserRef,
  isPlaying,
  themeId,
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

  const title =
    nowPlaying?.kind === "track"
      ? nowPlaying.track.title
      : nowPlaying?.kind === "radio"
      ? nowPlaying.station.name
      : "T - MusicPlayer";

  const artist =
    nowPlaying?.kind === "track"
      ? nowPlaying.track.artist
      : nowPlaying?.kind === "radio"
      ? "Live Internet Radio"
      : "";

  const titleBlock = config.titlePosition !== "hidden" && (
    <div className="text-center px-6 py-2 max-w-2xl mx-auto shrink-0 select-none">
      <div className="text-xl md:text-2xl font-bold tracking-tight text-[var(--text-primary)] truncate">
        {title}
      </div>
      {config.showArtistInTitle && artist && (
        <div className="text-xs md:text-sm text-[var(--text-secondary)] mt-0.5 truncate">
          {artist}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--bg-base)] flex flex-col items-center justify-center overflow-hidden p-6"
      style={{
        cursor: controlsVisible ? "default" : "none",
      }}
    >
      {/* Subtle auto-hiding exit & settings controls */}
      <div
        className={`fixed top-5 right-5 z-20 flex items-center gap-2 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
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

      {config.titlePosition === "above" && titleBlock}

      <div className="flex-1 w-full min-h-0 flex items-center justify-center">
        <CircularVisualizerCanvas
          config={config}
          analyserRef={analyserRef}
          isPlaying={isPlaying}
          isRadio={nowPlaying?.kind === "radio"}
          themeId={themeId}
          coverUrl={coverUrl}
        />
      </div>

      {config.titlePosition === "below" && titleBlock}
    </div>
  );
}
