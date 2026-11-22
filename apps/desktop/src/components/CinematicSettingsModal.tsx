import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Play, RotateCcw, Sparkles, Tv, X } from "lucide-react";
import { api, getCoverUrl } from "../services/api";
import {
  DEFAULT_CINEMATIC_CONFIG,
  type CinematicCenterSource,
  type CinematicColorMode,
  type CinematicConfig,
  type CinematicTitlePosition,
  type PlayingItem,
} from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";

interface CinematicSettingsModalProps {
  config: CinematicConfig;
  onChange: (next: CinematicConfig) => void;
  onLaunchCinematic: () => void;
  onClose: () => void;
  analyserRef: React.RefObject<AnalyserNode | null>;
  isPlaying: boolean;
  nowPlaying: PlayingItem | null;
  themeId: string;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (val: number) => void;
}

function SliderRow({ label, value, min, max, step, unit = "", onChange }: SliderRowProps) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="font-mono-num text-[var(--accent)]">
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="t-slider w-full"
        style={{ background: "var(--bg-surface)", borderRadius: 9999, height: 5 }}
      />
    </label>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, description, checked, onToggle }: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-left cursor-pointer"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium text-[var(--text-primary)]">{label}</div>
        {description && (
          <div className="text-[11px] text-[var(--text-muted)]">{description}</div>
        )}
      </div>
      <span
        className={`w-8 h-4.5 rounded-full p-0.5 transition-colors shrink-0 ${
          checked ? "bg-[var(--accent)]" : "bg-[var(--bg-base)]"
        }`}
      >
        <span
          className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

