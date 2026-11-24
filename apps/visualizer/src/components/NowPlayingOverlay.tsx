import type { NowPlayingMedia, VisualizerConfig } from "../types";

interface NowPlayingOverlayProps {
  config: VisualizerConfig;
  nowPlaying: NowPlayingMedia | null;
  previewMode?: boolean;
}

export function NowPlayingOverlay({
  config,
  nowPlaying,
  previewMode = false,
}: NowPlayingOverlayProps) {
  if (config.titlePosition === "hidden") return null;

  let title = "";
  let subtitle = "";
  let badge = "";

  if (config.titleSource === "auto-media") {
    if (nowPlaying && (nowPlaying.title || nowPlaying.artist)) {
      title = nowPlaying.title || nowPlaying.artist;
      subtitle = nowPlaying.artist || nowPlaying.album;
      badge = nowPlaying.source_app;
    } else if (previewMode) {
      title = "Detected Song Title";
      subtitle = "Spotify / YouTube Artist";
      badge = "Spotify";
    } else {
      return null;
    }
  } else {
    title = config.customTitle.trim();
    subtitle = config.customSubtitle.trim();
    if (!title && !subtitle) return null;
  }

  const baseTitlePx = (previewMode ? 14 : 26) * config.titleScale;
  const baseSubPx = (previewMode ? 11 : 15) * config.titleScale;

  const posClass =
    config.titlePosition === "above"
      ? previewMode
        ? "top-3 inset-x-4 text-center"
        : "top-14 inset-x-10 text-center"
      : config.titlePosition === "below"
      ? previewMode
        ? "bottom-4 inset-x-4 text-center"
        : "bottom-14 inset-x-10 text-center"
      : config.titlePosition === "bottom-left"
      ? previewMode
        ? "bottom-3 left-4 right-4 text-left"
        : "bottom-10 left-10 max-w-[60vw] text-left"
      : previewMode
      ? "bottom-3 inset-x-4 text-center"
      : "bottom-8 inset-x-10 text-center";

  return (
    <div className={`absolute z-10 pointer-events-none select-none ${posClass}`}>
      <div
        className={`inline-flex flex-col ${
          config.titlePosition === "bottom-left" ? "items-start" : "items-center"
        } px-4 py-2 rounded-xl bg-[var(--bg-elevated)]/85 border border-[var(--border-subtle)]`}
      >
        {config.showMediaSourceBadge && badge && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] mb-0.5">
            {badge}
          </span>
        )}
        {title && (
          <div
            className="font-bold tracking-tight text-[var(--text-primary)] leading-tight truncate max-w-full"
            style={{ fontSize: `${Math.round(baseTitlePx)}px` }}
          >
            {title}
          </div>
        )}
        {config.showSubtitle && subtitle && (
          <div
            className="text-[var(--text-secondary)] mt-0.5 truncate max-w-full"
            style={{ fontSize: `${Math.round(baseSubPx)}px` }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
