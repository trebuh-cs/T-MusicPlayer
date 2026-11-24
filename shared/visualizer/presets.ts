import {
  THEME_FILE_FORMAT,
  stripHostFields,
  type ExportedThemeFile,
  type SavedVisualizerTheme,
  type VisualizerConfig,
} from "./types";

export const BUILTIN_PRESETS: SavedVisualizerTheme[] = [
  {
    id: "builtin-tpx-ring",
    name: "TPX Neon Ring",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "tpx",
      style: "circular",
      circleSize: 220,
      scaleWithScreen: true,
      barCount: 72,
      barMaxHeight: 140,
      barThickness: 4.5,
      colorMode: "theme",
      edgeOverlayOnOthers: false,
      showCircleRing: true,
      circleRingColorMode: "match-bars",
      centerSource: "tpx",
    },
  },
  {
    id: "builtin-synth-half-rings",
    name: "Contour Half-Rings",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "midnight-glass",
      style: "synthwave",
      colorMode: "rainbow",
      synthDrawStyle: "half-rings",
      synthMode: "mirrored",
      synthContourCount: 8,
      synthCurveSmoothing: 6,
      synthLineWidth: 1.8,
      synthAmplitude: 1.25,
      synthShowBaseline: true,
      synthHorizonGrid: false,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-synth-led-blocks",
    name: "Pixel LED Wave",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "obsidian",
      style: "synthwave",
      colorMode: "rainbow",
      synthDrawStyle: "led-blocks",
      synthMode: "mirrored",
      synthBarCount: 56,
      synthBarGap: 3,
      synthPixelSize: 8,
      synthCurveSmoothing: 2,
      synthShowBaseline: true,
      synthHorizonGrid: false,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-synth-mountain",
    name: "Layered Synth Peaks",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "midnight-glass",
      style: "synthwave",
      colorMode: "height-dynamic",
      barColorLow: "#0EA5E9",
      barColorMid: "#22D3EE",
      barColorHigh: "#F43F5E",
      synthDrawStyle: "mountain",
      synthMode: "overlapping",
      synthLayerCount: 3,
      synthCurveSmoothing: 1,
      synthFilled: true,
      synthFillOpacity: 0.45,
      synthLineWidth: 2.5,
      synthShowBaseline: false,
      synthHorizonGrid: false,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-synth-dots",
    name: "Halftone Dot Matrix",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "retro-vfd",
      style: "synthwave",
      colorMode: "height-dynamic",
      barColorLow: "#F97316",
      barColorMid: "#FBBF24",
      barColorHigh: "#FEF3C7",
      synthDrawStyle: "dots",
      synthMode: "mirrored",
      synthBarCount: 64,
      synthPixelSize: 7,
      synthCurveSmoothing: 3,
      synthShowBaseline: false,
      synthHorizonGrid: false,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-heightmap-3d-bars",
    name: "2.5D Isometric Pillars",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "retro-vfd",
      style: "heightmap",
      colorMode: "height-dynamic",
      barColorLow: "#125E4B",
      barColorMid: "#2EFFC3",
      barColorHigh: "#FFB020",
      hmRenderMode: "bars-3d",
      hmRows: 18,
      hmCols: 32,
      hmElevation: 1.35,
      hmTilt: 46,
      hmPerspective: 0.68,
      hmShowBaseGrid: true,
      hmBarWidthRatio: 0.68,
      hmCurveSmoothing: 2,
      hmMirrored: true,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-4edge-frame",
    name: "4-Edge Studio Frame",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "obsidian",
      style: "edge-bars",
      colorMode: "radial-fade",
      barColorLow: "#6366F1",
      barColorMid: "#22D3EE",
      barColorHigh: "#F43F5E",
      edgeTop: true,
      edgeBottom: true,
      edgeLeft: true,
      edgeRight: true,
      edgeBarCount: 56,
      edgeBarMaxHeight: 130,
      edgeBarGap: 4,
      edgeCornerRadius: 8,
      edgeMirrored: true,
    },
  },
  {
    id: "builtin-organic-contours",
    name: "Organic Contour Rings",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "tpx",
      style: "spectrum-radar",
      colorMode: "rainbow",
      radarRingCount: 8,
      radarPolygonSides: 0,
      radarLineWidth: 2.2,
      radarFillOpacity: 0,
      radarSpread: 1.1,
      showCenterInOtherStyles: false,
      edgeOverlayOnOthers: false,
    },
  },
];

export function serializeThemePreset(name: string, config: VisualizerConfig): string {
  const payload: ExportedThemeFile = {
    format: THEME_FILE_FORMAT,
    name: name.trim() || "Custom Theme",
    exportedAt: Date.now(),
    config: stripHostFields(config),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseThemePresetFile(
  rawJson: string
): { name: string; config: Partial<VisualizerConfig> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Invalid theme file (not valid JSON).");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid theme file structure.");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format && obj.format !== THEME_FILE_FORMAT) {
    throw new Error(`Unsupported theme format: ${String(obj.format)}`);
  }
  const cfg =
    obj.config && typeof obj.config === "object"
      ? (obj.config as Partial<VisualizerConfig>)
      : (obj as Partial<VisualizerConfig>);
  const name =
    typeof obj.name === "string" && obj.name.trim().length > 0
      ? obj.name.trim()
      : "Imported Theme";
  return { name, config: cfg };
}
