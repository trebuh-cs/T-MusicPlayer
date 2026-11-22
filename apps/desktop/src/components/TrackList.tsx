import { memo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderPlus,
  Heart,
  ListPlus,
  MoreHorizontal,
  Music,
  Pencil,
  Play,
  Shuffle,
  Trash2,
  Upload,
} from "lucide-react";
import { formatDurationMs } from "../hooks/useAudioEngine";
import { getCoverUrl } from "../services/api";
import type { Playlist, Track } from "../types";

interface TrackListProps {
  title: string;
  subtitle?: string;
  tracks: Track[];
  playlist?: Playlist;
  allPlaylists: Playlist[];
  activeTrackId: string | null;
  isPlaying: boolean;
  emptyKind: "library" | "favorites" | "playlist" | "search";
  onPlayTrack: (track: Track, contextTracks: Track[]) => void;
  onShufflePlay: (tracks: Track[]) => void;
  onPlayNext: (track: Track) => void;
  onEnqueue: (track: Track) => void;
  onToggleFavorite: (trackId: string) => void;
  onAddTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  onRemoveFromPlaylist?: (trackId: string) => void;
  onReorderPlaylist?: (orderedIds: string[]) => void;
  onRenamePlaylist?: (newName: string) => void;
  onDeletePlaylist?: () => void;
  onExportPlaylist?: () => void;
  onAddFolder: () => void;
  onOpenWmpImport: () => void;
}

