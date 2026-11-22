import { Check, Sparkles, Tv, X } from "lucide-react";
import tpxLogoUrl from "../assets/tpx-logo.svg";
import { THEMES } from "../themes/themes";
import type { VisualizerStyle } from "../types";

interface ThemeDrawerProps {
  activeThemeId: string;
  matchAlbumArt: boolean;
  visualizerStyle: VisualizerStyle;
  onSelectTheme: (themeId: string) => void;
  onToggleMatchAlbumArt: () => void;
  onChangeVisualizerStyle: (style: VisualizerStyle) => void;
  onOpenCinematicSettings: () => void;
  onClose: () => void;
}

export function ThemeDrawer({
  activeThemeId,
  matchAlbumArt,
  visualizerStyle,
  onSelectTheme,
  onToggleMatchAlbumArt,
  onChangeVisualizerStyle,
  onOpenCinematicSettings,
  onClose,
}: ThemeDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside
        className="w-88 max-w-full h-full bg-[var(--bg-elevated)] border-l border-[var(--border-subtle)] p-5 flex flex-col gap-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">
              Theme Studio
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Shared token palette across desktop & mobile
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Adaptive Album Art Accent */}
        <button
          type="button"
          onClick={onToggleMatchAlbumArt}
          className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
            matchAlbumArt
              ? "bg-[var(--accent-soft)] border-[var(--accent)]"
              : "bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Match Album Art
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                Dynamically tint accents & spectrum to current cover
              </div>
            </div>
          </div>
          <span
            className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
              matchAlbumArt ? "bg-[var(--accent)]" : "bg-[var(--bg-base)]"
            }`}
          >
            <span
              className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                matchAlbumArt ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </span>
        </button>

        {/* Theme List */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Built-in Themes
          </div>
          {THEMES.map((theme) => {
            const isActive = theme.id === activeThemeId;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onSelectTheme(theme.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {/* Mini Color Swatch */}
                    <span
                      className="w-7 h-7 rounded-lg border border-white/15 flex items-center justify-center shrink-0 overflow-hidden"
                      style={{
                        background:
                          theme.id === "tpx"
                            ? "#090A09"
                            : `linear-gradient(135deg, ${theme.colors.bgBase} 45%, ${theme.colors.accent} 45%, ${theme.colors.vizEnd} 100%)`,
                      }}
                    >
                      {theme.id === "tpx" ? (
                        <img src={tpxLogoUrl} alt="TPX" className="w-5 h-5 object-contain" />
                      ) : (
                        isActive && <Check className="w-3.5 h-3.5 text-white" />
                      )}
                    </span>
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        {theme.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {theme.description}
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Visualizer Style */}
        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Spectrum Visualizer
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["bars", "Bars"],
                ["mirrored", "Wave"],
                ["off", "Off"],
              ] as const
            ).map(([style, label]) => (
              <button
                key={style}
                type="button"
                onClick={() => onChangeVisualizerStyle(style)}
                className={`py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  visualizerStyle === style
                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)]"
                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenCinematicSettings();
            }}
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
          >
            <Tv className="w-4 h-4 text-[var(--accent)]" />
            Customize Cinematic Visualizer...
          </button>
        </div>
      </aside>
    </div>
  );
}