export function CinematicSettingsModal({
  config,
  onChange,
  onLaunchCinematic,
  onClose,
  analyserRef,
  isPlaying,
  nowPlaying,
  themeId,
}: CinematicSettingsModalProps) {
  const [simulatePreview, setSimulatePreview] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const patch = <K extends keyof CinematicConfig>(key: K, val: CinematicConfig[K]) => {
    onChange({ ...config, [key]: val });
  };

  const pickCustomImage = async () => {
    setUploadError(null);
    const selected = await open({
      multiple: false,
      title: "Choose Center Circle Image",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg", "gif"] },
      ],
    });
    if (typeof selected !== "string") return;
    try {
      const hash = await api.importCinematicImage(selected);
      onChange({ ...config, customImageHash: hash, centerSource: "custom" });
    } catch (err) {
      setUploadError(String(err));
    }
  };

  const coverUrl =
    nowPlaying?.kind === "track"
      ? getCoverUrl(nowPlaying.track.cover_hash)
      : nowPlaying?.kind === "radio"
      ? nowPlaying.station.favicon
      : null;

  const previewTitle =
    nowPlaying?.kind === "track"
      ? nowPlaying.track.title
      : nowPlaying?.kind === "radio"
      ? nowPlaying.station.name
      : "Sample Track Title";

  const previewArtist =
    nowPlaying?.kind === "track"
      ? nowPlaying.track.artist
      : nowPlaying?.kind === "radio"
      ? "Live Internet Radio"
      : "T - MusicPlayer";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="w-full max-w-5xl h-[86vh] flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Tv className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                Cinematic Mode Studio
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Customize circle geometry, sound bars, dynamic colors, and center artwork
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(DEFAULT_CINEMATIC_CONFIG)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={onLaunchCinematic}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Enter Cinematic
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              aria-label="Close Cinematic Settings"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1.05fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-subtle)]">
          {/* Left: Live Interactive Preview */}
          <div className="flex flex-col min-h-0 p-5 bg-[var(--bg-base)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                Live Preview
              </span>
              {!isPlaying && (
                <button
                  type="button"
                  onClick={() => setSimulatePreview((v) => !v)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer ${
                    simulatePreview
                      ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                      : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                  }`}
                >
                  {simulatePreview ? "Simulating Beat" : "Beat Simulation Off"}
                </button>
              )}
            </div>

            <div className="flex-1 min-h-[260px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] flex flex-col items-center justify-center p-4 overflow-hidden">
              {config.titlePosition === "above" && (
                <div className="text-center pb-2">
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {previewTitle}
                  </div>
                  {config.showArtistInTitle && (
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {previewArtist}
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 w-full min-h-0">
                <CircularVisualizerCanvas
                  config={config}
                  analyserRef={analyserRef}
                  isPlaying={isPlaying}
                  isRadio={nowPlaying?.kind === "radio"}
                  themeId={themeId}
                  coverUrl={coverUrl}
                  previewMode
                  simulatePreview={simulatePreview}
                />
              </div>

              {config.titlePosition === "below" && (
                <div className="text-center pt-2">
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {previewTitle}
                  </div>
                  {config.showArtistInTitle && (
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {previewArtist}
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2.5 text-center">
              Press <span className="font-mono-num text-[var(--text-secondary)]">Esc</span> anytime in Cinematic Mode to return to the player.
            </p>
          </div>

          {/* Right: Controls */}
          <div className="overflow-y-auto p-5 space-y-6">
            {/* Section 1: Circle & Center Artwork */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Center Circle & Picture
              </h3>

              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["auto", "Auto (TPX / Icon)"],
                    ["tpx", "TPX Logo"],
                    ["music-icon", "Music Icon"],
                    ["album-art", "Album Art"],
                    ["custom", "Custom Picture"],
                  ] as [CinematicCenterSource, string][]
                ).map(([src, label]) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => patch("centerSource", src)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border text-left transition-colors cursor-pointer ${
                      config.centerSource === src
                        ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void pickCustomImage()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--accent)] flex items-center gap-1.5 cursor-pointer"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  Choose Image...
                </button>
              </div>
              {uploadError && (
                <div className="text-[11px] text-rose-400">{uploadError}</div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-1">
                <SliderRow
                  label="Circle Size"
                  value={config.circleSize}
                  min={100}
                  max={340}
                  step={4}
                  unit="px"
                  onChange={(v) => patch("circleSize", v)}
                />
                <SliderRow
                  label="Gap to Bars"
                  value={config.barGapFromCircle}
                  min={0}
                  max={64}
                  step={1}
                  unit="px"
                  onChange={(v) => patch("barGapFromCircle", v)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ToggleRow
                  label="Circle Ring"
                  checked={config.showCircleRing}
                  onToggle={() => patch("showCircleRing", !config.showCircleRing)}
                />
                <ToggleRow
                  label="Bass Pulse"
                  checked={config.bassPulse}
                  onToggle={() => patch("bassPulse", !config.bassPulse)}
                />
              </div>
            </section>

            {/* Section 2: Sound Bars */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Sound Bars & Physics
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <SliderRow
                  label="Bar Count"
                  value={config.barCount}
                  min={24}
                  max={160}
                  step={4}
                  onChange={(v) => patch("barCount", v)}
                />
                <SliderRow
                  label="Max Bar Height"
                  value={config.barMaxHeight}
                  min={30}
                  max={260}
                  step={4}
                  unit="px"
                  onChange={(v) => patch("barMaxHeight", v)}
                />
                <SliderRow
                  label="Bar Thickness"
                  value={config.barThickness}
                  min={2}
                  max={14}
                  step={0.5}
                  unit="px"
                  onChange={(v) => patch("barThickness", v)}
                />
                <SliderRow
                  label="Sensitivity"
                  value={config.barSensitivity}
                  min={0.4}
                  max={3.0}
                  step={0.05}
                  unit="x"
                  onChange={(v) => patch("barSensitivity", v)}
                />
                <SliderRow
                  label="Smoothing"
                  value={config.barSmoothing}
                  min={0}
                  max={0.92}
                  step={0.02}
                  onChange={(v) => patch("barSmoothing", v)}
                />
                <SliderRow
                  label="Rotation Speed"
                  value={config.rotationSpeed}
                  min={-2}
                  max={2}
                  step={0.05}
                  onChange={(v) => patch("rotationSpeed", v)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ToggleRow
                  label="Mirrored Ring"
                  description="Symmetric left & right"
                  checked={config.mirrored}
                  onToggle={() => patch("mirrored", !config.mirrored)}
                />
                <ToggleRow
                  label="Bidirectional Bars"
                  description="Bounce inward & outward"
                  checked={config.bidirectionalBars}
                  onToggle={() =>
                    patch("bidirectionalBars", !config.bidirectionalBars)
                  }
                />
                <ToggleRow
                  label="Rounded Tips"
                  checked={config.roundedCaps}
                  onToggle={() => patch("roundedCaps", !config.roundedCaps)}
                />
              </div>
            </section>

            {/* Section 3: Bar Colors */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Bar Color Mode
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {(
                  [
                    ["theme", "Theme Gradient"],
                    ["height-dynamic", "Dynamic by Height"],
                    ["radial-fade", "High-to-Low Fade"],
                    ["solid", "Solid Color"],
                    ["rainbow", "Spectrum Ring"],
                  ] as [CinematicColorMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patch("colorMode", mode)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      config.colorMode === mode
                        ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {(config.colorMode === "solid" ||
                config.colorMode === "height-dynamic" ||
                config.colorMode === "radial-fade") && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs cursor-pointer">
                    <span className="text-[var(--text-secondary)]">
                      {config.colorMode === "solid" ? "Bar" : "Low"}
                    </span>
                    <input
                      type="color"
                      value={config.barColorLow}
                      onChange={(e) => patch("barColorLow", e.target.value)}
                      className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                    />
                  </label>
                  {config.colorMode !== "solid" && (
                    <>
                      <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs cursor-pointer">
                        <span className="text-[var(--text-secondary)]">Mid</span>
                        <input
                          type="color"
                          value={config.barColorMid}
                          onChange={(e) => patch("barColorMid", e.target.value)}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs cursor-pointer">
                        <span className="text-[var(--text-secondary)]">Peak</span>
                        <input
                          type="color"
                          value={config.barColorHigh}
                          onChange={(e) => patch("barColorHigh", e.target.value)}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
            </section>

            {/* Section 4: Title & Fullscreen */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Track Title & Display
              </h3>

              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["hidden", "Title Hidden"],
                    ["above", "Above Circle"],
                    ["below", "Below Circle"],
                  ] as [CinematicTitlePosition, string][]
                ).map(([pos, label]) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => patch("titlePosition", pos)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      config.titlePosition === pos
                        ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ToggleRow
                  label="Show Artist Subtitle"
                  checked={config.showArtistInTitle}
                  onToggle={() => patch("showArtistInTitle", !config.showArtistInTitle)}
                />
                <ToggleRow
                  label="Auto Borderless Fullscreen"
                  description="Enter fullscreen in Cinematic"
                  checked={config.enterFullscreen}
                  onToggle={() => patch("enterFullscreen", !config.enterFullscreen)}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
