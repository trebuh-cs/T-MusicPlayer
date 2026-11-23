import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ImagePlus,
  Monitor,
  Palette,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Tv,
  Volume2,
  Wallpaper,
  X,
} from "lucide-react";
import { api } from "../services/api";
import { THEMES } from "../themes";
import {
  DEFAULT_VISUALIZER_CONFIG,
  type AudioDeviceInfo,
  type AudioStatus,
  type MonitorInfo,
  type VisualizerBackgroundMode,
  type VisualizerCenterSource,
  type VisualizerColorMode,
  type VisualizerConfig,
  type VisualizerTitlePosition,
} from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";

interface CustomizeStudioModalProps {
  config: VisualizerConfig;
  onChange: (next: VisualizerConfig) => void;
  onClose: () => void;
  onToggleWallpaper: () => void;
  wallpaperMode: boolean;
  liveFftRef: React.RefObject<Uint8Array>;
  hasAudioSignal: boolean;
  audioStatus: AudioStatus | null;
  devices: AudioDeviceInfo[];
  monitors: MonitorInfo[];
  onRefreshHardware: () => void;
  onSelectDevice: (deviceId: string | null) => void;
  onSelectMonitor: (monitorId: string | null) => void;
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

export function CustomizeStudioModal({
  config,
  onChange,
  onClose,
  onToggleWallpaper,
  wallpaperMode,
  liveFftRef,
  hasAudioSignal,
  audioStatus,
  devices,
  monitors,
  onRefreshHardware,
  onSelectDevice,
  onSelectMonitor,
}: CustomizeStudioModalProps) {
  const [simulatePreview, setSimulatePreview] = useState(true);
  const [imageError, setImageError] = useState<string | null>(null);

  const patch = <K extends keyof VisualizerConfig>(key: K, val: VisualizerConfig[K]) => {
    onChange({ ...config, [key]: val });
  };

  const pickCenterImage = async () => {
    setImageError(null);
    const selected = await open({
      multiple: false,
      title: "Choose Center Circle Image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg", "gif"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const dataUrl = await api.loadImageAsDataUrl(selected);
      onChange({ ...config, customImageDataUrl: dataUrl, centerSource: "custom" });
    } catch (err) {
      setImageError(String(err));
    }
  };

  const pickBackgroundImage = async () => {
    setImageError(null);
    const selected = await open({
      multiple: false,
      title: "Choose Wallpaper Background Image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const dataUrl = await api.loadImageAsDataUrl(selected);
      onChange({ ...config, backgroundImageDataUrl: dataUrl, backgroundMode: "image" });
    } catch (err) {
      setImageError(String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="w-full max-w-6xl h-[88vh] flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Tv className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[var(--text-primary)] truncate">
                T - Visualizer Studio
              </h2>
              <p className="text-xs text-[var(--text-secondary)] truncate">
                System-wide Windows audio visualizer &amp; Live Desktop Wallpaper
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...DEFAULT_VISUALIZER_CONFIG,
                  selectedDeviceId: config.selectedDeviceId,
                  selectedMonitorId: config.selectedMonitorId,
                })
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onToggleWallpaper();
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              <Wallpaper className="w-3.5 h-3.5" />
              {wallpaperMode ? "Exit Wallpaper Mode" : "Set as Live Wallpaper"}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              aria-label="Close Studio"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1.02fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-subtle)]">
          {/* Left: Live Interactive Preview */}
          <div className="flex flex-col min-h-0 p-5 bg-[var(--bg-base)]">
            <div className="flex items-center justify-between mb-3 gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                Live Preview
              </span>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: hasAudioSignal ? "var(--accent)" : "var(--text-muted)",
                    }}
                  />
                  {hasAudioSignal
                    ? "Live System Audio"
                    : audioStatus?.capturing
                    ? "Waiting for Audio"
                    : "Connecting..."}
                </span>

