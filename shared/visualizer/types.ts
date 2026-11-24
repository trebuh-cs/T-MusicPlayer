export type VisualizerStyleId =
  | "circular"
  | "edge-bars"
  | "synthwave"
  | "heightmap"
  | "spectrum-radar"
  | "particle-constellation";

export type VisualizerColorMode =
  | "theme"
  | "solid"
  | "height-dynamic"
  | "radial-fade"
  | "rainbow";

export type VisualizerTitlePosition =
  | "hidden"
  | "above"
  | "below"
  | "bottom-center"
  | "bottom-left";

export type VisualizerTitleSource = "auto-media" | "custom";

export type VisualizerCenterSource =
  | "auto"
  | "tpx"
  | "album-art"
  | "music-icon"
  | "custom";

export type VisualizerBackgroundMode = "theme" | "solid" | "image";

export type CircleRingColorMode = "match-bars" | "theme-accent" | "custom";

export type SynthwaveMode = "single" | "double" | "overlapping" | "mirrored";

export type SynthwaveDrawStyle =
  | "ribbon"
  | "half-rings"
  | "bars"
  | "led-blocks"
  | "dots"
  | "mountain"
  | "needles";

export type HeightmapRenderMode =
  | "bars-3d"
  | "ridges"
  | "wireframe"
  | "filled-mesh"
  | "dots";

export type ParticleShape = "circle" | "square" | "diamond";

export interface VisualizerConfig {
  // Theme & Canvas Background
  themeId: string;
  backgroundMode: VisualizerBackgroundMode;
  backgroundColor: string;
  backgroundImageDataUrl: string | null;
  backgroundDim: number;

  // Main Style
  style: VisualizerStyleId;

  // Center Circle & Ring
  centerSource: VisualizerCenterSource;
  customImageDataUrl: string | null;
  customImageHash: string | null;
  circleSize: number;
  scaleWithScreen: boolean;
  barGapFromCircle: number;
  showCircleRing: boolean;
  circleRingWidth: number;
  circleRingColorMode: CircleRingColorMode;
  circleRingColor: string;
  bassPulse: boolean;
  showCenterInOtherStyles: boolean;

  // Shared Sound Bars & Physics
  barCount: number;
  barMaxHeight: number;
  barThickness: number;
  barSensitivity: number;
  barSmoothing: number;
  mirrored: boolean;
  bidirectionalBars: boolean;
  roundedCaps: boolean;
  rotationSpeed: number;
  colorMode: VisualizerColorMode;
  barColorLow: string;
  barColorMid: string;
  barColorHigh: string;

  // Screen Edge Bars (Standalone Style OR Overlay on top of other styles)
  edgeOverlayOnOthers: boolean;
  edgeTop: boolean;
  edgeBottom: boolean;
  edgeLeft: boolean;
  edgeRight: boolean;
  edgeBarCount: number;
  edgeBarMaxHeight: number;
  edgeBarGap: number;
  edgeCornerRadius: number;
  edgeMirrored: boolean;
  edgePadding: number;
  edgeOpacity: number;

  // Ultra-Customizable Synthwave (All Reference Inspiration Styles!)
  synthDrawStyle: SynthwaveDrawStyle;
  synthMode: SynthwaveMode;
  synthLayerCount: number;
  synthContourCount: number;
  synthCurveSmoothing: number;
  synthBarCount: number;
  synthBarGap: number;
  synthBarRadius: number;
  synthPixelated: boolean;
  synthPixelSize: number;
  synthFilled: boolean;
  synthFillOpacity: number;
  synthLineWidth: number;
  synthAmplitude: number;
  synthFrequencyScale: number;
  synthWaveSpeed: number;
  synthVerticalOffset: number;
  synthShowBaseline: boolean;
  synthHorizonGrid: boolean;

  // 2.5D Audio Heightmap / 3D Pillars / Terrain
  hmRenderMode: HeightmapRenderMode;
  hmRows: number;
  hmCols: number;
  hmElevation: number;
  hmTilt: number;
  hmPerspective: number;
  hmScrollSpeed: number;
  hmLineWidth: number;
  hmMirrored: boolean;
  hmShowBaseGrid: boolean;
  hmBarWidthRatio: number;
  hmCurveSmoothing: number;
  hmVerticalOffset: number;

  // Concentric Shockwave / Radar Polygons
  radarRingCount: number;
  radarPolygonSides: number;
  radarLineWidth: number;
  radarFillOpacity: number;
  radarSpread: number;

  // Geometric Particle Constellation
  partCount: number;
  partSize: number;
  partSpeed: number;
  partLinkDistance: number;
  partBassKick: number;
  partShape: ParticleShape;

  // Title & Now-Playing Textbox Overlay
  titlePosition: VisualizerTitlePosition;
  titleSource: VisualizerTitleSource;
  showSubtitle: boolean;
  showArtistInTitle: boolean;
  showMediaSourceBadge: boolean;
  titleScale: number;
  titleCompact: boolean;
  titlePaddingY: number;
  titlePaddingX: number;
  titleBoxOpacity: number;
  titleShowBorder: boolean;
  titleMaxWidth: number;
  titleMarquee: boolean;
  titleMarqueeSpeed: number;
  customTitle: string;
  customSubtitle: string;

  // Local Host Preferences (preserved on theme import)
  enterFullscreen: boolean;
  selectedDeviceId: string | null;
  selectedMonitorId: string | null;
}

