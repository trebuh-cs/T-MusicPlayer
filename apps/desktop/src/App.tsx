import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AlertCircle, X } from "lucide-react";
import { AutoPlaylistView } from "./components/AutoPlaylistView";
import { CinematicOverlay } from "./components/CinematicOverlay";
import { CinematicSettingsModal } from "./components/CinematicSettingsModal";
import { PlayerBar } from "./components/PlayerBar";
import { RadioView } from "./components/RadioView";
import { ServerSyncView } from "./components/ServerSyncView";
import { Sidebar } from "./components/Sidebar";
import { ThemeDrawer } from "./components/ThemeDrawer";
import { TopBar } from "./components/TopBar";
import { TrackEditorModal } from "./components/TrackEditorModal";
import { TrackList } from "./components/TrackList";
import { WmpImportModal } from "./components/WmpImportModal";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { api, getCoverUrl, getTrackPlaybackUrl } from "./services/api";
import {
  DEFAULT_AUTO_PLAYLIST_CONFIG,
  isTrackEligibleForAutoPlaylist,
  pickNextAutoTrack,
} from "./utils/autoPlaylist";
import {
  applyThemeToDocument,
  extractAccentFromImage,
  getThemeById,
  type AdaptiveAccent,
} from "./themes/themes";
import {
  DEFAULT_CINEMATIC_CONFIG,
  mergeVisualizerConfig,
  type ActiveView,
  type AutoPlaylistConfig,
  type CinematicConfig,
  type DesktopWallpaperPayload,
  type EqSettings,
  type MonitorInfo,
  type MusicFolder,
  type Playlist,
  type RadioStation,
  type RepeatMode,
  type SavedVisualizerTheme,
  type SyncProgressEvent,
  type SyncSummary,
  type Track,
  type TrackEditDraft,
  type VisualizerStyle,
} from "./types";

function parseJsonSetting<T>(raw: string | undefined): Partial<T> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return null;
  }
}