                {!hasAudioSignal && (
                  <button
                    type="button"
                    onClick={() => setSimulatePreview((v) => !v)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer ${
                      simulatePreview
                        ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {simulatePreview ? "Beat Sim On" : "Beat Sim Off"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-[260px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] flex flex-col items-center justify-center overflow-hidden relative">
              {config.titlePosition === "above" && config.customTitle.trim() && (
                <div className="absolute top-4 inset-x-4 z-10 text-center pointer-events-none">
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {config.customTitle}
                  </div>
                  {config.showSubtitle && config.customSubtitle.trim() && (
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {config.customSubtitle}
                    </div>
                  )}
                </div>
              )}

              <div className="w-full h-full">
                <CircularVisualizerCanvas
                  config={config}
                  liveFftRef={liveFftRef}
                  hasAudioSignal={hasAudioSignal}
                  previewMode
                  simulatePreview={simulatePreview}
                />
              </div>

              {config.titlePosition === "below" && config.customTitle.trim() && (
                <div className="absolute bottom-4 inset-x-4 z-10 text-center pointer-events-none">
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {config.customTitle}
                  </div>
                  {config.showSubtitle && config.customSubtitle.trim() && (
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {config.customSubtitle}
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="text-[11px] text-[var(--text-muted)] mt-2.5 text-center">
              In Live Wallpaper Mode, click the{" "}
              <span className="text-[var(--text-secondary)] font-medium">TPX Tray Icon</span>{" "}
              in your Windows taskbar anytime to reopen Studio or exit Wallpaper Mode.
            </p>
          </div>

          {/* Right: Controls */}
          <div className="overflow-y-auto p-5 space-y-6">
            {/* Section 0: Audio Device & Live Wallpaper Monitor */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                  Audio Capture &amp; Wallpaper Monitor
                </h3>
                <button
                  type="button"
                  onClick={onRefreshHardware}
                  className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
              </div>

              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    Windows Audio Output (Spotify, YouTube, Games...)
                  </span>
                  <select
                    value={config.selectedDeviceId ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      patch("selectedDeviceId", val);
                      onSelectDevice(val);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">System Default Output (Auto-Follow)</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.is_default ? "(Default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                    <Monitor className="w-3 h-3" />
                    Wallpaper Display Mode &amp; Monitor
                  </span>
                  <select
                    value={config.selectedMonitorId ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      patch("selectedMonitorId", val);
                      onSelectMonitor(val);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">
                      Auto ({monitors.some((m) => m.id === "mirrored")
                        ? "All Monitors Mirrored · Native Res"
                        : "Primary Monitor"})
                    </option>
                    {monitors.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>

                {audioStatus?.error && (
                  <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
                    {audioStatus.error}
                  </div>
                )}
              </div>
            </section>

            {/* Section 1: Theme & Background */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-[var(--accent)]" />
                Theme &amp; Wallpaper Background
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch("themeId", t.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border text-left transition-colors cursor-pointer ${
                      config.themeId === t.id
                        ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/15"
                      style={{ background: t.colors.accent }}
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {(
                  [
                    ["theme", "Theme Canvas"],
                    ["solid", "Custom Color"],
                    ["image", "Wallpaper Photo"],
                  ] as [VisualizerBackgroundMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patch("backgroundMode", mode)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      config.backgroundMode === mode
                        ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {config.backgroundMode === "solid" && (
                <label className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs cursor-pointer">
                  <span className="text-[var(--text-secondary)]">Background Color</span>
                  <input
                    type="color"
                    value={config.backgroundColor}
                    onChange={(e) => patch("backgroundColor", e.target.value)}
                    className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                  />
                </label>
              )}

              {config.backgroundMode === "image" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void pickBackgroundImage()}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--accent)] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      {config.backgroundImageDataUrl
                        ? "Change Wallpaper Photo..."
                        : "Choose Wallpaper Photo..."}
                    </button>
                    {config.backgroundImageDataUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            ...config,
                            backgroundImageDataUrl: null,
                            backgroundMode: "theme",
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <SliderRow
                    label="Photo Darkening"
                    value={config.backgroundDim}
                    min={0}
                    max={0.85}
                    step={0.05}
                    onChange={(v) => patch("backgroundDim", v)}
                  />
                </div>
              )}
            </section>

            {/* Section 2: Circle & Center Artwork */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Center Circle &amp; Picture
              </h3>

              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["tpx", "TPX Logo"],
                    ["music-icon", "Music Icon"],
                    ["custom", "Custom Picture"],
                  ] as [VisualizerCenterSource, string][]
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
                  onClick={() => void pickCenterImage()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--accent)] flex items-center gap-1.5 cursor-pointer"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  Choose Image...
                </button>
              </div>

              {imageError && <div className="text-[11px] text-rose-400">{imageError}</div>}

              <div className="grid grid-cols-2 gap-4 pt-1">
                <SliderRow
                  label="Circle Size"
                  value={config.circleSize}
                  min={100}
                  max={360}
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

            {/* Section 3: Sound Bars */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Sound Bars &amp; Physics
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
                  max={280}
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
                  max={3.2}
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
                  onToggle={() => patch("bidirectionalBars", !config.bidirectionalBars)}
                />
                <ToggleRow
                  label="Rounded Tips"
                  checked={config.roundedCaps}
                  onToggle={() => patch("roundedCaps", !config.roundedCaps)}
                />
              </div>
            </section>

            {/* Section 4: Bar Colors */}
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
                  ] as [VisualizerColorMode, string][]
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

            {/* Section 5: Optional Text Overlay */}
            <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Text Label Overlay
              </h3>

              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["hidden", "Hidden"],
                    ["above", "Above Circle"],
                    ["below", "Below Circle"],
                  ] as [VisualizerTitlePosition, string][]
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

              {config.titlePosition !== "hidden" && (
                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    value={config.customTitle}
                    onChange={(e) => patch("customTitle", e.target.value)}
                    placeholder="Title (e.g. T - VISUALIZER)"
                    className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <input
                    type="text"
                    value={config.customSubtitle}
                    onChange={(e) => patch("customSubtitle", e.target.value)}
                    placeholder="Subtitle (optional)"
                    className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <ToggleRow
                    label="Show Subtitle"
                    checked={config.showSubtitle}
                    onToggle={() => patch("showSubtitle", !config.showSubtitle)}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
