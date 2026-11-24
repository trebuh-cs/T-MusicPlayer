import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  VisualizerRenderer,
  type PaletteColors,
} from "@shared/visualizer/renderer";
import tpxLogoUrl from "../assets/tpx-logo.svg";
import type { VisualizerConfig } from "../types";

interface CircularVisualizerCanvasProps {
  config: VisualizerConfig;
  liveFftRef: React.RefObject<Uint8Array>;
  hasAudioSignal: boolean;
  albumArtUrl?: string | null;
  previewMode?: boolean;
  simulatePreview?: boolean;
  className?: string;
}

function readDocumentPalette(): PaletteColors {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: styles.getPropertyValue("--accent").trim() || "#0AF92A",
    vizStart: styles.getPropertyValue("--viz-start").trim() || "#0AF92A",
    vizEnd: styles.getPropertyValue("--viz-end").trim() || "#49ECC1",
    bgBase: styles.getPropertyValue("--bg-base").trim() || "#090A09",
    bgElevated: styles.getPropertyValue("--bg-elevated").trim() || "#111311",
  };
}

export const CircularVisualizerCanvas = memo(function CircularVisualizerCanvas({
  config,
  liveFftRef,
  hasAudioSignal,
  albumArtUrl = null,
  previewMode = false,
  simulatePreview = false,
  className = "",
}: CircularVisualizerCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<VisualizerRenderer | null>(null);
  if (!rendererRef.current) {
    rendererRef.current = new VisualizerRenderer();
  }

  const configRef = useRef(config);
  configRef.current = config;

  const hasSignalRef = useRef(hasAudioSignal);
  hasSignalRef.current = hasAudioSignal;
  const simulateRef = useRef(simulatePreview);
  simulateRef.current = simulatePreview;

  const paletteRef = useRef<PaletteColors>({
    accent: "#0AF92A",
    vizStart: "#0AF92A",
    vizEnd: "#49ECC1",
    bgBase: "#090A09",
    bgElevated: "#111311",
  });

  const [size, setSize] = useState({ width: 400, height: 400 });
  const centerImgRef = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);
  const bgImgRef = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);

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

  const effectiveCenterKind = useMemo(() => {
    if (config.centerSource === "auto") {
      return config.themeId === "tpx" ? "tpx" : "music-icon";
    }
    return config.centerSource;
  }, [config.centerSource, config.themeId]);

  const effectiveCenterKindRef = useRef(effectiveCenterKind);
  effectiveCenterKindRef.current = effectiveCenterKind;

  const effectiveCenterUrl = useMemo(() => {
    if (effectiveCenterKind === "tpx") return tpxLogoUrl;
    if (effectiveCenterKind === "custom" && config.customImageDataUrl) {
      return config.customImageDataUrl;
    }
    if (effectiveCenterKind === "album-art" && albumArtUrl) {
      return albumArtUrl;
    }
    return null;
  }, [effectiveCenterKind, config.customImageDataUrl, albumArtUrl]);

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
        const nextW = Math.ceil(rect.width);
        const nextH = Math.ceil(rect.height);
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

      const freqData = liveFftRef.current;
      let livePeak = 0;
      if (freqData) {
        for (let b = 0; b < 64; b++) {
          if (freqData[b] > livePeak) livePeak = freqData[b];
        }
      }
      const hasLiveFft = livePeak > 2 || hasSignalRef.current;
      const useSimulation = !hasLiveFft && previewMode && simulateRef.current;

      rendererRef.current!.render({
        ctx,
        width: size.width,
        height: size.height,
        now,
        dt,
        config: configRef.current,
        palette: paletteRef.current,
        freqData,
        hasLiveFft,
        useSimulation,
        previewMode,
        centerImg: centerImgRef.current?.ready ? centerImgRef.current.img : null,
        centerIsTpx: effectiveCenterKindRef.current === "tpx",
        bgImg: bgImgRef.current?.ready ? bgImgRef.current.img : null,
      });

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
