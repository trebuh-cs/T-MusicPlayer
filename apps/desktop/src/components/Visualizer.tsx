import { memo, useEffect, useRef } from "react";
import type { VisualizerStyle } from "../types";

interface VisualizerProps {
  analyserRef: React.RefObject<AnalyserNode | null>;
  isPlaying: boolean;
  isRadio: boolean;
  styleMode: VisualizerStyle;
  isRetroVfd: boolean;
}

const BAR_COUNT = 20;

export const Visualizer = memo(function Visualizer({
  analyserRef,
  isPlaying,
  isRadio,
  styleMode,
  isRetroVfd,
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || styleMode === "off") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = 112;
    const height = 32;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let cachedVizStart = "#6366f1";
    let cachedVizEnd = "#22d3ee";
    let cachedGrad: CanvasGradient | null = null;

    const rebuildGradient = () => {
      const styles = getComputedStyle(document.documentElement);
      cachedVizStart = styles.getPropertyValue("--viz-start").trim() || "#6366f1";
      cachedVizEnd = styles.getPropertyValue("--viz-end").trim() || "#22d3ee";
      const g = ctx.createLinearGradient(0, height, 0, 0);
      g.addColorStop(0, cachedVizStart);
      g.addColorStop(1, cachedVizEnd);
      cachedGrad = g;
    };

    rebuildGradient();
    const observer = new MutationObserver(rebuildGradient);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"],
    });

    let rafId = 0;
    const freqData = new Uint8Array(256);
    const gap = 2;
    const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;

    const renderFrame = (timeMs: number) => {
      ctx.clearRect(0, 0, width, height);

      const analyser = analyserRef.current;
      if (analyser && isPlaying && !isRadio) {
        analyser.getByteFrequencyData(freqData);
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        let level = 0.06;
        if (isPlaying) {
          if (isRadio || !analyser) {
            const t = timeMs * 0.005;
            level =
              0.22 +
              0.38 *
                Math.abs(Math.sin(t + i * 0.42) * Math.cos(t * 0.65 - i * 0.18));
          } else {
            const bin = Math.min(freqData.length - 1, Math.floor((i / BAR_COUNT) * 140));
            level = Math.max(0.06, freqData[bin] / 255);
          }
        }

        const x = i * (barWidth + gap);
        ctx.fillStyle = cachedGrad || cachedVizStart;

        if (styleMode === "mirrored") {
          const barH = Math.max(2, level * (height * 0.9));
          const y = (height - barH) / 2;
          ctx.fillRect(x, y, barWidth, barH);
        } else {
          const barH = Math.max(2, level * (height - 4));
          const y = height - barH;
          ctx.fillRect(x, y, barWidth, barH);

          if (isRetroVfd) {
            const prevPeak = peaksRef.current[i];
            const nextPeak = level >= prevPeak ? level : Math.max(0.06, prevPeak - 0.015);
            peaksRef.current[i] = nextPeak;
            const peakY = Math.max(1, height - nextPeak * (height - 4) - 2.5);
            ctx.fillStyle = cachedVizEnd;
            ctx.fillRect(x, peakY, barWidth, 1.8);
          }
        }
      }

      if (isPlaying) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame(performance.now());
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [analyserRef, isPlaying, isRadio, styleMode, isRetroVfd]);

  if (styleMode === "off") return null;

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 112, height: 32 }}
      className="shrink-0 opacity-95"
      aria-label="Audio spectrum visualizer"
    />
  );
});
