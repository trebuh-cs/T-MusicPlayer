import rawThemes from "@shared/themes/themes.json";

export interface ThemeColors {
  bgBase: string;
  bgElevated: string;
  bgSurface: string;
  bgHover: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  accentSoft: string;
  vizStart: string;
  vizEnd: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  mode: "dark" | "light";
  fontDisplay: string;
  fontMono: string;
  colors: ThemeColors;
}

export const THEMES: ThemeDefinition[] = rawThemes as ThemeDefinition[];

export function getThemeById(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export interface AdaptiveAccent {
  accent: string;
  accentContrast: string;
  accentSoft: string;
  vizStart: string;
  vizEnd: string;
}

export function applyThemeToDocument(
  theme: ThemeDefinition,
  adaptiveAccent?: AdaptiveAccent | null
): void {
  const root = document.documentElement;
  const c = theme.colors;
  const accent = adaptiveAccent?.accent ?? c.accent;
  const accentContrast = adaptiveAccent?.accentContrast ?? c.accentContrast;
  const accentSoft = adaptiveAccent?.accentSoft ?? c.accentSoft;
  const vizStart = adaptiveAccent?.vizStart ?? c.vizStart;
  const vizEnd = adaptiveAccent?.vizEnd ?? c.vizEnd;

  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.style.colorScheme = theme.mode;

  root.style.setProperty("--bg-base", c.bgBase);
  root.style.setProperty("--bg-elevated", c.bgElevated);
  root.style.setProperty("--bg-surface", c.bgSurface);
  root.style.setProperty("--bg-hover", c.bgHover);
  root.style.setProperty("--border-subtle", c.borderSubtle);
  root.style.setProperty("--text-primary", c.textPrimary);
  root.style.setProperty("--text-secondary", c.textSecondary);
  root.style.setProperty("--text-muted", c.textMuted);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-contrast", accentContrast);
  root.style.setProperty("--accent-soft", accentSoft);
  root.style.setProperty("--viz-start", vizStart);
  root.style.setProperty("--viz-end", vizEnd);
  root.style.setProperty("--font-display", theme.fontDisplay);
  root.style.setProperty("--font-mono", theme.fontMono);
}

/**
 * Extracts a vivid dominant color from an album artwork URL using an offscreen canvas.
 */
export function extractAccentFromImage(
  imageUrl: string,
  mode: "dark" | "light"
): Promise<AdaptiveAccent | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let bestScore = -1;
        let bestR = 99;
        let bestG = 102;
        let bestB = 241;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 180) continue;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

          // Prefer vibrant mid-tone colors so text and highlights stay legible.
          const lumScore = 1 - Math.abs(lum - (mode === "dark" ? 0.58 : 0.45));
          const score = sat * 2.2 + lumScore * 0.6;
          if (score > bestScore) {
            bestScore = score;
            bestR = r;
            bestG = g;
            bestB = b;
          }
        }

        const [adjR, adjG, adjB] = ensureContrastRgb(bestR, bestG, bestB, mode);
        const [endR, endG, endB] = shiftCompanionRgb(adjR, adjG, adjB);
        const lum = (0.2126 * adjR + 0.7152 * adjG + 0.0722 * adjB) / 255;

        resolve({
          accent: `rgb(${adjR}, ${adjG}, ${adjB})`,
          accentContrast: lum > 0.62 ? "#090A09" : "#FFFFFF",
          accentSoft: `rgba(${adjR}, ${adjG}, ${adjB}, 0.16)`,
          vizStart: `rgb(${adjR}, ${adjG}, ${adjB})`,
          vizEnd: `rgb(${endR}, ${endG}, ${endB})`,
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function ensureContrastRgb(
  r: number,
  g: number,
  b: number,
  mode: "dark" | "light"
): [number, number, number] {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (mode === "dark" && lum < 0.36) {
    const boost = 1.45;
    return [
      Math.min(255, Math.round(r * boost + 42)),
      Math.min(255, Math.round(g * boost + 42)),
      Math.min(255, Math.round(b * boost + 42)),
    ];
  }
  if (mode === "light" && lum > 0.65) {
    const scale = 0.68;
    return [Math.round(r * scale), Math.round(g * scale), Math.round(b * scale)];
  }
  return [r, g, b];
}

function shiftCompanionRgb(r: number, g: number, b: number): [number, number, number] {
  return [
    Math.min(255, Math.round(r * 0.65 + 70)),
    Math.min(255, Math.round(g * 0.8 + 55)),
    Math.min(255, Math.round(b * 0.85 + 65)),
  ];
}
