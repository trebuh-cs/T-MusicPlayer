import { memo, useState, useSyncExternalStore } from "react";
import {
  ChevronUp,
  Gauge,
  Heart,
  Loader2,
  Music,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Tv,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  formatTime,
  type AudioEngineState,
  type TimeSnapshot,
} from "../hooks/useAudioEngine";
import { getCoverUrl } from "../services/api";
import type { VisualizerStyle } from "../types";
import { Visualizer } from "./Visualizer";

const SPEED_PRESETS = [0.75, 1.0, 1.15, 1.25, 1.5, 2.0];

interface SeekBarProps {
  subscribeTime: (listener: () => void) => () => void;
  getTimeSnapshot: () => TimeSnapshot;
  disabled: boolean;
  onSeek: (seconds: number) => void;
}

const SeekBar = memo(function SeekBar({
  subscribeTime,
  getTimeSnapshot,
  disabled,
  onSeek,
}: SeekBarProps) {
  const { currentTime, duration } = useSyncExternalStore(
    subscribeTime,
    getTimeSnapshot
  );
  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <>
      <span className="text-[11px] font-mono-num text-[var(--text-muted)] w-9 text-right">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(currentTime, duration || 1)}
        disabled={disabled || duration <= 0}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="t-slider flex-1 min-w-0"
        style={{
          background: `linear-gradient(to right, var(--accent) ${progressPct}%, var(--bg-surface) ${progressPct}%)`,
          borderRadius: 9999,
          height: 5,
        }}
        aria-label="Playback seek"
      />
      <span className="text-[11px] font-mono-num text-[var(--text-muted)] w-9">
        {formatTime(duration)}
      </span>
    </>
  );
});

interface PlayerBarProps {
  engine: AudioEngineState;
  visualizerStyle: VisualizerStyle;
  isRetroVfd: boolean;
  cinematicActive: boolean;
  onToggleFavorite: (trackId: string) => void;
  onEnterCinematic: () => void;
}

