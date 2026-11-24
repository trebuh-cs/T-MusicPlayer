import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CinematicConfig } from "../types";

interface MarqueeLineProps {
  text: string;
  enabled: boolean;
  speedPxPerSec: number;
  className?: string;
  style?: React.CSSProperties;
}

function MarqueeLine({
  text,
  enabled,
  speedPxPerSec,
  className = "",
  style,
}: MarqueeLineProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  const remeasure = () => {
    const outer = outerRef.current;
    const inner = measureRef.current;
    if (!outer || !inner) return;
    const tw = inner.scrollWidth;
    const ow = outer.clientWidth;
    setTextWidth(tw);
    setOverflowPx(tw > ow + 2 ? tw - ow : 0);
  };

  useLayoutEffect(() => {
    remeasure();
  }, [text, style?.fontSize, enabled]);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const obs = new ResizeObserver(remeasure);
    obs.observe(outer);
    return () => obs.disconnect();
  }, []);

  const shouldScroll = enabled && overflowPx > 0;
  const gapPx = 48;
  const durationSec = Math.max(
    4,
    (textWidth + gapPx) / Math.max(15, speedPxPerSec)
  );

  return (
    <div
      ref={outerRef}
      className={`w-full overflow-hidden whitespace-nowrap ${className}`}
      style={style}
    >
      <span
        ref={measureRef}
        className="inline-block whitespace-nowrap"
        style={
          shouldScroll
            ? { position: "absolute", visibility: "hidden", pointerEvents: "none" }
            : undefined
        }
      >
        {text}
      </span>

      {shouldScroll && (
        <div
          className="t-marquee-track"
          style={{ animationDuration: `${durationSec.toFixed(2)}s` }}
        >
          <span
            className="inline-block whitespace-nowrap"
            style={{ paddingRight: `${gapPx}px` }}
          >
            {text}
          </span>
          <span
            className="inline-block whitespace-nowrap"
            style={{ paddingRight: `${gapPx}px` }}
          >
            {text}
          </span>
        </div>
      )}
    </div>
  );
}

interface NowPlayingOverlayProps {
  config: CinematicConfig;
  title: string;
  artist: string;
  sourceLabel?: string;
  previewMode?: boolean;
}

export function NowPlayingOverlay({
  config,
  title: rawTitle,
  artist: rawArtist,
  sourceLabel = "T - MusicPlayer",
  previewMode = false,
}: NowPlayingOverlayProps) {
  if (config.titlePosition === "hidden") return null;

  const title =
    config.titleSource === "custom" ? config.customTitle.trim() : rawTitle.trim();
  const subtitle =
    config.titleSource === "custom" ? config.customSubtitle.trim() : rawArtist.trim();
  if (!title && !subtitle) return null;

  const scaleMult = previewMode ? 0.62 : 1;
  const titlePx = Math.max(10, Math.round(22 * config.titleScale * scaleMult));
  const subPx = Math.max(9, Math.round(13 * config.titleScale * scaleMult));
  const padY = Math.max(2, Math.round(config.titlePaddingY * scaleMult));
  const padX = Math.max(6, Math.round(config.titlePaddingX * scaleMult));
  const maxW = Math.max(120, Math.round(config.titleMaxWidth * (previewMode ? 0.62 : 1)));
  const showSub = (config.showSubtitle || config.showArtistInTitle) && Boolean(subtitle);
  const showBadge =
    config.showMediaSourceBadge && config.titleSource === "auto-media" && Boolean(sourceLabel);

  const posClass =
    config.titlePosition === "above"
      ? previewMode
        ? "top-3 inset-x-4 flex justify-center"
        : "top-14 inset-x-10 flex justify-center"
      : config.titlePosition === "below"
      ? previewMode
        ? "bottom-4 inset-x-4 flex justify-center"
        : "bottom-14 inset-x-10 flex justify-center"
      : config.titlePosition === "bottom-left"
      ? previewMode
        ? "bottom-3 left-4 flex justify-start"
        : "bottom-10 left-10 flex justify-start"
      : previewMode
      ? "bottom-3 inset-x-4 flex justify-center"
      : "bottom-8 inset-x-10 flex justify-center";

  const alignClass =
    config.titlePosition === "bottom-left"
      ? "items-start text-left"
      : "items-center text-center";

  const compactCombined = [title, showSub ? subtitle : ""].filter(Boolean).join("  —  ");

  return (
    <div className={`absolute z-10 pointer-events-none select-none ${posClass}`}>
      <div
        className={`relative flex ${
          config.titleCompact ? "flex-row items-center gap-2.5" : `flex-col ${alignClass}`
        } rounded-xl overflow-hidden`}
        style={{
          maxWidth: `${maxW}px`,
          padding: `${padY}px ${padX}px`,
          backgroundColor:
            config.titleBoxOpacity > 0.01
              ? `color-mix(in srgb, var(--bg-elevated) ${Math.round(
                  config.titleBoxOpacity * 100
                )}%, transparent)`
              : "transparent",
          border: config.titleShowBorder
            ? "1px solid var(--border-subtle)"
            : "1px solid transparent",
        }}
      >
        {config.titleCompact ? (
          <>
            {showBadge && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] shrink-0">
                {sourceLabel}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <MarqueeLine
                text={compactCombined}
                enabled={config.titleMarquee}
                speedPxPerSec={config.titleMarqueeSpeed}
                className="font-semibold tracking-tight text-[var(--text-primary)] leading-snug"
                style={{ fontSize: `${titlePx}px` }}
              />
            </div>
          </>
        ) : (
          <>
            {showBadge && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] mb-0.5 shrink-0">
                {sourceLabel}
              </span>
            )}
            {title && (
              <MarqueeLine
                text={title}
                enabled={config.titleMarquee}
                speedPxPerSec={config.titleMarqueeSpeed}
                className="font-bold tracking-tight text-[var(--text-primary)] leading-tight"
                style={{ fontSize: `${titlePx}px` }}
              />
            )}
            {showSub && (
              <MarqueeLine
                text={subtitle}
                enabled={config.titleMarquee}
                speedPxPerSec={config.titleMarqueeSpeed}
                className="text-[var(--text-secondary)] mt-0.5 leading-snug"
                style={{ fontSize: `${subPx}px` }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
