import type { VisualizerConfig } from "./types";

export interface PaletteColors {
  accent: string;
  vizStart: string;
  vizEnd: string;
  bgBase: string;
  bgElevated: string;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bin: number;
  phase: number;
}

export interface RenderFrameInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  now: number;
  dt: number;
  config: VisualizerConfig;
  palette: PaletteColors;
  freqData: Uint8Array | null;
  hasLiveFft: boolean;
  useSimulation: boolean;
  previewMode: boolean;
  centerImg: HTMLImageElement | null;
  centerIsTpx: boolean;
  bgImg: HTMLImageElement | null;
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

function rgbStr(c: RGB, alpha = 1): string {
  if (alpha >= 0.999) return `rgb(${c.r},${c.g},${c.b})`;
  return `rgba(${c.r},${c.g},${c.b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

function scaleRgb(c: RGB, mult: number): RGB {
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r * mult))),
    g: Math.max(0, Math.min(255, Math.round(c.g * mult))),
    b: Math.max(0, Math.min(255, Math.round(c.b * mult))),
  };
}

function sampleTriRgb(low: RGB, mid: RGB, high: RGB, t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5
    ? lerpRgb(low, mid, clamped * 2)
    : lerpRgb(mid, high, (clamped - 0.5) * 2);
}

function hslToRgb(hDeg: number, s: number, l: number): RGB {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(h + 1 / 3) * 255),
    g: Math.round(hue2rgb(h) * 255),
    b: Math.round(hue2rgb(h - 1 / 3) * 255),
  };
}

function sampleStyleColor(
  cfg: VisualizerConfig,
  palette: PaletteColors,
  level: number,
  posNorm: number,
  rotDeg: number,
  alpha = 1
): string {
  if (cfg.colorMode === "solid") {
    return rgbStr(parseHexRgb(cfg.barColorLow), alpha);
  }
  if (cfg.colorMode === "rainbow") {
    const hue = (posNorm * 360 + rotDeg) % 360;
    return alpha >= 0.999
      ? `hsl(${hue},92%,58%)`
      : `hsla(${hue},92%,58%,${alpha.toFixed(3)})`;
  }
  if (cfg.colorMode === "theme") {
    const s = parseHexRgb(palette.vizStart);
    const e = parseHexRgb(palette.vizEnd);
    return rgbStr(lerpRgb(s, e, level), alpha);
  }
  const low = parseHexRgb(cfg.barColorLow);
  const mid = parseHexRgb(cfg.barColorMid);
  const high = parseHexRgb(cfg.barColorHigh);
  return rgbStr(sampleTriRgb(low, mid, high, level), alpha);
}

/** Applies N passes of 3-tap [0.25, 0.5, 0.25] spatial smoothing in-place (zero allocations). */
function smoothArraySpatial(
  data: Float32Array,
  scratch: Float32Array,
  len: number,
  passes: number
): void {
  const pCount = Math.max(0, Math.min(12, Math.round(passes)));
  if (pCount === 0 || len < 3) return;
  for (let p = 0; p < pCount; p++) {
    scratch[0] = data[0] * 0.75 + data[1] * 0.25;
    for (let i = 1; i < len - 1; i++) {
      scratch[i] = data[i - 1] * 0.25 + data[i] * 0.5 + data[i + 1] * 0.25;
    }
    scratch[len - 1] = data[len - 1] * 0.75 + data[len - 2] * 0.25;
    for (let i = 0; i < len; i++) {
      data[i] = scratch[i];
    }
  }
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

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (rad <= 0.25) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * Stateful 60fps Canvas2D multi-style visualizer engine shared between
 * T - Visualizer (standalone) and T - MusicPlayer (desktop + wallpaper).
 * Strictly matte aesthetic: zero shadowBlur, zero glow, zero backdrop blur.
 * Heavily optimized with pre-allocated typed arrays and LUT color batching.
 */
export class VisualizerRenderer {
  private smoothedCircular = new Float32Array(200);
  private smoothedEdge = new Float32Array(160);
  private smoothedRadar = new Float32Array(128);
  private smoothedSynth = new Float32Array(256);
  private synthWork = new Float32Array(256);
  private synthScratch = new Float32Array(256);
  private synthPtsX = new Float32Array(260);
  private synthPtsY = new Float32Array(260);

  private rotation = 0;
  private synthPhase = 0;

  // Heightmap ring history & pre-allocated projection buffers (ZERO per-frame allocations!)
  private hmHistory: Float32Array[] = [];
  private hmPushAccum = 0;
  private hmScratch = new Float32Array(128);
  private hmProjX = new Float32Array(64 * 128);
  private hmProjY = new Float32Array(64 * 128);
  private hmGroundY = new Float32Array(64 * 128);

  // Reusable color buckets for batched heightmap drawing
  private bucketCoords: number[][] = Array.from({ length: 12 }, () => []);

  // Particle constellation pool
  private particles: Particle[] = [];

  public render(input: RenderFrameInput): boolean {
    const {
      ctx,
      width,
      height,
      now,
      dt,
      config: cfg,
      palette,
      freqData,
      hasLiveFft,
      useSimulation,
      previewMode,
      centerImg,
      centerIsTpx,
      bgImg,
    } = input;

    this.drawBackground(ctx, width, height, cfg, palette, bgImg);

    const activeMotion = hasLiveFft || useSimulation;
    const bass = this.computeBassEnergy(freqData, hasLiveFft, useSimulation, now);

    if (activeMotion || !cfg.stopSpinOnSilence) {
      this.rotation += cfg.rotationSpeed * dt * 0.45;
    }
    if (activeMotion) {
      this.synthPhase += dt * (0.65 + cfg.synthWaveSpeed * 1.15);
    }

    const minDim = Math.min(width, height);
    const proportionalScale = cfg.scaleWithScreen
      ? Math.max(0.32, minDim / 1080)
      : 1.0;

    let stillSettling = false;

    switch (cfg.style) {
      case "circular":
        stillSettling = this.drawCircular(
          ctx,
          width,
          height,
          now,
          cfg,
          palette,
          freqData,
          hasLiveFft,
          useSimulation,
          activeMotion,
          bass,
          proportionalScale,
          previewMode,
          centerImg,
          centerIsTpx
        );
        break;
      case "edge-bars":
        stillSettling = this.drawEdgeBars(
          ctx,
          width,
          height,
          now,
          cfg,
          palette,
          freqData,
          hasLiveFft,
          useSimulation,
          activeMotion,
          proportionalScale,
          previewMode
        );
        break;
      case "synthwave":
        stillSettling = this.drawSynthwave(
          ctx,
          width,
          height,
          now,
          cfg,
          palette,
          freqData,
          hasLiveFft,
          useSimulation,
          activeMotion,
          bass,
          proportionalScale
        );
        break;
      case "heightmap":
        stillSettling = this.drawHeightmap(
          ctx,
          width,
          height,
          now,
          dt,
          cfg,
          palette,
          freqData,
          hasLiveFft,
          useSimulation,
          activeMotion
        );
        break;
      case "spectrum-radar":
        stillSettling = this.drawSpectrumRadar(
          ctx,
          width,
          height,
          now,
          cfg,
          palette,
          freqData,
          hasLiveFft,
          useSimulation,
          activeMotion,
          bass,
          proportionalScale,
          previewMode,
          centerImg,
          centerIsTpx
        );
        break;
      case "particle-constellation":
        stillSettling = this.drawConstellation(
          ctx,
          width,
          height,
          now,
          dt,
          cfg,
          palette,
          freqData,
          hasLiveFft,
          useSimulation,
          activeMotion,
          bass,
          proportionalScale,
          previewMode,
          centerImg,
          centerIsTpx
        );
        break;
    }

    if (cfg.style !== "edge-bars" && cfg.edgeOverlayOnOthers) {
      const edgeSettling = this.drawEdgeBars(
        ctx,
        width,
        height,
        now,
        cfg,
        palette,
        freqData,
        hasLiveFft,
        useSimulation,
        activeMotion,
        proportionalScale,
        previewMode
      );
      stillSettling = stillSettling || edgeSettling;
    }

    return stillSettling;
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    bgImg: HTMLImageElement | null
  ): void {
    if (cfg.backgroundMode === "solid") {
      ctx.fillStyle = cfg.backgroundColor || palette.bgBase;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (cfg.backgroundMode === "image" && bgImg && bgImg.naturalWidth > 0) {
      const iw = bgImg.naturalWidth;
      const ih = bgImg.naturalHeight;
      const coverScale = Math.max(width / iw, height / ih);
      const dw = iw * coverScale;
      const dh = ih * coverScale;
      ctx.drawImage(bgImg, (width - dw) / 2, (height - dh) / 2, dw, dh);
      if (cfg.backgroundDim > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(0.92, cfg.backgroundDim))})`;
        ctx.fillRect(0, 0, width, height);
      }
      return;
    }
    ctx.fillStyle = palette.bgBase;
    ctx.fillRect(0, 0, width, height);
  }

  private computeBassEnergy(
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    now: number
  ): number {
    if (hasLiveFft && freqData) {
      let sum = 0;
      for (let b = 0; b < 8; b++) sum += freqData[b];
      return sum / (8 * 255);
    }
    if (useSimulation) {
      const beat = Math.pow(Math.max(0, Math.sin(now * 0.0062)), 3);
      return 0.25 + 0.55 * beat;
    }
    return 0;
  }

  private sampleSpectrumLevel(
    normPos: number,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    now: number,
    sensitivity: number
  ): number {
    if (hasLiveFft && freqData) {
      const bin = Math.min(
        freqData.length - 1,
        Math.floor(2 + Math.pow(Math.max(0, Math.min(1, normPos)), 1.35) * 120)
      );
      return (freqData[bin] / 255) * sensitivity;
    }
    if (useSimulation) {
      const t = now * 0.004;
      const wave =
        0.35 +
        0.35 * Math.sin(t * 1.4 + normPos * 8.5) +
        0.25 * Math.cos(t * 2.3 - normPos * 14);
      const beatBoost =
        Math.pow(Math.max(0, Math.sin(t * 1.55)), 4) *
        (1 - normPos * 0.6) *
        0.55;
      return Math.max(0.05, (wave + beatBoost) * 0.65 * sensitivity);
    }
    return 0.03;
  }

  private resolveCircleRingColor(
    cfg: VisualizerConfig,
    palette: PaletteColors
  ): string {
    if (cfg.circleRingColorMode === "custom") {
      return cfg.circleRingColor || palette.accent;
    }
    if (cfg.circleRingColorMode === "theme-accent") {
      return palette.accent;
    }
    return cfg.colorMode === "theme" || cfg.colorMode === "rainbow"
      ? palette.vizStart
      : cfg.barColorLow;
  }

  private drawCenterCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    circleRadius: number,
    ringScale: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    centerImg: HTMLImageElement | null,
    centerIsTpx: boolean
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
    ctx.fillStyle = palette.bgElevated;
    ctx.fill();
    ctx.clip();

    if (centerImg && centerImg.naturalWidth > 0) {
      const iw = centerImg.naturalWidth;
      const ih = centerImg.naturalHeight;
      if (centerIsTpx) {
        const targetBox = circleRadius * 1.62;
        const aspect = iw / ih;
        const dw = aspect >= 1 ? targetBox : targetBox * aspect;
        const dh = aspect >= 1 ? targetBox / aspect : targetBox;
        ctx.drawImage(centerImg, cx - dw / 2, cy - dh / 2, dw, dh);
      } else {
        const diameter = circleRadius * 2;
        const imgScale = Math.max(diameter / iw, diameter / ih);
        const dw = iw * imgScale;
        const dh = ih * imgScale;
        ctx.drawImage(centerImg, cx - dw / 2, cy - dh / 2, dw, dh);
      }
    } else {
      drawVectorMusicIcon(ctx, cx, cy, circleRadius, palette.accent);
    }
    ctx.restore();

    if (cfg.showCircleRing) {
      ctx.beginPath();
      ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, cfg.circleRingWidth * ringScale);
      ctx.strokeStyle = this.resolveCircleRingColor(cfg, palette);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // STYLE 1: CIRCULAR RING & CENTER
  // ---------------------------------------------------------------------------
  private drawCircular(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    activeMotion: boolean,
    bass: number,
    proportionalScale: number,
    previewMode: boolean,
    centerImg: HTMLImageElement | null,
    centerIsTpx: boolean
  ): boolean {
    const cx = width / 2;
    const cy = height / 2;
    const minDim = Math.min(width, height);

    const refDiameter =
      cfg.circleSize + (cfg.barGapFromCircle + cfg.barMaxHeight) * 2 + 32;
    const maxSafeScale = minDim / Math.max(1, refDiameter);
    const scale = cfg.scaleWithScreen
      ? Math.min(maxSafeScale, proportionalScale * (previewMode ? 0.88 : 1.0))
      : previewMode
      ? Math.min(0.68, maxSafeScale)
      : Math.min(1, maxSafeScale);

    const pulseMult = cfg.bassPulse && activeMotion ? 1 + bass * 0.075 : 1;
    const circleRadius = cfg.circleSize * 0.5 * scale * pulseMult;
    const barBaseRadius = circleRadius + cfg.barGapFromCircle * scale;
    const maxBarLen = cfg.barMaxHeight * scale;
    const barWidth = Math.max(1.5, cfg.barThickness * scale);
    const gapScaled = cfg.barGapFromCircle * scale;

    const count = Math.max(12, Math.min(180, cfg.barCount));
    const halfCount = cfg.mirrored ? Math.ceil(count / 2) : count;
    const smoothing = Math.max(0, Math.min(0.94, cfg.barSmoothing));
    const angleStep = (Math.PI * 2) / count;
    const startAngle = -Math.PI / 2 + this.rotation;

    ctx.lineWidth = barWidth;
    ctx.lineCap = cfg.roundedCaps ? "round" : "butt";

    const isSingleStroke =
      cfg.colorMode === "theme" ||
      cfg.colorMode === "solid" ||
      cfg.colorMode === "radial-fade";

    let anySettling = false;

    if (isSingleStroke) {
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
        const raw = this.sampleSpectrumLevel(
          normPos,
          freqData,
          hasLiveFft,
          useSimulation,
          now,
          cfg.barSensitivity
        );
        const clamped = Math.max(0.03, Math.min(1.0, raw));
        const smoothed =
          smoothing === 0
            ? clamped
            : this.smoothedCircular[i] * smoothing + clamped * (1 - smoothing);
        this.smoothedCircular[i] = smoothed;
        if (!activeMotion && Math.abs(smoothed - 0.03) > 0.003) anySettling = true;

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
      const rotDeg = (this.rotation * 180) / Math.PI;

      for (let i = 0; i < count; i++) {
        const mirrorIdx = cfg.mirrored ? (i < halfCount ? i : count - 1 - i) : i;
        const normPos = halfCount > 1 ? mirrorIdx / (halfCount - 1) : 0;
        const raw = this.sampleSpectrumLevel(
          normPos,
          freqData,
          hasLiveFft,
          useSimulation,
          now,
          cfg.barSensitivity
        );
        const clamped = Math.max(0.03, Math.min(1.0, raw));
        const smoothed =
          smoothing === 0
            ? clamped
            : this.smoothedCircular[i] * smoothing + clamped * (1 - smoothing);
        this.smoothedCircular[i] = smoothed;
        if (!activeMotion && Math.abs(smoothed - 0.03) > 0.003) anySettling = true;

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
            ? rgbStr(sampleTriRgb(lowRgb, midRgb, highRgb, smoothed))
            : `hsl(${((i / count) * 360 + rotDeg) % 360},92%,58%)`;

        ctx.beginPath();
        ctx.moveTo(cx + cosA * rStart, cy + sinA * rStart);
        ctx.lineTo(cx + cosA * rEnd, cy + sinA * rEnd);
        ctx.stroke();
      }
    }

    this.drawCenterCircle(
      ctx,
      cx,
      cy,
      circleRadius,
      scale,
      cfg,
      palette,
      centerImg,
      centerIsTpx
    );
    return anySettling;
  }

  // ---------------------------------------------------------------------------
  // STYLE 2: SCREEN EDGE BARS (Top / Bottom / Left / Right — Standalone or Overlay)
  // ---------------------------------------------------------------------------
  private drawEdgeBars(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    activeMotion: boolean,
    proportionalScale: number,
    previewMode: boolean
  ): boolean {
    const anyEdge = cfg.edgeTop || cfg.edgeBottom || cfg.edgeLeft || cfg.edgeRight;
    if (!anyEdge) return false;

    const count = Math.max(12, Math.min(140, cfg.edgeBarCount));
    const half = cfg.edgeMirrored ? Math.ceil(count / 2) : count;
    const smoothing = Math.max(0, Math.min(0.94, cfg.barSmoothing));
    const scale = cfg.scaleWithScreen
      ? proportionalScale * (previewMode ? 0.85 : 1)
      : previewMode
      ? 0.55
      : 1;
    const maxLen = Math.min(Math.min(width, height) * 0.42, cfg.edgeBarMaxHeight * scale);
    const pad = cfg.edgePadding * scale;
    const gap = cfg.edgeBarGap * scale;
    const radius = cfg.edgeCornerRadius * scale;
    const opacity = Math.max(0.15, Math.min(1, cfg.edgeOpacity));
    const rotDeg = (this.rotation * 180) / Math.PI;

    let anySettling = false;
    for (let i = 0; i < count; i++) {
      const idx = cfg.edgeMirrored ? (i < half ? i : count - 1 - i) : i;
      const norm = half > 1 ? idx / (half - 1) : 0;
      const raw = this.sampleSpectrumLevel(
        norm,
        freqData,
        hasLiveFft,
        useSimulation,
        now,
        cfg.barSensitivity
      );
      const clamped = Math.max(0.02, Math.min(1.0, raw));
      const sm =
        smoothing === 0
          ? clamped
          : this.smoothedEdge[i] * smoothing + clamped * (1 - smoothing);
      this.smoothedEdge[i] = sm;
      if (!activeMotion && Math.abs(sm - 0.02) > 0.003) anySettling = true;
    }

    const drawSide = (side: "bottom" | "top" | "left" | "right") => {
      const horizontal = side === "bottom" || side === "top";
      const span = (horizontal ? width : height) - pad * 2;
      const step = span / count;
      const thickness = Math.max(2, step - gap);

      let gradFill: CanvasGradient | null = null;
      if (cfg.colorMode === "theme" || cfg.colorMode === "radial-fade") {
        if (side === "bottom") {
          gradFill = ctx.createLinearGradient(0, height - pad, 0, height - pad - maxLen);
        } else if (side === "top") {
          gradFill = ctx.createLinearGradient(0, pad, 0, pad + maxLen);
        } else if (side === "left") {
          gradFill = ctx.createLinearGradient(pad, 0, pad + maxLen, 0);
        } else {
          gradFill = ctx.createLinearGradient(width - pad, 0, width - pad - maxLen, 0);
        }
        if (cfg.colorMode === "theme") {
          gradFill.addColorStop(0, palette.vizStart);
          gradFill.addColorStop(1, palette.vizEnd);
        } else {
          gradFill.addColorStop(0, cfg.barColorLow);
          gradFill.addColorStop(0.55, cfg.barColorMid);
          gradFill.addColorStop(1, cfg.barColorHigh);
        }
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      const singleFill =
        cfg.colorMode === "solid" ||
        cfg.colorMode === "theme" ||
        cfg.colorMode === "radial-fade";

      if (singleFill) {
        ctx.fillStyle = gradFill ?? cfg.barColorLow;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const len = Math.max(3, this.smoothedEdge[i] * maxLen);
          const pos = pad + i * step + gap * 0.5;
          if (side === "bottom") {
            drawRoundedRectPath(ctx, pos, height - pad - len, thickness, len, radius);
          } else if (side === "top") {
            drawRoundedRectPath(ctx, pos, pad, thickness, len, radius);
          } else if (side === "left") {
            drawRoundedRectPath(ctx, pad, pos, len, thickness, radius);
          } else {
            drawRoundedRectPath(ctx, width - pad - len, pos, len, thickness, radius);
          }
        }
        ctx.fill();
      } else {
        for (let i = 0; i < count; i++) {
          const lvl = this.smoothedEdge[i];
          const len = Math.max(3, lvl * maxLen);
          const pos = pad + i * step + gap * 0.5;
          ctx.fillStyle = sampleStyleColor(cfg, palette, lvl, i / count, rotDeg);
          ctx.beginPath();
          if (side === "bottom") {
            drawRoundedRectPath(ctx, pos, height - pad - len, thickness, len, radius);
          } else if (side === "top") {
            drawRoundedRectPath(ctx, pos, pad, thickness, len, radius);
          } else if (side === "left") {
            drawRoundedRectPath(ctx, pad, pos, len, thickness, radius);
          } else {
            drawRoundedRectPath(ctx, width - pad - len, pos, len, thickness, radius);
          }
          ctx.fill();
        }
      }
      ctx.restore();
    };

    if (cfg.edgeBottom) drawSide("bottom");
    if (cfg.edgeTop) drawSide("top");
    if (cfg.edgeLeft) drawSide("left");
    if (cfg.edgeRight) drawSide("right");

    return anySettling;
  }

  // ---------------------------------------------------------------------------
  // STYLE 3: ULTRA-CUSTOMIZABLE SYNTHWAVE (7 Draw Styles + Spatial/Temporal Smoothing!)
  //   ribbon | half-rings | bars | led-blocks | dots | mountain | needles
  // ---------------------------------------------------------------------------
  private drawSynthwave(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    activeMotion: boolean,
    bass: number,
    proportionalScale: number
  ): boolean {
    const baseY = height * (0.5 + cfg.synthVerticalOffset / 100);
    const rotDeg = (this.rotation * 180) / Math.PI;
    const ampPx = height * 0.3 * cfg.synthAmplitude;
    const padX = width * 0.04;
    const spanW = width - padX * 2;
    const temporalSmooth = Math.max(0.15, Math.min(0.95, cfg.barSmoothing));

    // Optional matte perspective floor grid
    if (cfg.synthHorizonGrid) {
      const horizonY = Math.max(height * 0.3, Math.min(height * 0.85, baseY + height * 0.14));
      const gridColor =
        cfg.colorMode === "theme" || cfg.colorMode === "rainbow"
          ? parseHexRgb(palette.vizStart)
          : parseHexRgb(cfg.barColorLow);
      ctx.save();
      ctx.strokeStyle = rgbStr(gridColor, 0.22);
      ctx.lineWidth = Math.max(1, 1.2 * proportionalScale);
      const rows = 10;
      const scroll = activeMotion ? (this.synthPhase * 0.35) % 1 : 0;
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const t = Math.pow((r + scroll) / rows, 1.85);
        const y = horizonY + t * (height - horizonY);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      const cols = 14;
      const vanishX = width / 2;
      for (let c = -cols; c <= cols; c++) {
        ctx.moveTo(vanishX + (c / cols) * width * 0.16, horizonY);
        ctx.lineTo(vanishX + (c / cols) * width * 1.9, height);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Build temporally + spatially smoothed base spectrum curve (ZERO micro-jitter!)
    const isDiscrete =
      cfg.synthDrawStyle === "bars" ||
      cfg.synthDrawStyle === "led-blocks" ||
      cfg.synthDrawStyle === "dots" ||
      cfg.synthDrawStyle === "needles";
    const sampleCount = isDiscrete
      ? Math.max(16, Math.min(140, cfg.synthBarCount))
      : cfg.synthDrawStyle === "mountain"
      ? Math.max(18, Math.min(96, Math.round(cfg.synthBarCount * 0.75)))
      : 128;

    const half = cfg.mirrored ? Math.ceil(sampleCount / 2) : sampleCount;
    for (let i = 0; i < sampleCount; i++) {
      const idx = cfg.mirrored ? (i < half ? i : sampleCount - 1 - i) : i;
      const norm = half > 1 ? idx / (half - 1) : 0;
      const raw = this.sampleSpectrumLevel(
        norm,
        freqData,
        hasLiveFft,
        useSimulation,
        now,
        cfg.barSensitivity
      );
      const clamped = Math.max(0.015, Math.min(1.0, raw));
      const prev = this.smoothedSynth[i];
      const sm = prev * temporalSmooth + clamped * (1 - temporalSmooth);
      this.smoothedSynth[i] = sm;
      this.synthWork[i] = sm;
    }

    // Apply user-controlled multi-pass spatial Gaussian curve smoothing
    smoothArraySpatial(
      this.synthWork,
      this.synthScratch,
      sampleCount,
      cfg.synthCurveSmoothing
    );

    // Helper: create crisp horizontal spectrum gradient matching reference sheet
    const makeHorizontalGrad = (alpha = 1, hueShift = 0): CanvasGradient | string => {
      if (cfg.colorMode === "solid") {
        return rgbStr(parseHexRgb(cfg.barColorLow), alpha);
      }
      const g = ctx.createLinearGradient(padX, 0, width - padX, 0);
      if (cfg.colorMode === "rainbow") {
        for (let s = 0; s <= 6; s++) {
          const frac = s / 6;
          const hue = (frac * 320 + rotDeg + hueShift) % 360;
          g.addColorStop(
            frac,
            alpha >= 0.999 ? `hsl(${hue},92%,58%)` : `hsla(${hue},92%,58%,${alpha.toFixed(3)})`
          );
        }
        return g;
      }
      if (cfg.colorMode === "theme") {
        g.addColorStop(0, rgbStr(parseHexRgb(palette.vizStart), alpha));
        g.addColorStop(0.5, rgbStr(parseHexRgb(palette.vizEnd), alpha));
        g.addColorStop(1, rgbStr(parseHexRgb(palette.vizStart), alpha));
        return g;
      }
      g.addColorStop(0, rgbStr(parseHexRgb(cfg.barColorLow), alpha));
      g.addColorStop(0.5, rgbStr(parseHexRgb(cfg.barColorMid), alpha));
      g.addColorStop(1, rgbStr(parseHexRgb(cfg.barColorHigh), alpha));
      return g;
    };

    const layerCount =
      cfg.synthMode === "single"
        ? 1
        : cfg.synthMode === "double"
        ? 2
        : Math.max(2, Math.min(6, cfg.synthLayerCount));
    const isMirroredMode = cfg.synthMode === "mirrored";

    // Draw horizontal center baseline if enabled
    if (cfg.synthShowBaseline) {
      ctx.save();
      ctx.strokeStyle = makeHorizontalGrad(0.55);
      ctx.lineWidth = Math.max(1, 1.5 * proportionalScale);
      ctx.beginPath();
      ctx.moveTo(padX, baseY);
      ctx.lineTo(width - padX, baseY);
      ctx.stroke();
      ctx.restore();
    }

    // ---- SUB-STYLE A: VERTICAL BARS / LED BLOCKS / DOTS / NEEDLES ----
    if (isDiscrete) {
      const step = spanW / sampleCount;
      const gap = cfg.synthBarGap * proportionalScale;
      const barW = Math.max(
        cfg.synthDrawStyle === "needles" ? 1.5 : 2.5,
        step - gap
      );
      const pix = Math.max(3, Math.round(cfg.synthPixelSize * proportionalScale));
      const drawLayers =
        cfg.synthMode === "double" || cfg.synthMode === "overlapping"
          ? Math.min(3, layerCount)
          : 1;

      for (let l = drawLayers - 1; l >= 0; l--) {
        const lFrac = drawLayers > 1 ? l / (drawLayers - 1) : 0;
        const layerScale = 1 - lFrac * 0.34;
        const alpha = drawLayers > 1 ? 0.55 + (1 - lFrac) * 0.45 : 0.96;
        const shiftIdx = l * 3;
        const grad = makeHorizontalGrad(alpha, l * 55);

        ctx.save();
        if (cfg.synthDrawStyle === "needles") {
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.max(1.2, cfg.synthLineWidth * 0.65 * proportionalScale);
          ctx.lineCap = "round";
          ctx.beginPath();
          for (let i = 0; i < sampleCount; i++) {
            const u = i / Math.max(1, sampleCount - 1);
            const env = 0.25 + 0.75 * Math.sin(u * Math.PI);
            const lvl = this.synthWork[(i + shiftIdx) % sampleCount] * env * layerScale;
            const h = Math.max(4, lvl * ampPx * 1.15);
            const x = padX + (i + 0.5) * step;
            if (isMirroredMode || cfg.synthMode === "double") {
              ctx.moveTo(x, baseY - h);
              ctx.lineTo(x, baseY + h);
            } else {
              ctx.moveTo(x, baseY);
              ctx.lineTo(x, baseY - h * 1.45);
            }
          }
          ctx.stroke();
        } else if (cfg.synthDrawStyle === "bars") {
          const rad = cfg.synthBarRadius * proportionalScale;
          ctx.fillStyle = grad;
          ctx.beginPath();
          for (let i = 0; i < sampleCount; i++) {
            const u = i / Math.max(1, sampleCount - 1);
            const env = 0.2 + 0.8 * Math.sin(u * Math.PI);
            const lvl = this.synthWork[(i + shiftIdx) % sampleCount] * env * layerScale;
            const h = Math.max(4, lvl * ampPx);
            const x = padX + i * step + gap * 0.5;
            if (isMirroredMode || cfg.synthMode === "double" || cfg.synthMode === "overlapping") {
              drawRoundedRectPath(ctx, x, baseY - h, barW, h * 2, rad);
            } else {
              drawRoundedRectPath(ctx, x, baseY - h * 1.4, barW, h * 1.4, rad);
            }
          }
          ctx.fill();
        } else if (cfg.synthDrawStyle === "led-blocks") {
          const blockH = Math.max(3, pix * 0.68);
          const blockPitch = blockH + Math.max(2, pix * 0.28);
          const rad = Math.min(cfg.synthBarRadius * 0.5, blockH * 0.35);
          ctx.fillStyle = grad;
          ctx.beginPath();
          for (let i = 0; i < sampleCount; i++) {
            const u = i / Math.max(1, sampleCount - 1);
            const env = 0.22 + 0.78 * Math.sin(u * Math.PI);
            const lvl = this.synthWork[(i + shiftIdx) % sampleCount] * env * layerScale;
            const h = Math.max(blockPitch, lvl * ampPx);
            const blocks = Math.max(1, Math.floor(h / blockPitch));
            const x = padX + i * step + gap * 0.5;
            for (let b = 0; b < blocks; b++) {
              const yUp = baseY - (b + 1) * blockPitch;
              drawRoundedRectPath(ctx, x, yUp, barW, blockH, rad);
              if (isMirroredMode || cfg.synthMode === "double") {
                const yDn = baseY + b * blockPitch + (blockPitch - blockH);
                drawRoundedRectPath(ctx, x, yDn, barW, blockH, rad);
              }
            }
          }
          ctx.fill();
        } else {
          // "dots" — Halftone dot-matrix waveform (bottom-middle-left of reference image!)
          const pitch = Math.max(5, pix * 0.92);
          const dotRad = Math.max(1.5, pitch * 0.34);
          ctx.fillStyle = grad;
          ctx.beginPath();
          for (let i = 0; i < sampleCount; i++) {
            const u = i / Math.max(1, sampleCount - 1);
            const env = 0.2 + 0.8 * Math.sin(u * Math.PI);
            const lvl = this.synthWork[(i + shiftIdx) % sampleCount] * env * layerScale;
            const h = Math.max(pitch, lvl * ampPx);
            const dots = Math.max(1, Math.floor(h / pitch));
            const cx = padX + (i + 0.5) * step;
            for (let d = 0; d < dots; d++) {
              const yUp = baseY - (d + 0.5) * pitch;
              ctx.moveTo(cx + dotRad, yUp);
              ctx.arc(cx, yUp, dotRad, 0, Math.PI * 2);
              if (isMirroredMode || cfg.synthMode === "double") {
                const yDn = baseY + (d + 0.5) * pitch;
                ctx.moveTo(cx + dotRad, yDn);
                ctx.arc(cx, yDn, dotRad, 0, Math.PI * 2);
              }
            }
          }
          ctx.fill();
        }
        ctx.restore();
      }
      return activeMotion;
    }

    // ---- SUB-STYLE B: HALF-RINGS / NESTED CONTOUR ARCS (Rows 2, 3, 4 on left of reference!) ----
    if (cfg.synthDrawStyle === "half-rings") {
      const contours = Math.max(2, Math.min(14, cfg.synthContourCount));
      const pts = sampleCount;
      // Modulate the smoothed spectrum with clean harmonic hill lobes (zero jitter!)
      const lobes = Math.max(1.5, cfg.synthFrequencyScale * 2.2);
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const env = Math.pow(Math.sin(u * Math.PI), 0.75);
        const hill = Math.abs(Math.sin(u * Math.PI * lobes + this.synthPhase * 0.45));
        const lvl = this.synthWork[i];
        this.synthScratch[i] =
          env * Math.pow(hill, 1.35) * (0.14 + lvl * 1.15 + bass * 0.22) * ampPx;
      }
      // Extra gentle polish pass so half-ring arcs are always super silky
      smoothArraySpatial(
        this.synthScratch,
        this.synthPtsY,
        pts,
        Math.max(2, Math.floor(cfg.synthCurveSmoothing * 0.6))
      );

      const drawContourArc = (scaleFrac: number, sign: 1 | -1, alpha: number) => {
        ctx.beginPath();
        for (let i = 0; i < pts; i++) {
          const x = padX + (i / (pts - 1)) * spanW;
          const y = baseY - sign * this.synthScratch[i] * scaleFrac;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            const px = padX + ((i - 1) / (pts - 1)) * spanW;
            const py = baseY - sign * this.synthScratch[i - 1] * scaleFrac;
            ctx.quadraticCurveTo(px, py, (px + x) * 0.5, (py + y) * 0.5);
          }
        }
        ctx.lineTo(width - padX, baseY);
        ctx.strokeStyle = makeHorizontalGrad(alpha);
        ctx.lineWidth = Math.max(1, cfg.synthLineWidth * 0.65 * proportionalScale);
        ctx.stroke();
      };

      // Optional subtle inner fill on outer envelope
      if (cfg.synthFilled && cfg.synthFillOpacity > 0.02) {
        const fillHalf = (sign: 1 | -1) => {
          ctx.beginPath();
          ctx.moveTo(padX, baseY);
          for (let i = 0; i < pts; i++) {
            ctx.lineTo(padX + (i / (pts - 1)) * spanW, baseY - sign * this.synthScratch[i]);
          }
          ctx.lineTo(width - padX, baseY);
          ctx.closePath();
          ctx.fillStyle = makeHorizontalGrad(cfg.synthFillOpacity * 0.45);
          ctx.fill();
        };
        fillHalf(1);
        if (isMirroredMode || cfg.synthMode === "double") fillHalf(-1);
      }

      for (let c = 1; c <= contours; c++) {
        const frac = c / contours;
        const alpha = 0.25 + frac * 0.72;
        drawContourArc(frac, 1, alpha);
        if (isMirroredMode || cfg.synthMode === "double") {
          drawContourArc(frac, -1, alpha * 0.88);
        }
      }
      return activeMotion;
    }

    // ---- SUB-STYLE C: ANGULAR LAYERED MOUNTAIN PEAKS (Top-right & Middle-right of reference!) ----
    if (cfg.synthDrawStyle === "mountain") {
      const pts = sampleCount;
      const layers = cfg.synthMode === "single" ? 1 : Math.min(4, Math.max(2, layerCount));
      const bottomBase =
        isMirroredMode ? baseY : Math.min(height * 0.84, baseY + ampPx * 0.55);

      const drawPeakLayer = (layerIdx: number, sign: 1 | -1) => {
        const lNorm = layers > 1 ? layerIdx / (layers - 1) : 0;
        const scale = (1 - lNorm * 0.32) * (isMirroredMode ? 0.95 : 1.25);
        const shift = layerIdx * 4;

        for (let i = 0; i < pts; i++) {
          const u = i / (pts - 1);
          const lvl = this.synthWork[(i + shift) % pts];
          this.synthPtsX[i] = padX + u * spanW;
          this.synthPtsY[i] = bottomBase - sign * (0.08 + lvl) * ampPx * scale;
        }

        const fillCol = sampleStyleColor(
          cfg,
          palette,
          0.2 + lNorm * 0.75,
          lNorm,
          rotDeg + layerIdx * 60,
          Math.max(0.25, cfg.synthFillOpacity + 0.15)
        );
        const strokeCol = sampleStyleColor(
          cfg,
          palette,
          0.35 + lNorm * 0.65,
          lNorm,
          rotDeg + layerIdx * 60,
          0.96
        );

        if (cfg.synthFilled) {
          ctx.beginPath();
          ctx.moveTo(this.synthPtsX[0], bottomBase);
          for (let i = 0; i < pts; i++) {
            ctx.lineTo(this.synthPtsX[i], this.synthPtsY[i]);
          }
          ctx.lineTo(this.synthPtsX[pts - 1], bottomBase);
          ctx.closePath();
          ctx.fillStyle = fillCol;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(this.synthPtsX[0], this.synthPtsY[0]);
        for (let i = 1; i < pts; i++) {
          ctx.lineTo(this.synthPtsX[i], this.synthPtsY[i]);
        }
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = Math.max(1.2, cfg.synthLineWidth * proportionalScale);
        ctx.lineJoin = "miter";
        ctx.stroke();
      };

      for (let l = 0; l < layers; l++) {
        drawPeakLayer(l, 1);
        if (isMirroredMode) {
          drawPeakLayer(l, -1);
        }
      }
      return activeMotion;
    }

    // ---- SUB-STYLE D: SMOOTH OVERLAPPING ORGANIC RIBBONS (Top-middle-left of reference!) ----
    const pts = sampleCount;
    const pixSize = Math.max(3, Math.round(cfg.synthPixelSize * proportionalScale));
    const drawRibbonLayer = (layerIdx: number, total: number, sign: 1 | -1) => {
      const lNorm = total > 1 ? layerIdx / (total - 1) : 0;
      const phaseOff = layerIdx * 1.35 + (sign < 0 ? Math.PI * 0.45 : 0);
      const lAmp = ampPx * (1 - lNorm * 0.25);
      const yShift =
        cfg.synthMode === "double"
          ? (layerIdx === 0 ? -1 : 1) * 10 * proportionalScale
          : cfg.synthMode === "overlapping"
          ? (lNorm - 0.5) * 24 * proportionalScale
          : 0;

      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const env = Math.sin(u * Math.PI);
        const lvl = this.synthWork[i];
        const freq = (1.6 + layerIdx * 0.55) * cfg.synthFrequencyScale;
        const carrier = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * freq + this.synthPhase + phaseOff);
        const disp = sign * carrier * env * (0.1 + lvl * 1.1 + bass * 0.22) * lAmp;
        let px = padX + u * spanW;
        let py = baseY + yShift - disp;
        if (cfg.synthPixelated) {
          px = Math.floor(px / pixSize) * pixSize;
          py = Math.floor(py / pixSize) * pixSize;
        }
        this.synthPtsX[i] = px;
        this.synthPtsY[i] = py;
      }

      const strokeCol = sampleStyleColor(
        cfg,
        palette,
        0.25 + lNorm * 0.7,
        lNorm,
        rotDeg + layerIdx * 52,
        0.95 - lNorm * 0.15
      );
      const fillCol = sampleStyleColor(
        cfg,
        palette,
        0.25 + lNorm * 0.7,
        lNorm,
        rotDeg + layerIdx * 52,
        cfg.synthFillOpacity * (1 - lNorm * 0.2)
      );

      if (cfg.synthPixelated) {
        if (cfg.synthFilled) {
          ctx.fillStyle = fillCol;
          for (let i = 0; i < pts - 1; i++) {
            const yTop = Math.min(this.synthPtsY[i], baseY + yShift);
            const h = Math.abs(this.synthPtsY[i] - (baseY + yShift));
            if (h >= 1) ctx.fillRect(this.synthPtsX[i], yTop, pixSize, h);
          }
        }
        ctx.fillStyle = strokeCol;
        const bh = Math.max(pixSize * 0.65, cfg.synthLineWidth * proportionalScale);
        for (let i = 0; i < pts - 1; i++) {
          ctx.fillRect(this.synthPtsX[i], this.synthPtsY[i] - bh * 0.5, pixSize, bh);
        }
        return;
      }

      if (cfg.synthFilled) {
        ctx.beginPath();
        ctx.moveTo(this.synthPtsX[0], baseY + yShift);
        for (let i = 0; i < pts; i++) {
          ctx.lineTo(this.synthPtsX[i], this.synthPtsY[i]);
        }
        ctx.lineTo(this.synthPtsX[pts - 1], baseY + yShift);
        ctx.closePath();
        ctx.fillStyle = fillCol;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.moveTo(this.synthPtsX[0], this.synthPtsY[0]);
      for (let i = 1; i < pts; i++) {
        const px = this.synthPtsX[i - 1];
        const py = this.synthPtsY[i - 1];
        ctx.quadraticCurveTo(px, py, (px + this.synthPtsX[i]) * 0.5, (py + this.synthPtsY[i]) * 0.5);
      }
      ctx.lineTo(this.synthPtsX[pts - 1], this.synthPtsY[pts - 1]);
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = Math.max(1, cfg.synthLineWidth * proportionalScale);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    };

    for (let l = layerCount - 1; l >= 0; l--) {
      drawRibbonLayer(l, layerCount, 1);
      if (isMirroredMode) {
        drawRibbonLayer(l, layerCount, -1);
      }
    }

    return activeMotion;
  }

  // ---------------------------------------------------------------------------
  // STYLE 4: OPTIMIZED 2.5D AUDIO HEIGHTMAP & 3D ISOMETRIC PILLARS (60fps Batched!)
  // ---------------------------------------------------------------------------
  private drawHeightmap(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    dt: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    activeMotion: boolean
  ): boolean {
    const rows = Math.max(8, Math.min(52, cfg.hmRows));
    const cols = Math.max(12, Math.min(84, cfg.hmCols));

    while (this.hmHistory.length < rows) {
      this.hmHistory.push(new Float32Array(cols));
    }
    if (this.hmHistory.length > rows) {
      this.hmHistory.length = rows;
    }
    for (let r = 0; r < rows; r++) {
      if (this.hmHistory[r].length !== cols) {
        this.hmHistory[r] = new Float32Array(cols);
      }
    }

    const pushInterval = 0.044 / Math.max(0.25, cfg.hmScrollSpeed);
    this.hmPushAccum += dt;
    if (this.hmPushAccum >= pushInterval) {
      this.hmPushAccum = Math.min(pushInterval, this.hmPushAccum - pushInterval);
      const recycled = this.hmHistory.pop()!;
      const half = cfg.hmMirrored ? Math.ceil(cols / 2) : cols;
      const sm = Math.max(0, Math.min(0.85, cfg.barSmoothing * 0.7));
      for (let c = 0; c < cols; c++) {
        const idx = cfg.hmMirrored ? (c < half ? half - 1 - c : c - half) : c;
        const norm = half > 1 ? idx / (half - 1) : 0;
        const raw = this.sampleSpectrumLevel(
          norm,
          freqData,
          hasLiveFft,
          useSimulation,
          now,
          cfg.barSensitivity
        );
        const edgeFade = Math.sin((c / Math.max(1, cols - 1)) * Math.PI);
        const target = Math.max(0, Math.min(1.15, raw * (0.28 + 0.72 * edgeFade)));
        const prevFront = this.hmHistory[0]?.[c] ?? 0;
        recycled[c] = prevFront * sm + target * (1 - sm);
      }
      if (cfg.hmCurveSmoothing > 0) {
        smoothArraySpatial(recycled, this.hmScratch, cols, cfg.hmCurveSmoothing);
      }
      this.hmHistory.unshift(recycled);
    }

    // Ensure flat projection buffers are large enough (never allocates once sized!)
    const totalPts = rows * cols;
    if (this.hmProjX.length < totalPts) {
      this.hmProjX = new Float32Array(totalPts);
      this.hmProjY = new Float32Array(totalPts);
      this.hmGroundY = new Float32Array(totalPts);
    }

    const tiltRad = (Math.max(15, Math.min(78, cfg.hmTilt)) * Math.PI) / 180;
    const sinTilt = Math.sin(tiltRad);
    const persp = Math.max(0.1, Math.min(1.25, cfg.hmPerspective));
    const elevScale = height * 0.25 * cfg.hmElevation * sinTilt;
    const yOff = (cfg.hmVerticalOffset / 100) * height;
    const topY = height * (0.24 - (Math.cos(tiltRad) - 0.5) * 0.14) + yOff;
    const bottomY = height * 0.88 + yOff;
    const ySpan = bottomY - topY;
    const baseSpanW = width * 0.92;
    const halfW = width * 0.5;
    const invRows = 1 / Math.max(1, rows - 1);
    const invCols = 1 / Math.max(1, cols - 1);
    const rotDeg = (this.rotation * 180) / Math.PI;

    // Pre-project all grid vertices into flat typed arrays (zero object allocation)
    for (let r = 0; r < rows; r++) {
      const depth = 1 - r * invRows;
      const depthCurve = Math.pow(depth, 1 + persp * 0.65);
      const rowScale = 1 - (1 - depthCurve) * (0.25 + persp * 0.42);
      const spanW = baseSpanW * rowScale;
      const groundY = topY + depthCurve * ySpan;
      const rowElev = elevScale * rowScale;
      const rowData = this.hmHistory[r];
      const baseIdx = r * cols;

      for (let c = 0; c < cols; c++) {
        const u = c * invCols - 0.5;
        this.hmProjX[baseIdx + c] = halfW + u * spanW;
        this.hmGroundY[baseIdx + c] = groundY;
        this.hmProjY[baseIdx + c] = groundY - rowData[c] * rowElev;
      }
    }

    // Pre-compute 12-bucket RGB color LUT ONCE per frame (eliminates 1,600+ parseInt calls/frame!)
    const BUCKETS = 12;
    const vizStartRgb = parseHexRgb(palette.vizStart);
    const vizEndRgb = parseHexRgb(palette.vizEnd);
    const lowRgb = parseHexRgb(cfg.barColorLow);
    const midRgb = parseHexRgb(cfg.barColorMid);
    const highRgb = parseHexRgb(cfg.barColorHigh);

    const lutRgb: RGB[] = new Array(BUCKETS);
    for (let b = 0; b < BUCKETS; b++) {
      const t = b / (BUCKETS - 1);
      if (cfg.colorMode === "solid") {
        lutRgb[b] = lowRgb;
      } else if (cfg.colorMode === "theme") {
        lutRgb[b] = lerpRgb(vizStartRgb, vizEndRgb, t);
      } else if (cfg.colorMode === "rainbow") {
        lutRgb[b] = hslToRgb(t * 300 + rotDeg, 0.9, 0.56);
      } else {
        lutRgb[b] = sampleTriRgb(lowRgb, midRgb, highRgb, t);
      }
    }

    // Optional crisp perspective wireframe base floor plane (especially slick under bars-3d & dots!)
    if (
      cfg.hmShowBaseGrid &&
      (cfg.hmRenderMode === "bars-3d" || cfg.hmRenderMode === "dots")
    ) {
      ctx.save();
      ctx.strokeStyle = rgbStr(lutRgb[2], 0.24);
      ctx.lineWidth = Math.max(1, cfg.hmLineWidth * 0.65);
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const bi = r * cols;
        ctx.moveTo(this.hmProjX[bi], this.hmGroundY[bi]);
        ctx.lineTo(this.hmProjX[bi + cols - 1], this.hmGroundY[bi + cols - 1]);
      }
      for (let c = 0; c < cols; c++) {
        ctx.moveTo(this.hmProjX[(rows - 1) * cols + c], this.hmGroundY[(rows - 1) * cols + c]);
        ctx.lineTo(this.hmProjX[c], this.hmGroundY[c]);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- MODE A: 2.5D / 3D ISOMETRIC AUDIO PILLARS ON WIREFRAME FLOOR (NEW!) ----
    if (cfg.hmRenderMode === "bars-3d") {
      const widthRatio = Math.max(0.25, Math.min(0.95, cfg.hmBarWidthRatio));
      // Pre-build shaded front/top/side styles per bucket (zero string alloc in inner loop!)
      const frontStyles: string[] = new Array(BUCKETS);
      const topStyles: string[] = new Array(BUCKETS);
      const sideStyles: string[] = new Array(BUCKETS);
      for (let b = 0; b < BUCKETS; b++) {
        frontStyles[b] = rgbStr(lutRgb[b], 0.92);
        topStyles[b] = rgbStr(scaleRgb(lutRgb[b], 1.24), 0.98);
        sideStyles[b] = rgbStr(scaleRgb(lutRgb[b], 0.64), 0.92);
      }

      // Painter's algorithm back-to-front per row; batch bars by color bucket per row
      for (let r = rows - 1; r >= 0; r--) {
        const depth = 1 - r * invRows;
        const depthCurve = Math.pow(depth, 1 + persp * 0.65);
        const rowScale = 1 - (1 - depthCurve) * (0.25 + persp * 0.42);
        const cellW = (baseSpanW * rowScale) * invCols;
        const barW = Math.max(2, cellW * widthRatio);
        const halfBarW = barW * 0.5;
        const topDepthY = Math.max(2, barW * 0.34 * Math.cos(tiltRad * 0.5));
        const sideShiftX = Math.max(1.5, barW * 0.22);
        const bi = r * cols;
        const rowData = this.hmHistory[r];

        for (let b = 0; b < BUCKETS; b++) this.bucketCoords[b].length = 0;

        for (let c = 0; c < cols; c++) {
          const val = rowData[c];
          const px = this.hmProjX[bi + c];
          const gy = this.hmGroundY[bi + c];
          const ty = Math.min(gy - 2, this.hmProjY[bi + c]);
          const bucket = Math.min(
            BUCKETS - 1,
            Math.max(
              0,
              Math.floor(
                (cfg.colorMode === "rainbow" ? c * invCols : Math.min(1, val * 1.05)) *
                  (BUCKETS - 1)
              )
            )
          );
          const arr = this.bucketCoords[bucket];
          arr.push(px, gy, ty);
        }

        // Draw batched front, side & top faces per active color bucket (<= 12 draw calls/row!)
        for (let b = 0; b < BUCKETS; b++) {
          const arr = this.bucketCoords[b];
          if (arr.length === 0) continue;

          // Front face
          ctx.fillStyle = frontStyles[b];
          ctx.beginPath();
          for (let k = 0; k < arr.length; k += 3) {
            const px = arr[k];
            const gy = arr[k + 1];
            const ty = arr[k + 2];
            ctx.rect(px - halfBarW, ty, barW, gy - ty);
          }
          ctx.fill();

          // Right 3D bevel face
          ctx.fillStyle = sideStyles[b];
          ctx.beginPath();
          for (let k = 0; k < arr.length; k += 3) {
            const px = arr[k];
            const gy = arr[k + 1];
            const ty = arr[k + 2];
            const rx = px + halfBarW;
            ctx.moveTo(rx, ty);
            ctx.lineTo(rx + sideShiftX, ty - topDepthY);
            ctx.lineTo(rx + sideShiftX, gy - topDepthY);
            ctx.lineTo(rx, gy);
            ctx.closePath();
          }
          ctx.fill();

          // Top 3D cap face
          ctx.fillStyle = topStyles[b];
          ctx.beginPath();
          for (let k = 0; k < arr.length; k += 3) {
            const px = arr[k];
            const ty = arr[k + 2];
            const lx = px - halfBarW;
            const rx = px + halfBarW;
            ctx.moveTo(lx, ty);
            ctx.lineTo(lx + sideShiftX, ty - topDepthY);
            ctx.lineTo(rx + sideShiftX, ty - topDepthY);
            ctx.lineTo(rx, ty);
            ctx.closePath();
          }
          ctx.fill();
        }
      }
      return activeMotion;
    }

    // ---- MODE B: BATCHED 3D POINT MATRIX (20x faster than per-dot fill!) ----
    if (cfg.hmRenderMode === "dots") {
      const dotBase = Math.max(1.5, cfg.hmLineWidth * 1.35);
      for (let b = 0; b < BUCKETS; b++) this.bucketCoords[b].length = 0;

      for (let r = rows - 1; r >= 0; r--) {
        const depth = 1 - r * invRows;
        const bi = r * cols;
        const rowData = this.hmHistory[r];
        for (let c = 0; c < cols; c++) {
          const v = rowData[c];
          const rad = dotBase * (0.45 + depth * 0.75) * (0.7 + v * 0.75);
          const bucket = Math.min(
            BUCKETS - 1,
            Math.max(
              0,
              Math.floor(
                (cfg.colorMode === "rainbow" ? c * invCols : Math.min(1, v * 1.1)) *
                  (BUCKETS - 1)
              )
            )
          );
          this.bucketCoords[bucket].push(this.hmProjX[bi + c], this.hmProjY[bi + c], rad);
        }
      }

      for (let b = 0; b < BUCKETS; b++) {
        const arr = this.bucketCoords[b];
        if (arr.length === 0) continue;
        ctx.fillStyle = rgbStr(lutRgb[b], 0.92);
        ctx.beginPath();
        for (let k = 0; k < arr.length; k += 3) {
          const x = arr[k];
          const y = arr[k + 1];
          const rad = arr[k + 2];
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      return activeMotion;
    }

    // ---- MODE C: BATCHED FILLED TERRAIN MESH (30x faster: <= 12 fills/row instead of 1,600!) ----
    if (cfg.hmRenderMode === "filled-mesh") {
      ctx.lineJoin = "round";
      for (let r = rows - 2; r >= 0; r--) {
        const depth = 1 - r * invRows;
        const bi = r * cols;
        const biBack = (r + 1) * cols;
        const rowCur = this.hmHistory[r];
        const rowBack = this.hmHistory[r + 1];

        for (let b = 0; b < BUCKETS; b++) this.bucketCoords[b].length = 0;

        for (let c = 0; c < cols - 1; c++) {
          const avgH = (rowCur[c] + rowCur[c + 1] + rowBack[c] + rowBack[c + 1]) * 0.25;
          const bucket = Math.min(
            BUCKETS - 1,
            Math.max(
              0,
              Math.floor(
                (cfg.colorMode === "rainbow" ? c * invCols : Math.min(1, avgH * 1.15)) *
                  (BUCKETS - 1)
              )
            )
          );
          this.bucketCoords[bucket].push(c);
        }

        const alpha = 0.28 + depth * 0.68;
        for (let b = 0; b < BUCKETS; b++) {
          const arr = this.bucketCoords[b];
          if (arr.length === 0) continue;
          ctx.fillStyle = rgbStr(lutRgb[b], alpha);
          ctx.beginPath();
          for (let k = 0; k < arr.length; k++) {
            const c = arr[k];
            ctx.moveTo(this.hmProjX[biBack + c], this.hmProjY[biBack + c]);
            ctx.lineTo(this.hmProjX[biBack + c + 1], this.hmProjY[biBack + c + 1]);
            ctx.lineTo(this.hmProjX[bi + c + 1], this.hmProjY[bi + c + 1]);
            ctx.lineTo(this.hmProjX[bi + c], this.hmProjY[bi + c]);
            ctx.closePath();
          }
          ctx.fill();
        }

        // Crisp crest stroke
        ctx.beginPath();
        ctx.moveTo(this.hmProjX[bi], this.hmProjY[bi]);
        for (let c = 1; c < cols; c++) {
          ctx.lineTo(this.hmProjX[bi + c], this.hmProjY[bi + c]);
        }
        ctx.strokeStyle = rgbStr(lutRgb[Math.min(BUCKETS - 1, Math.floor(depth * (BUCKETS - 1)))], 0.55 + depth * 0.4);
        ctx.lineWidth = Math.max(1, cfg.hmLineWidth * 0.75);
        ctx.stroke();
      }
      return activeMotion;
    }

    // ---- MODE D: RIDGES & WIREFRAME (Optimized, bounded occlusion fill!) ----
    const bgFill = cfg.backgroundMode === "solid" ? cfg.backgroundColor : palette.bgBase;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (let r = rows - 1; r >= 0; r--) {
      const depth = 1 - r * invRows;
      const bi = r * cols;
      const rowData = this.hmHistory[r];
      let rowPeak = 0;
      for (let c = 0; c < cols; c++) {
        if (rowData[c] > rowPeak) rowPeak = rowData[c];
      }
      const bucket = Math.min(
        BUCKETS - 1,
        Math.max(0, Math.floor(Math.min(1, 0.15 + rowPeak * 0.95) * (BUCKETS - 1)))
      );

      // Occlusion fill bounded to the row's own ground + small margin (massive fill-rate win!)
      const occBottom = Math.min(height, this.hmGroundY[bi] + (r === 0 ? 48 : 26));
      ctx.beginPath();
      ctx.moveTo(this.hmProjX[bi], occBottom);
      for (let c = 0; c < cols; c++) {
        ctx.lineTo(this.hmProjX[bi + c], this.hmProjY[bi + c]);
      }
      ctx.lineTo(this.hmProjX[bi + cols - 1], occBottom);
      ctx.closePath();
      ctx.fillStyle = bgFill;
      ctx.fill();

      if (cfg.hmRenderMode === "wireframe" && r < rows - 1) {
        const biBack = (r + 1) * cols;
        ctx.strokeStyle = rgbStr(lutRgb[bucket], 0.16 + depth * 0.42);
        ctx.lineWidth = Math.max(0.8, cfg.hmLineWidth * 0.65);
        ctx.beginPath();
        for (let c = 0; c < cols; c += 2) {
          ctx.moveTo(this.hmProjX[biBack + c], this.hmProjY[biBack + c]);
          ctx.lineTo(this.hmProjX[bi + c], this.hmProjY[bi + c]);
        }
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(this.hmProjX[bi], this.hmProjY[bi]);
      for (let c = 1; c < cols; c++) {
        ctx.lineTo(this.hmProjX[bi + c], this.hmProjY[bi + c]);
      }
      ctx.strokeStyle = rgbStr(lutRgb[bucket], 0.25 + depth * 0.75);
      ctx.lineWidth = Math.max(1, cfg.hmLineWidth * (0.65 + depth * 0.55));
      ctx.stroke();
    }

    return activeMotion;
  }

  // ---------------------------------------------------------------------------
  // STYLE 5: CONCENTRIC SHOCKWAVE / ORGANIC CONTOUR RINGS (Bottom-right of reference!)
  // ---------------------------------------------------------------------------
  private drawSpectrumRadar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    activeMotion: boolean,
    bass: number,
    proportionalScale: number,
    previewMode: boolean,
    centerImg: HTMLImageElement | null,
    centerIsTpx: boolean
  ): boolean {
    const cx = width / 2;
    const cy = height / 2;
    const minDim = Math.min(width, height);
    const rings = Math.max(2, Math.min(12, cfg.radarRingCount));
    const sides = cfg.radarPolygonSides;
    const smoothBlob = sides < 3;
    const pts = smoothBlob ? 48 : sides;
    const smoothing = Math.max(0, Math.min(0.94, cfg.barSmoothing));
    const maxR = minDim * 0.43 * cfg.radarSpread * (previewMode ? 0.9 : 1);
    const baseInner = cfg.showCenterInOtherStyles
      ? cfg.circleSize * 0.5 * (cfg.scaleWithScreen ? proportionalScale : 1) + 22
      : minDim * 0.06;
    const rotDeg = (this.rotation * 180) / Math.PI;

    let anySettling = false;
    for (let i = 0; i < pts; i++) {
      const mirror = cfg.mirrored ? (i < pts / 2 ? i : pts - 1 - i) : i;
      const norm = pts > 1 ? mirror / Math.max(1, cfg.mirrored ? pts / 2 : pts - 1) : 0;
      const raw = this.sampleSpectrumLevel(
        norm,
        freqData,
        hasLiveFft,
        useSimulation,
        now,
        cfg.barSensitivity
      );
      const clamped = Math.max(0.03, Math.min(1, raw));
      const sm =
        smoothing === 0
          ? clamped
          : this.smoothedRadar[i] * smoothing + clamped * (1 - smoothing);
      this.smoothedRadar[i] = sm;
      if (!activeMotion && Math.abs(sm - 0.03) > 0.003) anySettling = true;
    }

    // Smooth circular array for organic contour blobs
    if (smoothBlob) {
      smoothArraySpatial(this.smoothedRadar, this.synthScratch, pts, 3);
    }

    for (let r = rings - 1; r >= 0; r--) {
      const frac = (r + 1) / rings;
      const ringRadius =
        baseInner + (maxR - baseInner) * frac * (1 + (cfg.bassPulse ? bass * 0.08 : 0));
      const ringRot = this.rotation * (r % 2 === 0 ? 1 : -0.6) + r * 0.14;

      for (let i = 0; i < pts; i++) {
        const angle = ringRot + (i / pts) * Math.PI * 2 - Math.PI / 2;
        const lobe = smoothBlob ? 0.5 + 0.5 * Math.sin(angle * 5 + r * 0.35 + this.synthPhase * 0.4) : 1;
        const mod = this.smoothedRadar[(i + r * 2) % pts] * lobe;
        const amp = (maxR - baseInner) * 0.24 * (0.35 + frac * 0.65);
        const rad = ringRadius + mod * amp;
        this.synthPtsX[i] = cx + Math.cos(angle) * rad;
        this.synthPtsY[i] = cy + Math.sin(angle) * rad;
      }

      ctx.beginPath();
      if (smoothBlob) {
        const firstMidX = (this.synthPtsX[pts - 1] + this.synthPtsX[0]) * 0.5;
        const firstMidY = (this.synthPtsY[pts - 1] + this.synthPtsY[0]) * 0.5;
        ctx.moveTo(firstMidX, firstMidY);
        for (let i = 0; i < pts; i++) {
          const next = (i + 1) % pts;
          const mx = (this.synthPtsX[i] + this.synthPtsX[next]) * 0.5;
          const my = (this.synthPtsY[i] + this.synthPtsY[next]) * 0.5;
          ctx.quadraticCurveTo(this.synthPtsX[i], this.synthPtsY[i], mx, my);
        }
      } else {
        ctx.moveTo(this.synthPtsX[0], this.synthPtsY[0]);
        for (let i = 1; i < pts; i++) {
          ctx.lineTo(this.synthPtsX[i], this.synthPtsY[i]);
        }
      }
      ctx.closePath();

      if (cfg.radarFillOpacity > 0) {
        ctx.fillStyle = sampleStyleColor(
          cfg,
          palette,
          frac,
          frac,
          rotDeg + r * 35,
          cfg.radarFillOpacity * (1 - frac * 0.35)
        );
        ctx.fill();
      }

      ctx.strokeStyle = sampleStyleColor(cfg, palette, frac, frac, rotDeg + r * 35, 0.92);
      ctx.lineWidth = Math.max(1, cfg.radarLineWidth * proportionalScale);
      ctx.stroke();
    }

    if (cfg.showCenterInOtherStyles) {
      const scale = cfg.scaleWithScreen ? proportionalScale : previewMode ? 0.68 : 1;
      const rad =
        cfg.circleSize *
        0.5 *
        scale *
        (cfg.bassPulse && activeMotion ? 1 + bass * 0.07 : 1);
      this.drawCenterCircle(ctx, cx, cy, rad, scale, cfg, palette, centerImg, centerIsTpx);
    }

    return anySettling;
  }

  // ---------------------------------------------------------------------------
  // STYLE 6: GEOMETRIC PARTICLE CONSTELLATION
  // ---------------------------------------------------------------------------
  private drawConstellation(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    dt: number,
    cfg: VisualizerConfig,
    palette: PaletteColors,
    freqData: Uint8Array | null,
    hasLiveFft: boolean,
    useSimulation: boolean,
    activeMotion: boolean,
    bass: number,
    proportionalScale: number,
    previewMode: boolean,
    centerImg: HTMLImageElement | null,
    centerIsTpx: boolean
  ): boolean {
    const targetCount = Math.max(24, Math.min(180, cfg.partCount));
    while (this.particles.length < targetCount) {
      const idx = this.particles.length;
      const seed1 = Math.sin((idx + 1) * 12.9898) * 43758.5453;
      const seed2 = Math.sin((idx + 1) * 78.233) * 24634.6345;
      const seed3 = Math.sin((idx + 1) * 39.425) * 19283.1234;
      const rx = seed1 - Math.floor(seed1);
      const ry = seed2 - Math.floor(seed2);
      const ang = (seed3 - Math.floor(seed3)) * Math.PI * 2;
      this.particles.push({
        x: rx,
        y: ry,
        vx: Math.cos(ang) * 0.045,
        vy: Math.sin(ang) * 0.045,
        bin: idx % 64,
        phase: rx * Math.PI * 2,
      });
    }
    if (this.particles.length > targetCount) {
      this.particles.length = targetCount;
    }

    const speedMult =
      cfg.partSpeed * (activeMotion ? 1 + bass * cfg.partBassKick * 2.2 : 0.15);
    const linkDist = cfg.partLinkDistance * proportionalScale;
    const linkDistSq = linkDist * linkDist;
    const rotDeg = (this.rotation * 180) / Math.PI;
    const pxArr = this.synthPtsX;
    const pyArr = this.synthPtsY;
    const lvlArr = this.synthWork;

    for (let i = 0; i < targetCount; i++) {
      const p = this.particles[i];
      p.x += p.vx * dt * speedMult;
      p.y += p.vy * dt * speedMult;
      if (p.x < 0) p.x += 1;
      if (p.x > 1) p.x -= 1;
      if (p.y < 0) p.y += 1;
      if (p.y > 1) p.y -= 1;

      pxArr[i] = p.x * width;
      pyArr[i] = p.y * height;
      lvlArr[i] = Math.min(
        1,
        this.sampleSpectrumLevel(
          p.bin / 64,
          freqData,
          hasLiveFft,
          useSimulation,
          now,
          cfg.barSensitivity
        )
      );
    }

    const baseLineColor =
      cfg.colorMode === "theme" || cfg.colorMode === "rainbow"
        ? parseHexRgb(palette.vizStart)
        : parseHexRgb(cfg.barColorLow);
    ctx.lineWidth = Math.max(1, 1.2 * proportionalScale);
    ctx.strokeStyle = rgbStr(baseLineColor, 0.24 + bass * 0.35);
    ctx.beginPath();
    for (let i = 0; i < targetCount; i++) {
      for (let j = i + 1; j < targetCount; j++) {
        const dx = pxArr[i] - pxArr[j];
        const dy = pyArr[i] - pyArr[j];
        if (dx * dx + dy * dy < linkDistSq) {
          ctx.moveTo(pxArr[i], pyArr[i]);
          ctx.lineTo(pxArr[j], pyArr[j]);
        }
      }
    }
    ctx.stroke();

    const baseSize = cfg.partSize * proportionalScale;
    for (let i = 0; i < targetCount; i++) {
      const lvl = lvlArr[i];
      const sz = Math.max(1.5, baseSize * (0.65 + lvl * cfg.partBassKick * 0.9));
      const x = pxArr[i];
      const y = pyArr[i];
      ctx.fillStyle = sampleStyleColor(cfg, palette, lvl, i / targetCount, rotDeg, 0.92);

      if (cfg.partShape === "square") {
        ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
      } else if (cfg.partShape === "diamond") {
        ctx.beginPath();
        ctx.moveTo(x, y - sz * 1.35);
        ctx.lineTo(x + sz * 1.35, y);
        ctx.lineTo(x, y + sz * 1.35);
        ctx.lineTo(x - sz * 1.35, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (cfg.showCenterInOtherStyles) {
      const scale = cfg.scaleWithScreen ? proportionalScale : previewMode ? 0.68 : 1;
      const rad =
        cfg.circleSize *
        0.5 *
        scale *
        (cfg.bassPulse && activeMotion ? 1 + bass * 0.07 : 1);
      this.drawCenterCircle(ctx, width / 2, height / 2, rad, scale, cfg, palette, centerImg, centerIsTpx);
    }

    return true;
  }
}
