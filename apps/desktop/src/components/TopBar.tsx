import { memo, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../services/api";
import {
  Cloud,
  FolderPlus,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  RefreshCw,
  Search,
  Sliders,
  Square,
  Tv,
  X,
} from "lucide-react";

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isScanning: boolean;
  isSyncing: boolean;
  isServerConnected: boolean;
  isFullscreen: boolean;
  onAddFolder: () => void;
  onRescan: () => void;
  onSyncNow: () => void;
  onOpenThemes: () => void;
  onEnterCinematic: () => void;
  onOpenCinematicSettings: () => void;
  onToggleFullscreen: () => void;
  onBeforeClose: () => Promise<void>;
  activeThemeName: string;
}

export const TopBar = memo(function TopBar({
  searchQuery,
  onSearchChange,
  isScanning,
  isSyncing,
  isServerConnected,
  isFullscreen,
  onAddFolder,
  onRescan,
  onSyncNow,
  onOpenThemes,
  onEnterCinematic,
  onOpenCinematicSettings,
  onToggleFullscreen,
  onBeforeClose,
  activeThemeName,
}: TopBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    void getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    await Promise.race([
      onBeforeClose(),
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]);
    await api.closeAppWindow();
  };

  return (
    <header
      data-tauri-drag-region
      className="h-14 shrink-0 px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] flex items-center justify-between gap-3"
    >
      {/* Search Input */}
      <div className="relative flex-1 max-w-sm">
        <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tracks, artists, albums... (Ctrl+K)"
          className="w-full pl-9 pr-8 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Draggable Spacer */}
      <div data-tauri-drag-region className="flex-1 h-full min-w-[20px]" />

      {/* Action Buttons & Frameless Window Controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onAddFolder}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span className="hidden sm:inline">Add Folder</span>
        </button>

        <button
          type="button"
          onClick={onRescan}
          disabled={isScanning}
          title="Rescan all library folders"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isScanning ? "animate-spin text-[var(--accent)]" : ""}`}
          />
          <span className="hidden md:inline">{isScanning ? "Scanning..." : "Rescan"}</span>
        </button>

        {isServerConnected && (
          <button
            type="button"
            onClick={onSyncNow}
            disabled={isSyncing}
            title="Two-way sync with home server"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Cloud
              className={`w-3.5 h-3.5 text-[var(--accent)] ${
                isSyncing ? "animate-pulse" : ""
              }`}
            />
            <span className="hidden md:inline">
              {isSyncing ? "Syncing..." : "Sync"}
            </span>
          </button>
        )}

        {/* Cinematic Mode + Studio Gear */}
        <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <button
            type="button"
            onClick={onEnterCinematic}
            title="Enter Cinematic Visualizer Mode"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Tv className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="hidden lg:inline">Cinematic</span>
          </button>
          <button
            type="button"
            onClick={onOpenCinematicSettings}
            title="Cinematic Visualizer Settings"
            className="px-2 py-1.5 border-l border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenThemes}
          title="Open Theme Studio"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-soft)] hover:brightness-110 border border-[var(--border-subtle)] text-[var(--text-primary)] transition-all cursor-pointer"
        >
          <Palette className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span className="hidden sm:inline">{activeThemeName}</span>
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          title="Toggle Borderless Fullscreen (F11)"
          className={`p-1.5 rounded-lg border border-[var(--border-subtle)] transition-colors cursor-pointer ${
            isFullscreen
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Window Chrome Controls */}
        <div className="ml-1 pl-2 border-l border-[var(--border-subtle)] flex items-center gap-1">
          <button
            type="button"
            onClick={handleMinimize}
            title="Minimize"
            className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            title="Maximize / Restore"
            className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            title="Close"
            className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-white hover:bg-rose-500/80 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
});
