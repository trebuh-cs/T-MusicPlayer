import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  resolveTitleFontCss,
  type NowPlayingMedia,
  type TitleFontWeight,
  type VisualizerConfig,
} from "../types";

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
  }, [text, style?.fontSize, style?.fontFamily, style?.letterSpacing, enabled]);

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

const FONT_WEIGHT_MAP: Record<TitleFontWeight, number> = {
  normal: 400,
  semibold: 600,
  bold: 700,
  black: 900,
};

const SNAP_X_TARGETS = [4, 50, 96];
const SNAP_Y_TARGETS = [6, 50, 94];
const SNAP_THRESHOLD = 2.4;

function snapAxis(val: number, targets: number[], freeMode: boolean): [number, number | null] {
  const clamped = Math.max(0, Math.min(100, val));
  if (freeMode) return [Math.round(clamped * 10) / 10, null];
  for (const t of targets) {
    if (Math.abs(clamped - t) <= SNAP_THRESHOLD) {
      return [t, t];
    }
  }
  return [Math.round(clamped * 10) / 10, null];
}

interface NowPlayingOverlayProps {
  config: VisualizerConfig;
  nowPlaying: NowPlayingMedia | null;
  previewMode?: boolean;
  onMovePosition?: (xPct: number, yPct: number) => void;
}

