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
  x: number; // normalized 0..1
  y: number; // normalized 0..1
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

function sampleTriColor(low: RGB, mid: RGB, high: RGB, t: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(1, t));
  const c =
    clamped < 0.5
      ? lerpRgb(low, mid, clamped * 2)
      : lerpRgb(mid, high, (clamped - 0.5) * 2);
  return rgbStr(c, alpha);
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
  return sampleTriColor(low, mid, high, level, alpha);
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
 */
export class VisualizerRenderer {
  private smoothedCircular = new Float32Array(200);
  private smoothedEdge = new Float32Array(160);
  private smoothedRadar = new Float32Array(128);
  private rotation = 0;
  private synthPhase = 0;

  // Heightmap ring history (rows x cols)
  private hmHistory: Float32Array[] = [];
  private hmPushAccum = 0;

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

    // 1. Background
    this.drawBackground(ctx, width, height, cfg, palette, bgImg);

    const activeMotion = hasLiveFft || useSimulation;
    const bass = this.computeBassEnergy(freqData, hasLiveFft, useSimulation, now);

    if (activeMotion) {
      this.rotation += cfg.rotationSpeed * dt * 0.45;
      this.synthPhase += dt * (1.2 + cfg.synthWaveSpeed * 1.4);
    }

    // Proportional dynamic screen scaling factor relative to 1080p reference height.
    // On high-res/high-DPI monitors (e.g. 2560x1600 @ 200% -> 800 CSS px height or 4K),
    // elements stay visually identical in proportion across every display!
    const minDim = Math.min(width, height);
    const proportionalScale = cfg.scaleWithScreen
      ? Math.max(0.32, minDim / 1080)
      : 1.0;

    let stillSettling = false;

    // 2. Main Style Dispatch
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

    // 3. Optional Screen-Edge Bars Overlay on top of any non-edge style
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
    // "match-bars": same color as the base of the bars
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

    // Base design dimensions in reference space (1080p when scaleWithScreen is on)
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
            ? sampleTriColor(lowRgb, midRgb, highRgb, smoothed)
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
  // STYLE 3: ULTRA-CUSTOMIZABLE SYNTHWAVE (Single / Double / Overlapping / Mirrored + Pixelated + Grid)
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
    const ampPx = height * 0.24 * cfg.synthAmplitude;