export const PlayerBar = memo(function PlayerBar({
  engine,
  visualizerStyle,
  isRetroVfd,
  cinematicActive,
  onToggleFavorite,
  onEnterCinematic,
}: PlayerBarProps) {
  const [showEq, setShowEq] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { nowPlaying, isPlaying, isBuffering } = engine;
  const isRadio = nowPlaying?.kind === "radio";
  const track = nowPlaying?.kind === "track" ? nowPlaying.track : null;
  const station = nowPlaying?.kind === "radio" ? nowPlaying.station : null;

  const coverUrl = track
    ? getCoverUrl(track.cover_hash)
    : station?.favicon || null;

  const title = track?.title ?? station?.name ?? "Nothing playing";
  const subtitle = track
    ? `${track.artist} · ${track.album}`
    : station
    ? station.tags || station.country || "Live Internet Radio"
    : "Choose a track or live radio station";

  const volPct = Math.round((engine.isMuted ? 0 : engine.volume) * 100);

  return (
    <>
      {/* Expanded Now Playing Overlay */}
      {expanded && nowPlaying && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center p-8 bg-[var(--bg-base)]"
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute top-6 right-6 p-2.5 rounded-full bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
            aria-label="Close expanded view"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="max-w-3xl w-full grid md:grid-cols-[280px_1fr] gap-8 items-center">
            <div className="w-64 h-64 md:w-72 md:h-72 mx-auto rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl flex items-center justify-center">
              {coverUrl ? (
                <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              ) : isRadio ? (
                <Radio className="w-16 h-16 text-[var(--accent)]" />
              ) : (
                <Music className="w-16 h-16 text-[var(--text-muted)]" />
              )}
            </div>

            <div className="min-w-0 space-y-4">
              <div>
                <span className="inline-block text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] mb-2">
                  {track
                    ? `${track.format.toUpperCase()}${
                        track.bitrate_kbps ? ` · ${track.bitrate_kbps} kbps` : ""
                      }`
                    : "LIVE INTERNET RADIO"}
                </span>
                <h2 className="text-3xl font-bold text-[var(--text-primary)] truncate">
                  {title}
                </h2>
                <p className="text-sm text-[var(--text-secondary)] mt-1 truncate">
                  {subtitle}
                </p>
              </div>

              {track && engine.queue.length > 1 && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                    Up Next in Queue ({engine.queue.length})
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {engine.queue
                      .slice(engine.queueIndex + 1, engine.queueIndex + 7)
                      .map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => engine.playTrack(q, engine.queue)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-xs hover:bg-[var(--bg-hover)] text-left cursor-pointer"
                        >
                          <span className="truncate text-[var(--text-primary)]">
                            {q.title}{" "}
                            <span className="text-[var(--text-muted)]">— {q.artist}</span>
                          </span>
                          <span className="font-mono-num text-[var(--text-muted)] shrink-0">
                            {formatTime(q.duration_ms / 1000)}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Docked Player Bar */}
      <footer className="h-[86px] w-full shrink-0 px-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] grid grid-cols-[minmax(160px,1fr)_minmax(250px,1.35fr)_minmax(240px,1fr)] items-center gap-3">
        {/* Left: Now Playing Info */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => nowPlaying && setExpanded((v) => !v)}
            disabled={!nowPlaying}
            className="group relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-center cursor-pointer disabled:cursor-default"
            title={nowPlaying ? "Expand Now Playing" : undefined}
          >
            {coverUrl ? (
              <img src={coverUrl} alt="" className="w-full h-full object-cover" />
            ) : isRadio ? (
              <Radio className="w-5 h-5 text-[var(--accent)]" />
            ) : (
              <Music className="w-5 h-5 text-[var(--text-muted)]" />
            )}
            {nowPlaying && (
              <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <ChevronUp className="w-4 h-4 text-white" />
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {title}
            </div>
            <div className="text-xs text-[var(--text-secondary)] truncate">
              {subtitle}
            </div>
          </div>

          {track && (
            <button
              type="button"
              onClick={() => onToggleFavorite(track.id)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                track.is_favorite
                  ? "text-rose-400"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              title="Toggle favorite"
            >
              <Heart className={`w-4 h-4 ${track.is_favorite ? "fill-current" : ""}`} />
            </button>
          )}
        </div>

        {/* Center: Transport & Seek */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={engine.toggleShuffle}
              disabled={isRadio}
              title="Shuffle"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-35 ${
                engine.shuffle
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={engine.playPrevious}
              disabled={!nowPlaying || isRadio}
              title="Previous"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            <button
              type="button"
              onClick={engine.togglePlayPause}
              disabled={!nowPlaying}
              title={isPlaying ? "Pause" : "Play"}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              {isBuffering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => engine.playNext(true)}
              disabled={!nowPlaying || isRadio}
              title="Next"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>

            <button
              type="button"
              onClick={engine.cycleRepeat}
              disabled={isRadio}
              title={`Repeat: ${engine.repeat}`}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-35 ${
                engine.repeat !== "off"
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {engine.repeat === "one" ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="w-full max-w-lg flex items-center gap-2.5">
            {isRadio ? (
              <div className="w-full flex items-center justify-center gap-2 text-[11px] font-mono-num text-[var(--accent)]">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                LIVE RADIO STREAM
                {station?.bitrate ? ` · ${station.bitrate} kbps` : ""}
              </div>
            ) : (
              <SeekBar
                subscribeTime={engine.subscribeTime}
                getTimeSnapshot={engine.getTimeSnapshot}
                disabled={!nowPlaying}
                onSeek={engine.seek}
              />
            )}
          </div>
        </div>

        {/* Right: Visualizer + Speed + EQ + Cinematic + Volume */}
        <div className="flex items-center justify-end gap-2 min-w-0">
          <div className="hidden xl:flex items-center shrink-0">
            <Visualizer
              analyserRef={engine.analyserRef}
              isPlaying={isPlaying && !cinematicActive}
              isRadio={Boolean(isRadio)}
              styleMode={visualizerStyle}
              isRetroVfd={isRetroVfd}
            />
          </div>

          {/* Pitch-Preserved Speed Popover */}
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={isRadio}
              onClick={() => {
                setShowSpeed((v) => !v);
                setShowEq(false);
              }}
              title="Playback speed (pitch preserved)"
              className={`px-2 py-1 rounded-lg text-[11px] font-mono-num font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-35 ${
                showSpeed || engine.playbackRate !== 1.0
                  ? "text-[var(--accent)] bg-[var(--accent-soft)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              <Gauge className="w-3.5 h-3.5" />
              <span>{engine.playbackRate.toFixed(2).replace(/\.?0+$/, "")}x</span>
            </button>

            {showSpeed && (
              <div className="absolute right-0 bottom-11 z-40 w-64 p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      Playback Speed
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Pitch preserved (time-stretch)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => engine.setPlaybackRate(1.0)}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> 1.0x
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono-num">
                    <span className="text-[var(--text-secondary)]">Tempo</span>
                    <span className="text-[var(--accent)] font-semibold">
                      {engine.playbackRate.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={engine.playbackRate}
                    onChange={(e) => engine.setPlaybackRate(Number(e.target.value))}
                    className="t-slider w-full"
                    style={{
                      background: "var(--bg-surface)",
                      borderRadius: 9999,
                      height: 5,
                    }}
                    aria-label="Playback speed"
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {SPEED_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => engine.setPlaybackRate(preset)}
                      className={`py-1 rounded-md text-[11px] font-mono-num font-medium border cursor-pointer ${
                        Math.abs(engine.playbackRate - preset) < 0.01
                          ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                          : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {preset}x
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 3-Band EQ Popover */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowEq((v) => !v);
                setShowSpeed(false);
              }}
              title="3-Band Equalizer"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                showEq ||
                engine.eq.bass !== 0 ||
                engine.eq.mid !== 0 ||
                engine.eq.treble !== 0
                  ? "text-[var(--accent)] bg-[var(--accent-soft)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {showEq && (
              <div className="absolute right-0 bottom-11 z-40 w-60 p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    3-Band EQ
                  </span>
                  <button
                    type="button"
                    onClick={() => engine.setEq({ bass: 0, mid: 0, treble: 0 })}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                </div>

                {(
                  [
                    ["Bass", "bass"],
                    ["Mid", "mid"],
                    ["Treble", "treble"],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono-num">
                      <span className="text-[var(--text-secondary)]">{label}</span>
                      <span className="text-[var(--accent)]">
                        {engine.eq[key] > 0 ? `+${engine.eq[key]}` : engine.eq[key]} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={engine.eq[key]}
                      onChange={(e) =>
                        engine.setEq({ ...engine.eq, [key]: Number(e.target.value) })
                      }
                      className="t-slider w-full"
                      style={{
                        background: "var(--bg-surface)",
                        borderRadius: 9999,
                        height: 5,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cinematic Mode Shortcut */}
          <button
            type="button"
            onClick={onEnterCinematic}
            title="Enter Cinematic Visualizer Mode"
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer shrink-0"
          >
            <Tv className="w-4 h-4" />
          </button>

          {/* Volume */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={engine.toggleMute}
              title={engine.isMuted ? "Unmute" : "Mute"}
              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
            >
              {engine.isMuted || engine.volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={engine.isMuted ? 0 : engine.volume}
              onChange={(e) => engine.setVolume(Number(e.target.value))}
              className="t-slider w-20 min-w-0 shrink-0"
              style={{
                background: `linear-gradient(to right, var(--accent) ${volPct}%, var(--bg-surface) ${volPct}%)`,
                borderRadius: 9999,
                height: 5,
              }}
              aria-label="Volume"
            />
          </div>
        </div>
      </footer>
    </>
  );
});
