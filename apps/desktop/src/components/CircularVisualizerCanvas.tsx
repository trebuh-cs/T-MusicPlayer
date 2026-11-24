import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  VisualizerRenderer,
  type PaletteColors,
} from "@shared/visualizer/renderer";
import tpxLogoUrl from "../assets/tpx-logo.svg";
import { getCoverUrl } from "../services/api";
import type { CinematicConfig } from "../types";

interface CircularVisualizerCanvasProps {
  config: CinematicConfig;
  analyserRef?: React.RefObject<AnalyserNode | null>;
  liveFftRef?: React.RefObject<Uint8Array>;
  isPlaying: boolean;
  isRadio: boolean;
  themeId: string;
  coverUrl: string | null;
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
    bgBase: styles.getPropertyValue("--bg-base").trim() || "#0B0D12",
    bgElevated: styles.getPropertyValue("--bg-elevated").trim() || "#111311",
  };
}

export const CircularVisualizerCanvas = memo(function CircularVisualizerCanvas({
  config,
  analyserRef,
  liveFftRef,
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
  const rendererRef = useRef<VisualizerRenderer | null>(null);
  if (!rendererRef.current) {
    rendererRef.current = new VisualizerRenderer();
  }

  const configRef = useRef(config);
  configRef.current = config;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isRadioRef = useRef(isRadio);
  isRadioRef.current = isRadio;
  const simulateRef = useRef(simulatePreview);
  simulateRef.current = simulatePreview;

  const paletteRef = useRef<PaletteColors>({
    accent: "#0AF92A",
    vizStart: "#0AF92A",
    vizEnd: "#49ECC1",
    bgBase: "#0B0D12",
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
  }, [themeId]);

  const effectiveCenterKind = useMemo(() => {
    if (config.centerSource === "auto") {
      return themeId === "tpx" ? "tpx" : "music-icon";
    }
    return config.centerSource;
  }, [config.centerSource, themeId]);

  const effectiveCenterKindRef = useRef(effectiveCenterKind);
  effectiveCenterKindRef.current = effectiveCenterKind;

  const effectiveCenterUrl = useMemo(() => {
    if (effectiveCenterKind === "tpx") return tpxLogoUrl;
    if (effectiveCenterKind === "custom") {
      if (config.customImageDataUrl) return config.customImageDataUrl;
      if (config.customImageHash) return getCoverUrl(config.customImageHash);
    }
    if (effectiveCenterKind === "album-art" && coverUrl) return coverUrl;
    return null;
  }, [effectiveCenterKind, config.customImageDataUrl, config.customImageHash, coverUrl]);

  useEffect(() => {
    if (!effectiveCenterUrl) {
      centerImgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
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
    const localFreq = new Uint8Array(256);

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const playing = isPlayingRef.current;
      const radio = isRadioRef.current;

      let freqData: Uint8Array | null = null;
      let hasLiveFft = false;

      if (liveFftRef?.current) {
        freqData = liveFftRef.current;
        let peak = 0;
        for (let i = 0; i < 64; i++) {
          if (freqData[i] > peak) peak = freqData[i];
        }
        hasLiveFft = peak > 2 && !radio;
      } else if (analyserRef?.current && playing && !radio) {
        analyserRef.current.getByteFrequencyData(localFreq);
        freqData = localFreq;
        hasLiveFft = true;
      }

      const useSimulation =
        !hasLiveFft && ((playing && radio) || (previewMode && simulateRef.current));

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
  }, [size, analyserRef, liveFftRef, previewMode]);

  return (
    <div ref={containerRef} className={`w-full h-full relative ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
});
