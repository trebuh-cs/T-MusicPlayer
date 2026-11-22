import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileAudio,
  FolderSearch,
  ListMusic,
  Loader2,
  X,
} from "lucide-react";
import { api } from "../services/api";
import type {
  DetectedPlaylistFile,
  ImportPlaylistReport,
  ParsedPlaylist,
} from "../types";

interface WmpImportModalProps {
  onClose: () => void;
  onImported: (report: ImportPlaylistReport) => void;
}

export function WmpImportModal({ onClose, onImported }: WmpImportModalProps) {
  const [detected, setDetected] = useState<DetectedPlaylistFile[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [preview, setPreview] = useState<ParsedPlaylist | null>(null);
  const [customName, setCustomName] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportPlaylistReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .detectWmpPlaylists()
      .then((list) => {
        if (!cancelled) {
          setDetected(list);
          setLoadingList(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoadingList(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPreview = async (filePath: string) => {
    setError(null);
    setReport(null);
    setLoadingPreview(true);
    try {
      const parsed = await api.previewPlaylistFile(filePath);
      setPreview(parsed);
      setCustomName(parsed.name);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingPreview(false);
    }
  };

  const browsePlaylistFile = async () => {
    const selected = await open({
      multiple: false,
      title: "Select Windows Media Player or M3U/PLS Playlist",
      filters: [
        {
          name: "Playlists",
          extensions: ["wpl", "zpl", "m3u", "m3u8", "pls"],
        },
      ],
    });
    if (typeof selected === "string") {
      await loadPreview(selected);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.importPlaylistFile(
        preview.source_path,
        customName.trim() || undefined
      );
      setReport(res);
      onImported(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const foundCount = preview ? preview.entries.filter((e) => e.exists).length : 0;
  const missingCount = preview ? preview.entries.length - foundCount : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="w-full max-w-3xl max-h-[84vh] flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">
              Import Windows Media Player Playlists
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Supports <span className="font-mono-num">.wpl</span>,{" "}
              <span className="font-mono-num">.zpl</span>,{" "}
              <span className="font-mono-num">.m3u</span>,{" "}
              <span className="font-mono-num">.m3u8</span>, and{" "}
              <span className="font-mono-num">.pls</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={browsePlaylistFile}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
            >
              <FolderSearch className="w-3.5 h-3.5 text-[var(--accent)]" />
              Browse File...
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid md:grid-cols-[260px_1fr] divide-y md:divide-y-0 md:divide-x divide-[var(--border-subtle)]">
          {/* Detected List */}
          <div className="overflow-y-auto p-4 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              Detected Playlists
            </div>
            {loadingList ? (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                Scanning Music & Playlists...
              </div>
            ) : detected.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] py-4 leading-relaxed">
                No playlists found automatically in{" "}
                <span className="font-mono-num">Music\Playlists</span>. Use{" "}
                <strong>Browse File...</strong> to pick one manually.
              </div>
            ) : (
              detected.map((item) => {
                const isSelected = preview?.source_path === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => void loadPreview(item.path)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[var(--accent-soft)] border-[var(--accent)]"
                        : "bg-[var(--bg-surface)] border-transparent hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {item.name}
                      </span>
                      <span className="text-[10px] font-mono-num uppercase px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--accent)]">
                        {item.format}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1 font-mono-num">
                      {item.entry_count} {item.entry_count === 1 ? "entry" : "entries"}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Preview & Confirm Pane */}
          <div className="flex flex-col min-h-0 p-5 overflow-y-auto">
            {error && (
              <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
                {error}
              </div>
            )}

            {report && (
              <div className="mb-4 p-4 rounded-xl bg-emerald-500/12 border border-emerald-500/30 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Imported "{report.playlist.name}" ({report.imported_count} tracks)
                </div>
                {report.missing_entries.length > 0 && (
                  <div className="text-[11px] text-amber-300">
                    {report.missing_entries.length} missing file(s) could not be found on disk and were skipped.
                  </div>
                )}
              </div>
            )}

            {loadingPreview ? (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-secondary)] gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                Resolving playlist paths...
              </div>
            ) : !preview ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-[var(--text-muted)]">
                <ListMusic className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-xs">
                  Select a detected playlist on the left or click{" "}
                  <strong>Browse File...</strong> to preview resolved and missing tracks before importing.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3 pb-4 border-b border-[var(--border-subtle)]">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Imported Playlist Name
                    </span>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-mono-num">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {foundCount} found on disk
                    </span>
                    {missingCount > 0 && (
                      <span className="flex items-center gap-1.5 text-amber-400 font-mono-num">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {missingCount} missing
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto py-3 space-y-1.5">
                  {preview.entries.map((entry, idx) => (
                    <div
                      key={`${entry.raw_src}-${idx}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileAudio
                          className={`w-4 h-4 shrink-0 ${
                            entry.exists ? "text-[var(--accent)]" : "text-amber-400"
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-[var(--text-primary)] truncate">
                            {entry.title_hint
                              ? `${entry.artist_hint ? `${entry.artist_hint} — ` : ""}${entry.title_hint}`
                              : entry.raw_src}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate font-mono-num">
                            {entry.resolved_path || entry.raw_src}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded shrink-0 ${
                          entry.exists
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {entry.exists ? "Ready" : "Missing"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    disabled={importing || foundCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-45 cursor-pointer"
                    style={{ background: "var(--accent)" }}
                  >
                    {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Import {foundCount} {foundCount === 1 ? "Track" : "Tracks"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
