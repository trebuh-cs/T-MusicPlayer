import { memo, useEffect, useMemo, useRef, useState } from "react";
import tpxLogoUrl from "../assets/tpx-logo.svg";
import { getCoverUrl } from "../services/api";
import type { CinematicConfig } from "../types";

interface CircularVisualizerCanvasProps {
  config: CinematicConfig;
  analyserRef: React.RefObject<AnalyserNode | null>;
  isPlaying: boolean;
  isRadio: boolean;
  themeId: string;
  coverUrl: string | null;
  previewMode?: boolean;
  simulatePreview?: boolean;
  className?: string;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface CachedPalette {
  accent: string;
  vizStart: string;
  vizEnd: string;
  bgElevated: string;
}

function readDocumentPalette(): CachedPalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: styles.getPropertyValue("--accent").trim() || "#0AF92A",
    vizStart: styles.getPropertyValue("--viz-start").trim() || "#0AF92A",
    vizEnd: styles.getPropertyValue("--viz-end").trim() || "#49ECC1",
    bgElevated: styles.getPropertyValue("--bg-elevated").trim() || "#111311",
  };
}

function parseHexRgb(hex: string): RGB {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b };
    }
  }
  return { r: 10, g: 249, b: 42 };
}

function lerpRgb(a: RGB, b: RGB, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * k);
  const g = Math.round(a.g + (b.g - a.g) * k);
  const bl = Math.round(a.b + (b.b - a.b) * k);
  return `rgb(${r},${g},${bl})`;
}

function sampleDynamicColor(low: RGB, mid: RGB, high: RGB, level: number): string {
  const clamped = Math.max(0, Math.min(1, level));
  return clamped < 0.5
    ? lerpRgb(low, mid, clamped * 2)
    : lerpRgb(mid, high, (clamped - 0.5) * 2);
}

function drawVectorMusicIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  accent: string
): void {
  const s = radius * 0.44;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.ellipse(-s * 0.42, s * 0.42, s * 0.28, s * 0.21, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(s * 0.44, s * 0.28, s * 0.28, s * 0.21, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = Math.max(2.5, s * 0.16);
  ctx.beginPath();
  ctx.moveTo(-s * 0.18, s * 0.36);
  ctx.lineTo(-s * 0.18, -s * 0.62);
  ctx.lineTo(s * 0.68, -s * 0.78);
  ctx.lineTo(s * 0.68, 0.22 * s);
  ctx.stroke();

  ctx.lineWidth = Math.max(4, s * 0.24);
  ctx.beginPath();
  ctx.moveTo(-s * 0.18, -s * 0.62);
  ctx.lineTo(s * 0.68, -s * 0.78);
  ctx.stroke();

  ctx.restore();
}

export const CircularVisualizerCanvas = memo(function CircularVisualizerCanvas({
  config,
  analyserRef,
  isPlaying,
  isRadio,
  themeId,
  coverUrl,
  previewMode = false,
  simulatePreview = false,
  className = "",
}: CircularVisualizerCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(200));
  const rotationRef = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  const paletteRef = useRef<CachedPalette>({
    accent: "#0AF92A",
    vizStart: "#0AF92A",
    vizEnd: "#49ECC1",
    bgElevated: "#111311",
  });

  const [size, setSize] = useState({ width: 400, height: 400 });
  const [imageVersion, setImageVersion] = useState(0);
  const loadedImgRef = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);

  // Sync cached CSS theme colors only when theme/style changes (never per-frame).
  useEffect(() => {
    paletteRef.current = readDocumentPalette();
    const observer = new MutationObserver(() => {
      paletteRef.current = readDocumentPalette();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [themeId]);

  const effectiveCenterKind = useMemo(() => {
    if (config.centerSource === "auto") {
      return themeId === "tpx" ? "tpx" : "music-icon";
    }
    return config.centerSource;
  }, [config.centerSource, themeId]);

  const effectiveImageUrl = useMemo(() => {
    if (effectiveCenterKind === "tpx") return tpxLogoUrl;
    if (effectiveCenterKind === "custom" && config.customImageHash) {
      return getCoverUrl(config.customImageHash);
    }
    if (effectiveCenterKind === "album-art" && coverUrl) return coverUrl;
    return null;
  }, [effectiveCenterKind, config.customImageHash, coverUrl]);

  useEffect(() => {
    if (!effectiveImageUrl) {
      loadedImgRef.current = null;
      setImageVersion((v) => v + 1);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const entry = { url: effectiveImageUrl, img, ready: false };
    loadedImgRef.current = entry;
    img.onload = () => {
      if (loadedImgRef.current?.url === effectiveImageUrl) {
        loadedImgRef.current.ready = true;
        setImageVersion((v) => v + 1);
      }
    };
    img.src = effectiveImageUrl;
  }, [effectiveImageUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextW = Math.floor(rect.width);
        const nextH = Math.floor(rect.height);
        setSize((prev) =>
          prev.width === nextW && prev.height === nextH
            ? prev
            : { width: nextW, height: nextH }
        );
      }
    };
    updateSize();
    const obs = new ResizeObserver(updateSize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(size.width * dpr));
    canvas.height = Math.max(1, Math.floor(size.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let rafId = 0;
    let lastTime = performance.now();
    const freqData = new Uint8Array(256);

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const cfg = configRef.current;
      const palette = paletteRef.current;

      // Read base background directly from computed body background once via cached palette or root var.
      const bgBase =
        document.documentElement.style.getPropertyValue("--bg-base").trim() || "#0B0D12";
      ctx.fillStyle = bgBase;
      ctx.fillRect(0, 0, size.width, size.height);

      const cx = size.width / 2;
      const cy = size.height / 2;
      const minDim = Math.min(size.width, size.height);

      const desiredTotalDiameter =
        cfg.circleSize + (cfg.barGapFromCircle + cfg.barMaxHeight) * 2 + 24;
      const fitScale = Math.min(1, minDim / Math.max(1, desiredTotalDiameter));
      const scale = previewMode ? Math.min(0.68, fitScale) : fitScale;

      const analyser = analyserRef.current;
      const hasLiveFft = Boolean(analyser && isPlaying && !isRadio);
      if (hasLiveFft && analyser) {
        analyser.getByteFrequencyData(freqData);
      }

      const useSimulation =
        !hasLiveFft && ((isPlaying && isRadio) || (previewMode && simulatePreview));
      const activeMotion = hasLiveFft || useSimulation;

      let bassSum = 0;
      if (hasLiveFft) {
        for (let b = 0; b < 8; b++) bassSum += freqData[b];
        bassSum /= 8 * 255;
      } else if (useSimulation) {
        const beat = Math.pow(Math.max(0, Math.sin(now * 0.0062)), 3);
        bassSum = 0.25 + 0.55 * beat;
      }

      const pulseMult = cfg.bassPulse && activeMotion ? 1 + bassSum * 0.07 : 1;
      const circleRadius = cfg.circleSize * 0.5 * scale * pulseMult;
      const barBaseRadius = circleRadius + cfg.barGapFromCircle * scale;
      const maxBarLen = cfg.barMaxHeight * scale;
      const barWidth = Math.max(1.5, cfg.barThickness * scale);

      if (activeMotion) {
        rotationRef.current += cfg.rotationSpeed * dt * 0.45;
      }

      const count = Math.max(12, Math.min(180, cfg.barCount));
      const halfCount = cfg.mirrored ? Math.ceil(count / 2) : count;
      const smoothing = Math.max(0, Math.min(0.92, cfg.barSmoothing));
      const angleStep = (Math.PI * 2) / count;
      const startAngle = -Math.PI / 2 + rotationRef.current;
      const gapScaled = cfg.barGapFromCircle * scale;

      ctx.lineWidth = barWidth;
      ctx.lineCap = cfg.roundedCaps ? "round" : "butt";

      const isSingleStrokeMode =
        cfg.colorMode === "theme" ||
        cfg.colorMode === "solid" ||
        cfg.colorMode === "radial-fade";

      let anyBarStillSettling = false;

      if (isSingleStrokeMode) {
        if (cfg.colorMode === "solid") {
          ctx.strokeStyle = cfg.barColorLow;
        } else {
          const innerR = Math.max(1, cfg.bidirectionalBars ? barBaseRadius - gapScaled * 0.65 : barBaseRadius);
          const outerR = Math.max(innerR + 2, barBaseRadius + maxBarLen);
          const radialGrad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
          if (cfg.colorMode === "theme") {
            radialGrad.addColorStop(0, palette.vizStart);
            radialGrad.addColorStop(1, palette.vizEnd);
          } else {
            radialGrad.addColorStop(0, cfg.barColorLow);
            radialGrad.addColorStop(0.55, cfg.barColorMid);
            radialGrad.addColorStop(1, cfg.barColorHigh);
          }
          ctx.strokeStyle = radialGrad;
        }

        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const mirrorIdx = cfg.mirrored ? (i < halfCount ? i : count - 1 - i) : i;
          const normPos = halfCount > 1 ? mirrorIdx / (halfCount - 1) : 0;

          let rawLevel = 0.03;
          if (hasLiveFft) {
            const bin = Math.min(
              freqData.length - 1,
              Math.floor(2 + Math.pow(normPos, 1.35) * 120)
            );
            rawLevel = (freqData[bin] / 255) * cfg.barSensitivity;
          } else if (useSimulation) {
            const t = now * 0.004;
            const wave =
              0.35 +
              0.35 * Math.sin(t * 1.4 + normPos * 8.5) +
              0.25 * Math.cos(t * 2.3 - normPos * 14);
            const beatBoost =
              Math.pow(Math.max(0, Math.sin(t * 1.55)), 4) *
              (1 - normPos * 0.6) *
              0.55;
            rawLevel = Math.max(0.05, (wave + beatBoost) * 0.65 * cfg.barSensitivity);
          }

          const clampedTarget = Math.max(0.03, Math.min(1.0, rawLevel));
          const smoothed =
            smoothing === 0
              ? clampedTarget
              : smoothedRef.current[i] * smoothing + clampedTarget * (1 - smoothing);
          smoothedRef.current[i] = smoothed;
          if (!activeMotion && Math.abs(smoothed - 0.03) > 0.003) {
            anyBarStillSettling = true;
          }

          const angle = startAngle + i * angleStep;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const outerLen = Math.max(2, smoothed * maxBarLen);
          const innerOffset = cfg.bidirectionalBars
            ? Math.min(gapScaled * 0.65, outerLen * 0.28)
            : 0;

          const rStart = barBaseRadius - innerOffset;
          const rEnd = barBaseRadius + outerLen;
          ctx.moveTo(cx + cosA * rStart, cy + sinA * rStart);
          ctx.lineTo(cx + cosA * rEnd, cy + sinA * rEnd);
        }
        ctx.stroke();
      } else {
        const lowRgb = parseHexRgb(cfg.barColorLow);
        const midRgb = parseHexRgb(cfg.barColorMid);
        const highRgb = parseHexRgb(cfg.barColorHigh);
        const rotDeg = (rotationRef.current * 180) / Math.PI;

        for (let i = 0; i < count; i++) {
          const mirrorIdx = cfg.mirrored ? (i < halfCount ? i : count - 1 - i) : i;
          const normPos = halfCount > 1 ? mirrorIdx / (halfCount - 1) : 0;

          let rawLevel = 0.03;
          if (hasLiveFft) {
            const bin = Math.min(
              freqData.length - 1,
              Math.floor(2 + Math.pow(normPos, 1.35) * 120)
            );
            rawLevel = (freqData[bin] / 255) * cfg.barSensitivity;
          } else if (useSimulation) {
            const t = now * 0.004;
            const wave =
              0.35 +
              0.35 * Math.sin(t * 1.4 + normPos * 8.5) +
              0.25 * Math.cos(t * 2.3 - normPos * 14);
            const beatBoost =
              Math.pow(Math.max(0, Math.sin(t * 1.55)), 4) *
              (1 - normPos * 0.6) *
              0.55;
            rawLevel = Math.max(0.05, (wave + beatBoost) * 0.65 * cfg.barSensitivity);
          }

          const clampedTarget = Math.max(0.03, Math.min(1.0, rawLevel));
          const smoothed =
            smoothing === 0
              ? clampedTarget
              : smoothedRef.current[i] * smoothing + clampedTarget * (1 - smoothing);
          smoothedRef.current[i] = smoothed;
          if (!activeMotion && Math.abs(smoothed - 0.03) > 0.003) {
            anyBarStillSettling = true;
          }

          const angle = startAngle + i * angleStep;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const outerLen = Math.max(2, smoothed * maxBarLen);
          const innerOffset = cfg.bidirectionalBars
            ? Math.min(gapScaled * 0.65, outerLen * 0.28)
            : 0;

          const rStart = barBaseRadius - innerOffset;
          const rEnd = barBaseRadius + outerLen;

          ctx.strokeStyle =
            cfg.colorMode === "height-dynamic"
              ? sampleDynamicColor(lowRgb, midRgb, highRgb, smoothed)
              : `hsl(${((i / count) * 360 + rotDeg) % 360},92%,58%)`;

          ctx.beginPath();
          ctx.moveTo(cx + cosA * rStart, cy + sinA * rStart);
          ctx.lineTo(cx + cosA * rEnd, cy + sinA * rEnd);
          ctx.stroke();
        }
      }

      // Center Circle Background + Clipped Image
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = palette.bgElevated;
      ctx.fill();
      ctx.clip();

      const imgEntry = loadedImgRef.current;
      if (imgEntry && imgEntry.ready && imgEntry.img.naturalWidth > 0) {
        const iw = imgEntry.img.naturalWidth;
        const ih = imgEntry.img.naturalHeight;
        if (effectiveCenterKind === "tpx") {
          const targetBox = circleRadius * 1.62;
          const aspect = iw / ih;
          const dw = aspect >= 1 ? targetBox : targetBox * aspect;
          const dh = aspect >= 1 ? targetBox / aspect : targetBox;
          ctx.drawImage(imgEntry.img, cx - dw / 2, cy - dh / 2, dw, dh);
        } else {
          const diameter = circleRadius * 2;
          const imgScale = Math.max(diameter / iw, diameter / ih);
          const dw = iw * imgScale;
          const dh = ih * imgScale;
          ctx.drawImage(imgEntry.img, cx - dw / 2, cy - dh / 2, dw, dh);
        }
      } else {
        drawVectorMusicIcon(ctx, cx, cy, circleRadius, palette.accent);
      }
      ctx.restore();

      // Crisp matte ring around center circle (no shadowBlur)
      if (cfg.showCircleRing) {
        ctx.beginPath();
        ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1.5, 2.5 * scale);
        ctx.strokeStyle =
          cfg.colorMode === "theme" || cfg.colorMode === "rainbow"
            ? palette.accent
            : cfg.barColorLow;
        ctx.stroke();
      }

      if (activeMotion || anyBarStillSettling) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    size,
    analyserRef,
    isPlaying,
    isRadio,
    effectiveCenterKind,
    previewMode,
    simulatePreview,
    config,
    themeId,
    imageVersion,
  ]);

  return (
    <div ref={containerRef} className={`w-full h-full relative ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
});
