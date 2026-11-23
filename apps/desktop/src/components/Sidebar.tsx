import { memo, useState } from "react";
import {
  Disc3,
  FolderMinus,
  FolderOpen,
  Heart,
  ListMusic,
  Music2,
  Plus,
  Radio,
  Server,
  Sparkles,
  Upload,
} from "lucide-react";
import tpxLogoUrl from "../assets/tpx-logo.svg";
import type { ActiveView, MusicFolder, Playlist } from "../types";

interface SidebarProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  playlists: Playlist[];
  folders: MusicFolder[];
  totalTracks: number;
  favoriteCount: number;
  autoEligibleCount: number;
  isAutoMixActive: boolean;
  isTpxTheme: boolean;
  isServerConnected: boolean;
  onOpenWmpImport: () => void;
  onCreatePlaylist: (name: string) => Promise<void>;
  onRemoveFolder: (folderId: string) => Promise<void>;
}

export const Sidebar = memo(function Sidebar({
  activeView,
  onSelectView,
  playlists,
  folders,
  totalTracks,
  favoriteCount,
  autoEligibleCount,
  isAutoMixActive,
  isTpxTheme,
  isServerConnected,
  onOpenWmpImport,
  onCreatePlaylist,
  onRemoveFolder,
}: SidebarProps) {
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showFolders, setShowFolders] = useState(false);

  const submitCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    await onCreatePlaylist(trimmed);
    setNewPlaylistName("");
    setCreatingPlaylist(false);
  };

  const navItemClass = (isActive: boolean) =>
    `w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
      isActive
        ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    }`;

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      {/* Brand Header */}
      <div data-tauri-drag-region className="px-4 pt-4 pb-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
          style={
            isTpxTheme
              ? {
                  background: "#090A09",
                  border: "1px solid rgba(10, 249, 42, 0.35)",
                }
              : {
                  background: "linear-gradient(135deg, var(--viz-start), var(--viz-end))",
                }
          }
        >
          {isTpxTheme ? (
            <img src={tpxLogoUrl} alt="TPX" className="w-7 h-7 object-contain" />
          ) : (
            <Disc3 className="w-5 h-5 text-white" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-tight text-[var(--text-primary)] truncate">
            T - MusicPlayer
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-mono-num">
            {totalTracks} {totalTracks === 1 ? "track" : "tracks"} indexed
          </div>
        </div>
      </div>

      {/* Primary Navigation */}
      <nav className="px-3 space-y-1">
        <button
          type="button"
          onClick={() => onSelectView({ kind: "library" })}
          className={navItemClass(activeView.kind === "library")}
        >
          <span className="flex items-center gap-2.5">
            <Music2
              className="w-4 h-4"
              style={{
                color: activeView.kind === "library" ? "var(--accent)" : undefined,
              }}
            />
            All Tracks
          </span>
          <span className="text-[11px] text-[var(--text-muted)] font-mono-num">
            {totalTracks}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView({ kind: "favorites" })}
          className={navItemClass(activeView.kind === "favorites")}
        >
          <span className="flex items-center gap-2.5">
            <Heart
              className="w-4 h-4"
              style={{
                color: activeView.kind === "favorites" ? "var(--accent)" : undefined,
              }}
            />
            Favorites
          </span>
          <span className="text-[11px] text-[var(--text-muted)] font-mono-num">
            {favoriteCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView({ kind: "auto" })}
          className={navItemClass(activeView.kind === "auto")}
        >
          <span className="flex items-center gap-2.5">
            <Sparkles
              className="w-4 h-4"
              style={{
                color: activeView.kind === "auto" || isAutoMixActive ? "var(--accent)" : undefined,
              }}
            />
            Auto Playlist
          </span>
          <span className="text-[11px] text-[var(--text-muted)] font-mono-num">
            {isAutoMixActive ? "MIX" : autoEligibleCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView({ kind: "radio" })}
          className={navItemClass(activeView.kind === "radio")}
        >
          <span className="flex items-center gap-2.5">
            <Radio
              className="w-4 h-4"
              style={{
                color: activeView.kind === "radio" ? "var(--accent)" : undefined,
              }}
            />
            Internet Radio
          </span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">
            Live
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView({ kind: "sync" })}
          className={navItemClass(activeView.kind === "sync")}
        >
          <span className="flex items-center gap-2.5">
            <Server
              className="w-4 h-4"
              style={{
                color: activeView.kind === "sync" ? "var(--accent)" : undefined,
              }}
            />
            Home Server
          </span>
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--bg-surface)] ${
              isServerConnected ? "text-emerald-400" : "text-[var(--text-muted)]"
            }`}
          >
            {isServerConnected ? "Linked" : "Sync"}
          </span>
        </button>
      </nav>

      {/* WMP Import Action */}
      <div className="px-3 mt-3">
        <button
          type="button"
          onClick={onOpenWmpImport}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-[var(--accent)]" />
          Import WMP Playlists
        </button>
      </div>

      {/* Playlists Section */}
      <div className="mt-5 px-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Playlists
        </span>
        <button
          type="button"
          onClick={() => setCreatingPlaylist((v) => !v)}
          title="New playlist"
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {creatingPlaylist && (
        <form onSubmit={submitCreatePlaylist} className="px-3 mt-2">
          <input
            type="text"
            autoFocus
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setCreatingPlaylist(false);
                setNewPlaylistName("");
              }
            }}
            placeholder="Playlist name..."
            className="w-full px-2.5 py-1.5 rounded-md text-xs bg-[var(--bg-surface)] border border-[var(--accent)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {playlists.length === 0 ? (
          <div className="px-2 py-4 text-xs text-[var(--text-muted)]">
            No playlists yet. Create one with <span className="font-semibold">+</span> or import from Windows Media Player.
          </div>
        ) : (
          playlists.map((pl) => {
            const isActive =
              activeView.kind === "playlist" && activeView.playlistId === pl.id;
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => onSelectView({ kind: "playlist", playlistId: pl.id })}
                className={navItemClass(isActive)}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <ListMusic
                    className="w-4 h-4 shrink-0"
                    style={{ color: isActive ? "var(--accent)" : undefined }}
                  />
                  <span className="truncate">{pl.name}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {pl.source_type === "wmp" && (
                    <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--accent)] font-semibold">
                      WMP
                    </span>
                  )}
                  <span className="text-[11px] text-[var(--text-muted)] font-mono-num">
                    {pl.track_count}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Watched Folders Footer */}
      <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
        <button
          type="button"
          onClick={() => setShowFolders((v) => !v)}
          className="w-full flex items-center justify-between text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-[var(--accent)]" />
            Music Folders
          </span>
          <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
            {folders.length}
          </span>
        </button>

        {showFolders && (
          <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
            {folders.length === 0 ? (
              <div className="text-[11px] text-[var(--text-muted)]">
                No folders added yet.
              </div>
            ) : (
              folders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-[var(--bg-surface)] text-[11px]"
                >
                  <span className="truncate text-[var(--text-secondary)]" title={folder.path}>
                    {folder.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onRemoveFolder(folder.id)}
                    title="Remove folder from library"
                    className="p-0.5 text-[var(--text-muted)] hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    <FolderMinus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
});
