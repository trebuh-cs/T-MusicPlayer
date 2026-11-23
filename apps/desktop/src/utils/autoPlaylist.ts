import type { AutoPlaylistConfig, Track } from "../types";

export const DEFAULT_AUTO_PLAYLIST_CONFIG: AutoPlaylistConfig = {
  max_duration_ms: null,
  favorite_boost_enabled: true,
  favorite_boost_factor: 3.0,
  cooldown_enabled: true,
  cooldown_tracks: 10,
  updated_at: 0,
};

export function isTrackEligibleForAutoPlaylist(
  track: Track,
  config: AutoPlaylistConfig
): boolean {
  if (track.play_count < 1) return false;
  if (track.auto_excluded) return false;
  if (
    config.max_duration_ms !== null &&
    config.max_duration_ms > 0 &&
    track.duration_ms > config.max_duration_ms
  ) {
    return false;
  }
  return true;
}

/**
 * Computes selection weight for a track in Auto Playlist.
 *
 * Rules:
 * - Only tracks with `play_count >= 1`, not excluded, and within `max_duration_ms` are eligible.
 * - Targeted manual plays (`manual_play_count`) boost weight substantially; skips reduce weight.
 * - Favorites get a configurable `1.5x .. 10x` multiplier when `favorite_boost_enabled`.
 * - Global recent play history (`recentPlayIds`, index 0 = most recently played across the entire app)
 *   enforces zero back-to-back repeats (when >= 2 eligible tracks) and a decaying debuff over the last `cooldown_tracks` (>= 10) plays.
 */
export function computeAutoPlaylistWeight(
  track: Track,
  config: AutoPlaylistConfig,
  recentPlayIds: string[],
  currentTrackId: string | null = null
): number {
  if (!isTrackEligibleForAutoPlaylist(track, config)) return 0;

  if (currentTrackId && track.id === currentTrackId) {
    return 0;
  }

  const baseWeight =
    1.0 + track.manual_play_count * 1.2 + Math.max(0, track.play_count) * 0.35;
  const skipPenalty = 1.0 / (1.0 + Math.max(0, track.skip_count) * 0.85);
  const favFactor =
    config.favorite_boost_enabled && track.is_favorite
      ? Math.max(1.5, Math.min(10.0, config.favorite_boost_factor))
      : 1.0;

  let cooldownFactor = 1.0;
  const recentIdx = recentPlayIds.indexOf(track.id);
  const windowSize = Math.max(10, config.cooldown_tracks || 10);

  if (recentIdx === 0) {
    return 0;
  } else if (config.cooldown_enabled && recentIdx >= 1 && recentIdx <= windowSize) {
    // Smoothly decays debuff from ~0.04 (just played) up to ~0.69 (at 10 songs ago).
    const progress = (recentIdx - 1) / Math.max(1, windowSize - 1);
    cooldownFactor = 0.04 + progress * 0.65;
  }

  return Math.max(0.0001, baseWeight * skipPenalty * favFactor * cooldownFactor);
}

export function pickNextAutoTrack(
  tracks: Track[],
  config: AutoPlaylistConfig,
  recentPlayIds: string[],
  currentTrackId: string | null = null
): Track | null {
  const eligible = tracks.filter((t) => isTrackEligibleForAutoPlaylist(t, config));
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  const effectiveRecent =
    currentTrackId && recentPlayIds[0] !== currentTrackId
      ? [currentTrackId, ...recentPlayIds]
      : recentPlayIds;

  const weighted = eligible.map((track) => ({
    track,
    weight: computeAutoPlaylistWeight(track, config, effectiveRecent, currentTrackId),
  }));

  const positive = weighted.filter((w) => w.weight > 0);
  if (positive.length === 0) {
    // Fallback if somehow everything was guarded: allow anything except currentTrackId.
    const nonCurrent = eligible.filter((t) => t.id !== currentTrackId);
    const pool = nonCurrent.length > 0 ? nonCurrent : eligible;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const totalWeight = positive.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.random() * totalWeight;
  for (const item of positive) {
    target -= item.weight;
    if (target <= 0) return item.track;
  }
  return positive[positive.length - 1].track;
}

export interface AutoMixEntry {
  track: Track;
  weight: number;
  probabilityPct: number;
  inCooldown: boolean;
}

export function rankAutoMixTracks(
  tracks: Track[],
  config: AutoPlaylistConfig,
  recentPlayIds: string[]
): AutoMixEntry[] {
  const eligible = tracks.filter((t) => isTrackEligibleForAutoPlaylist(t, config));
  const windowSize = Math.max(10, config.cooldown_tracks || 10);

  const raw = eligible.map((track) => {
    const recentIdx = recentPlayIds.indexOf(track.id);
    const baseWeight =
      1.0 + track.manual_play_count * 1.2 + Math.max(0, track.play_count) * 0.35;
    const skipPenalty = 1.0 / (1.0 + Math.max(0, track.skip_count) * 0.85);
    const favFactor =
      config.favorite_boost_enabled && track.is_favorite
        ? Math.max(1.5, Math.min(10.0, config.favorite_boost_factor))
        : 1.0;

    let cooldownFactor = 1.0;
    let inCooldown = false;
    if (config.cooldown_enabled && recentIdx >= 0 && recentIdx <= windowSize) {
      inCooldown = true;
      const dist = Math.max(0, recentIdx);
      const progress = dist / Math.max(1, windowSize);
      cooldownFactor = 0.04 + progress * 0.65;
    }

    return {
      track,
      weight: Math.max(0.01, baseWeight * skipPenalty * favFactor * cooldownFactor),
      inCooldown,
    };
  });

  const total = raw.reduce((s, e) => s + e.weight, 0) || 1;
  return raw
    .map((entry) => ({
      ...entry,
      probabilityPct: (entry.weight / total) * 100,
    }))
    .sort((a, b) => b.weight - a.weight);
}
