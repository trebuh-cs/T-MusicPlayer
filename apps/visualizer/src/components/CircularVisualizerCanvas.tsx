import { memo, useEffect, useRef, useState } from "react";
import tpxLogoUrl from "../assets/tpx-logo.svg";
import type { VisualizerConfig } from "../types";

interface CircularVisualizerCanvasProps {
  config: VisualizerConfig;
  liveFftRef: React.RefObject<Uint8Array>;
  hasAudioSignal: boolean;
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
  bgBase: string;
  bgElevated: string;
}

function readDocumentPalette(): CachedPalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: styles.getPropertyValue("--accent").trim() || "#0AF92A",
    vizStart: styles.getPropertyValue("--viz-start").trim() || "#0AF92A",
    vizEnd: styles.getPropertyValue("--viz-end").trim() || "#49ECC1",
    bgBase: styles.getPropertyValue("--bg-base").trim() || "#090A09",
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
  liveFftRef,
  hasAudioSignal,
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

  const hasSignalRef = useRef(hasAudioSignal);
  hasSignalRef.current = hasAudioSignal;
  const simulateRef = useRef(simulatePreview);
  simulateRef.current = simulatePreview;

  const paletteRef = useRef<CachedPalette>({
    accent: "#0AF92A",
    vizStart: "#0AF92A",
    vizEnd: "#49ECC1",
    bgBase: "#090A09",
    bgElevated: "#111311",
  });

  const [size, setSize] = useState({ width: 400, height: 400 });
  const centerImgRef = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);
  const bgImgRef = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);

  // Sync cached CSS theme colors only when theme/style changes.
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
  }, [config.themeId]);

  const effectiveCenterUrl =
    config.centerSource === "tpx"
      ? tpxLogoUrl
      : config.centerSource === "custom" && config.customImageDataUrl
      ? config.customImageDataUrl
      : null;

  useEffect(() => {
    if (!effectiveCenterUrl) {
      centerImgRef.current = null;
      return;
    }
    const img = new Image();
    const entry = { url: effectiveCenterUrl, img, ready: false };
    centerImgRef.current = entry;
    img.onload = () => {
      if (centerImgRef.current?.url === effectiveCenterUrl) {
        centerImgRef.current.ready = true;
      }
    };
    img.src = effectiveCenterUrl;
  }, [effectiveCenterUrl]);

  const effectiveBgUrl =
    config.backgroundMode === "image" && config.backgroundImageDataUrl
      ? config.backgroundImageDataUrl
      : null;

  useEffect(() => {
    if (!effectiveBgUrl) {
      bgImgRef.current = null;
      return;
    }
    const img = new Image();
    const entry = { url: effectiveBgUrl, img, ready: false };
    bgImgRef.current = entry;
    img.onload = () => {
      if (bgImgRef.current?.url === effectiveBgUrl) {
        bgImgRef.current.ready = true;
      }
    };
    img.src = effectiveBgUrl;
  }, [effectiveBgUrl]);

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

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const cfg = configRef.current;
      const palette = paletteRef.current;
      const freqData = liveFftRef.current;

      // Background fill or custom wallpaper photo
      if (cfg.backgroundMode === "solid") {
        ctx.fillStyle = cfg.backgroundColor || palette.bgBase;
        ctx.fillRect(0, 0, size.width, size.height);
      } else if (
        cfg.backgroundMode === "image" &&
        bgImgRef.current?.ready &&
        bgImgRef.current.img.naturalWidth > 0
      ) {
        const bgImg = bgImgRef.current.img;
        const iw = bgImg.naturalWidth;
        const ih = bgImg.naturalHeight;
        const coverScale = Math.max(size.width / iw, size.height / ih);
        const dw = iw * coverScale;
        const dh = ih * coverScale;
        ctx.drawImage(bgImg, (size.width - dw) / 2, (size.height - dh) / 2, dw, dh);
        if (cfg.backgroundDim > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(0.92, cfg.backgroundDim))})`;
          ctx.fillRect(0, 0, size.width, size.height);
        }
      } else {
        ctx.fillStyle = palette.bgBase;
        ctx.fillRect(0, 0, size.width, size.height);
      }

      const cx = size.width / 2;
      const cy = size.height / 2;
      const minDim = Math.min(size.width, size.height);

      const desiredTotalDiameter =
        cfg.circleSize + (cfg.barGapFromCircle + cfg.barMaxHeight) * 2 + 24;
      const fitScale = Math.min(1, minDim / Math.max(1, desiredTotalDiameter));
      const scale = previewMode ? Math.min(0.68, fitScale) : fitScale;

      // Check if live WASAPI FFT has signal right now
      let livePeak = 0;
      if (freqData) {
        for (let b = 0; b < 64; b++) {
          if (freqData[b] > livePeak) livePeak = freqData[b];
        }
      }
      const hasLiveFft = livePeak > 2 || hasSignalRef.current;
      const useSimulation = !hasLiveFft && previewMode && simulateRef.current;
      const activeMotion = hasLiveFft || useSimulation;

      let bassSum = 0;
      if (hasLiveFft && freqData) {
        for (let b = 0; b < 8; b++) bassSum += freqData[b];
        bassSum /= 8 * 255;
      } else if (useSimulation) {
        const beat = Math.pow(Math.max(0, Math.sin(now * 0.0062)), 3);
        bassSum = 0.25 + 0.55 * beat;
      }

      const pulseMult = cfg.bassPulse && activeMotion ? 1 + bassSum * 0.075 : 1;
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

      if (isSingleStrokeMode) {
        if (cfg.colorMode === "solid") {
          ctx.strokeStyle = cfg.barColorLow;
        } else {
          const innerR = Math.max(
            1,
            cfg.bidirectionalBars ? barBaseRadius - gapScaled * 0.65 : barBaseRadius
          );
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
          if (hasLiveFft && freqData) {
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
          if (hasLiveFft && freqData) {
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

      const imgEntry = centerImgRef.current;
      if (imgEntry && imgEntry.ready && imgEntry.img.naturalWidth > 0) {
        const iw = imgEntry.img.naturalWidth;
        const ih = imgEntry.img.naturalHeight;
        if (cfg.centerSource === "tpx") {
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

      // Crisp matte ring around center circle
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

      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [size, liveFftRef, previewMode]);

  return (
    <div ref={containerRef} className={`w-full h-full relative ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
});
