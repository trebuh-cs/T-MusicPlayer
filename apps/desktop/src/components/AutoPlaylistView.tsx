import { memo, useMemo, useState } from "react";
import {
  Ban,
  Heart,
  Music,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { formatDurationMs } from "../hooks/useAudioEngine";
import { getCoverUrl } from "../services/api";
import type { AutoPlaylistConfig, Track } from "../types";
import { rankAutoMixTracks } from "../utils/autoPlaylist";

interface AutoPlaylistViewProps {
  tracks: Track[];
  config: AutoPlaylistConfig;
  recentPlayIds: string[];
  activeTrackId: string | null;
  isAutoMixActive: boolean;
  onStartAutoMix: () => void;
  onPlaySpecificTrack: (track: Track) => void;
  onUpdateConfig: (next: AutoPlaylistConfig) => void;
  onToggleAutoExcluded: (track: Track, excluded: boolean) => void;
  onToggleFavorite: (trackId: string) => void;
}

export const AutoPlaylistView = memo(function AutoPlaylistView({
  tracks,
  config,
  recentPlayIds,
  activeTrackId,
  isAutoMixActive,
  onStartAutoMix,
  onPlaySpecificTrack,
  onUpdateConfig,
  onToggleAutoExcluded,
  onToggleFavorite,
}: AutoPlaylistViewProps) {
  const [showExcluded, setShowExcluded] = useState(false);

  const ranked = useMemo(
    () => rankAutoMixTracks(tracks, config, recentPlayIds),
    [tracks, config, recentPlayIds]
  );

  const excludedTracks = useMemo(
    () => tracks.filter((t) => t.auto_excluded),
    [tracks]
  );

  const maxMinutes = config.max_duration_ms
    ? Math.max(1, Math.round(config.max_duration_ms / 60_000))
    : 8;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Auto Playlist
            </h1>
            {isAutoMixActive && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                Playing Mix
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Adaptive mix built automatically from every track you&apos;ve played at least once ({ranked.length} eligible · {excludedTracks.length} excluded)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={ranked.length === 0}
            onClick={onStartAutoMix}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            style={{
              background: "var(--accent)",
              color: "var(--accent-contrast)",
            }}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isAutoMixActive ? "Skip to Next Auto Pick" : "Play Auto Mix"}
          </button>
        </div>
      </div>

      {/* Synced Rules & Preferences */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Max Duration */}
        <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Max Song Length
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                Exclude long mixes or podcasts
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  ...config,
                  max_duration_ms: config.max_duration_ms ? null : maxMinutes * 60_000,
                })
              }
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                config.max_duration_ms
                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
              }`}
            >
              {config.max_duration_ms ? `${maxMinutes} min max` : "Unlimited"}
            </button>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            disabled={!config.max_duration_ms}
            value={maxMinutes}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                max_duration_ms: Number(e.target.value) * 60_000,
              })
            }
            className="w-full accent-[var(--accent)] disabled:opacity-40 cursor-pointer"
          />
        </div>

        {/* Favorites Boost */}
        <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Favorites Weight Boost
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                Multiply frequency for favorited tracks
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  ...config,
                  favorite_boost_enabled: !config.favorite_boost_enabled,
                })
              }
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                config.favorite_boost_enabled
                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
              }`}
            >
              {config.favorite_boost_enabled
                ? `${config.favorite_boost_factor.toFixed(1)}x`
                : "Off"}
            </button>
          </div>
          <input
            type="range"
            min={1.5}
            max={10}
            step={0.5}
            disabled={!config.favorite_boost_enabled}
            value={config.favorite_boost_factor}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                favorite_boost_factor: Number(e.target.value),
              })
            }
            className="w-full accent-[var(--accent)] disabled:opacity-40 cursor-pointer"
          />
        </div>

        {/* Cooldown Debuff */}
        <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--accent)]" />
                10-Song Cooldown Debuff
              </div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                Never repeats back-to-back &amp; cools down every played song across all views
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  ...config,
                  cooldown_enabled: !config.cooldown_enabled,
                })
              }
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                config.cooldown_enabled
                  ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
              }`}
            >
              {config.cooldown_enabled ? "On (10 songs)" : "Off"}
            </button>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
            <SlidersHorizontal className="w-3 h-3" />
            Rules &amp; stats sync automatically between PC &amp; Pixel 7.
          </div>
        </div>
      </div>

      {/* Excluded Tracks Toggle */}
      {excludedTracks.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowExcluded((s) => !s)}
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
          >
            <Ban className="w-3.5 h-3.5 text-rose-400" />
            {showExcluded
              ? `Hide Excluded Tracks (${excludedTracks.length})`
              : `Manage Excluded Tracks (${excludedTracks.length})`}
          </button>

          {showExcluded && (
            <div className="mt-2 p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-1.5">
              {excludedTracks.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)]"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {track.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] truncate">
                      {track.artist} · {formatDurationMs(track.duration_ms)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleAutoExcluded(track, false)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--accent)] hover:brightness-110 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Weighted Track Pool */}
      <div className="mt-5">
        {ranked.length === 0 ? (
          <div className="my-12 mx-auto max-w-md text-center p-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-[var(--accent-soft)] flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[var(--accent)]" />
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Auto Playlist is warming up
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
              Play any track at least once (or loosen your Max Song Length / Excluded tracks filters) to add songs to your adaptive mix.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {ranked.map(({ track, probabilityPct, inCooldown }) => {
              const isActive = track.id === activeTrackId;
              const coverUrl = getCoverUrl(track.cover_hash);
              return (
                <div
                  key={track.id}
                  onDoubleClick={() => onPlaySpecificTrack(track)}
                  className={`group flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${
                    isActive
                      ? "bg-[var(--accent-soft)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onPlaySpecificTrack(track)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer shrink-0"
                    title="Play from Auto Mix"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>

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

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-sm font-medium truncate ${
                          isActive ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                        }`}
                      >
                        {track.title}
                      </span>
                      {inCooldown && (
                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">
                          Cooldown
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate">
                      {track.artist} · {formatDurationMs(track.duration_ms)}
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono-num text-[var(--text-muted)] shrink-0">
                    <span title="Targeted plays">+{track.manual_play_count} picks</span>
                    <span title="Early skips">−{track.skip_count} skips</span>
                    <span
                      className="px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--accent)]"
                      title="Current selection probability"
                    >
                      {probabilityPct >= 10
                        ? `${probabilityPct.toFixed(0)}%`
                        : `${probabilityPct.toFixed(1)}%`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onToggleFavorite(track.id)}
                    title={track.is_favorite ? "Remove favorite" : "Favorite"}
                    className={`p-1.5 rounded-lg cursor-pointer ${
                      track.is_favorite
                        ? "text-rose-400"
                        : "text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${track.is_favorite ? "fill-current" : ""}`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleAutoExcluded(track, true)}
                    title="Exclude from Auto Playlist"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-rose-400 cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
