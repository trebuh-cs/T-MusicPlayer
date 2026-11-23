export type VisualizerColorMode =
  | "theme"
  | "solid"
  | "height-dynamic"
  | "radial-fade"
  | "rainbow";

export type VisualizerTitlePosition = "hidden" | "above" | "below";

export type VisualizerCenterSource = "tpx" | "music-icon" | "custom";

export type VisualizerBackgroundMode = "theme" | "solid" | "image";

export interface VisualizerConfig {
  themeId: string;
  circleSize: number;
  barGapFromCircle: number;
  barCount: number;
  barMaxHeight: number;
  barThickness: number;
  barSensitivity: number;
  barSmoothing: number;
  mirrored: boolean;
  bidirectionalBars: boolean;
  colorMode: VisualizerColorMode;
  barColorLow: string;
  barColorMid: string;
  barColorHigh: string;
  roundedCaps: boolean;
  bassPulse: boolean;
  rotationSpeed: number;
  showCircleRing: boolean;
  titlePosition: VisualizerTitlePosition;
  showSubtitle: boolean;
  customTitle: string;
  customSubtitle: string;
  centerSource: VisualizerCenterSource;
  customImageDataUrl: string | null;
  backgroundMode: VisualizerBackgroundMode;
  backgroundColor: string;
  backgroundImageDataUrl: string | null;
  backgroundDim: number;
  selectedDeviceId: string | null;
  selectedMonitorId: string | null;
}

export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  themeId: "tpx",
  circleSize: 210,
  barGapFromCircle: 14,
  barCount: 72,
  barMaxHeight: 132,
  barThickness: 4.5,
  barSensitivity: 1.4,
  barSmoothing: 0.72,
  mirrored: true,
  bidirectionalBars: false,
  colorMode: "theme",
  barColorLow: "#0AF92A",
  barColorMid: "#49ECC1",
  barColorHigh: "#FFB020",
  roundedCaps: true,
  bassPulse: true,
  rotationSpeed: 0.15,
  showCircleRing: true,
  titlePosition: "hidden",
  showSubtitle: true,
  customTitle: "T - VISUALIZER",
  customSubtitle: "Live System Audio",
  centerSource: "tpx",
  customImageDataUrl: null,
  backgroundMode: "theme",
  backgroundColor: "#090A09",
  backgroundImageDataUrl: null,
  backgroundDim: 0.45,
  selectedDeviceId: null,
  selectedMonitorId: null,
};

export interface AudioDeviceInfo {
  id: string;
  name: string;
  is_default: boolean;
}

export interface AudioStatus {
  active: boolean;
  capturing: boolean;
  device_name: string;
  selected_device_id: string | null;
  error: string | null;
}

export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}