export const TrackList = memo(function TrackList({
  title,
  subtitle,
  tracks,
  playlist,
  allPlaylists,
  activeTrackId,
  isPlaying,
  emptyKind,
  onPlayTrack,
  onShufflePlay,
  onPlayNext,
  onEnqueue,
  onToggleFavorite,
  onAddTracksToPlaylist,
  onRemoveFromPlaylist,
  onReorderPlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onExportPlaylist,
  onAddFolder,
  onOpenWmpImport,
}: TrackListProps) {
  const [menuTrackId, setMenuTrackId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(playlist?.name ?? "");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const totalMs = tracks.reduce((sum, t) => sum + t.duration_ms, 0);
  const totalMins = Math.floor(totalMs / 60000);

  const moveTrack = (index: number, delta: -1 | 1) => {
    if (!onReorderPlaylist) return;
    const target = index + delta;
    if (target < 0 || target >= tracks.length) return;
    const reordered = [...tracks];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    onReorderPlaylist(reordered.map((t) => t.id));
  };

  const handleDrop = (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex || !onReorderPlaylist) {
      setDragIndex(null);
      return;
    }
    const reordered = [...tracks];
    const [item] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, item);
    setDragIndex(null);
    onReorderPlaylist(reordered.map((t) => t.id));
  };

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-5"
      onClick={() => {
        if (menuTrackId) setMenuTrackId(null);
      }}
    >
      {/* Header Banner */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          {renaming && playlist && onRenamePlaylist ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (renameValue.trim()) {
                  onRenamePlaylist(renameValue.trim());
                }
                setRenaming(false);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => setRenaming(false)}
                className="text-2xl font-bold bg-[var(--bg-surface)] border border-[var(--accent)] rounded-lg px-3 py-1 text-[var(--text-primary)] focus:outline-none"
              />
            </form>
          ) : (
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] truncate">
                {title}
              </h1>
              {playlist?.source_type === "wmp" && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  WMP Import
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono-num">
            {subtitle ? `${subtitle} · ` : ""}
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"} · {totalMins} min
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => onPlayTrack(tracks[0], tracks)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold hover:brightness-110 transition-colors cursor-pointer"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                }}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Play All
              </button>
              <button
                type="button"
                onClick={() => onShufflePlay(tracks)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5 text-[var(--accent)]" />
                Shuffle
              </button>
            </>
          )}

          {playlist && (
            <>
              {onRenamePlaylist && (
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(playlist.name);
                    setRenaming(true);
                  }}
                  title="Rename playlist"
                  className="p-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {onExportPlaylist && tracks.length > 0 && (
                <button
                  type="button"
                  onClick={onExportPlaylist}
                  title="Export as .m3u8"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                </button>
              )}
              {onDeletePlaylist && (
                <button
                  type="button"
                  onClick={onDeletePlaylist}
                  title="Delete playlist"
                  className="p-2 rounded-lg bg-[var(--bg-surface)] hover:bg-rose-500/20 border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Empty States */}
      {tracks.length === 0 ? (
        <div className="my-14 mx-auto max-w-md text-center p-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-[var(--accent-soft)] flex items-center justify-center">
            <Music className="w-6 h-6 text-[var(--accent)]" />
          </div>
          {emptyKind === "library" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Your music library is ready
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Point T - MusicPlayer to your music folder or import your existing Windows Media Player playlists (`.wpl`, `.zpl`, `.m3u`).
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={onAddFolder}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-contrast)",
                  }}
                >
                  <FolderPlus className="w-4 h-4" />
                  Add Music Folder
                </button>
                <button
                  type="button"
                  onClick={onOpenWmpImport}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-[var(--accent)]" />
                  Import WMP Playlists
                </button>
              </div>
            </>
          )}
          {emptyKind === "favorites" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                No favorites yet
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                Click the heart icon on any track to keep it here for quick listening.
              </p>
            </>
          )}
          {emptyKind === "playlist" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                This playlist is empty
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                Use the <span className="font-semibold">•••</span> menu on any track in your library to add songs here.
              </p>
            </>
          )}
          {emptyKind === "search" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                No matching tracks
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                Try a different artist, album, title, or genre keyword.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3">
          {/* Column Header */}
          <div className="grid grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.4fr)_84px_64px_72px] gap-3 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <span className="text-center">#</span>
            <span>Title</span>
            <span className="hidden md:block">Album</span>
            <span className="text-right">Format</span>
            <span className="text-right">Time</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="space-y-0.5">
            {tracks.map((track, idx) => {
              const isActive = track.id === activeTrackId;
              const coverUrl = getCoverUrl(track.cover_hash);
              const isMenuOpen = menuTrackId === track.id;

              return (
                <div
                  key={track.id}
                  draggable={Boolean(onReorderPlaylist)}
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => {
                    if (onReorderPlaylist) e.preventDefault();
                  }}
                  onDrop={() => handleDrop(idx)}
                  onDoubleClick={() => onPlayTrack(track, tracks)}
                  className={`track-row-perf group relative grid grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.4fr)_84px_64px_72px] items-center gap-3 px-3 py-2 rounded-xl transition-colors ${
                    isActive
                      ? "bg-[var(--accent-soft)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {/* Track Index / Active Indicator */}
                  <button
                    type="button"
                    onClick={() => onPlayTrack(track, tracks)}
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-xs font-mono-num text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    aria-label={`Play ${track.title}`}
                  >
                    {isActive && isPlaying ? (
                      <span className="flex items-end gap-0.5 h-3.5">
                        <span className="w-0.5 h-full bg-[var(--accent)] animate-eq-1 rounded-full" />
                        <span className="w-0.5 h-full bg-[var(--accent)] animate-eq-2 rounded-full" />
                        <span className="w-0.5 h-full bg-[var(--accent)] animate-eq-3 rounded-full" />
                      </span>
                    ) : (
                      <>
                        <span className="group-hover:hidden">{idx + 1}</span>
                        <Play className="w-3.5 h-3.5 hidden group-hover:block text-[var(--accent)] fill-current" />
                      </>
                    )}
                  </button>

                  {/* Cover + Title + Artist */}
                  <div className="flex items-center gap-3 min-w-0">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt=""
                        loading="lazy"
                        className="w-9 h-9 rounded-lg object-cover shrink-0 bg-[var(--bg-surface)]"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg shrink-0 bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                        <Music className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-medium truncate ${
                          isActive ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                        }`}
                      >
                        {track.title}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] truncate">
                        {track.artist}
                      </div>
                    </div>
                  </div>

                  {/* Album */}
                  <div className="hidden md:block text-xs text-[var(--text-secondary)] truncate">
                    {track.album}
                  </div>

                  {/* Format & Bitrate */}
                  <div className="text-right">
                    <span className="inline-block text-[10px] font-mono-num uppercase px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">
                      {track.format}
                      {track.bitrate_kbps ? ` ${track.bitrate_kbps}k` : ""}
                    </span>
                  </div>

                  {/* Duration */}
                  <div className="text-right text-xs font-mono-num text-[var(--text-secondary)]">
                    {formatDurationMs(track.duration_ms)}
                  </div>

                  {/* Actions */}
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(track.id)}
                      title={track.is_favorite ? "Remove from favorites" : "Add to favorites"}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        track.is_favorite
                          ? "text-rose-400"
                          : "text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${track.is_favorite ? "fill-current" : ""}`}
                      />
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuTrackId(isMenuOpen ? null : track.id)}
                        title="Track options"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] cursor-pointer"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {isMenuOpen && (
                        <div className="absolute right-0 top-8 z-30 w-52 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              onPlayNext(track);
                              setMenuTrackId(null);
                            }}
                            className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
                          >
                            Play Next
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onEnqueue(track);
                              setMenuTrackId(null);
                            }}
                            className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
                          >
                            Add to Queue
                          </button>

                          {allPlaylists.length > 0 && (
                            <div className="my-1 border-t border-[var(--border-subtle)] pt-1">
                              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                                <ListPlus className="w-3 h-3" />
                                Add to Playlist
                              </div>
                              <div className="max-h-32 overflow-y-auto">
                                {allPlaylists.map((pl) => (
                                  <button
                                    key={pl.id}
                                    type="button"
                                    onClick={() => {
                                      onAddTracksToPlaylist(pl.id, [track.id]);
                                      setMenuTrackId(null);
                                    }}
                                    className="w-full px-3 py-1.5 text-left truncate hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                                  >
                                    {pl.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {playlist && (
                            <div className="my-1 border-t border-[var(--border-subtle)] pt-1">
                              {onReorderPlaylist && idx > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    moveTrack(idx, -1);
                                    setMenuTrackId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" /> Move Up
                                </button>
                              )}
                              {onReorderPlaylist && idx < tracks.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    moveTrack(idx, 1);
                                    setMenuTrackId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" /> Move Down
                                </button>
                              )}
                              {onRemoveFromPlaylist && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRemoveFromPlaylist(track.id);
                                    setMenuTrackId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-rose-500/20 text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Remove from Playlist
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
