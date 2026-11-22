import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getCoverUrl, getStreamUrl } from "../services/api";
import type {
  EqSettings,
  PlayingItem,
  RadioStation,
  RepeatMode,
  Track,
  TrackEditDraft,
} from "../types";

export interface HydrateAudioPrefs {
  volume?: number;
  isMuted?: boolean;
  playbackRate?: number;
  eq?: EqSettings;
  shuffle?: boolean;
  repeat?: RepeatMode;
}

export interface TimeSnapshot {
  currentTime: number;
  duration: number;
}

export interface AudioEngineState {
  nowPlaying: PlayingItem | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  shuffle: boolean;
  repeat: RepeatMode;
  eq: EqSettings;
  audioError: string | null;
  analyserRef: React.RefObject<AnalyserNode | null>;
  getTimeSnapshot: () => TimeSnapshot;
  subscribeTime: (listener: () => void) => () => void;
  playTrack: (track: Track, contextQueue?: Track[]) => void;
  playRadio: (station: RadioStation) => void;
  playNextInQueue: (track: Track) => void;
  enqueueTrack: (track: Track) => void;
  togglePlayPause: () => void;
  playNext: (manual?: boolean) => void;
  playPrevious: () => void;
  seek: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setEq: (eq: EqSettings) => void;
  hydratePreferences: (prefs: HydrateAudioPrefs) => void;
  setLiveEditPreview: (trackId: string, edit: TrackEditDraft | null) => void;
  updateTrackInPlayback: (updated: Track) => void;
  clearError: () => void;
}

const DEFAULT_EQ: EqSettings = { bass: 0, mid: 0, treble: 0 };

function applyPitchPreservedSpeed(audioEl: HTMLAudioElement, rate: number): void {
  const clamped = Math.max(0.5, Math.min(2.0, rate));
  const withWebkit = audioEl as HTMLAudioElement & { webkitPreservesPitch?: boolean };
  audioEl.preservesPitch = true;
  withWebkit.webkitPreservesPitch = true;
  audioEl.defaultPlaybackRate = clamped;
  audioEl.playbackRate = clamped;
}