export function NowPlayingOverlay({
  config,
  nowPlaying,
  previewMode = false,
  onMovePosition,
}: NowPlayingOverlayProps) {
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const [dragging, setDragging] = useState(false);
  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  const [snapGuideY, setSnapGuideY] = useState<number | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

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
      title = "Very Long Track Title That Scrolls Smoothly In A Classic Loop";
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

  const scaleMult = previewMode ? 0.62 : 1;
  const titlePx = Math.max(10, Math.round(22 * config.titleScale * scaleMult));
  const subPx = Math.max(9, Math.round(13 * config.titleScale * scaleMult));
  const padY = config.titleShowBox ? Math.max(2, Math.round(config.titlePaddingY * scaleMult)) : 0;
  const padX = config.titleShowBox ? Math.max(6, Math.round(config.titlePaddingX * scaleMult)) : 0;
  const maxW = Math.max(120, Math.round(config.titleMaxWidth * (previewMode ? 0.62 : 1)));
  const showSub = config.showSubtitle && Boolean(subtitle);
  const showBadge = config.showMediaSourceBadge && Boolean(badge);

  const posX = Math.max(0, Math.min(100, config.titlePosX ?? 50));
  const posY = Math.max(0, Math.min(100, config.titlePosY ?? 90));
  const fontFamily = resolveTitleFontCss(config.titleFontFamily);
  const fontWeight = FONT_WEIGHT_MAP[config.titleFontWeight ?? "bold"];
  const letterSpacing = `${(config.titleLetterSpacing ?? 0) * scaleMult}px`;
  const textTransform = config.titleUppercase ? "uppercase" : "none";
  const primaryTextColor =
    config.titleTextColorMode === "custom"
      ? config.titleCustomColor
      : "var(--text-primary)";

  const alignItemsClass =
    config.titleAlign === "left"
      ? "items-start text-left"
      : config.titleAlign === "right"
      ? "items-end text-right"
      : "items-center text-center";

  const compactCombined = [title, showSub ? subtitle : ""].filter(Boolean).join("  —  ");
  const isDraggable = Boolean(onMovePosition);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onMovePosition || e.button !== 0) return;
    const root = overlayRootRef.current;
    if (!root) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const curPxX = (posX / 100) * rect.width;
    const curPxY = (posY / 100) * rect.height;
    dragStateRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left - curPxX,
      offsetY: e.clientY - rect.top - curPxY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setShiftHeld(e.shiftKey);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !onMovePosition) return;
    const root = overlayRootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    const rawX = ((e.clientX - rect.left - drag.offsetX) / rect.width) * 100;
    const rawY = ((e.clientY - rect.top - drag.offsetY) / rect.height) * 100;
    const free = e.shiftKey;
    setShiftHeld(free);

    const [nx, guideX] = snapAxis(rawX, SNAP_X_TARGETS, free);
    const [ny, guideY] = snapAxis(rawY, SNAP_Y_TARGETS, free);
    setSnapGuideX(guideX);
    setSnapGuideY(guideY);
    onMovePosition(nx, ny);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    dragStateRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // Ignore if capture already released
    }
    setDragging(false);
    setSnapGuideX(null);
    setSnapGuideY(null);
    setShiftHeld(false);
  };

  return (
    <div
      ref={overlayRootRef}
      className="absolute inset-0 z-10 pointer-events-none select-none overflow-hidden"
    >
      {/* Crisp Matte Alignment Snap Guides (visible only while dragging) */}
      {dragging && snapGuideX !== null && (
        <div
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{
            left: `${snapGuideX}%`,
            backgroundColor: "var(--accent)",
            opacity: 0.75,
          }}
        />
      )}
      {dragging && snapGuideY !== null && (
        <div
          className="absolute left-0 right-0 h-px pointer-events-none"
          style={{
            top: `${snapGuideY}%`,
            backgroundColor: "var(--accent)",
            opacity: 0.75,
          }}
        />
      )}

      {/* Draggable / Positioned Text Container */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`absolute flex ${
          config.titleCompact ? "flex-row items-center gap-2.5" : `flex-col ${alignItemsClass}`
        } ${config.titleShowBox ? "rounded-xl" : ""} overflow-hidden ${
          isDraggable
            ? dragging
              ? "pointer-events-auto cursor-grabbing outline-1 outline-dashed outline-[var(--accent)]"
              : "pointer-events-auto cursor-grab hover:outline-1 hover:outline-dashed hover:outline-[var(--accent)]/60"
            : "pointer-events-none"
        }`}
        style={{
          left: `${posX}%`,
          top: `${posY}%`,
          transform: `translate(${-posX}%, ${-posY}%)`,
          maxWidth: config.titleUnlimitedWidth ? "none" : `${maxW}px`,
          width: config.titleUnlimitedWidth ? "max-content" : undefined,
          padding: `${padY}px ${padX}px`,
          fontFamily,
          backgroundColor:
            config.titleShowBox && config.titleBoxOpacity > 0.01
              ? `color-mix(in srgb, var(--bg-elevated) ${Math.round(
                  config.titleBoxOpacity * 100
                )}%, transparent)`
              : "transparent",
          border:
            config.titleShowBox && config.titleShowBorder
              ? "1px solid var(--border-subtle)"
              : "1px solid transparent",
        }}
        title={isDraggable ? "Drag to reposition (hold Shift for free placement without snapping)" : undefined}
      >
        {config.titleCompact ? (
          <>
            {showBadge && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] shrink-0"
                style={{ fontFamily }}
              >
                {badge}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <MarqueeLine
                text={compactCombined}
                enabled={!config.titleUnlimitedWidth && config.titleMarquee}
                speedPxPerSec={config.titleMarqueeSpeed}
                className="leading-snug"
                style={{
                  fontSize: `${titlePx}px`,
                  fontWeight,
                  letterSpacing,
                  textTransform,
                  color: primaryTextColor,
                }}
              />
            </div>
          </>
        ) : (
          <>
            {showBadge && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] mb-0.5 shrink-0"
                style={{ fontFamily }}
              >
                {badge}
              </span>
            )}
            {title && (
              <MarqueeLine
                text={title}
                enabled={!config.titleUnlimitedWidth && config.titleMarquee}
                speedPxPerSec={config.titleMarqueeSpeed}
                className="leading-tight"
                style={{
                  fontSize: `${titlePx}px`,
                  fontWeight,
                  letterSpacing,
                  textTransform,
                  color: primaryTextColor,
                }}
              />
            )}
            {showSub && (
              <MarqueeLine
                text={subtitle}
                enabled={!config.titleUnlimitedWidth && config.titleMarquee}
                speedPxPerSec={config.titleMarqueeSpeed}
                className="mt-0.5 leading-snug"
                style={{
                  fontSize: `${subPx}px`,
                  letterSpacing,
                  color:
                    config.titleTextColorMode === "custom"
                      ? primaryTextColor
                      : "var(--text-secondary)",
                  opacity: config.titleTextColorMode === "custom" ? 0.78 : 1,
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Live drag coordinates readout */}
      {dragging && (
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] font-mono-num text-[var(--text-primary)] pointer-events-none">
          X {posX.toFixed(0)}% · Y {posY.toFixed(0)}%{" "}
          <span className="text-[var(--accent)]">
            {shiftHeld ? "(Free · Shift)" : "(Snap On · Hold Shift for Free)"}
          </span>
        </div>
      )}
    </div>
  );
}