export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  themeId: "tpx",
  backgroundMode: "theme",
  backgroundColor: "#090A09",
  backgroundImageDataUrl: null,
  backgroundDim: 0.45,

  style: "circular",

  centerSource: "tpx",
  customImageDataUrl: null,
  customImageHash: null,
  circleSize: 220,
  scaleWithScreen: true,
  barGapFromCircle: 14,
  showCircleRing: true,
  circleRingWidth: 2.5,
  circleRingColorMode: "match-bars",
  circleRingColor: "#0AF92A",
  bassPulse: true,
  showCenterInOtherStyles: false,

  barCount: 72,
  barMaxHeight: 136,
  barThickness: 4.5,
  barSensitivity: 1.4,
  barSmoothing: 0.72,
  mirrored: true,
  bidirectionalBars: false,
  roundedCaps: true,
  rotationSpeed: 0.15,
  colorMode: "theme",
  barColorLow: "#0AF92A",
  barColorMid: "#49ECC1",
  barColorHigh: "#FFB020",

  edgeOverlayOnOthers: false,
  edgeTop: false,
  edgeBottom: true,
  edgeLeft: false,
  edgeRight: false,
  edgeBarCount: 64,
  edgeBarMaxHeight: 150,
  edgeBarGap: 4,
  edgeCornerRadius: 6,
  edgeMirrored: true,
  edgePadding: 0,
  edgeOpacity: 0.95,

  synthDrawStyle: "half-rings",
  synthMode: "mirrored",
  synthLayerCount: 3,
  synthContourCount: 7,
  synthCurveSmoothing: 5,
  synthBarCount: 64,
  synthBarGap: 4,
  synthBarRadius: 4,
  synthPixelated: false,
  synthPixelSize: 8,
  synthFilled: true,
  synthFillOpacity: 0.28,
  synthLineWidth: 2.5,
  synthAmplitude: 1.15,
  synthFrequencyScale: 1.4,
  synthWaveSpeed: 0.85,
  synthVerticalOffset: 0,
  synthShowBaseline: true,
  synthHorizonGrid: false,

  hmRenderMode: "bars-3d",
  hmRows: 22,
  hmCols: 36,
  hmElevation: 1.25,
  hmTilt: 48,
  hmPerspective: 0.65,
  hmScrollSpeed: 1.1,
  hmLineWidth: 1.6,
  hmMirrored: true,
  hmShowBaseGrid: true,
  hmBarWidthRatio: 0.68,
  hmCurveSmoothing: 2,
  hmVerticalOffset: 0,

  radarRingCount: 6,
  radarPolygonSides: 0,
  radarLineWidth: 2.5,
  radarFillOpacity: 0.08,
  radarSpread: 1.05,

  partCount: 84,
  partSize: 4,
  partSpeed: 1.0,
  partLinkDistance: 135,
  partBassKick: 1.25,
  partShape: "diamond",

  titlePosition: "bottom-center",
  titleSource: "auto-media",
  showSubtitle: true,
  showArtistInTitle: true,
  showMediaSourceBadge: true,
  titleScale: 1.0,
  titleCompact: false,
  titlePaddingY: 8,
  titlePaddingX: 16,
  titleBoxOpacity: 0.82,
  titleShowBorder: true,
  titleMaxWidth: 420,
  titleMarquee: true,
  titleMarqueeSpeed: 55,
  customTitle: "T - VISUALIZER",
  customSubtitle: "Live Audio",

  enterFullscreen: true,
  selectedDeviceId: null,
  selectedMonitorId: null,
};

export interface NowPlayingMedia {
  title: string;
  artist: string;
  album: string;
  source_app: string;
  is_playing: boolean;
  thumbnail_data_url: string | null;
}

export const THEME_FILE_FORMAT = "t-visualizer-theme-v1" as const;

export interface SavedVisualizerTheme {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: Partial<VisualizerConfig>;
}

export interface ExportedThemeFile {
  format: typeof THEME_FILE_FORMAT;
  name: string;
  exportedAt: number;
  config: Partial<VisualizerConfig>;
}

export function mergeVisualizerConfig(
  raw: Partial<VisualizerConfig> | null | undefined,
  defaults: VisualizerConfig = DEFAULT_VISUALIZER_CONFIG
): VisualizerConfig {
  if (!raw || typeof raw !== "object") return { ...defaults };
  const merged: VisualizerConfig = {
    ...defaults,
    ...raw,
  };
  if (typeof raw.showSubtitle === "boolean") {
    merged.showArtistInTitle = raw.showSubtitle;
  } else if (typeof raw.showArtistInTitle === "boolean") {
    merged.showSubtitle = raw.showArtistInTitle;
  }
  if (merged.selectedMonitorId === "all") {
    merged.selectedMonitorId = "mirrored";
  }
  return merged;
}

export function stripHostFields(config: VisualizerConfig): Partial<VisualizerConfig> {
  const {
    selectedDeviceId: _dev,
    selectedMonitorId: _mon,
    customImageHash: _hash,
    ...portable
  } = config;
  return portable;
}

export function applyPortableTheme(
  current: VisualizerConfig,
  incoming: Partial<VisualizerConfig>
): VisualizerConfig {
  const clean = { ...incoming };
  delete clean.selectedDeviceId;
  delete clean.selectedMonitorId;
  return mergeVisualizerConfig(
    {
      ...clean,
      selectedDeviceId: current.selectedDeviceId,
      selectedMonitorId: current.selectedMonitorId,
    },
    DEFAULT_VISUALIZER_CONFIG
  );
}
