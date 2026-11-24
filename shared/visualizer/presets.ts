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
    id: "builtin-pixel-synthwave",
    name: "Retro Pixel Synthwave",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "midnight-glass",
      style: "synthwave",
      colorMode: "height-dynamic",
      barColorLow: "#A855F7",
      barColorMid: "#F43F5E",
      barColorHigh: "#22D3EE",
      synthMode: "overlapping",
      synthLayerCount: 4,
      synthPixelated: true,
      synthPixelSize: 8,
      synthFilled: true,
      synthFillOpacity: 0.25,
      synthLineWidth: 4,
      synthHorizonGrid: true,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-heightmap-ridges",
    name: "2.5D Cyber Terrain",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "retro-vfd",
      style: "heightmap",
      colorMode: "height-dynamic",
      barColorLow: "#125E4B",
      barColorMid: "#2EFFC3",
      barColorHigh: "#FFB020",
      hmRenderMode: "filled-mesh",
      hmRows: 30,
      hmCols: 54,
      hmElevation: 1.35,
      hmTilt: 46,
      hmPerspective: 0.72,
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
    id: "builtin-shockwave-hex",
    name: "Hexagon Shockwave",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "tpx",
      style: "spectrum-radar",
      colorMode: "theme",
      radarRingCount: 6,
      radarPolygonSides: 6,
      radarLineWidth: 3,
      radarFillOpacity: 0.1,
      radarSpread: 1.15,
      showCenterInOtherStyles: true,
      circleSize: 160,
      edgeOverlayOnOthers: false,
    },
  },
  {
    id: "builtin-constellation",
    name: "Audio Constellation",
    createdAt: 0,
    updatedAt: 0,
    config: {
      themeId: "nord-frost",
      style: "particle-constellation",
      colorMode: "theme",
      partCount: 96,
      partSize: 4.5,
      partSpeed: 1.1,
      partLinkDistance: 145,
      partBassKick: 1.4,
      partShape: "diamond",
      showCenterInOtherStyles: false,
      edgeOverlayOnOthers: true,
      edgeBottom: true,
      edgeTop: false,
      edgeLeft: false,
      edgeRight: false,
      edgeBarMaxHeight: 90,
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
  const cfg = obj.config && typeof obj.config === "object"
    ? (obj.config as Partial<VisualizerConfig>)
    : (obj as Partial<VisualizerConfig>);
  const name =
    typeof obj.name === "string" && obj.name.trim().length > 0
      ? obj.name.trim()
      : "Imported Theme";
  return { name, config: cfg };
}