export function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [radioFavorites, setRadioFavorites] = useState<RadioStation[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>({ kind: "library" });
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);

  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [themeId, setThemeId] = useState("obsidian");
  const [matchAlbumArt, setMatchAlbumArt] = useState(false);
  const [adaptiveAccent, setAdaptiveAccent] = useState<AdaptiveAccent | null>(null);
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>("bars");
  const [cinematicConfig, setCinematicConfig] = useState<CinematicConfig>(
    DEFAULT_CINEMATIC_CONFIG
  );

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cinematicMode, setCinematicMode] = useState(false);
  const [wallpaperMode, setWallpaperMode] = useState(false);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [savedVisualizerThemes, setSavedVisualizerThemes] = useState<
    SavedVisualizerTheme[]
  >([]);
  const [showCinematicSettings, setShowCinematicSettings] = useState(false);
  const [showWmpModal, setShowWmpModal] = useState(false);
  const [showThemeDrawer, setShowThemeDrawer] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const [serverUrl, setServerUrl] = useState("");
  const [serverToken, setServerToken] = useState("");
  const [serverUsername, setServerUsername] = useState("");
  const [serverRole, setServerRole] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<SyncSummary | null>(null);
  const [autoConfig, setAutoConfig] = useState<AutoPlaylistConfig>(
    DEFAULT_AUTO_PLAYLIST_CONFIG
  );
  const [recentPlayIds, setRecentPlayIds] = useState<string[]>([]);

  const cinematicEnteredFullscreenRef = useRef(false);
  const pendingWritesRef = useRef<Map<string, string>>(new Map());
  const writeTimersRef = useRef<Map<string, number>>(new Map());
  const autoSyncTimerRef = useRef<number | null>(null);
  const lastFocusSyncAtRef = useRef<number>(0);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const autoConfigRef = useRef(autoConfig);
  autoConfigRef.current = autoConfig;
  const recentPlayIdsRef = useRef(recentPlayIds);
  recentPlayIdsRef.current = recentPlayIds;
  const serverConnectedRef = useRef(false);
  serverConnectedRef.current = Boolean(serverToken && serverUrl);
  const isSyncingRef = useRef(false);
  isSyncingRef.current = isSyncing;
  const scheduleAutoSyncRef = useRef<(delayMs?: number) => void>(() => {});

  const scheduleSettingWrite = useCallback(
    (key: string, value: string, immediate = false) => {
      const existingTimer = writeTimersRef.current.get(key);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        writeTimersRef.current.delete(key);
      }

      if (immediate) {
        pendingWritesRef.current.delete(key);
        void api.saveSetting(key, value).catch(() => {});
        return;
      }

      pendingWritesRef.current.set(key, value);
      const timer = window.setTimeout(() => {
        writeTimersRef.current.delete(key);
        const latest = pendingWritesRef.current.get(key);
        if (latest !== undefined) {
          pendingWritesRef.current.delete(key);
          void api.saveSetting(key, latest).catch(() => {});
        }
      }, 100);
      writeTimersRef.current.set(key, timer);
    },
    []
  );

  const onTrackPlayRecorded = useCallback(
    (updated: Track) => {
      setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setPlaylistTracks((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
      setRecentPlayIds((prev) => {
        const next = [updated.id, ...prev.filter((id) => id !== updated.id)].slice(0, 25);
        scheduleSettingWrite("auto_recent_play_ids", JSON.stringify(next), true);
        return next;
      });
      scheduleAutoSyncRef.current(4000);
    },
    [scheduleSettingWrite]
  );

  const onTrackSkipped = useCallback((updated: Track) => {
    setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setPlaylistTracks((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
    scheduleAutoSyncRef.current(4000);
  }, []);

  const autoNextTrackProvider = useCallback((currentTrackId: string | null) => {
    return pickNextAutoTrack(
      tracksRef.current,
      autoConfigRef.current,
      recentPlayIdsRef.current,
      currentTrackId
    );
  }, []);

  const resolveTrackUrl = useCallback(
    (track: Track) => getTrackPlaybackUrl(track, serverUrl, serverToken),
    [serverUrl, serverToken]
  );

  const engine = useAudioEngine(
    onTrackPlayRecorded,
    resolveTrackUrl,
    onTrackSkipped,
    autoNextTrackProvider
  );
  const { hydratePreferences } = engine;

  const flushPendingSettings = useCallback(async () => {
    for (const timer of writeTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    writeTimersRef.current.clear();

    const entries = Array.from(pendingWritesRef.current.entries());
    pendingWritesRef.current.clear();
    await Promise.all(
      entries.map(([k, v]) => api.saveSetting(k, v).catch(() => {}))
    );
  }, []);

  const refreshLibrary = useCallback(
    async (hydrateSettings = false) => {
      const snap = await api.getLibrary();
      setTracks(snap.tracks);
      setFolders(snap.folders);
      setPlaylists(snap.playlists);
      setRadioFavorites(snap.radio_favorites);

      const s = snap.settings;
      setServerUrl(s.server_url ?? "");
      setServerToken(s.server_token ?? "");
      setServerUsername(s.server_username ?? "");
      setServerRole(s.server_role ?? "");
      const parsedLastSync =
        s.last_sync_at !== undefined ? Number(s.last_sync_at) : NaN;
      setLastSyncAt(Number.isFinite(parsedLastSync) ? parsedLastSync : null);

      const parsedAutoCfg = parseJsonSetting<AutoPlaylistConfig>(s.auto_playlist_config);
      if (parsedAutoCfg) {
        setAutoConfig({ ...DEFAULT_AUTO_PLAYLIST_CONFIG, ...parsedAutoCfg });
      }
      if (s.auto_recent_play_ids && !hydrateSettings) {
        // Keep in-memory recent IDs unless hydrating from DB on startup.
      } else if (s.auto_recent_play_ids) {
        try {
          const arr = JSON.parse(s.auto_recent_play_ids);
          if (Array.isArray(arr)) {
            setRecentPlayIds(arr.filter((v): v is string => typeof v === "string").slice(0, 25));
          }
        } catch {
          // ignore invalid JSON
        }
      }

      if (!hydrateSettings) return;
      if (s.theme_id) setThemeId(s.theme_id);
      if (s.match_album_art !== undefined) {
        setMatchAlbumArt(s.match_album_art === "true");
      }
      if (
        s.visualizer_style === "bars" ||
        s.visualizer_style === "mirrored" ||
        s.visualizer_style === "off"
      ) {
        setVisualizerStyle(s.visualizer_style);
      }

      const parsedCinematic = parseJsonSetting<CinematicConfig>(s.cinematic_config);
      if (parsedCinematic) {
        setCinematicConfig(
          mergeVisualizerConfig(parsedCinematic, DEFAULT_CINEMATIC_CONFIG)
        );
      }
      if (s.visualizer_saved_themes) {
        try {
          const parsedThemes = JSON.parse(s.visualizer_saved_themes);
          if (Array.isArray(parsedThemes)) {
            setSavedVisualizerThemes(parsedThemes as SavedVisualizerTheme[]);
          }
        } catch {
          // Ignore malformed saved themes
        }
      }

      const parsedVol = s.volume !== undefined ? Number(s.volume) : undefined;
      const parsedRate =
        s.playback_rate !== undefined ? Number(s.playback_rate) : undefined;
      const parsedEq = parseJsonSetting<EqSettings>(s.eq_settings);
      const parsedRepeat =
        s.repeat === "off" || s.repeat === "all" || s.repeat === "one"
          ? (s.repeat as RepeatMode)
          : undefined;

      hydratePreferences({
        volume: Number.isFinite(parsedVol) ? parsedVol : undefined,
        isMuted: s.is_muted !== undefined ? s.is_muted === "true" : undefined,
        playbackRate: Number.isFinite(parsedRate) ? parsedRate : undefined,
        eq:
          parsedEq &&
          typeof parsedEq.bass === "number" &&
          typeof parsedEq.mid === "number" &&
          typeof parsedEq.treble === "number"
            ? (parsedEq as EqSettings)
            : undefined,
        shuffle: s.shuffle !== undefined ? s.shuffle === "true" : undefined,
        repeat: parsedRepeat,
      });

      setSettingsHydrated(true);
    },
    [hydratePreferences]
  );

  const refreshPlaylistTracks = useCallback(async (playlistId: string) => {
    const list = await api.getPlaylistTracks(playlistId);
    setPlaylistTracks(list);
  }, []);

  const handleSyncNow = useCallback(
    async (silent = false) => {
      if (isSyncingRef.current || !serverConnectedRef.current) return;
      isSyncingRef.current = true;
      setIsSyncing(true);
      if (!silent) {
        setSyncProgress({
          phase: "hashing",
          percent: 0,
          current: 0,
          total: 0,
          file_name: null,
          bytes_sent: 0,
          bytes_total: 0,
          message: "Starting two-way sync…",
        });
      }
      try {
        const summary = await api.syncWithServer();
        setLastSyncSummary(summary);
        await refreshLibrary(false);
        if (activeView.kind === "playlist") {
          await refreshPlaylistTracks(activeView.playlistId);
        }
        if (!silent) {
          setBannerMsg(
            `Synced: +${summary.uploaded_tracks} uploaded, +${summary.pulled_tracks} pulled, ${summary.synced_playlists} playlists updated.`
          );
        }
      } catch (err) {
        if (!silent) {
          setBannerMsg(String(err));
        }
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [activeView, refreshLibrary, refreshPlaylistTracks]
  );

  const scheduleAutoSync = useCallback(
    (delayMs = 2500) => {
      if (!serverConnectedRef.current) return;
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current);
      }
      autoSyncTimerRef.current = window.setTimeout(() => {
        autoSyncTimerRef.current = null;
        void handleSyncNow(true);
      }, delayMs);
    },
    [handleSyncNow]
  );
  scheduleAutoSyncRef.current = scheduleAutoSync;

  useEffect(() => {
    const onFocus = () => {
      if (!serverConnectedRef.current || isSyncingRef.current) return;
      const now = Date.now();
      if (now - lastFocusSyncAtRef.current < 45_000) return;
      lastFocusSyncAtRef.current = now;
      scheduleAutoSyncRef.current(500);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current);
      }
    };
  }, []);

  const handleServerLogout = useCallback(async () => {
    await api.serverLogout();
    await refreshLibrary(false);
    setLastSyncSummary(null);
  }, [refreshLibrary]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<SyncProgressEvent>("sync-progress", (event) => {
      if (!cancelled) {
        setSyncProgress(event.payload);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void refreshLibrary(true).catch((err) => {
      setSettingsHydrated(true);
      setBannerMsg(String(err));
    });
    void api
      .isWindowFullscreen()
      .then(setIsFullscreen)
      .catch(() => {});
  }, [refreshLibrary]);

  useEffect(() => {
    if (activeView.kind === "playlist") {
      void refreshPlaylistTracks(activeView.playlistId).catch((err) =>
        setBannerMsg(String(err))
      );
    }
  }, [activeView, refreshPlaylistTracks]);

  // Persist audio & visualizer settings whenever changed after initial hydration.
  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("volume", String(engine.volume));
  }, [settingsHydrated, engine.volume, scheduleSettingWrite]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("is_muted", String(engine.isMuted), true);
  }, [settingsHydrated, engine.isMuted, scheduleSettingWrite]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("playback_rate", String(engine.playbackRate));
  }, [settingsHydrated, engine.playbackRate, scheduleSettingWrite]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("eq_settings", JSON.stringify(engine.eq));
  }, [settingsHydrated, engine.eq, scheduleSettingWrite]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("shuffle", String(engine.shuffle), true);
  }, [settingsHydrated, engine.shuffle, scheduleSettingWrite]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("repeat", engine.repeat, true);
  }, [settingsHydrated, engine.repeat, scheduleSettingWrite]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleSettingWrite("cinematic_config", JSON.stringify(cinematicConfig));
  }, [settingsHydrated, cinematicConfig, scheduleSettingWrite]);

  // Flush pending setting writes on unload without blocking native window close.
  useEffect(() => {
    const onUnload = () => {
      void flushPendingSettings();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [flushPendingSettings]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const next = await api.setWindowFullscreen(!isFullscreen);
      setIsFullscreen(next);
      if (!next) cinematicEnteredFullscreenRef.current = false;
    } catch (err) {
      setBannerMsg(String(err));
    }
  }, [isFullscreen]);

  const enterCinematicMode = useCallback(async () => {
    setShowCinematicSettings(false);
    setShowThemeDrawer(false);
    setCinematicMode(true);
    if (cinematicConfig.enterFullscreen && !isFullscreen) {
      try {
        const next = await api.setWindowFullscreen(true);
        setIsFullscreen(next);
        cinematicEnteredFullscreenRef.current = next;
      } catch {
        // Non-fatal if fullscreen toggle fails.
      }
    }
  }, [cinematicConfig.enterFullscreen, isFullscreen]);

  const exitCinematicMode = useCallback(async () => {
    setCinematicMode(false);
    if (cinematicEnteredFullscreenRef.current) {
      cinematicEnteredFullscreenRef.current = false;
      try {
        const next = await api.setWindowFullscreen(false);
        setIsFullscreen(next);
      } catch {
        // Non-fatal
      }
    }
  }, []);

  const refreshMonitors = useCallback(async () => {
    try {
      const [mons, active] = await Promise.all([
        api.listMonitors(),
        api.isWallpaperMode(),
      ]);
      setMonitors(mons);
      setWallpaperMode(active);
    } catch {
      // Ignore on non-Windows hosts
    }
  }, []);

  useEffect(() => {
    void refreshMonitors();
  }, [refreshMonitors]);

  const buildWallpaperPayload = useCallback(
    (overrideConfig?: CinematicConfig): DesktopWallpaperPayload => {
      const np = engine.nowPlaying;
      const title =
        np?.kind === "track"
          ? np.track.title
          : np?.kind === "radio"
          ? np.station.name
          : "";
      const artist =
        np?.kind === "track"
          ? np.track.artist
          : np?.kind === "radio"
          ? "Live Internet Radio"
          : "";
      const coverUrl =
        np?.kind === "track"
          ? getCoverUrl(np.track.cover_hash)
          : np?.kind === "radio"
          ? np.station.favicon
          : null;
      return {
        config: overrideConfig ?? cinematicConfig,
        themeId,
        isPlaying: engine.isPlaying,
        isRadio: np?.kind === "radio",
        title,
        artist,
        coverUrl,
      };
    },
    [cinematicConfig, themeId, engine.isPlaying, engine.nowPlaying]
  );

  // Sync live visualizer config, theme, track metadata & cover to all running wallpaper monitors
  useEffect(() => {
    if (!wallpaperMode) return;
    void api
      .syncWallpaperPayload(JSON.stringify(buildWallpaperPayload()))
      .catch(() => {});
  }, [wallpaperMode, buildWallpaperPayload]);

  // Stream 60fps FFT spectrum frames from the player's AnalyserNode to the desktop wallpaper surfaces
  useEffect(() => {
    if (!wallpaperMode) return;
    let cancelled = false;
    let inFlight = false;
    let rafId = 0;
    const freqBuf = new Uint8Array(256);

    const pushFrame = () => {
      if (cancelled) return;
      if (!inFlight) {
        const analyser = engine.analyserRef.current;
        if (analyser && engine.isPlaying && engine.nowPlaying?.kind !== "radio") {
          analyser.getByteFrequencyData(freqBuf);
        } else {
          freqBuf.fill(0);
        }
        inFlight = true;
        api
          .pushWallpaperFft(Array.from(freqBuf))
          .catch(() => {})
          .finally(() => {
            inFlight = false;
          });
      }
      rafId = requestAnimationFrame(pushFrame);
    };

    rafId = requestAnimationFrame(pushFrame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [wallpaperMode, engine.analyserRef, engine.isPlaying, engine.nowPlaying]);

  const toggleWallpaperMode = useCallback(async () => {
    try {
      const target = !wallpaperMode;
      if (target) {
        await api.syncWallpaperPayload(JSON.stringify(buildWallpaperPayload()));
      }
      const active = await api.setWallpaperMode(
        target,
        cinematicConfig.selectedMonitorId
      );
      setWallpaperMode(active);
      if (active) {
        void api.syncWallpaperPayload(JSON.stringify(buildWallpaperPayload()));
      }
    } catch (err) {
      setBannerMsg(`Live Wallpaper error: ${String(err)}`);
    }
  }, [wallpaperMode, cinematicConfig.selectedMonitorId, buildWallpaperPayload]);

  const handleSelectWallpaperMonitor = useCallback(
    async (monitorId: string | null) => {
      if (!wallpaperMode) return;
      try {
        const nextCfg = { ...cinematicConfig, selectedMonitorId: monitorId };
        await api.syncWallpaperPayload(
          JSON.stringify(buildWallpaperPayload(nextCfg))
        );
        await api.setWallpaperMode(true, monitorId);
      } catch (err) {
        setBannerMsg(`Live Wallpaper error: ${String(err)}`);
      }
    },
    [wallpaperMode, cinematicConfig, buildWallpaperPayload]
  );

  const handleSaveVisualizerThemes = useCallback(
    (next: SavedVisualizerTheme[]) => {
      setSavedVisualizerThemes(next);
      scheduleSettingWrite("visualizer_saved_themes", JSON.stringify(next), true);
    },
    [scheduleSettingWrite]
  );

  // Global keyboard shortcuts: Space play/pause, F11 fullscreen, Escape exit cinematic/modals.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (e.key === "Escape") {
        if (showCinematicSettings) {
          setShowCinematicSettings(false);
          return;
        }
        if (cinematicMode) {
          e.preventDefault();
          void exitCinematicMode();
          return;
        }
        if (showThemeDrawer) {
          setShowThemeDrawer(false);
          return;
        }
        if (showWmpModal) {
          setShowWmpModal(false);
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        engine.togglePlayPause();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    engine,
    toggleFullscreen,
    exitCinematicMode,
    cinematicMode,
    showCinematicSettings,
    showThemeDrawer,
    showWmpModal,
  ]);

  // Apply active theme + optional Match Album Art adaptive accent.
  const activeTheme = useMemo(() => getThemeById(themeId), [themeId]);

  useEffect(() => {
    let cancelled = false;
    const coverHash =
      engine.nowPlaying?.kind === "track" ? engine.nowPlaying.track.cover_hash : null;

    if (!matchAlbumArt || !coverHash) {
      setAdaptiveAccent(null);
      return;
    }

    const coverUrl = getCoverUrl(coverHash);
    if (!coverUrl) {
      setAdaptiveAccent(null);
      return;
    }

    void extractAccentFromImage(coverUrl, activeTheme.mode).then((accent) => {
      if (!cancelled) setAdaptiveAccent(accent);
    });

    return () => {
      cancelled = true;
    };
  }, [matchAlbumArt, engine.nowPlaying, activeTheme.mode]);

  useEffect(() => {
    applyThemeToDocument(activeTheme, matchAlbumArt ? adaptiveAccent : null);
  }, [activeTheme, matchAlbumArt, adaptiveAccent]);

  const handleSelectTheme = useCallback(
    (nextId: string) => {
      setThemeId(nextId);
      scheduleSettingWrite("theme_id", nextId, true);
    },
    [scheduleSettingWrite]
  );

  const handleToggleMatchAlbumArt = useCallback(() => {
    setMatchAlbumArt((prev) => {
      const next = !prev;
      scheduleSettingWrite("match_album_art", String(next), true);
      return next;
    });
  }, [scheduleSettingWrite]);

  const handleVisualizerStyleChange = useCallback(
    (style: VisualizerStyle) => {
      setVisualizerStyle(style);
      scheduleSettingWrite("visualizer_style", style, true);
    },
    [scheduleSettingWrite]
  );

  const handleAddFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Music Folder",
    });
    if (typeof selected !== "string") return;

    setIsScanning(true);
    try {
      const report = await api.addMusicFolder(selected);
      await refreshLibrary();
      scheduleAutoSync();
      setBannerMsg(
        `Scanned folder: +${report.tracks_added} added, ${report.total_tracks} total tracks.`
      );
    } catch (err) {
      setBannerMsg(String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescan = async () => {
    setIsScanning(true);
    try {
      const report = await api.rescanLibrary();
      await refreshLibrary();
      if (activeView.kind === "playlist") {
        await refreshPlaylistTracks(activeView.playlistId);
      }
      scheduleAutoSync();
      setBannerMsg(
        `Rescan complete: +${report.tracks_added} added, ${report.tracks_updated} updated, ${report.tracks_removed} removed.`
      );
    } catch (err) {
      setBannerMsg(String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveFolder = async (folderId: string) => {
    await api.removeMusicFolder(folderId);
    await refreshLibrary();
    if (activeView.kind === "playlist") {
      await refreshPlaylistTracks(activeView.playlistId);
    }
  };

  const handleCreatePlaylist = async (name: string) => {
    const created = await api.createPlaylist(name);
    await refreshLibrary();
    setActiveView({ kind: "playlist", playlistId: created.id });
    scheduleAutoSync();
  };

  const handleToggleFavorite = async (trackId: string) => {
    const nextFav = await api.toggleFavorite(trackId);
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, is_favorite: nextFav } : t))
    );
    setPlaylistTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, is_favorite: nextFav } : t))
    );
    scheduleAutoSync();
  };

  const handleToggleAutoExcluded = useCallback(
    async (track: Track, excluded: boolean) => {
      try {
        const updated = await api.setTrackAutoExcluded(track.id, excluded);
        setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setPlaylistTracks((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        );
        scheduleAutoSync();
      } catch (err) {
        setBannerMsg(String(err));
      }
    },
    [scheduleAutoSync]
  );

  const handleSaveAutoPlaylistConfig = useCallback(
    async (next: AutoPlaylistConfig) => {
      setAutoConfig(next);
      try {
        const saved = await api.saveAutoPlaylistConfig(next);
        setAutoConfig(saved);
        scheduleAutoSync();
      } catch (err) {
        setBannerMsg(String(err));
      }
    },
    [scheduleAutoSync]
  );

  const handleStartAutoMix = useCallback(() => {
    const currentId =
      engine.nowPlaying?.kind === "track" ? engine.nowPlaying.track.id : null;
    const picked = pickNextAutoTrack(tracks, autoConfig, recentPlayIds, currentId);
    if (!picked) {
      setBannerMsg(
        "No eligible tracks for Auto Playlist yet. Listen to at least one song first."
      );
      return;
    }
    engine.playAutoMixTrack(picked);
  }, [autoConfig, engine, recentPlayIds, tracks]);

  const handleToggleRadioFavorite = async (station: RadioStation) => {
    await api.toggleRadioFavorite(station);
    await refreshLibrary();
  };

  const handleShufflePlay = (list: Track[]) => {
    if (list.length === 0) return;
    if (!engine.shuffle) engine.toggleShuffle();
    const randomTrack = list[Math.floor(Math.random() * list.length)];
    engine.playTrack(randomTrack, list);
  };

  const handleExportPlaylist = async (playlist: Playlist) => {
    const dest = await save({
      title: "Export Playlist (.m3u8)",
      defaultPath: `${playlist.name}.m3u8`,
      filters: [{ name: "M3U8 Playlist", extensions: ["m3u8"] }],
    });
    if (!dest) return;
    await api.exportPlaylistM3u8(playlist.id, dest);
    setBannerMsg(`Exported "${playlist.name}" to ${dest}`);
  };

  const handleSaveTrackEdit = useCallback(
    async (trackId: string, draft: TrackEditDraft) => {
      const updated = await api.saveTrackEdit(
        trackId,
        draft.speed,
        draft.gain_db,
        draft.trim_start_ms,
        draft.trim_end_ms
      );
      setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setPlaylistTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      engine.updateTrackInPlayback(updated);
      scheduleAutoSync();
      setBannerMsg(
        `Saved playback defaults for "${updated.title}". Syncing automatically…`
      );
    },
    [engine, scheduleAutoSync]
  );

  const handleResetTrackEdit = useCallback(
    async (trackId: string) => {
      const updated = await api.resetTrackEdit(trackId);
      setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setPlaylistTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      engine.updateTrackInPlayback(updated);
      setEditingTrack(updated);
      scheduleAutoSync();
      setBannerMsg(`Reset "${updated.title}" back to original defaults.`);
    },
    [engine, scheduleAutoSync]
  );

  const handleDownloadAsMp3 = useCallback(async (track: Track) => {
    const safeName = `${track.artist} - ${track.title}`
      .replace(/[<>:"/\\|?*]+/g, "_")
      .trim();
    const dest = await save({
      title: "Download as MP3",
      defaultPath: `${safeName || "track"}.mp3`,
      filters: [{ name: "MP3 Audio", extensions: ["mp3"] }],
    });
    if (!dest) return;
    setBannerMsg(`Exporting "${track.title}" as MP3…`);
    try {
      const savedPath = await api.exportTrackAsMp3(track.id, dest);
      setBannerMsg(`Saved MP3 to ${savedPath}`);
    } catch (err) {
      setBannerMsg(String(err));
    }
  }, []);

  const handleRevealTrack = useCallback(async (track: Track) => {
    try {
      await api.revealTrackInExplorer(track.id);
    } catch (err) {
      setBannerMsg(String(err));
    }
  }, []);

  const favoriteTracks = useMemo(
    () => tracks.filter((t) => t.is_favorite),
    [tracks]
  );

  const autoEligibleCount = useMemo(
    () => tracks.filter((t) => isTrackEligibleForAutoPlaylist(t, autoConfig)).length,
    [tracks, autoConfig]
  );

  const activePlaylist = useMemo(
    () =>
      activeView.kind === "playlist"
        ? playlists.find((p) => p.id === activeView.playlistId)
        : undefined,
    [activeView, playlists]
  );

  const rawViewTracks = useMemo(() => {
    if (activeView.kind === "favorites") return favoriteTracks;
    if (activeView.kind === "playlist") return playlistTracks;
    return tracks;
  }, [activeView.kind, favoriteTracks, playlistTracks, tracks]);

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawViewTracks;
    return rawViewTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        (t.genre?.toLowerCase().includes(q) ?? false)
    );
  }, [rawViewTracks, searchQuery]);

  const activeTrackId =
    engine.nowPlaying?.kind === "track" ? engine.nowPlaying.track.id : null;
  const activeStationUuid =
    engine.nowPlaying?.kind === "radio"
      ? engine.nowPlaying.station.station_uuid
      : null;

  const emptyKind =
    searchQuery.trim().length > 0
      ? "search"
      : activeView.kind === "favorites"
      ? "favorites"
      : activeView.kind === "playlist"
      ? "playlist"
      : "library";

  const isServerConnected = Boolean(serverToken && serverUrl);

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden">
      <div className="flex-1 min-h-0 flex">
        <Sidebar
          activeView={activeView}
          onSelectView={setActiveView}
          playlists={playlists}
          folders={folders}
          totalTracks={tracks.length}
          favoriteCount={favoriteTracks.length}
          autoEligibleCount={autoEligibleCount}
          isAutoMixActive={engine.isAutoMixActive}
          isTpxTheme={themeId === "tpx"}
          isServerConnected={isServerConnected}
          onOpenWmpImport={() => setShowWmpModal(true)}
          onCreatePlaylist={handleCreatePlaylist}
          onRemoveFolder={handleRemoveFolder}
        />

        <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-base)]">
          <TopBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isScanning={isScanning}
            isSyncing={isSyncing}
            syncProgress={syncProgress}
            isServerConnected={isServerConnected}
            isFullscreen={isFullscreen}
            wallpaperMode={wallpaperMode}
            onAddFolder={() => void handleAddFolder()}
            onRescan={() => void handleRescan()}
            onSyncNow={() => void handleSyncNow(false)}
            onOpenThemes={() => setShowThemeDrawer(true)}
            onEnterCinematic={() => void enterCinematicMode()}
            onToggleWallpaper={() => void toggleWallpaperMode()}
            onOpenCinematicSettings={() => {
              setShowCinematicSettings(true);
              void refreshMonitors();
            }}
            onToggleFullscreen={() => void toggleFullscreen()}
            onBeforeClose={flushPendingSettings}
            activeThemeName={activeTheme.name}
          />

          {(bannerMsg || engine.audioError) && (
            <div className="mx-6 mt-3 px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                <AlertCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span>{engine.audioError ?? bannerMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBannerMsg(null);
                  engine.clearError();
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {activeView.kind === "auto" ? (
            <AutoPlaylistView
              tracks={tracks}
              config={autoConfig}
              recentPlayIds={recentPlayIds}
              activeTrackId={activeTrackId}
              isAutoMixActive={engine.isAutoMixActive}
              onStartAutoMix={handleStartAutoMix}
              onPlaySpecificTrack={(track) => engine.playAutoMixTrack(track)}
              onUpdateConfig={(next) => void handleSaveAutoPlaylistConfig(next)}
              onToggleAutoExcluded={(track, excluded) =>
                void handleToggleAutoExcluded(track, excluded)
              }
              onToggleFavorite={(id) => void handleToggleFavorite(id)}
            />
          ) : activeView.kind === "radio" ? (
            <RadioView
              favorites={radioFavorites}
              activeStationUuid={activeStationUuid}
              isPlaying={engine.isPlaying}
              onPlayStation={engine.playRadio}
              onToggleFavorite={(s) => void handleToggleRadioFavorite(s)}
            />
          ) : activeView.kind === "sync" ? (
            <ServerSyncView
              serverUrl={serverUrl}
              serverToken={serverToken}
              serverUsername={serverUsername}
              serverRole={serverRole}
              lastSyncAt={lastSyncAt}
              isSyncing={isSyncing}
              syncProgress={syncProgress}
              lastSyncSummary={lastSyncSummary}
              onAuthSuccess={() => refreshLibrary(false)}
              onLogout={handleServerLogout}
              onSyncNow={() => handleSyncNow(false)}
            />
          ) : (
            <TrackList
              title={
                activeView.kind === "favorites"
                  ? "Favorites"
                  : activeView.kind === "playlist"
                  ? activePlaylist?.name ?? "Playlist"
                  : "All Tracks"
              }
              subtitle={
                activeView.kind === "playlist" && activePlaylist?.source_path
                  ? `Imported from ${activePlaylist.source_path}`
                  : undefined
              }
              tracks={filteredTracks}
              playlist={activePlaylist}
              allPlaylists={playlists}
              activeTrackId={activeTrackId}
              isPlaying={engine.isPlaying}
              emptyKind={emptyKind}
              onPlayTrack={engine.playTrack}
              onShufflePlay={handleShufflePlay}
              onPlayNext={engine.playNextInQueue}
              onEnqueue={engine.enqueueTrack}
              onToggleFavorite={(id) => void handleToggleFavorite(id)}
              onAddTracksToPlaylist={(playlistId, trackIds) => {
                void api.addTracksToPlaylist(playlistId, trackIds).then(async () => {
                  await refreshLibrary();
                  scheduleAutoSync();
                });
              }}
              onEditTrack={(track) => setEditingTrack(track)}
              onDownloadAsMp3={(track) => void handleDownloadAsMp3(track)}
              onRevealTrack={(track) => void handleRevealTrack(track)}
              onToggleAutoExcluded={(track, excluded) =>
                void handleToggleAutoExcluded(track, excluded)
              }
              onRemoveFromPlaylist={
                activeView.kind === "playlist"
                  ? (trackId) => {
                      void api
                        .removeTrackFromPlaylist(activeView.playlistId, trackId)
                        .then(async () => {
                          await refreshLibrary();
                          await refreshPlaylistTracks(activeView.playlistId);
                          scheduleAutoSync();
                        });
                    }
                  : undefined
              }
              onReorderPlaylist={
                activeView.kind === "playlist" && !searchQuery.trim()
                  ? (orderedIds) => {
                      void api
                        .reorderPlaylistTracks(activeView.playlistId, orderedIds)
                        .then((updated) => {
                          setPlaylistTracks(updated);
                          scheduleAutoSync();
                        });
                    }
                  : undefined
              }
              onRenamePlaylist={
                activePlaylist
                  ? (newName) => {
                      void api.renamePlaylist(activePlaylist.id, newName).then(async () => {
                        await refreshLibrary();
                        scheduleAutoSync();
                      });
                    }
                  : undefined
              }
              onDeletePlaylist={
                activePlaylist
                  ? () => {
                      void api.deletePlaylist(activePlaylist.id).then(async () => {
                        setActiveView({ kind: "library" });
                        await refreshLibrary();
                        scheduleAutoSync();
                      });
                    }
                  : undefined
              }
              onExportPlaylist={
                activePlaylist
                  ? () => void handleExportPlaylist(activePlaylist)
                  : undefined
              }
              onAddFolder={() => void handleAddFolder()}
              onOpenWmpImport={() => setShowWmpModal(true)}
            />
          )}
        </main>
      </div>

      <PlayerBar
        engine={engine}
        visualizerStyle={visualizerStyle}
        isRetroVfd={themeId === "retro-vfd"}
        cinematicActive={cinematicMode}
        onToggleFavorite={(id) => void handleToggleFavorite(id)}
        onEnterCinematic={() => void enterCinematicMode()}
      />

      {cinematicMode && (
        <CinematicOverlay
          config={cinematicConfig}
          nowPlaying={engine.nowPlaying}
          analyserRef={engine.analyserRef}
          isPlaying={engine.isPlaying}
          themeId={themeId}
          wallpaperMode={wallpaperMode}
          onToggleWallpaper={() => void toggleWallpaperMode()}
          onMoveTitlePosition={(x, y) =>
            setCinematicConfig((prev) => ({
              ...prev,
              titlePosition: "custom",
              titlePosX: x,
              titlePosY: y,
            }))
          }
          onOpenSettings={() => {
            setShowCinematicSettings(true);
            void refreshMonitors();
          }}
          onExit={() => void exitCinematicMode()}
        />
      )}

      {showCinematicSettings && (
        <CinematicSettingsModal
          config={cinematicConfig}
          onChange={setCinematicConfig}
          savedThemes={savedVisualizerThemes}
          onSaveThemes={handleSaveVisualizerThemes}
          onLaunchCinematic={() => void enterCinematicMode()}
          onToggleWallpaper={() => void toggleWallpaperMode()}
          wallpaperMode={wallpaperMode}
          monitors={monitors}
          onRefreshMonitors={() => void refreshMonitors()}
          onSelectMonitor={(id) => void handleSelectWallpaperMonitor(id)}
          onClose={() => setShowCinematicSettings(false)}
          analyserRef={engine.analyserRef}
          isPlaying={engine.isPlaying}
          nowPlaying={engine.nowPlaying}
          themeId={themeId}
          onSelectAppTheme={handleSelectTheme}
        />
      )}

      {showWmpModal && (
        <WmpImportModal
          onClose={() => setShowWmpModal(false)}
          onImported={(report) => {
            void refreshLibrary().then(() => scheduleAutoSync());
            setActiveView({ kind: "playlist", playlistId: report.playlist.id });
          }}
        />
      )}

      {editingTrack && (
        <TrackEditorModal
          track={editingTrack}
          engine={engine}
          onSave={handleSaveTrackEdit}
          onReset={handleResetTrackEdit}
          onClose={() => setEditingTrack(null)}
        />
      )}

      {showThemeDrawer && (
        <ThemeDrawer
          activeThemeId={themeId}
          matchAlbumArt={matchAlbumArt}
          visualizerStyle={visualizerStyle}
          onSelectTheme={handleSelectTheme}
          onToggleMatchAlbumArt={handleToggleMatchAlbumArt}
          onChangeVisualizerStyle={handleVisualizerStyleChange}
          onOpenCinematicSettings={() => setShowCinematicSettings(true)}
          onClose={() => setShowThemeDrawer(false)}
        />
      )}
    </div>
  );
}

export default App;