export function useAudioEngine(
  onTrackPlayRecorded?: (trackId: string) => void,
  resolveTrackUrl?: (track: Track) => string
): AudioEngineState {
  const [nowPlaying, setNowPlaying] = useState<PlayingItem | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [eq, setEqState] = useState<EqSettings>(DEFAULT_EQ);
  const [audioError, setAudioError] = useState<string | null>(null);

  const timeSnapshotRef = useRef<TimeSnapshot>({ currentTime: 0, duration: 0 });
  const timeListenersRef = useRef<Set<() => void>>(new Set());

  const updateTimeSnapshot = useCallback((nextCurrent: number, nextDuration?: number) => {
    const prev = timeSnapshotRef.current;
    const resolvedDuration = nextDuration !== undefined ? nextDuration : prev.duration;
    if (prev.currentTime === nextCurrent && prev.duration === resolvedDuration) return;
    timeSnapshotRef.current = { currentTime: nextCurrent, duration: resolvedDuration };
    for (const listener of timeListenersRef.current) {
      listener();
    }
  }, []);

  const getTimeSnapshot = useCallback(() => timeSnapshotRef.current, []);
  const subscribeTime = useCallback((listener: () => void) => {
    timeListenersRef.current.add(listener);
    return () => {
      timeListenersRef.current.delete(listener);
    };
  }, []);

  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const trackGainNodeRef = useRef<GainNode | null>(null);
  const eqNodesRef = useRef<{
    bass: BiquadFilterNode;
    mid: BiquadFilterNode;
    treble: BiquadFilterNode;
  } | null>(null);

  const liveEditPreviewRef = useRef<{ trackId: string; edit: TrackEditDraft } | null>(null);
  const pendingStartSecRef = useRef<number | null>(null);
  const trimEndTriggeredForRef = useRef<string | null>(null);

  // Refs for callbacks inside event listeners without stale closures.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const nowPlayingRef = useRef(nowPlaying);
  nowPlayingRef.current = nowPlaying;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const eqRef = useRef(eq);
  eqRef.current = eq;
  const resolveTrackUrlRef = useRef(resolveTrackUrl);
  resolveTrackUrlRef.current = resolveTrackUrl;

  const resolveEffectiveTrackEdit = useCallback((track: Track): TrackEditDraft => {
    const preview = liveEditPreviewRef.current;
    if (preview && preview.trackId === track.id) {
      return preview.edit;
    }
    return {
      speed: Number.isFinite(track.edit_speed) && track.edit_speed > 0 ? track.edit_speed : 1.0,
      gain_db: Number.isFinite(track.edit_gain_db) ? track.edit_gain_db : 0.0,
      trim_start_ms: track.trim_start_ms ?? 0,
      trim_end_ms: track.trim_end_ms ?? null,
    };
  }, []);

  const applyTrackPlaybackParams = useCallback(
    (track: Track | null) => {
      const localEl = localAudioRef.current;
      const edit = track ? resolveEffectiveTrackEdit(track) : null;
      const effectiveSpeed = Math.max(
        0.5,
        Math.min(2.0, playbackRateRef.current * (edit ? edit.speed : 1.0))
      );
      if (localEl) {
        applyPitchPreservedSpeed(localEl, effectiveSpeed);
      }

      const gainNode = trackGainNodeRef.current;
      if (gainNode) {
        const gainDb = edit ? Math.max(-18, Math.min(12, edit.gain_db)) : 0;
        const linear = Math.pow(10, gainDb / 20);
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state === "running") {
          gainNode.gain.setTargetAtTime(linear, ctx.currentTime, 0.015);
        } else {
          gainNode.gain.value = linear;
        }
      }
    },
    [resolveEffectiveTrackEdit]
  );

  const ensureLocalGraph = useCallback(() => {
    const audioEl = localAudioRef.current;
    if (!audioEl) return;

    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audioEl);

      const bass = ctx.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 120;
      bass.gain.value = eqRef.current.bass;

      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 1.0;
      mid.gain.value = eqRef.current.mid;

      const treble = ctx.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 8000;
      treble.gain.value = eqRef.current.treble;

      const trackGain = ctx.createGain();
      trackGain.gain.value = 1.0;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;

      source.connect(bass);
      bass.connect(mid);
      mid.connect(treble);
      treble.connect(trackGain);
      trackGain.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      trackGainNodeRef.current = trackGain;
      eqNodesRef.current = { bass, mid, treble };
    }

    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
  }, []);

  const stopRadioAudio = useCallback(() => {
    const radioEl = radioAudioRef.current;
    if (radioEl) {
      radioEl.pause();
      radioEl.removeAttribute("src");
      radioEl.load();
    }
  }, []);

  const stopLocalAudio = useCallback(() => {
    const localEl = localAudioRef.current;
    if (localEl) {
      localEl.pause();
      localEl.removeAttribute("src");
      localEl.load();
    }
  }, []);

  const startTrackElement = useCallback(
    (track: Track) => {
      stopRadioAudio();
      const localEl = localAudioRef.current;
      if (!localEl) return;

      ensureLocalGraph();
      const edit = resolveEffectiveTrackEdit(track);
      const startSec = edit.trim_start_ms > 0 ? edit.trim_start_ms / 1000 : 0;
      pendingStartSecRef.current = startSec > 0 ? startSec : null;
      trimEndTriggeredForRef.current = null;

      setAudioError(null);
      setIsBuffering(true);
      updateTimeSnapshot(startSec, track.duration_ms > 0 ? track.duration_ms / 1000 : 0);
      setNowPlaying({ kind: "track", track });

      localEl.src = resolveTrackUrlRef.current
        ? resolveTrackUrlRef.current(track)
        : getStreamUrl(track.id);
      applyTrackPlaybackParams(track);
      localEl.load();
      applyTrackPlaybackParams(track);
      localEl
        .play()
        .then(() => {
          applyTrackPlaybackParams(track);
          setIsPlaying(true);
          setIsBuffering(false);
          void api.recordPlay(track.id).catch(() => {});
          onTrackPlayRecorded?.(track.id);
        })
        .catch((err) => {
          setIsPlaying(false);
          setIsBuffering(false);
          setAudioError(`Unable to play "${track.title}": ${err?.message ?? "playback error"}`);
        });
    },
    [
      applyTrackPlaybackParams,
      ensureLocalGraph,
      onTrackPlayRecorded,
      resolveEffectiveTrackEdit,
      stopRadioAudio,
      updateTimeSnapshot,
    ]
  );

  const playTrack = useCallback(
    (track: Track, contextQueue?: Track[]) => {
      const nextQueue = contextQueue && contextQueue.length > 0 ? contextQueue : [track];
      const idx = nextQueue.findIndex((t) => t.id === track.id);
      const resolvedQueue = idx >= 0 ? nextQueue : [track, ...nextQueue];
      const resolvedIdx = idx >= 0 ? idx : 0;

      setQueue(resolvedQueue);
      setQueueIndex(resolvedIdx);
      startTrackElement(track);
    },
    [startTrackElement]
  );

  const playRadio = useCallback(
    (station: RadioStation) => {
      stopLocalAudio();
      const radioEl = radioAudioRef.current;
      if (!radioEl) return;

      setAudioError(null);
      setIsBuffering(true);
      updateTimeSnapshot(0, 0);
      setNowPlaying({ kind: "radio", station });

      radioEl.src = station.url;
      radioEl.load();
      radioEl
        .play()
        .then(() => {
          setIsPlaying(true);
          setIsBuffering(false);
        })
        .catch((err) => {
          setIsPlaying(false);
          setIsBuffering(false);
          setAudioError(
            `Could not connect to "${station.name}": ${err?.message ?? "stream offline"}`
          );
        });
    },
    [stopLocalAudio, updateTimeSnapshot]
  );

  const playNext = useCallback(
    (manual = true) => {
      const current = nowPlayingRef.current;
      if (!current || current.kind === "radio") return;

      const list = queueRef.current;
      const idx = queueIndexRef.current;
      if (list.length === 0) return;

      if (!manual && repeatRef.current === "one") {
        const localEl = localAudioRef.current;
        if (localEl) {
          const edit = resolveEffectiveTrackEdit(current.track);
          const startSec = edit.trim_start_ms > 0 ? edit.trim_start_ms / 1000 : 0;
          trimEndTriggeredForRef.current = null;
          localEl.currentTime = startSec;
          void localEl.play();
        }
        return;
      }

      let nextIdx = -1;
      if (shuffleRef.current && list.length > 1) {
        do {
          nextIdx = Math.floor(Math.random() * list.length);
        } while (nextIdx === idx);
      } else if (idx + 1 < list.length) {
        nextIdx = idx + 1;
      } else if (repeatRef.current === "all") {
        nextIdx = 0;
      }

      if (nextIdx >= 0 && list[nextIdx]) {
        setQueueIndex(nextIdx);
        startTrackElement(list[nextIdx]);
      } else {
        setIsPlaying(false);
      }
    },
    [resolveEffectiveTrackEdit, startTrackElement]
  );

  const playPrevious = useCallback(() => {
    const current = nowPlayingRef.current;
    if (!current || current.kind === "radio") return;

    const edit = resolveEffectiveTrackEdit(current.track);
    const startSec = edit.trim_start_ms > 0 ? edit.trim_start_ms / 1000 : 0;
    const localEl = localAudioRef.current;
    if (localEl && localEl.currentTime > startSec + 3) {
      trimEndTriggeredForRef.current = null;
      localEl.currentTime = startSec;
      updateTimeSnapshot(startSec);
      return;
    }

    const list = queueRef.current;
    const idx = queueIndexRef.current;
    if (list.length === 0) return;

    const prevIdx = idx > 0 ? idx - 1 : repeatRef.current === "all" ? list.length - 1 : 0;
    if (list[prevIdx]) {
      setQueueIndex(prevIdx);
      startTrackElement(list[prevIdx]);
    }
  }, [resolveEffectiveTrackEdit, startTrackElement, updateTimeSnapshot]);

  const togglePlayPause = useCallback(() => {
    const current = nowPlayingRef.current;
    if (!current) return;

    const activeEl = current.kind === "radio" ? radioAudioRef.current : localAudioRef.current;
    if (!activeEl) return;

    if (activeEl.paused) {
      if (current.kind === "track") {
        ensureLocalGraph();
        applyTrackPlaybackParams(current.track);
      }
      void activeEl
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => setAudioError(err?.message ?? "Playback failed"));
    } else {
      activeEl.pause();
      setIsPlaying(false);
    }
  }, [applyTrackPlaybackParams, ensureLocalGraph]);

  const seek = useCallback(
    (seconds: number) => {
      const current = nowPlayingRef.current;
      const localEl = localAudioRef.current;
      if (!current || current.kind !== "track" || !localEl) return;
      trimEndTriggeredForRef.current = null;
      localEl.currentTime = Math.max(0, seconds);
      updateTimeSnapshot(localEl.currentTime);
    },
    [updateTimeSnapshot]
  );

  const playNextInQueue = useCallback(
    (track: Track) => {
      if (queueRef.current.length === 0 || !nowPlayingRef.current) {
        playTrack(track, [track]);
        return;
      }
      setQueue((prev) => {
        const filtered = prev.filter((t) => t.id !== track.id);
        const insertAt = Math.min(filtered.length, Math.max(0, queueIndexRef.current + 1));
        const copy = [...filtered];
        copy.splice(insertAt, 0, track);
        return copy;
      });
    },
    [playTrack]
  );

  const enqueueTrack = useCallback(
    (track: Track) => {
      if (queueRef.current.length === 0 || !nowPlayingRef.current) {
        playTrack(track, [track]);
        return;
      }
      setQueue((prev) => (prev.some((t) => t.id === track.id) ? prev : [...prev, track]));
    },
    [playTrack]
  );

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    if (clamped > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const rounded = Math.round(Math.max(0.5, Math.min(2.0, rate)) * 100) / 100;
      playbackRateRef.current = rounded;
      setPlaybackRateState(rounded);
      const activeTrack =
        nowPlayingRef.current?.kind === "track" ? nowPlayingRef.current.track : null;
      applyTrackPlaybackParams(activeTrack);
    },
    [applyTrackPlaybackParams]
  );

  const setLiveEditPreview = useCallback(
    (trackId: string, edit: TrackEditDraft | null) => {
      if (edit) {
        liveEditPreviewRef.current = { trackId, edit };
      } else if (liveEditPreviewRef.current?.trackId === trackId) {
        liveEditPreviewRef.current = null;
      }
      const activeTrack =
        nowPlayingRef.current?.kind === "track" ? nowPlayingRef.current.track : null;
      if (activeTrack && activeTrack.id === trackId) {
        trimEndTriggeredForRef.current = null;
        applyTrackPlaybackParams(activeTrack);
      }
    },
    [applyTrackPlaybackParams]
  );

  const updateTrackInPlayback = useCallback(
    (updated: Track) => {
      setQueue((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setNowPlaying((prev) =>
        prev?.kind === "track" && prev.track.id === updated.id
          ? { kind: "track", track: updated }
          : prev
      );
      if (nowPlayingRef.current?.kind === "track" && nowPlayingRef.current.track.id === updated.id) {
        nowPlayingRef.current = { kind: "track", track: updated };
        trimEndTriggeredForRef.current = null;
        applyTrackPlaybackParams(updated);
      }
    },
    [applyTrackPlaybackParams]
  );

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    []
  );

  const setEq = useCallback((nextEq: EqSettings) => {
    eqRef.current = nextEq;
    setEqState(nextEq);
    if (eqNodesRef.current) {
      eqNodesRef.current.bass.gain.value = nextEq.bass;
      eqNodesRef.current.mid.gain.value = nextEq.mid;
      eqNodesRef.current.treble.gain.value = nextEq.treble;
    }
  }, []);

  const hydratePreferences = useCallback(
    (prefs: HydrateAudioPrefs) => {
      if (typeof prefs.volume === "number" && Number.isFinite(prefs.volume)) {
        setVolumeState(Math.max(0, Math.min(1, prefs.volume)));
      }
      if (typeof prefs.isMuted === "boolean") {
        setIsMuted(prefs.isMuted);
      }
      if (typeof prefs.playbackRate === "number" && Number.isFinite(prefs.playbackRate)) {
        const rounded = Math.round(Math.max(0.5, Math.min(2.0, prefs.playbackRate)) * 100) / 100;
        playbackRateRef.current = rounded;
        setPlaybackRateState(rounded);
        const activeTrack =
          nowPlayingRef.current?.kind === "track" ? nowPlayingRef.current.track : null;
        applyTrackPlaybackParams(activeTrack);
      }
      if (prefs.eq) {
        eqRef.current = prefs.eq;
        setEqState(prefs.eq);
        if (eqNodesRef.current) {
          eqNodesRef.current.bass.gain.value = prefs.eq.bass;
          eqNodesRef.current.mid.gain.value = prefs.eq.mid;
          eqNodesRef.current.treble.gain.value = prefs.eq.treble;
        }
      }
      if (typeof prefs.shuffle === "boolean") {
        setShuffle(prefs.shuffle);
      }
      if (prefs.repeat === "off" || prefs.repeat === "all" || prefs.repeat === "one") {
        setRepeat(prefs.repeat);
      }
    },
    [applyTrackPlaybackParams]
  );

  const clearError = useCallback(() => setAudioError(null), []);

  // Create and wire up both HTML5 <audio> elements once on mount.
  useEffect(() => {
    const localEl = new Audio();
    localEl.crossOrigin = "anonymous";
    localEl.preload = "auto";

    const radioEl = new Audio();
    radioEl.preload = "none";

    localAudioRef.current = localEl;
    radioAudioRef.current = radioEl;

    const checkTrimEnd = () => {
      const current = nowPlayingRef.current;
      if (!current || current.kind !== "track" || localEl.paused) return;
      const edit = resolveEffectiveTrackEdit(current.track);
      if (edit.trim_end_ms === null || edit.trim_end_ms <= edit.trim_start_ms) return;
      const endSec = edit.trim_end_ms / 1000;
      if (localEl.currentTime >= endSec - 0.04) {
        if (repeatRef.current === "one") {
          localEl.currentTime = edit.trim_start_ms > 0 ? edit.trim_start_ms / 1000 : 0;
          return;
        }
        if (trimEndTriggeredForRef.current !== current.track.id) {
          trimEndTriggeredForRef.current = current.track.id;
          playNext(false);
        }
      }
    };

    const onTimeUpdate = () => {
      updateTimeSnapshot(localEl.currentTime || 0);
      checkTrimEnd();
    };
    const onDurationChange = () => {
      if (Number.isFinite(localEl.duration) && localEl.duration > 0) {
        updateTimeSnapshot(timeSnapshotRef.current.currentTime, localEl.duration);
      }
    };
    const onEnded = () => playNext(false);
    const onLocalWaiting = () => setIsBuffering(true);
    const onLocalLoadedMetadata = () => {
      const activeTrack =
        nowPlayingRef.current?.kind === "track" ? nowPlayingRef.current.track : null;
      applyTrackPlaybackParams(activeTrack);
      if (pendingStartSecRef.current !== null && Number.isFinite(localEl.duration)) {
        const target = Math.min(pendingStartSecRef.current, Math.max(0, localEl.duration - 0.1));
        localEl.currentTime = target;
        pendingStartSecRef.current = null;
      }
      if (Number.isFinite(localEl.duration) && localEl.duration > 0) {
        updateTimeSnapshot(localEl.currentTime || 0, localEl.duration);
      }
    };
    const onLocalPlaying = () => {
      const activeTrack =
        nowPlayingRef.current?.kind === "track" ? nowPlayingRef.current.track : null;
      applyTrackPlaybackParams(activeTrack);
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const onLocalError = () => {
      setIsBuffering(false);
      setIsPlaying(false);
      setAudioError("Audio decoding or stream error for this track.");
    };

    const onRadioWaiting = () => setIsBuffering(true);
    const onRadioPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const onRadioError = () => {
      setIsBuffering(false);
      setIsPlaying(false);
      if (nowPlayingRef.current?.kind === "radio") {
        setAudioError("Radio stream unavailable or disconnected.");
      }
    };

    localEl.addEventListener("timeupdate", onTimeUpdate);
    localEl.addEventListener("durationchange", onDurationChange);
    localEl.addEventListener("loadedmetadata", onLocalLoadedMetadata);
    localEl.addEventListener("ended", onEnded);
    localEl.addEventListener("waiting", onLocalWaiting);
    localEl.addEventListener("playing", onLocalPlaying);
    localEl.addEventListener("error", onLocalError);

    radioEl.addEventListener("waiting", onRadioWaiting);
    radioEl.addEventListener("playing", onRadioPlaying);
    radioEl.addEventListener("error", onRadioError);

    // Lightweight 100ms watcher for accurate end-trim cutoffs while playing.
    const trimInterval = window.setInterval(checkTrimEnd, 100);

    return () => {
      window.clearInterval(trimInterval);
      localEl.pause();
      radioEl.pause();
      localEl.removeEventListener("timeupdate", onTimeUpdate);
      localEl.removeEventListener("durationchange", onDurationChange);
      localEl.removeEventListener("loadedmetadata", onLocalLoadedMetadata);
      localEl.removeEventListener("ended", onEnded);
      localEl.removeEventListener("waiting", onLocalWaiting);
      localEl.removeEventListener("playing", onLocalPlaying);
      localEl.removeEventListener("error", onLocalError);
      radioEl.removeEventListener("waiting", onRadioWaiting);
      radioEl.removeEventListener("playing", onRadioPlaying);
      radioEl.removeEventListener("error", onRadioError);
      void audioCtxRef.current?.close();
    };
  }, [applyTrackPlaybackParams, playNext, resolveEffectiveTrackEdit, updateTimeSnapshot]);

  // Sync volume & mute to both audio elements.
  useEffect(() => {
    const effective = isMuted ? 0 : volume;
    if (localAudioRef.current) localAudioRef.current.volume = effective;
    if (radioAudioRef.current) radioAudioRef.current.volume = effective;
  }, [volume, isMuted]);

  // Keep Windows Media Session (media keys / taskbar overlay) updated.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !nowPlaying) return;

    if (nowPlaying.kind === "track") {
      const cover = getCoverUrl(nowPlaying.track.cover_hash);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.track.title,
        artist: nowPlaying.track.artist,
        album: nowPlaying.track.album,
        artwork: cover ? [{ src: cover }] : [],
      });
    } else {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.station.name,
        artist: "Live Internet Radio",
        album: nowPlaying.station.tags || "T - MusicPlayer",
        artwork: nowPlaying.station.favicon ? [{ src: nowPlaying.station.favicon }] : [],
      });
    }

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => togglePlayPause());
    navigator.mediaSession.setActionHandler("pause", () => togglePlayPause());
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrevious());
    navigator.mediaSession.setActionHandler("nexttrack", () => playNext(true));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seek(details.seekTime);
    });
  }, [nowPlaying, isPlaying, playNext, playPrevious, seek, togglePlayPause]);

  return useMemo(
    () => ({
      nowPlaying,
      queue,
      queueIndex,
      isPlaying,
      isBuffering,
      volume,
      isMuted,
      playbackRate,
      shuffle,
      repeat,
      eq,
      audioError,
      analyserRef,
      getTimeSnapshot,
      subscribeTime,
      playTrack,
      playRadio,
      playNextInQueue,
      enqueueTrack,
      togglePlayPause,
      playNext,
      playPrevious,
      seek,
      setVolume,
      toggleMute,
      setPlaybackRate,
      toggleShuffle,
      cycleRepeat,
      setEq,
      hydratePreferences,
      setLiveEditPreview,
      updateTrackInPlayback,
      clearError,
    }),
    [
      nowPlaying,
      queue,
      queueIndex,
      isPlaying,
      isBuffering,
      volume,
      isMuted,
      playbackRate,
      shuffle,
      repeat,
      eq,
      audioError,
      getTimeSnapshot,
      subscribeTime,
      playTrack,
      playRadio,
      playNextInQueue,
      enqueueTrack,
      togglePlayPause,
      playNext,
      playPrevious,
      seek,
      setVolume,
      toggleMute,
      setPlaybackRate,
      toggleShuffle,
      cycleRepeat,
      setEq,
      hydratePreferences,
      setLiveEditPreview,
      updateTrackInPlayback,
      clearError,
    ]
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDurationMs(ms: number): string {
  return formatTime(ms / 1000);
}
