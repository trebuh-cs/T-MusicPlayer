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
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === "tpx") ?? THEMES[0];
}

export function applyThemeToDocument(theme: ThemeDefinition): void {
  const root = document.documentElement;
  const c = theme.colors;

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
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-contrast", c.accentContrast);
  root.style.setProperty("--accent-soft", c.accentSoft);
  root.style.setProperty("--viz-start", c.vizStart);
  root.style.setProperty("--viz-end", c.vizEnd);
  root.style.setProperty("--font-display", theme.fontDisplay);
  root.style.setProperty("--font-mono", theme.fontMono);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", c.bgBase);
  }
}
