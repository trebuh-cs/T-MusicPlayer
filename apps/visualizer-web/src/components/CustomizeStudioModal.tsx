import { useState } from "react";
import {
  BookmarkPlus,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Mic,
  MicOff,
  Music2,
  Palette,
  Projector,
  Radio,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
  Sun,
  Trash2,
  Tv,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  BUILTIN_PRESETS,
  parseThemePresetFile,
  serializeThemePreset,
} from "@shared/visualizer/presets";
import { downloadTextFile, pickImageAsDataUrl, pickTextFile } from "../services/fileIO";
import { getProjectorUrl } from "../services/stageSync";
import { THEMES } from "../themes";
import {
  DEFAULT_VISUALIZER_CONFIG,
  TITLE_FONT_OPTIONS,
  applyPortableTheme,
  stripHostFields,
  type CircleRingColorMode,
  type HeightmapRenderMode,
  type NowPlayingMedia,
  type ParticleShape,
  type SavedVisualizerTheme,
  type SpotifyConnectionState,
  type SynthwaveDrawStyle,
  type SynthwaveMode,
  type TitleFontWeight,
  type TitleTextAlign,
  type VisualizerBackgroundMode,
  type VisualizerCenterSource,
  type VisualizerColorMode,
  type VisualizerConfig,
  type VisualizerStyleId,
  type VisualizerTitleSource,
  type WebAudioDeviceInfo,
  type WebAudioStatus,
} from "../types";
import { CircularVisualizerCanvas } from "./CircularVisualizerCanvas";
import { NowPlayingOverlay } from "./NowPlayingOverlay";
import { SpotifyConnectCard } from "./SpotifyConnectCard";

type StudioTab = "style" | "bars" | "presets" | "output";

interface CustomizeStudioModalProps {
  config: VisualizerConfig;
  onChange: (next: VisualizerConfig) => void;
  savedThemes: SavedVisualizerTheme[];
  onSaveThemes: (next: SavedVisualizerTheme[]) => void;
  onClose: () => void;
  initialTab?: StudioTab;
  liveFftRef: React.RefObject<Uint8Array>;
  hasAudioSignal: boolean;
  audioStatus: WebAudioStatus;
  devices: WebAudioDeviceInfo[];
  onStartAudio: (deviceId?: string | null) => void;
  onStopAudio: () => void;
  onToggleDemoBeat: () => void;
  onSetInputGain: (gain: number) => void;
  onSetNoiseGate: (gate: number) => void;
  onRefreshDevices: () => void;
  spotify: SpotifyConnectionState;
  nowPlaying: NowPlayingMedia | null;
  onChangeSpotifyClientId: (clientId: string) => void;
  onConnectSpotify: () => void;
  onDisconnectSpotify: () => void;
  onRefreshSpotify: () => void;
  wakeLockSupported: boolean;
  wakeLockEnabled: boolean;
  wakeLockActive: boolean;
  onToggleWakeLock: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  connectedProjectors: number;
  blackout: boolean;
  onOpenBeamer: () => void;
  onCloseBeamer: () => void;
  onToggleBlackout: () => void;
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

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
}: SliderRowProps) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="font-mono-num text-[var(--accent)]">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
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

const STYLE_OPTIONS: [VisualizerStyleId, string, string][] = [
  ["circular", "Circular Ring", "Center artwork + radial bars"],
  ["edge-bars", "Edge Bars", "Top / Bottom / Left / Right bars"],
  ["synthwave", "Synthwave", "Pixel / layered retro waves"],
  ["heightmap", "2.5D Heightmap", "3D audio terrain waterfall"],
  ["spectrum-radar", "Shockwave Radar", "Concentric audio polygons"],
  ["particle-constellation", "Constellation", "Reactive geometric network"],
];

