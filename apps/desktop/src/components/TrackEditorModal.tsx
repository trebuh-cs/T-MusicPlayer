import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Gauge,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Scissors,
  Volume2,
  X,
} from "lucide-react";
import { formatTime, type AudioEngineState } from "../hooks/useAudioEngine";
import type { Track, TrackEditDraft } from "../types";

interface TrackEditorModalProps {
  track: Track;
  engine: AudioEngineState;
  onSave: (trackId: string, draft: TrackEditDraft) => Promise<void>;
  onReset: (trackId: string) => Promise<void>;
  onClose: () => void;
}

const SPEED_PRESETS = [0.75, 0.9, 1.0, 1.15, 1.25, 1.5];

function formatPreciseTime(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = safe / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec - mins * 60;
  const wholeSecs = Math.floor(secs);
  const tenths = Math.floor((secs - wholeSecs) * 10);
  return `${mins}:${wholeSecs.toString().padStart(2, "0")}.${tenths}`;
}

export function TrackEditorModal({
  track,
  engine,
  onSave,
  onReset,
  onClose,
}: TrackEditorModalProps) {
  const originalDurationMs = Math.max(track.duration_ms, 1000);
  const [speed, setSpeed] = useState<number>(track.edit_speed || 1.0);
  const [gainDb, setGainDb] = useState<number>(track.edit_gain_db || 0.0);
  const [trimStartMs, setTrimStartMs] = useState<number>(track.trim_start_ms || 0);
  const [trimEndMs, setTrimEndMs] = useState<number>(
    track.trim_end_ms !== null && track.trim_end_ms > 0
      ? Math.min(track.trim_end_ms, originalDurationMs)
      : originalDurationMs
  );
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeSnap = useSyncExternalStore(engine.subscribeTime, engine.getTimeSnapshot);
  const isThisTrackLoaded =
    engine.nowPlaying?.kind === "track" && engine.nowPlaying.track.id === track.id;
  const isThisTrackPlaying = isThisTrackLoaded && engine.isPlaying;

  // Use real audio duration if loaded and slightly different from header metadata.
  const maxDurationMs =
    isThisTrackLoaded && timeSnap.duration > 1
      ? Math.max(originalDurationMs, Math.round(timeSnap.duration * 1000))
      : originalDurationMs;

  const effectiveTrimEndOrNull =
    trimEndMs < maxDurationMs - 250 ? trimEndMs : null;

  const currentDraft: TrackEditDraft = useMemo(
    () => ({
      speed: Math.round(speed * 100) / 100,
      gain_db: Math.round(gainDb * 10) / 10,
      trim_start_ms: Math.max(0, Math.round(trimStartMs)),
      trim_end_ms: effectiveTrimEndOrNull ? Math.round(effectiveTrimEndOrNull) : null,
    }),
    [speed, gainDb, trimStartMs, effectiveTrimEndOrNull]
  );

  // Push live slider preview straight into the audio engine while the modal is open.
  useEffect(() => {
    engine.setLiveEditPreview(track.id, currentDraft);
  }, [engine, track.id, currentDraft]);

  // Clear live preview when modal unmounts.
  useEffect(() => {
    return () => {
      engine.setLiveEditPreview(track.id, null);
    };
  }, [engine, track.id]);

  // Close on Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleTogglePreview = () => {
    if (isThisTrackLoaded) {
      engine.togglePlayPause();
    } else {
      engine.playTrack(track, [track]);
    }
  };

  const handlePreviewStart = () => {
    if (!isThisTrackLoaded) {
      engine.playTrack(track, [track]);
    } else {
      engine.seek(trimStartMs / 1000);
      if (!engine.isPlaying) engine.togglePlayPause();
    }
  };

  const handlePreviewEnd = () => {
    const targetEnd = Math.min(trimEndMs, maxDurationMs);
    const previewFromSec = Math.max(trimStartMs / 1000, (targetEnd - 4000) / 1000);
    if (!isThisTrackLoaded) {
      engine.playTrack(track, [track]);
      window.setTimeout(() => engine.seek(previewFromSec), 180);
    } else {
      engine.seek(previewFromSec);
      if (!engine.isPlaying) engine.togglePlayPause();
    }
  };

  const handleSetStartToCurrent = () => {
    if (!isThisTrackLoaded) return;
    const ms = Math.round(timeSnap.currentTime * 1000);
    const clamped = Math.max(0, Math.min(ms, trimEndMs - 500));
    setTrimStartMs(clamped);
  };

  const handleSetEndToCurrent = () => {
    if (!isThisTrackLoaded) return;
    const ms = Math.round(timeSnap.currentTime * 1000);
    const clamped = Math.max(trimStartMs + 500, Math.min(ms, maxDurationMs));
    setTrimEndMs(clamped);
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave(track.id, currentDraft);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setResetting(true);
    try {
      setSpeed(1.0);
      setGainDb(0.0);
      setTrimStartMs(0);
      setTrimEndMs(maxDurationMs);
      await onReset(track.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setResetting(false);
    }
  };

  const startPct = Math.min(100, Math.max(0, (trimStartMs / maxDurationMs) * 100));
  const endPct = Math.min(100, Math.max(startPct, (trimEndMs / maxDurationMs) * 100));
  const playheadPct = isThisTrackLoaded
    ? Math.min(100, Math.max(0, ((timeSnap.currentTime * 1000) / maxDurationMs) * 100))
    : null;
  const trimmedDurationMs = Math.max(0, trimEndMs - trimStartMs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent)]">
              Non-Destructive Track Editor
            </span>
            <h2 className="text-base font-bold text-[var(--text-primary)] truncate mt-1.5">
              {track.title}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {track.artist} · {track.album} · Original file stays untouched
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            aria-label="Close track editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Live Preview Controls */}
          <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleTogglePreview}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                }}
              >
                {isThisTrackPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" /> Pause Preview
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" /> Live Preview
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handlePreviewStart}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
              >
                Jump to Start
              </button>
              <button
                type="button"
                onClick={handlePreviewEnd}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
              >
                Preview End (-4s)
              </button>
            </div>
            <span className="text-[11px] font-mono-num text-[var(--text-muted)]">
              {isThisTrackLoaded
                ? `${formatTime(timeSnap.currentTime)} / ${formatTime(maxDurationMs / 1000)}`
                : `Length ${formatTime(maxDurationMs / 1000)}`}
            </span>
          </div>

          {/* 1. Playback Speed */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-[var(--accent)]" />
                Default Speed (pitch preserved)
              </span>
              <span className="font-mono-num font-bold text-[var(--accent)]">
                {speed.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="t-slider w-full"
              style={{
                background: "var(--bg-surface)",
                borderRadius: 9999,
                height: 6,
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              {SPEED_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSpeed(preset)}
                  className={`px-2 py-1 rounded-md text-[11px] font-mono-num border cursor-pointer ${
                    Math.abs(speed - preset) < 0.01
                      ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                      : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {preset.toFixed(2)}x
                </button>
              ))}
            </div>
          </div>

          {/* 2. Loudness / Gain */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                Loudness Adjustment
              </span>
              <span className="font-mono-num font-bold text-[var(--accent)]">
                {gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min={-18}
              max={12}
              step={0.5}
              value={gainDb}
              onChange={(e) => setGainDb(Number(e.target.value))}
              className="t-slider w-full"
              style={{
                background: "var(--bg-surface)",
                borderRadius: 9999,
                height: 6,
              }}
            />
            <div className="flex justify-between text-[10px] font-mono-num text-[var(--text-muted)]">
              <span>-18 dB (Quieter)</span>
              <button
                type="button"
                onClick={() => setGainDb(0)}
                className="hover:text-[var(--text-primary)] cursor-pointer"
              >
                0.0 dB (Original)
              </button>
              <span>+12 dB (Louder)</span>
            </div>
          </div>

          {/* 3. Trim Start & End */}
          <div className="space-y-3 pt-1 border-t border-[var(--border-subtle)]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5 text-[var(--accent)]" />
                Cut Front / End
              </span>
              <span className="font-mono-num text-[11px] text-[var(--text-secondary)]">
                Plays {formatPreciseTime(trimmedDurationMs)} of {formatPreciseTime(maxDurationMs)}
              </span>
            </div>

            {/* Visual Trim Segment Bar */}
            <div className="relative h-6 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
              <div
                className="absolute top-0 bottom-0 opacity-30"
                style={{
                  left: `${startPct}%`,
                  width: `${Math.max(0.5, endPct - startPct)}%`,
                  background: "var(--accent)",
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5"
                style={{ left: `${startPct}%`, background: "var(--accent)" }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5"
                style={{ left: `${endPct}%`, background: "var(--accent)" }}
              />
              {playheadPct !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[var(--text-primary)]"
                  style={{ left: `${playheadPct}%` }}
                />
              )}
            </div>

            {/* Trim Start */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-secondary)]">
                  Start At: <strong className="font-mono-num text-[var(--text-primary)]">{formatPreciseTime(trimStartMs)}</strong>
                </span>
                <button
                  type="button"
                  disabled={!isThisTrackLoaded}
                  onClick={handleSetStartToCurrent}
                  className="text-[11px] text-[var(--accent)] disabled:opacity-40 hover:underline cursor-pointer"
                >
                  Set to current playback position
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, trimEndMs - 500)}
                step={100}
                value={trimStartMs}
                onChange={(e) => setTrimStartMs(Number(e.target.value))}
                className="t-slider w-full"
                style={{
                  background: "var(--bg-surface)",
                  borderRadius: 9999,
                  height: 6,
                }}
              />
            </div>

            {/* Trim End */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-secondary)]">
                  Stop At:{" "}
                  <strong className="font-mono-num text-[var(--text-primary)]">
                    {effectiveTrimEndOrNull === null
                      ? `End (${formatPreciseTime(maxDurationMs)})`
                      : formatPreciseTime(trimEndMs)}
                  </strong>
                </span>
                <button
                  type="button"
                  disabled={!isThisTrackLoaded}
                  onClick={handleSetEndToCurrent}
                  className="text-[11px] text-[var(--accent)] disabled:opacity-40 hover:underline cursor-pointer"
                >
                  Set to current playback position
                </button>
              </div>
              <input
                type="range"
                min={Math.min(maxDurationMs, trimStartMs + 500)}
                max={maxDurationMs}
                step={100}
                value={trimEndMs}
                onChange={(e) => setTrimEndMs(Number(e.target.value))}
                className="t-slider w-full"
                style={{
                  background: "var(--bg-surface)",
                  borderRadius: 9999,
                  height: 6,
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={saving || resetting}
            onClick={() => void handleReset()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
          >
            {resetting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Reset to Defaults
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || resetting}
              onClick={() => void handleSave()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save &amp; Sync Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