    // Optional matte retro perspective horizon grid in bottom half
    if (cfg.synthHorizonGrid) {
      const horizonY = Math.max(height * 0.3, Math.min(height * 0.85, baseY + height * 0.12));
      const gridColor =
        cfg.colorMode === "theme" || cfg.colorMode === "rainbow"
          ? parseHexRgb(palette.vizStart)
          : parseHexRgb(cfg.barColorLow);
      ctx.save();
      ctx.strokeStyle = rgbStr(gridColor, 0.22);
      ctx.lineWidth = Math.max(1, 1.2 * proportionalScale);

      // Perspective horizontal lines scrolling smoothly
      const rows = 10;
      const scroll = activeMotion ? (this.synthPhase * 0.35) % 1 : 0;
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const t = Math.pow((r + scroll) / rows, 1.85);
        const y = horizonY + t * (height - horizonY);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      // Perspective vanishing rays
      const cols = 14;
      const vanishX = width / 2;
      for (let c = -cols; c <= cols; c++) {
        const bottomX = vanishX + (c / cols) * width * 1.9;
        const topX = vanishX + (c / cols) * width * 0.16;
        ctx.moveTo(topX, horizonY);
        ctx.lineTo(bottomX, height);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (cfg.synthShowBaseline) {
      ctx.save();
      ctx.strokeStyle = rgbStr(parseHexRgb(palette.vizStart), 0.24);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      ctx.lineTo(width, baseY);
      ctx.stroke();
      ctx.restore();
    }

    const layerCount =
      cfg.synthMode === "single"
        ? 1
        : cfg.synthMode === "double"
        ? 2
        : cfg.synthMode === "mirrored"
        ? Math.max(1, Math.min(4, cfg.synthLayerCount))
        : Math.max(2, Math.min(6, cfg.synthLayerCount));

    const pixSize = Math.max(3, Math.round(cfg.synthPixelSize * proportionalScale));
    const sampleCount = cfg.synthPixelated
      ? Math.max(20, Math.floor(width / pixSize))
      : 140;

    const drawSingleWave = (layerIdx: number, totalLayers: number, sign: 1 | -1) => {
      const layerNorm = totalLayers > 1 ? layerIdx / (totalLayers - 1) : 0;
      const phaseOffset = layerIdx * 1.35 + (sign < 0 ? Math.PI * 0.5 : 0);
      const layerAmp = ampPx * (1 - layerNorm * 0.28);
      const yShift =
        cfg.synthMode === "double"
          ? (layerIdx === 0 ? -1 : 1) * 14 * proportionalScale
          : cfg.synthMode === "overlapping"
          ? (layerNorm - 0.5) * 32 * proportionalScale
          : 0;

      const strokeCol = sampleStyleColor(
        cfg,
        palette,
        0.25 + layerNorm * 0.7,
        layerNorm,
        rotDeg + layerIdx * 48,
        1 - layerNorm * 0.16
      );
      const fillCol = sampleStyleColor(
        cfg,
        palette,
        0.25 + layerNorm * 0.7,
        layerNorm,
        rotDeg + layerIdx * 48,
        cfg.synthFillOpacity * (1 - layerNorm * 0.25)
      );

      const ptsX: number[] = new Array(sampleCount + 1);
      const ptsY: number[] = new Array(sampleCount + 1);

      for (let i = 0; i <= sampleCount; i++) {
        const u = i / sampleCount;
        // Bell envelope so wave stays anchored smoothly near screen edges
        const env = Math.sin(u * Math.PI);
        const symPos = Math.abs(u * 2 - 1);
        const spec = this.sampleSpectrumLevel(
          symPos * 0.85,
          freqData,
          hasLiveFft,
          useSimulation,
          now,
          cfg.barSensitivity
        );
        const freq = (2.4 + layerIdx * 0.9) * cfg.synthFrequencyScale;
        const carrier = Math.sin(u * Math.PI * 2 * freq + this.synthPhase + phaseOffset);
        const harmonic =
          0.42 *
          Math.cos(u * Math.PI * 4 * freq - this.synthPhase * 1.35 + phaseOffset * 1.7);
        const displacement =
          sign *
          (carrier * 0.72 + harmonic) *
          env *
          (0.12 + spec * 0.95 + bass * 0.25) *
          layerAmp;

        let px = u * width;
        let py = baseY + yShift - displacement;
        if (cfg.synthPixelated) {
          px = Math.floor(px / pixSize) * pixSize;
          py = Math.floor(py / pixSize) * pixSize;
        }
        ptsX[i] = px;
        ptsY[i] = py;
      }

      if (cfg.synthPixelated) {
        // Crisp stepped pixel-art blocks
        if (cfg.synthFilled) {
          ctx.fillStyle = fillCol;
          for (let i = 0; i < sampleCount; i++) {
            const x = ptsX[i];
            const yTop = Math.min(ptsY[i], baseY + yShift);
            const h = Math.abs(ptsY[i] - (baseY + yShift));
            if (h >= 1) {
              ctx.fillRect(x, yTop, pixSize, h);
            }
          }
        }
        ctx.fillStyle = strokeCol;
        const blockH = Math.max(pixSize * 0.65, cfg.synthLineWidth * proportionalScale);
        for (let i = 0; i < sampleCount; i++) {
          ctx.fillRect(ptsX[i], ptsY[i] - blockH * 0.5, pixSize, blockH);
        }
      } else {
        if (cfg.synthFilled) {
          ctx.beginPath();
          ctx.moveTo(ptsX[0], baseY + yShift);
          for (let i = 0; i <= sampleCount; i++) {
            ctx.lineTo(ptsX[i], ptsY[i]);
          }
          ctx.lineTo(ptsX[sampleCount], baseY + yShift);
          ctx.closePath();
          ctx.fillStyle = fillCol;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(ptsX[0], ptsY[0]);
        for (let i = 1; i <= sampleCount; i++) {
          const prevX = ptsX[i - 1];
          const prevY = ptsY[i - 1];
          const midX = (prevX + ptsX[i]) * 0.5;
          const midY = (prevY + ptsY[i]) * 0.5;
          ctx.quadraticCurveTo(prevX, prevY, midX, midY);
        }
        ctx.lineTo(ptsX[sampleCount], ptsY[sampleCount]);
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = Math.max(1, cfg.synthLineWidth * proportionalScale);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
    };

    for (let l = layerCount - 1; l >= 0; l--) {
      drawSingleWave(l, layerCount, 1);
      if (cfg.synthMode === "mirrored") {
        drawSingleWave(l, layerCount, -1);
      }
    }

    return activeMotion;
  }

  // ---------------------------------------------------------------------------
  // STYLE 4: 2.5D AUDIO HEIGHTMAP / TERRAIN WATERFALL
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
    const rows = Math.max(10, Math.min(56, cfg.hmRows));
    const cols = Math.max(16, Math.min(96, cfg.hmCols));

    // Ensure history buffer matches current dimensions
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

    // Push a fresh spectrum row at controlled scroll rate
    const pushInterval = 0.042 / Math.max(0.25, cfg.hmScrollSpeed);
    this.hmPushAccum += dt;
    if (this.hmPushAccum >= pushInterval) {
      this.hmPushAccum = Math.min(pushInterval, this.hmPushAccum - pushInterval);
      const recycled = this.hmHistory.pop()!;
      const half = cfg.hmMirrored ? Math.ceil(cols / 2) : cols;
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
        // Gentle lateral bell tapering so mountains look sculpted
        const edgeFade = Math.sin((c / (cols - 1)) * Math.PI);
        const target = Math.max(0, Math.min(1.15, raw * (0.25 + 0.75 * edgeFade)));
        const prevFront = this.hmHistory[0]?.[c] ?? 0;
        const sm = Math.max(0, Math.min(0.85, cfg.barSmoothing * 0.7));
        recycled[c] = prevFront * sm + target * (1 - sm);
      }
      this.hmHistory.unshift(recycled);
    }

    // 2.5D Perspective Projection parameters
    const tiltRad = (Math.max(15, Math.min(78, cfg.hmTilt)) * Math.PI) / 180;
    const persp = Math.max(0.1, Math.min(1.25, cfg.hmPerspective));
    const elevScale = height * 0.25 * cfg.hmElevation;
    const topY = height * (0.24 - (Math.cos(tiltRad) - 0.5) * 0.14);
    const bottomY = height * 0.88;
    const baseSpanW = width * 0.92;
    const rotDeg = (this.rotation * 180) / Math.PI;
    const bgFill = cfg.backgroundMode === "solid" ? cfg.backgroundColor : palette.bgBase;

    const project = (rowIdx: number, colIdx: number, val: number): [number, number] => {
      // depth 0 = farthest back, 1 = closest front
      const depth = 1 - rowIdx / Math.max(1, rows - 1);
      const depthCurve = Math.pow(depth, 1 + persp * 0.65);
      const rowScale = 1 - (1 - depthCurve) * (0.25 + persp * 0.42);
      const spanW = baseSpanW * rowScale;
      const u = colIdx / Math.max(1, cols - 1) - 0.5;
      const x = width * 0.5 + u * spanW;
      const groundY = topY + depthCurve * (bottomY - topY);
      const y = groundY - val * elevScale * rowScale * Math.sin(tiltRad);
      return [x, y];
    };

    // Pre-project back-to-front (row = rows-1 down to 0)
    const projX: Float32Array[] = new Array(rows);
    const projY: Float32Array[] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      projX[r] = new Float32Array(cols);
      projY[r] = new Float32Array(cols);
      const row = this.hmHistory[r];
      for (let c = 0; c < cols; c++) {
        const [px, py] = project(r, c, row[c]);
        projX[r][c] = px;
        projY[r][c] = py;
      }
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (cfg.hmRenderMode === "dots") {
      const dotBase = Math.max(1.5, cfg.hmLineWidth * 1.4);
      for (let r = rows - 1; r >= 0; r--) {
        const depth = 1 - r / Math.max(1, rows - 1);
        const row = this.hmHistory[r];
        for (let c = 0; c < cols; c++) {
          const v = row[c];
          const rad = dotBase * (0.45 + depth * 0.75) * (0.7 + v * 0.8);
          ctx.fillStyle = sampleStyleColor(
            cfg,
            palette,
            Math.min(1, v * 1.1),
            c / cols,
            rotDeg,
            0.25 + depth * 0.75
          );
          ctx.beginPath();
          ctx.arc(projX[r][c], projY[r][c], rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return activeMotion;
    }

    // Painter's algorithm: back row (rows - 1) to front row (0)
    for (let r = rows - 1; r >= 0; r--) {
      const depth = 1 - r / Math.max(1, rows - 1);
      const row = this.hmHistory[r];
      let rowPeak = 0;
      for (let c = 0; c < cols; c++) {
        if (row[c] > rowPeak) rowPeak = row[c];
      }

      if (cfg.hmRenderMode === "filled-mesh" && r < rows - 1) {
        // Draw filled quads between back row (r+1) and current row (r)
        for (let c = 0; c < cols - 1; c++) {
          const avgH =
            (row[c] + row[c + 1] + this.hmHistory[r + 1][c] + this.hmHistory[r + 1][c + 1]) *
            0.25;
          ctx.fillStyle = sampleStyleColor(
            cfg,
            palette,
            Math.min(1, avgH * 1.15),
            c / cols,
            rotDeg,
            0.18 + depth * 0.62
          );
          ctx.beginPath();
          ctx.moveTo(projX[r + 1][c], projY[r + 1][c]);
          ctx.lineTo(projX[r + 1][c + 1], projY[r + 1][c + 1]);
          ctx.lineTo(projX[r][c + 1], projY[r][c + 1]);
          ctx.lineTo(projX[r][c], projY[r][c]);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Occlusion fill beneath ridge line for clean Joy-Division / Wireframe depth
      if (cfg.hmRenderMode === "ridges" || cfg.hmRenderMode === "wireframe") {
        ctx.beginPath();
        ctx.moveTo(projX[r][0], height);
        for (let c = 0; c < cols; c++) {
          ctx.lineTo(projX[r][c], projY[r][c]);
        }
        ctx.lineTo(projX[r][cols - 1], height);
        ctx.closePath();
        ctx.fillStyle = bgFill;
        ctx.fill();
      }

      // Longitudinal wireframe struts connecting row r to row r+1
      if ((cfg.hmRenderMode === "wireframe" || cfg.hmRenderMode === "filled-mesh") && r < rows - 1) {
        ctx.strokeStyle = sampleStyleColor(
          cfg,
          palette,
          Math.min(1, rowPeak),
          depth,
          rotDeg,
          0.16 + depth * 0.42
        );
        ctx.lineWidth = Math.max(0.8, cfg.hmLineWidth * 0.65);
        ctx.beginPath();
        for (let c = 0; c < cols; c += 2) {
          ctx.moveTo(projX[r + 1][c], projY[r + 1][c]);
          ctx.lineTo(projX[r][c], projY[r][c]);
        }
        ctx.stroke();
      }

      // Horizontal ridge crest line
      ctx.beginPath();
      ctx.moveTo(projX[r][0], projY[r][0]);
      for (let c = 1; c < cols; c++) {
        ctx.lineTo(projX[r][c], projY[r][c]);
      }
      ctx.strokeStyle = sampleStyleColor(
        cfg,
        palette,
        Math.min(1, 0.15 + rowPeak * 0.95),
        depth,
        rotDeg,
        0.25 + depth * 0.75
      );
      ctx.lineWidth = Math.max(1, cfg.hmLineWidth * (0.65 + depth * 0.55));
      ctx.stroke();
    }

    return activeMotion;
  }

  // ---------------------------------------------------------------------------
  // STYLE 5: CONCENTRIC SHOCKWAVE / RADIAL POLYGONS
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
    const rings = Math.max(2, Math.min(10, cfg.radarRingCount));
    const sides = cfg.radarPolygonSides; // 0 = smooth 64-pt audio blob, 3..12 = polygon
    const pts = sides >= 3 ? sides : 64;
    const smoothing = Math.max(0, Math.min(0.94, cfg.barSmoothing));
    const maxR = minDim * 0.43 * cfg.radarSpread * (previewMode ? 0.9 : 1);
    const baseInner = cfg.showCenterInOtherStyles
      ? cfg.circleSize * 0.5 * (cfg.scaleWithScreen ? proportionalScale : 1) + 22
      : minDim * 0.08;
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

    for (let r = rings - 1; r >= 0; r--) {
      const frac = (r + 1) / rings;
      const ringRadius = baseInner + (maxR - baseInner) * frac * (1 + (cfg.bassPulse ? bass * 0.08 : 0));
      const ringRot = this.rotation * (r % 2 === 0 ? 1 : -0.7) + r * 0.22;

      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const angle = ringRot + (i / pts) * Math.PI * 2 - Math.PI / 2;
        const mod = this.smoothedRadar[(i + r * 3) % pts];
        const amp = (maxR - baseInner) * 0.24 * (0.4 + frac * 0.6);
        const rad = ringRadius + mod * amp;
        const px = cx + Math.cos(angle) * rad;
        const py = cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
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
      const rad = cfg.circleSize * 0.5 * scale * (cfg.bassPulse && activeMotion ? 1 + bass * 0.07 : 1);
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
      // Deterministic pseudo-random spread so all mirrored monitors start harmoniously
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
    const pxArr = new Float32Array(targetCount);
    const pyArr = new Float32Array(targetCount);
    const lvlArr = new Float32Array(targetCount);

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

    // Connecting lines
    const baseLineColor =
      cfg.colorMode === "theme" || cfg.colorMode === "rainbow"
        ? parseHexRgb(palette.vizStart)
        : parseHexRgb(cfg.barColorLow);
    ctx.lineWidth = Math.max(1, 1.2 * proportionalScale);
    for (let i = 0; i < targetCount; i++) {
      for (let j = i + 1; j < targetCount; j++) {
        const dx = pxArr[i] - pxArr[j];
        const dy = pyArr[i] - pyArr[j];
        const d2 = dx * dx + dy * dy;
        if (d2 < linkDistSq) {
          const alpha = (1 - Math.sqrt(d2) / linkDist) * (0.28 + bass * 0.45);
          ctx.strokeStyle = rgbStr(baseLineColor, alpha);
          ctx.beginPath();
          ctx.moveTo(pxArr[i], pyArr[i]);
          ctx.lineTo(pxArr[j], pyArr[j]);
          ctx.stroke();
        }
      }
    }

    // Geometric nodes
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
      const rad = cfg.circleSize * 0.5 * scale * (cfg.bassPulse && activeMotion ? 1 + bass * 0.07 : 1);
      this.drawCenterCircle(ctx, width / 2, height / 2, rad, scale, cfg, palette, centerImg, centerIsTpx);
    }

    return true;
  }
}