export function CustomizeStudioModal({
  config,
  onChange,
  savedThemes,
  onSaveThemes,
  onClose,
  initialTab = "style",
  liveFftRef,
  hasAudioSignal,
  audioStatus,
  devices,
  onStartAudio,
  onStopAudio,
  onToggleDemoBeat,
  onSetInputGain,
  onSetNoiseGate,
  onRefreshDevices,
  spotify,
  nowPlaying,
  onChangeSpotifyClientId,
  onConnectSpotify,
  onDisconnectSpotify,
  onRefreshSpotify,
  wakeLockSupported,
  wakeLockEnabled,
  wakeLockActive,
  onToggleWakeLock,
  snapEnabled,
  onToggleSnap,
  connectedProjectors,
  blackout,
  onOpenBeamer,
  onCloseBeamer,
  onToggleBlackout,
}: CustomizeStudioModalProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>(initialTab);
  const [simulatePreview, setSimulatePreview] = useState(true);
  const [presetName, setPresetName] = useState("");
  const [copiedProjUrl, setCopiedProjUrl] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const patch = <K extends keyof VisualizerConfig>(key: K, val: VisualizerConfig[K]) => {
    onChange({ ...config, [key]: val });
  };

  const notify = (kind: "ok" | "err", msg: string) => {
    setFeedback({ kind, msg });
  };

  const pickCenterImage = async () => {
    setFeedback(null);
    try {
      const dataUrl = await pickImageAsDataUrl(1024);
      if (!dataUrl) return;
      onChange({ ...config, customImageDataUrl: dataUrl, centerSource: "custom" });
      notify("ok", "Center image loaded (saved inside custom themes)");
    } catch (err) {
      notify("err", String(err));
    }
  };

  const pickBackgroundImage = async () => {
    setFeedback(null);
    try {
      const dataUrl = await pickImageAsDataUrl(1920);
      if (!dataUrl) return;
      onChange({ ...config, backgroundImageDataUrl: dataUrl, backgroundMode: "image" });
      notify("ok", "Background photo loaded");
    } catch (err) {
      notify("err", String(err));
    }
  };

  const handleSavePreset = () => {
    const clean = presetName.trim();
    if (!clean) {
      notify("err", "Please enter a name for your custom theme.");
      return;
    }
    const now = Date.now();
    const existing = savedThemes.find(
      (t) => t.name.toLowerCase() === clean.toLowerCase()
    );
    const portable = stripHostFields(config);
    let nextList: SavedVisualizerTheme[];
    if (existing) {
      nextList = savedThemes.map((t) =>
        t.id === existing.id ? { ...t, name: clean, updatedAt: now, config: portable } : t
      );
      notify("ok", `Updated custom theme "${clean}"`);
    } else {
      const created: SavedVisualizerTheme = {
        id: `custom-${now}-${Math.random().toString(36).slice(2, 7)}`,
        name: clean,
        createdAt: now,
        updatedAt: now,
        config: portable,
      };
      nextList = [created, ...savedThemes];
      notify("ok", `Saved custom theme "${clean}"`);
    }
    onSaveThemes(nextList);
    setPresetName("");
  };

  const handleDeletePreset = (id: string) => {
    onSaveThemes(savedThemes.filter((t) => t.id !== id));
    notify("ok", "Deleted custom theme");
  };

  const handleExportPreset = async (name: string, cfgToExport: VisualizerConfig) => {
    setFeedback(null);
    const safeName = (name.trim() || "my-t-visualizer-theme")
      .replace(/[<>:"/\\|?*]+/g, "-")
      .slice(0, 64);
    try {
      const content = serializeThemePreset(name.trim() || "Custom Theme", cfgToExport);
      downloadTextFile(`${safeName}.tviz`, content);
      notify("ok", `Exported ${safeName}.tviz`);
    } catch (err) {
      notify("err", String(err));
    }
  };

  const handleImportPreset = async () => {
    setFeedback(null);
    try {
      const picked = await pickTextFile(".tviz,.json,application/json");
      if (!picked) return;
      const { name, config: importedCfg } = parseThemePresetFile(picked.text);
      const applied = applyPortableTheme(config, importedCfg);
      onChange(applied);
      const now = Date.now();
      const entry: SavedVisualizerTheme = {
        id: `imported-${now}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        createdAt: now,
        updatedAt: now,
        config: stripHostFields(applied),
      };
      onSaveThemes([entry, ...savedThemes]);
      notify("ok", `Imported & applied theme "${name}"`);
    } catch (err) {
      notify("err", String(err));
    }
  };

  const showEdgeSettings = config.style === "edge-bars" || config.edgeOverlayOnOthers;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80">
      <div className="w-full max-w-6xl h-[94dvh] sm:h-[90dvh] flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Tv className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate">
                T - Visualizer Studio · Live Stage &amp; iPad
              </h2>
              <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] truncate">
                6 Visualizer Styles · Shareable Themes (.tviz) · Live Audio + Spotify Sync
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
                })
              }
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>

            <button
              type="button"
              onClick={onOpenBeamer}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={
                connectedProjectors > 0
                  ? {
                      background: "var(--bg-surface)",
                      color: "var(--accent)",
                      border: "1px solid var(--accent)",
                    }
                  : {
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-subtle)",
                    }
              }
              title="Open dedicated fullscreen Beamer / Stage Projector window"
            >
              <Projector className="w-3.5 h-3.5 text-[var(--accent)]" />
              {connectedProjectors > 0
                ? `Beamer Live (${connectedProjectors})`
                : "Beamer Output"}
            </button>

            <button
              type="button"
              onClick={() => (audioStatus.capturing ? onStopAudio() : onStartAudio(config.selectedDeviceId))}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={
                audioStatus.capturing
                  ? {
                      background: "var(--bg-surface)",
                      color: "var(--accent)",
                      border: "1px solid var(--accent)",
                    }
                  : {
                      background: "var(--accent)",
                      color: "var(--accent-contrast)",
                    }
              }
            >
              {audioStatus.capturing ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Stop Audio</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>Start Audio</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              aria-label="Close Studio"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[1fr_1.08fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-subtle)] overflow-hidden">
          {/* Left/Top: Live Interactive Preview */}
          <div className="flex flex-col min-h-[210px] max-h-[36dvh] lg:max-h-none lg:min-h-0 p-3 sm:p-5 bg-[var(--bg-base)] shrink-0 lg:shrink">
            <div className="flex items-center justify-between mb-2 sm:mb-3 gap-2">
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
                  {audioStatus.capturing
                    ? hasAudioSignal
                      ? "Live Audio"
                      : "Listening..."
                    : audioStatus.demoMode
                    ? "Demo Beat"
                    : "Audio Off"}
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

            <div className="flex-1 min-h-[150px] lg:min-h-[260px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden relative">
              <CircularVisualizerCanvas
                config={config}
                liveFftRef={liveFftRef}
                hasAudioSignal={hasAudioSignal}
                albumArtUrl={nowPlaying?.thumbnail_data_url ?? null}
                previewMode
                simulatePreview={simulatePreview}
              />
              <NowPlayingOverlay
                config={config}
                nowPlaying={nowPlaying}
                previewMode
                snapEnabled={snapEnabled}
                onMovePosition={(x, y) =>
                  onChange({
                    ...config,
                    titlePosition: "custom",
                    titlePosX: x,
                    titlePosY: y,
                  })
                }
              />
            </div>

            {nowPlaying && (nowPlaying.title || nowPlaying.artist) && (
              <div className="hidden sm:flex mt-2.5 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] items-center gap-2.5">
                <Music2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {nowPlaying.title || "Unknown Title"}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">
                    {nowPlaying.artist}
                    {nowPlaying.source_app ? ` · ${nowPlaying.source_app}` : ""}
                  </div>
                </div>
              </div>
            )}

            {feedback && (
              <div
                className={`mt-2 px-3 py-1.5 rounded-lg text-[11px] border ${
                  feedback.kind === "err"
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                    : "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                }`}
              >
                {feedback.msg}
              </div>
            )}
          </div>

          {/* Right/Bottom: Tabbed Studio Controls */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Tabs */}
            <div className="px-3 sm:px-4 pt-2.5 pb-2 border-b border-[var(--border-subtle)] grid grid-cols-4 gap-1.5 bg-[var(--bg-elevated)] shrink-0">
              {(
                [
                  ["style", "Styles", Layers],
                  ["bars", "Circle & Bars", Sliders],
                  ["presets", "Themes", BookmarkPlus],
                  ["output", "Audio & Spotify", Radio],
                ] as [StudioTab, string, typeof Layers][]
              ).map(([tab, label, Icon]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] sm:text-xs font-semibold border transition-colors cursor-pointer ${
                    activeTab === tab
                      ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                      : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* ================= TAB 1: STYLES ================= */}
              {activeTab === "style" && (
                <>
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Visualizer Style
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {STYLE_OPTIONS.map(([id, title, desc]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => patch("style", id)}
                          className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                            config.style === id
                              ? "bg-[var(--accent-soft)] border-[var(--accent)]"
                              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            {title}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-tight">
                            {desc}
                          </div>
                        </button>
                      ))}
                    </div>

                    {config.style !== "edge-bars" && (
                      <ToggleRow
                        label="Add Screen-Edge Bars Overlay"
                        description="Combine top/bottom/side bars on top of the active style"
                        checked={config.edgeOverlayOnOthers}
                        onToggle={() =>
                          patch("edgeOverlayOnOthers", !config.edgeOverlayOnOthers)
                        }
                      />
                    )}
                  </section>

                  {/* Synthwave Controls (All 7 Inspiration Styles!) */}
                  {config.style === "synthwave" && (
                    <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Synthwave Studio
                      </h3>

                      <div className="space-y-1.5">
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          Waveform Draw Style
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {(
                            [
                              ["half-rings", "Half-Rings"],
                              ["ribbon", "Smooth Ribbon"],
                              ["bars", "Vertical Bars"],
                              ["led-blocks", "Pixel LEDs"],
                              ["dots", "Dot Matrix"],
                              ["mountain", "Mountain Peaks"],
                              ["needles", "Needle Lines"],
                            ] as [SynthwaveDrawStyle, string][]
                          ).map(([ds, label]) => (
                            <button
                              key={ds}
                              type="button"
                              onClick={() => patch("synthDrawStyle", ds)}
                              className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                                config.synthDrawStyle === ds
                                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          Symmetry / Layering Mode
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {(
                            [
                              ["single", "Single"],
                              ["double", "Double"],
                              ["overlapping", "Overlapping"],
                              ["mirrored", "Mirrored"],
                            ] as [SynthwaveMode, string][]
                          ).map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => patch("synthMode", mode)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                                config.synthMode === mode
                                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <SliderRow
                          label="Curve Smoothing (Anti-Jitter)"
                          value={config.synthCurveSmoothing}
                          min={0}
                          max={10}
                          step={1}
                          onChange={(v) => patch("synthCurveSmoothing", v)}
                        />
                        <SliderRow
                          label="Amplitude"
                          value={config.synthAmplitude}
                          min={0.3}
                          max={2.5}
                          step={0.05}
                          unit="x"
                          onChange={(v) => patch("synthAmplitude", v)}
                        />
                        {config.synthDrawStyle === "half-rings" && (
                          <SliderRow
                            label="Contour Half-Rings"
                            value={config.synthContourCount}
                            min={2}
                            max={14}
                            step={1}
                            onChange={(v) => patch("synthContourCount", v)}
                          />
                        )}
                        {(config.synthDrawStyle === "bars" ||
                          config.synthDrawStyle === "led-blocks" ||
                          config.synthDrawStyle === "dots" ||
                          config.synthDrawStyle === "needles" ||
                          config.synthDrawStyle === "mountain") && (
                          <SliderRow
                            label="Bar / Column Count"
                            value={config.synthBarCount}
                            min={16}
                            max={140}
                            step={2}
                            onChange={(v) => patch("synthBarCount", v)}
                          />
                        )}
                        {(config.synthDrawStyle === "bars" ||
                          config.synthDrawStyle === "led-blocks") && (
                          <>
                            <SliderRow
                              label="Bar Gap"
                              value={config.synthBarGap}
                              min={0}
                              max={14}
                              step={1}
                              unit="px"
                              onChange={(v) => patch("synthBarGap", v)}
                            />
                            <SliderRow
                              label="Bar Rounding"
                              value={config.synthBarRadius}
                              min={0}
                              max={18}
                              step={1}
                              unit="px"
                              onChange={(v) => patch("synthBarRadius", v)}
                            />
                          </>
                        )}
                        {(config.synthDrawStyle === "led-blocks" ||
                          config.synthDrawStyle === "dots" ||
                          config.synthPixelated) && (
                          <SliderRow
                            label="Pixel / Dot Size"
                            value={config.synthPixelSize}
                            min={3}
                            max={24}
                            step={1}
                            unit="px"
                            onChange={(v) => patch("synthPixelSize", v)}
                          />
                        )}
                        {(config.synthMode === "overlapping" ||
                          config.synthMode === "mirrored") &&
                          (config.synthDrawStyle === "ribbon" ||
                            config.synthDrawStyle === "mountain") && (
                            <SliderRow
                              label="Wave Layers"
                              value={config.synthLayerCount}
                              min={1}
                              max={6}
                              step={1}
                              onChange={(v) => patch("synthLayerCount", v)}
                            />
                          )}
                        <SliderRow
                          label="Line Thickness"
                          value={config.synthLineWidth}
                          min={1}
                          max={12}
                          step={0.5}
                          unit="px"
                          onChange={(v) => patch("synthLineWidth", v)}
                        />
                        {(config.synthDrawStyle === "ribbon" ||
                          config.synthDrawStyle === "half-rings") && (
                          <>
                            <SliderRow
                              label="Wave Frequency / Lobes"
                              value={config.synthFrequencyScale}
                              min={0.6}
                              max={3.5}
                              step={0.1}
                              unit="x"
                              onChange={(v) => patch("synthFrequencyScale", v)}
                            />
                            <SliderRow
                              label="Wave Flow Speed"
                              value={config.synthWaveSpeed}
                              min={0}
                              max={3.0}
                              step={0.05}
                              unit="x"
                              onChange={(v) => patch("synthWaveSpeed", v)}
                            />
                          </>
                        )}
                        <SliderRow
                          label="Vertical Offset"
                          value={config.synthVerticalOffset}
                          min={-35}
                          max={35}
                          step={1}
                          unit="%"
                          onChange={(v) => patch("synthVerticalOffset", v)}
                        />
                        {config.synthFilled && (
                          <SliderRow
                            label="Fill Opacity"
                            value={config.synthFillOpacity}
                            min={0.05}
                            max={0.85}
                            step={0.02}
                            onChange={(v) => patch("synthFillOpacity", v)}
                          />
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {config.synthDrawStyle === "ribbon" && (
                          <ToggleRow
                            label="Pixelated Ribbon"
                            description="Stepped retro block curve"
                            checked={config.synthPixelated}
                            onToggle={() => patch("synthPixelated", !config.synthPixelated)}
                          />
                        )}
                        {(config.synthDrawStyle === "ribbon" ||
                          config.synthDrawStyle === "half-rings" ||
                          config.synthDrawStyle === "mountain") && (
                          <ToggleRow
                            label="Area Fill"
                            checked={config.synthFilled}
                            onToggle={() => patch("synthFilled", !config.synthFilled)}
                          />
                        )}
                        <ToggleRow
                          label="Horizon Floor Grid"
                          description="Retro 3D perspective floor"
                          checked={config.synthHorizonGrid}
                          onToggle={() => patch("synthHorizonGrid", !config.synthHorizonGrid)}
                        />
                        <ToggleRow
                          label="Center Baseline"
                          checked={config.synthShowBaseline}
                          onToggle={() =>
                            patch("synthShowBaseline", !config.synthShowBaseline)
                          }
                        />
                      </div>
                    </section>
                  )}

                  {/* 2.5D Heightmap Controls (Optimized + 3D Pillars!) */}
                  {config.style === "heightmap" && (
                    <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        2.5D Audio Heightmap &amp; 3D Pillars
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                        {(
                          [
                            ["bars-3d", "3D Pillars"],
                            ["ridges", "Ridges"],
                            ["wireframe", "Wireframe"],
                            ["filled-mesh", "Terrain"],
                            ["dots", "3D Matrix"],
                          ] as [HeightmapRenderMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => patch("hmRenderMode", mode)}
                            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                              config.hmRenderMode === mode
                                ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <SliderRow
                          label="Depth Rows"
                          value={config.hmRows}
                          min={8}
                          max={48}
                          step={2}
                          onChange={(v) => patch("hmRows", v)}
                        />
                        <SliderRow
                          label="Frequency Columns"
                          value={config.hmCols}
                          min={12}
                          max={80}
                          step={2}
                          onChange={(v) => patch("hmCols", v)}
                        />
                        <SliderRow
                          label="Peak Elevation"
                          value={config.hmElevation}
                          min={0.4}
                          max={2.5}
                          step={0.05}
                          unit="x"
                          onChange={(v) => patch("hmElevation", v)}
                        />
                        <SliderRow
                          label="Camera Tilt"
                          value={config.hmTilt}
                          min={20}
                          max={75}
                          step={1}
                          unit="°"
                          onChange={(v) => patch("hmTilt", v)}
                        />
                        <SliderRow
                          label="Perspective Depth"
                          value={config.hmPerspective}
                          min={0.15}
                          max={1.2}
                          step={0.05}
                          onChange={(v) => patch("hmPerspective", v)}
                        />
                        <SliderRow
                          label="Scroll Speed"
                          value={config.hmScrollSpeed}
                          min={0.3}
                          max={3.0}
                          step={0.05}
                          unit="x"
                          onChange={(v) => patch("hmScrollSpeed", v)}
                        />
                        {config.hmRenderMode === "bars-3d" && (
                          <SliderRow
                            label="3D Pillar Width"
                            value={config.hmBarWidthRatio}
                            min={0.25}
                            max={0.95}
                            step={0.05}
                            onChange={(v) => patch("hmBarWidthRatio", v)}
                          />
                        )}
                        <SliderRow
                          label="Curve Smoothing"
                          value={config.hmCurveSmoothing}
                          min={0}
                          max={6}
                          step={1}
                          onChange={(v) => patch("hmCurveSmoothing", v)}
                        />
                        <SliderRow
                          label="Vertical Offset"
                          value={config.hmVerticalOffset}
                          min={-25}
                          max={25}
                          step={1}
                          unit="%"
                          onChange={(v) => patch("hmVerticalOffset", v)}
                        />
                        <SliderRow
                          label="Line / Dot Size"
                          value={config.hmLineWidth}
                          min={1}
                          max={4.5}
                          step={0.2}
                          unit="px"
                          onChange={(v) => patch("hmLineWidth", v)}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <ToggleRow
                          label="Symmetric Peaks"
                          checked={config.hmMirrored}
                          onToggle={() => patch("hmMirrored", !config.hmMirrored)}
                        />
                        {(config.hmRenderMode === "bars-3d" ||
                          config.hmRenderMode === "dots") && (
                          <ToggleRow
                            label="Wireframe Floor Grid"
                            description="Perspective base plane"
                            checked={config.hmShowBaseGrid}
                            onToggle={() =>
                              patch("hmShowBaseGrid", !config.hmShowBaseGrid)
                            }
                          />
                        )}
                      </div>
                    </section>
                  )}

                  {/* Shockwave Radar Controls */}
                  {config.style === "spectrum-radar" && (
                    <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Concentric Shockwave Radar
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <SliderRow
                          label="Ring Count"
                          value={config.radarRingCount}
                          min={2}
                          max={10}
                          step={1}
                          onChange={(v) => patch("radarRingCount", v)}
                        />
                        <SliderRow
                          label="Polygon Sides (0 = Smooth)"
                          value={config.radarPolygonSides}
                          min={0}
                          max={12}
                          step={1}
                          onChange={(v) => patch("radarPolygonSides", v)}
                        />
                        <SliderRow
                          label="Ring Line Width"
                          value={config.radarLineWidth}
                          min={1.5}
                          max={10}
                          step={0.5}
                          unit="px"
                          onChange={(v) => patch("radarLineWidth", v)}
                        />
                        <SliderRow
                          label="Ring Spread"
                          value={config.radarSpread}
                          min={0.5}
                          max={1.6}
                          step={0.05}
                          unit="x"
                          onChange={(v) => patch("radarSpread", v)}
                        />
                        <SliderRow
                          label="Fill Opacity"
                          value={config.radarFillOpacity}
                          min={0}
                          max={0.45}
                          step={0.02}
                          onChange={(v) => patch("radarFillOpacity", v)}
                        />
                      </div>
                      <ToggleRow
                        label="Show Center Emblem"
                        description="Display Center Circle / Logo inside rings"
                        checked={config.showCenterInOtherStyles}
                        onToggle={() =>
                          patch("showCenterInOtherStyles", !config.showCenterInOtherStyles)
                        }
                      />
                    </section>
                  )}

                  {/* Particle Constellation Controls */}
                  {config.style === "particle-constellation" && (
                    <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Geometric Constellation
                      </h3>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            ["circle", "Circles"],
                            ["square", "Squares"],
                            ["diamond", "Diamonds"],
                          ] as [ParticleShape, string][]
                        ).map(([shape, label]) => (
                          <button
                            key={shape}
                            type="button"
                            onClick={() => patch("partShape", shape)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                              config.partShape === shape
                                ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <SliderRow
                          label="Node Count"
                          value={config.partCount}
                          min={24}
                          max={180}
                          step={4}
                          onChange={(v) => patch("partCount", v)}
                        />
                        <SliderRow
                          label="Node Size"
                          value={config.partSize}
                          min={2}
                          max={12}
                          step={0.5}
                          unit="px"
                          onChange={(v) => patch("partSize", v)}
                        />
                        <SliderRow
                          label="Drift Speed"
                          value={config.partSpeed}
                          min={0.2}
                          max={3.0}
                          step={0.1}
                          unit="x"
                          onChange={(v) => patch("partSpeed", v)}
                        />
                        <SliderRow
                          label="Link Distance"
                          value={config.partLinkDistance}
                          min={40}
                          max={260}
                          step={5}
                          unit="px"
                          onChange={(v) => patch("partLinkDistance", v)}
                        />
                        <SliderRow
                          label="Bass Kick Reaction"
                          value={config.partBassKick}
                          min={0.2}
                          max={2.5}
                          step={0.05}
                          unit="x"
                          onChange={(v) => patch("partBassKick", v)}
                        />
                      </div>
                      <ToggleRow
                        label="Show Center Emblem"
                        description="Display Center Circle / Logo on top of constellation"
                        checked={config.showCenterInOtherStyles}
                        onToggle={() =>
                          patch("showCenterInOtherStyles", !config.showCenterInOtherStyles)
                        }
                      />
                    </section>
                  )}

                  {/* Screen Edge Bars Controls */}
                  {showEdgeSettings && (
                    <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        Screen-Edge Bars (Top / Bottom / Left / Right)
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <ToggleRow
                          label="Top"
                          checked={config.edgeTop}
                          onToggle={() => patch("edgeTop", !config.edgeTop)}
                        />
                        <ToggleRow
                          label="Bottom"
                          checked={config.edgeBottom}
                          onToggle={() => patch("edgeBottom", !config.edgeBottom)}
                        />
                        <ToggleRow
                          label="Left"
                          checked={config.edgeLeft}
                          onToggle={() => patch("edgeLeft", !config.edgeLeft)}
                        />
                        <ToggleRow
                          label="Right"
                          checked={config.edgeRight}
                          onToggle={() => patch("edgeRight", !config.edgeRight)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <SliderRow
                          label="Bars per Edge"
                          value={config.edgeBarCount}
                          min={16}
                          max={140}
                          step={2}
                          onChange={(v) => patch("edgeBarCount", v)}
                        />
                        <SliderRow
                          label="Max Bar Height"
                          value={config.edgeBarMaxHeight}
                          min={30}
                          max={320}
                          step={4}
                          unit="px"
                          onChange={(v) => patch("edgeBarMaxHeight", v)}
                        />
                        <SliderRow
                          label="Bar Gap"
                          value={config.edgeBarGap}
                          min={0}
                          max={16}
                          step={1}
                          unit="px"
                          onChange={(v) => patch("edgeBarGap", v)}
                        />
                        <SliderRow
                          label="Corner Rounding"
                          value={config.edgeCornerRadius}
                          min={0}
                          max={24}
                          step={1}
                          unit="px"
                          onChange={(v) => patch("edgeCornerRadius", v)}
                        />
                        <SliderRow
                          label="Edge Margin"
                          value={config.edgePadding}
                          min={0}
                          max={40}
                          step={2}
                          unit="px"
                          onChange={(v) => patch("edgePadding", v)}
                        />
                        <SliderRow
                          label="Edge Opacity"
                          value={config.edgeOpacity}
                          min={0.2}
                          max={1.0}
                          step={0.05}
                          onChange={(v) => patch("edgeOpacity", v)}
                        />
                      </div>
                      <ToggleRow
                        label="Mirrored Edge Spectrum"
                        description="Symmetric bars from edges toward center"
                        checked={config.edgeMirrored}
                        onToggle={() => patch("edgeMirrored", !config.edgeMirrored)}
                      />
                    </section>
                  )}
                </>
              )}

              {/* ================= TAB 2: CIRCLE, RING & BARS ================= */}
              {activeTab === "bars" && (
                <>
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Center Circle, Dynamic Scaling &amp; Ring
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {(
                        [
                          ["tpx", "TPX Logo"],
                          ["album-art", "Spotify / Media Cover"],
                          ["music-icon", "Music Icon"],
                          ["custom", "Custom Picture"],
                        ] as [VisualizerCenterSource, string][]
                      ).map(([src, label]) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => patch("centerSource", src)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border text-left cursor-pointer ${
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
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--accent)] flex items-center gap-1.5 cursor-pointer"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        Choose Image...
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1">
                      <SliderRow
                        label="Circle Size"
                        value={config.circleSize}
                        min={60}
                        max={640}
                        step={4}
                        unit="px"
                        onChange={(v) => patch("circleSize", v)}
                      />
                      <SliderRow
                        label="Gap to Bars"
                        value={config.barGapFromCircle}
                        min={0}
                        max={90}
                        step={1}
                        unit="px"
                        onChange={(v) => patch("barGapFromCircle", v)}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <ToggleRow
                        label="Dynamic Screen Scaling"
                        description="Keep same visual proportion on 1080p, 1600p & 4K screens"
                        checked={config.scaleWithScreen}
                        onToggle={() => patch("scaleWithScreen", !config.scaleWithScreen)}
                      />
                      <ToggleRow
                        label="Bass Pulse"
                        description="Subtle kick bounce on bass"
                        checked={config.bassPulse}
                        onToggle={() => patch("bassPulse", !config.bassPulse)}
                      />
                    </div>

                    {/* Ring Customization */}
                    <div className="p-3 rounded-xl bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] space-y-3">
                      <ToggleRow
                        label="Show Circle Ring"
                        description="Crisp ring directly around the center picture"
                        checked={config.showCircleRing}
                        onToggle={() => patch("showCircleRing", !config.showCircleRing)}
                      />

                      {config.showCircleRing && (
                        <>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(
                              [
                                ["match-bars", "Match Bar Base"],
                                ["theme-accent", "Theme Accent"],
                                ["custom", "Custom Color"],
                              ] as [CircleRingColorMode, string][]
                            ).map(([mode, label]) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => patch("circleRingColorMode", mode)}
                                className={`px-2 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                                  config.circleRingColorMode === mode
                                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-2 gap-3 items-center">
                            <SliderRow
                              label="Ring Width"
                              value={config.circleRingWidth}
                              min={1}
                              max={14}
                              step={0.5}
                              unit="px"
                              onChange={(v) => patch("circleRingWidth", v)}
                            />
                            {config.circleRingColorMode === "custom" && (
                              <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs cursor-pointer">
                                <span className="text-[var(--text-secondary)]">Ring Color</span>
                                <input
                                  type="color"
                                  value={config.circleRingColor}
                                  onChange={(e) => patch("circleRingColor", e.target.value)}
                                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                                />
                              </label>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </section>

                  {/* Sound Bars & Physics */}
                  <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Sound Bars &amp; Audio Physics
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <SliderRow
                        label="Bar Count"
                        value={config.barCount}
                        min={16}
                        max={180}
                        step={4}
                        onChange={(v) => patch("barCount", v)}
                      />
                      <SliderRow
                        label="Max Bar Height"
                        value={config.barMaxHeight}
                        min={30}
                        max={360}
                        step={4}
                        unit="px"
                        onChange={(v) => patch("barMaxHeight", v)}
                      />
                      <SliderRow
                        label="Bar Thickness"
                        value={config.barThickness}
                        min={2}
                        max={18}
                        step={0.5}
                        unit="px"
                        onChange={(v) => patch("barThickness", v)}
                      />
                      <SliderRow
                        label="Sensitivity"
                        value={config.barSensitivity}
                        min={0.4}
                        max={3.5}
                        step={0.05}
                        unit="x"
                        onChange={(v) => patch("barSensitivity", v)}
                      />
                      <SliderRow
                        label="Smoothing"
                        value={config.barSmoothing}
                        min={0}
                        max={0.94}
                        step={0.02}
                        onChange={(v) => patch("barSmoothing", v)}
                      />
                      <SliderRow
                        label="Rotation Speed"
                        value={config.rotationSpeed}
                        min={-2.5}
                        max={2.5}
                        step={0.05}
                        onChange={(v) => patch("rotationSpeed", v)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <ToggleRow
                        label="Mirrored Ring"
                        checked={config.mirrored}
                        onToggle={() => patch("mirrored", !config.mirrored)}
                      />
                      <ToggleRow
                        label="Bidirectional Bars"
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
                      <ToggleRow
                        label="No Music, No Spinning"
                        description="Pause circle rotation when audio is silent"
                        checked={config.stopSpinOnSilence}
                        onToggle={() =>
                          patch("stopSpinOnSilence", !config.stopSpinOnSilence)
                        }
                      />
                    </div>
                  </section>

                  {/* Color Mode */}
                  <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Visualizer Color Mode
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
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                            config.colorMode === mode
                              ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
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
                            {config.colorMode === "solid" ? "Color" : "Low"}
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
                </>
              )}

              {/* ================= TAB 3: CUSTOM THEMES (.tviz) ================= */}
              {activeTab === "presets" && (
                <>
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Save &amp; Share Custom Theme (.tviz)
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Saves every setting — style, custom center icon, wallpaper photo, ring colors,
                      bar physics, synthwave/heightmap settings, and title layout — into one shareable file.
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSavePreset();
                        }}
                        placeholder="Theme name (e.g. My Neon Synthwave)..."
                        className="flex-1 px-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={handleSavePreset}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer shrink-0"
                        style={{
                          background: "var(--accent)",
                          color: "var(--accent-contrast)",
                        }}
                      >
                        <BookmarkPlus className="w-3.5 h-3.5" />
                        Save Theme
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleExportPreset(presetName || "Custom Theme", config)
                        }
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[var(--accent)]" />
                        Export Current as .tviz
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleImportPreset()}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-[var(--accent)]" />
                        Import .tviz Theme...
                      </button>
                    </div>
                  </section>

                  {/* My Saved Custom Themes */}
                  <section className="space-y-2.5 pt-4 border-t border-[var(--border-subtle)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      My Saved Themes ({savedThemes.length})
                    </h3>
                    {savedThemes.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)] text-center">
                        No custom themes saved yet. Customize anything and click &quot;Save Theme&quot; above!
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {savedThemes.map((preset) => (
                          <div
                            key={preset.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onChange(applyPortableTheme(config, preset.config));
                                notify("ok", `Applied "${preset.name}"`);
                              }}
                              className="min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                {preset.name}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)]">
                                Style: {preset.config.style ?? "circular"} · Base:{" "}
                                {preset.config.themeId ?? "tpx"}
                              </div>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleExportPreset(
                                    preset.name,
                                    applyPortableTheme(config, preset.config)
                                  )
                                }
                                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer"
                                title="Export .tviz file"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePreset(preset.id)}
                                className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[var(--text-muted)] hover:text-rose-400 cursor-pointer"
                                title="Delete theme"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Built-in Showcase Presets */}
                  <section className="space-y-2.5 pt-4 border-t border-[var(--border-subtle)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Built-In Showcase Presets
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {BUILTIN_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            onChange(applyPortableTheme(config, preset.config));
                            notify("ok", `Loaded preset "${preset.name}"`);
                          }}
                          className="p-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-left cursor-pointer"
                        >
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            {preset.name}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                            {preset.config.style}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* ================= TAB 4: AUDIO, SPOTIFY, DISPLAY & TEXT ================= */}
              {activeTab === "output" && (
                <>
                  {/* Live Audio Input (USB-C Mixer / Interface / iPad Mic) */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                        Live Audio Input (USB-C Mixer / Mic)
                      </h3>
                      <button
                        type="button"
                        onClick={onRefreshDevices}
                        className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Refresh
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            audioStatus.capturing
                              ? onStopAudio()
                              : onStartAudio(config.selectedDeviceId)
                          }
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                          style={
                            audioStatus.capturing
                              ? {
                                  background: "var(--bg-surface)",
                                  color: "var(--accent)",
                                  border: "1px solid var(--accent)",
                                }
                              : {
                                  background: "var(--accent)",
                                  color: "var(--accent-contrast)",
                                }
                          }
                        >
                          {audioStatus.capturing ? (
                            <>
                              <MicOff className="w-3.5 h-3.5" />
                              Stop Audio Input
                            </>
                          ) : (
                            <>
                              <Mic className="w-3.5 h-3.5" />
                              Start Live Audio Input
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={onToggleDemoBeat}
                          className={`px-3 py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                            audioStatus.demoMode
                              ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {audioStatus.demoMode ? "Demo Beat On" : "Demo Beat"}
                        </button>
                      </div>

                      {audioStatus.error && (
                        <div className="px-2.5 py-2 rounded-lg text-[11px] bg-rose-500/15 border border-rose-500/35 text-rose-300">
                          {audioStatus.error}
                        </div>
                      )}

                      <label className="block space-y-1">
                        <span className="text-[11px] text-[var(--text-secondary)]">
                          Audio Input Device (USB-C Interface, Line-In, iPad Mic)
                        </span>
                        <select
                          value={config.selectedDeviceId ?? ""}
                          onChange={(e) => {
                            const val = e.target.value || null;
                            patch("selectedDeviceId", val);
                            if (audioStatus.capturing) {
                              onStartAudio(val);
                            }
                          }}
                          className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        >
                          <option value="">System Default Audio Input</option>
                          {devices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} {d.isDefault ? "(Default)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>

                      {/* Live Signal Level Meter */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--text-secondary)]">Input Signal Level</span>
                          <span className="font-mono-num text-[var(--accent)]">
                            {Math.round((audioStatus.peakLevel / 255) * 100)}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[var(--bg-base)] border border-[var(--border-subtle)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width] duration-75"
                            style={{
                              width: `${Math.min(100, Math.round((audioStatus.peakLevel / 255) * 100))}%`,
                              backgroundColor: "var(--accent)",
                            }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <SliderRow
                          label="Input Gain Boost"
                          value={audioStatus.inputGain}
                          min={0.2}
                          max={4.0}
                          step={0.05}
                          unit="x"
                          onChange={onSetInputGain}
                        />
                        <SliderRow
                          label="Noise Gate (Floor)"
                          value={audioStatus.noiseGate}
                          min={0}
                          max={48}
                          step={1}
                          onChange={onSetNoiseGate}
                        />
                      </div>

                      {wakeLockSupported && (
                        <ToggleRow
                          label="Keep iPad Screen Awake (Wake Lock)"
                          description={
                            wakeLockActive
                              ? "Screen Wake Lock active — display won't dim or lock mid-set"
                              : "Prevents iPad / tablet from auto-sleeping during festival sets"
                          }
                          checked={wakeLockEnabled}
                          onToggle={onToggleWakeLock}
                        />
                      )}
                    </div>
                  </section>

                  {/* Beamer / Stage Projector Mode */}
                  <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <Projector className="w-3.5 h-3.5 text-[var(--accent)]" />
                        Beamer / Presenter Mode (Stage Output)
                      </h3>
                      <span className="text-[10px] font-semibold text-[var(--accent)]">
                        {connectedProjectors > 0
                          ? `LIVE (${connectedProjectors} connected)`
                          : "Standby"}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2.5">
                      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                        Opens a clean, zero-HUD fullscreen Beamer output synced live (60fps audio,
                        theme edits &amp; Spotify track) while you adjust settings or control
                        Spotify on your iPad / laptop screen. Works on Desktop multi-screen &amp;
                        iPad External Display (Stage Manager, M1+).
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={onOpenBeamer}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                          style={{
                            background: "var(--accent)",
                            color: "var(--accent-contrast)",
                          }}
                        >
                          <Projector className="w-3.5 h-3.5" />
                          {connectedProjectors > 0
                            ? "Open Another Beamer Window"
                            : "Open Fullscreen Beamer Window"}
                        </button>

                        {connectedProjectors > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={onToggleBlackout}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                                blackout
                                  ? "bg-rose-500/20 border-rose-500/50 text-rose-300"
                                  : "bg-[var(--bg-base)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                              }`}
                            >
                              {blackout ? (
                                <>
                                  <EyeOff className="w-3.5 h-3.5" />
                                  Blackout ON
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3.5 h-3.5" />
                                  Blackout
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={onCloseBeamer}
                              className="px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-base)] hover:bg-rose-500/20 border border-[var(--border-subtle)] text-rose-400 cursor-pointer"
                            >
                              Close
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 px-2 py-1.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[10px] font-mono-num text-[var(--text-secondary)] truncate select-all">
                          {getProjectorUrl()}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(getProjectorUrl()).then(() => {
                              setCopiedProjUrl(true);
                              window.setTimeout(() => setCopiedProjUrl(false), 2000);
                            });
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[var(--bg-base)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[10px] font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                        >
                          {copiedProjUrl ? (
                            <>
                              <Check className="w-3 h-3 text-[var(--accent)]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy URL
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Spotify Live Song Recognition */}
                  <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                      <Sun className="w-3.5 h-3.5 text-[var(--accent)]" />
                      Spotify Song Recognition
                    </h3>
                    <SpotifyConnectCard
                      spotify={spotify}
                      nowPlaying={nowPlaying}
                      onChangeClientId={onChangeSpotifyClientId}
                      onConnect={onConnectSpotify}
                      onDisconnect={onDisconnectSpotify}
                      onRefreshNowPlaying={onRefreshSpotify}
                    />
                  </section>

                  {/* Base Theme & Wallpaper Background */}
                  <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-[var(--accent)]" />
                      Base Color Theme &amp; Background
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => patch("themeId", t.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border text-left cursor-pointer ${
                            config.themeId === t.id
                              ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
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
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                            config.backgroundMode === mode
                              ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
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

                  {/* Now Playing / Song Text Overlay */}
                  <section className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <Music2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                        Now Playing &amp; Free-Drag Textbox
                      </h3>
                      <button
                        type="button"
                        onClick={onToggleSnap}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer ${
                          snapEnabled
                            ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                            : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {snapEnabled ? "Snap: ON" : "Snap: OFF (Free)"}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ["auto-media", "Spotify Live Auto-Detect"],
                          ["custom", "Custom Text Label"],
                        ] as [VisualizerTitleSource, string][]
                      ).map(([src, label]) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => patch("titleSource", src)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                            config.titleSource === src
                              ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Quick Position Snap Buttons */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                      <button
                        type="button"
                        onClick={() => patch("titlePosition", "hidden")}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                          config.titlePosition === "hidden"
                            ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                            : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                        }`}
                      >
                        Hidden
                      </button>
                      {(
                        [
                          ["Top", 50, 8, "center"],
                          ["Center", 50, 50, "center"],
                          ["Bottom", 50, 92, "center"],
                          ["Bot Left", 4, 92, "left"],
                          ["Bot Right", 96, 92, "right"],
                        ] as [string, number, number, TitleTextAlign][]
                      ).map(([label, x, y, align]) => {
                        const isActive =
                          config.titlePosition !== "hidden" &&
                          Math.abs((config.titlePosX ?? 50) - x) < 1.5 &&
                          Math.abs((config.titlePosY ?? 90) - y) < 1.5;
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() =>
                              onChange({
                                ...config,
                                titlePosition: "custom",
                                titlePosX: x,
                                titlePosY: y,
                                titleAlign: align,
                              })
                            }
                            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                              isActive
                                ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {config.titlePosition !== "hidden" && (
                      <div className="space-y-3">
                        {/* Font Family Selector */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            Font Family
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {TITLE_FONT_OPTIONS.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => patch("titleFontFamily", f.id)}
                                style={{ fontFamily: f.cssFamily }}
                                className={`px-2 py-1.5 rounded-lg text-[11px] border truncate cursor-pointer ${
                                  config.titleFontFamily === f.id
                                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                                }`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Weight & Alignment */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="grid grid-cols-4 gap-1">
                            {(
                              [
                                ["normal", "Reg"],
                                ["semibold", "Semi"],
                                ["bold", "Bold"],
                                ["black", "Heavy"],
                              ] as [TitleFontWeight, string][]
                            ).map(([w, lbl]) => (
                              <button
                                key={w}
                                type="button"
                                onClick={() => patch("titleFontWeight", w)}
                                className={`px-1.5 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                                  config.titleFontWeight === w
                                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                                }`}
                              >
                                {lbl}
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-3 gap-1">
                            {(
                              [
                                ["left", "Left"],
                                ["center", "Center"],
                                ["right", "Right"],
                              ] as [TitleTextAlign, string][]
                            ).map(([a, lbl]) => (
                              <button
                                key={a}
                                type="button"
                                onClick={() => patch("titleAlign", a)}
                                className={`px-1.5 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                                  config.titleAlign === a
                                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                                }`}
                              >
                                {lbl}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Text Color */}
                        <div className="grid grid-cols-2 gap-2 items-center">
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => patch("titleTextColorMode", "theme")}
                              className={`px-2 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                                config.titleTextColorMode === "theme"
                                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                              }`}
                            >
                              Theme Text
                            </button>
                            <button
                              type="button"
                              onClick={() => patch("titleTextColorMode", "custom")}
                              className={`px-2 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                                config.titleTextColorMode === "custom"
                                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                              }`}
                            >
                              Custom Color
                            </button>
                          </div>
                          {config.titleTextColorMode === "custom" && (
                            <label className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs cursor-pointer">
                              <span className="text-[var(--text-secondary)]">Text Color</span>
                              <input
                                type="color"
                                value={config.titleCustomColor}
                                onChange={(e) => patch("titleCustomColor", e.target.value)}
                                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                              />
                            </label>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <ToggleRow
                            label="Show Background Box"
                            description="Off = pure floating text only"
                            checked={config.titleShowBox}
                            onToggle={() => patch("titleShowBox", !config.titleShowBox)}
                          />
                          <ToggleRow
                            label="UPPERCASE Title"
                            checked={config.titleUppercase}
                            onToggle={() => patch("titleUppercase", !config.titleUppercase)}
                          />
                          <ToggleRow
                            label="Show Artist"
                            checked={config.showSubtitle}
                            onToggle={() => patch("showSubtitle", !config.showSubtitle)}
                          />
                          <ToggleRow
                            label="Show Source (Spotify)"
                            checked={config.showMediaSourceBadge}
                            onToggle={() =>
                              patch("showMediaSourceBadge", !config.showMediaSourceBadge)
                            }
                          />
                          <ToggleRow
                            label="Slim Single-Line Pill"
                            description="Thin compact 1-row bar"
                            checked={config.titleCompact}
                            onToggle={() => patch("titleCompact", !config.titleCompact)}
                          />
                          <ToggleRow
                            label="Unlimited Box Width"
                            description="Never restrict or clip text box length"
                            checked={config.titleUnlimitedWidth}
                            onToggle={() =>
                              patch("titleUnlimitedWidth", !config.titleUnlimitedWidth)
                            }
                          />
                          {!config.titleUnlimitedWidth && (
                            <ToggleRow
                              label="Scroll Loop (Marquee)"
                              description="Loop text when wider than Max Width"
                              checked={config.titleMarquee}
                              onToggle={() => patch("titleMarquee", !config.titleMarquee)}
                            />
                          )}
                          {config.titleShowBox && (
                            <ToggleRow
                              label="Show Box Border"
                              checked={config.titleShowBorder}
                              onToggle={() =>
                                patch("titleShowBorder", !config.titleShowBorder)
                              }
                            />
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <SliderRow
                            label="Position X"
                            value={config.titlePosX}
                            min={0}
                            max={100}
                            step={1}
                            unit="%"
                            onChange={(v) =>
                              onChange({ ...config, titlePosition: "custom", titlePosX: v })
                            }
                          />
                          <SliderRow
                            label="Position Y"
                            value={config.titlePosY}
                            min={0}
                            max={100}
                            step={1}
                            unit="%"
                            onChange={(v) =>
                              onChange({ ...config, titlePosition: "custom", titlePosY: v })
                            }
                          />
                          <SliderRow
                            label="Text Size"
                            value={config.titleScale}
                            min={0.6}
                            max={2.4}
                            step={0.05}
                            unit="x"
                            onChange={(v) => patch("titleScale", v)}
                          />
                          <SliderRow
                            label="Letter Spacing"
                            value={config.titleLetterSpacing}
                            min={-1}
                            max={8}
                            step={0.5}
                            unit="px"
                            onChange={(v) => patch("titleLetterSpacing", v)}
                          />
                          {!config.titleUnlimitedWidth && (
                            <SliderRow
                              label="Max Box Width"
                              value={config.titleMaxWidth}
                              min={140}
                              max={3600}
                              step={20}
                              unit="px"
                              onChange={(v) => patch("titleMaxWidth", v)}
                            />
                          )}
                          {!config.titleUnlimitedWidth && config.titleMarquee && (
                            <SliderRow
                              label="Scroll Loop Speed"
                              value={config.titleMarqueeSpeed}
                              min={20}
                              max={140}
                              step={5}
                              unit="px/s"
                              onChange={(v) => patch("titleMarqueeSpeed", v)}
                            />
                          )}
                          {config.titleShowBox && (
                            <>
                              <SliderRow
                                label="Box Thickness (Pad Y)"
                                value={config.titlePaddingY}
                                min={2}
                                max={18}
                                step={1}
                                unit="px"
                                onChange={(v) => patch("titlePaddingY", v)}
                              />
                              <SliderRow
                                label="Side Padding (Pad X)"
                                value={config.titlePaddingX}
                                min={6}
                                max={36}
                                step={2}
                                unit="px"
                                onChange={(v) => patch("titlePaddingX", v)}
                              />
                              <SliderRow
                                label="Box Background Opacity"
                                value={config.titleBoxOpacity}
                                min={0}
                                max={1.0}
                                step={0.05}
                                onChange={(v) => patch("titleBoxOpacity", v)}
                              />
                            </>
                          )}
                        </div>

                        {config.titleSource === "custom" && (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={config.customTitle}
                              onChange={(e) => patch("customTitle", e.target.value)}
                              placeholder="Custom Title..."
                              className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                            />
                            <input
                              type="text"
                              value={config.customSubtitle}
                              onChange={(e) => patch("customSubtitle", e.target.value)}
                              placeholder="Custom Subtitle..."
                              className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
