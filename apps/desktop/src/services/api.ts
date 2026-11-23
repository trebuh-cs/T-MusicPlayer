import { invoke } from "@tauri-apps/api/core";
import type {
  AuthResponse,
  AutoPlaylistConfig,
  DetectedPlaylistFile,
  ImportPlaylistReport,
  LibrarySnapshot,
  ParsedPlaylist,
  Playlist,
  RadioStation,
  ScanReport,
  ServerHealth,
  SyncSummary,
  Track,
} from "../types";

const IS_WINDOWS =
  typeof navigator !== "undefined" &&
  (/Windows/i.test(navigator.userAgent) || navigator.platform.startsWith("Win"));

const PROTOCOL_ORIGIN = IS_WINDOWS ? "http://tmusic.localhost" : "tmusic://localhost";

export function getStreamUrl(trackId: string): string {
  return `${PROTOCOL_ORIGIN}/stream/${encodeURIComponent(trackId)}`;
}

export function getTrackPlaybackUrl(
  track: Track,
  serverUrl?: string,
  serverToken?: string
): string {
  if (track.file_path.startsWith("remote://") && serverUrl && serverToken) {
    const serverTrackId = track.file_path.slice("remote://".length);
    const cleanBase = serverUrl.replace(/\/+$/, "");
    return `${cleanBase}/api/v1/stream/${encodeURIComponent(serverTrackId)}?token=${encodeURIComponent(serverToken)}`;
  }
  return getStreamUrl(track.id);
}

export function getCoverUrl(coverHash: string | null | undefined): string | null {
  if (!coverHash) return null;
  return `${PROTOCOL_ORIGIN}/cover/${encodeURIComponent(coverHash)}`;
}

export const api = {
  getLibrary: () => invoke<LibrarySnapshot>("get_library"),
  addMusicFolder: (path: string) => invoke<ScanReport>("add_music_folder", { path }),
  removeMusicFolder: (folderId: string) =>
    invoke<void>("remove_music_folder", { folderId }),
  rescanLibrary: () => invoke<ScanReport>("rescan_library"),
  detectWmpPlaylists: () => invoke<DetectedPlaylistFile[]>("detect_wmp_playlists"),
  previewPlaylistFile: (path: string) =>
    invoke<ParsedPlaylist>("preview_playlist_file", { path }),
  importPlaylistFile: (path: string, customName?: string) =>
    invoke<ImportPlaylistReport>("import_playlist_file", {
      path,
      customName: customName ?? null,
    }),
  createPlaylist: (name: string, description?: string) =>
    invoke<Playlist>("create_playlist", { name, description: description ?? null }),
  renamePlaylist: (playlistId: string, name: string) =>
    invoke<Playlist>("rename_playlist", { playlistId, name }),
  deletePlaylist: (playlistId: string) =>
    invoke<void>("delete_playlist", { playlistId }),
  getPlaylistTracks: (playlistId: string) =>
    invoke<Track[]>("get_playlist_tracks", { playlistId }),
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) =>
    invoke<Playlist>("add_tracks_to_playlist", { playlistId, trackIds }),
  removeTrackFromPlaylist: (playlistId: string, trackId: string) =>
    invoke<Playlist>("remove_track_from_playlist", { playlistId, trackId }),
  reorderPlaylistTracks: (playlistId: string, orderedTrackIds: string[]) =>
    invoke<Track[]>("reorder_playlist_tracks", { playlistId, orderedTrackIds }),
  exportPlaylistM3u8: (playlistId: string, destPath: string) =>
    invoke<void>("export_playlist_m3u8", { playlistId, destPath }),
  toggleFavorite: (trackId: string) =>
    invoke<boolean>("toggle_favorite", { trackId }),
  recordPlay: (trackId: string, isManual = false) =>
    invoke<Track>("record_play", { trackId, isManual }),
  recordSkip: (trackId: string) =>
    invoke<Track>("record_skip", { trackId }),
  setTrackAutoExcluded: (trackId: string, excluded: boolean) =>
    invoke<Track>("set_track_auto_excluded", { trackId, excluded }),
  getAutoPlaylistConfig: () =>
    invoke<AutoPlaylistConfig>("get_auto_playlist_config"),
  saveAutoPlaylistConfig: (config: AutoPlaylistConfig) =>
    invoke<AutoPlaylistConfig>("save_auto_playlist_config", { config }),
  toggleRadioFavorite: (station: RadioStation) =>
    invoke<boolean>("toggle_radio_favorite", { station }),
  saveSetting: (key: string, value: string) =>
    invoke<void>("save_setting", { key, value }),
  importCinematicImage: (path: string) =>
    invoke<string>("import_cinematic_image", { path }),
  setWindowFullscreen: (fullscreen: boolean) =>
    invoke<boolean>("set_window_fullscreen", { fullscreen }),
  isWindowFullscreen: () => invoke<boolean>("is_window_fullscreen"),
  closeAppWindow: () => invoke<void>("close_app_window"),
  serverHealth: (serverUrl: string) =>
    invoke<ServerHealth>("server_health", { serverUrl }),
  serverLogin: (serverUrl: string, username: string, password: string) =>
    invoke<AuthResponse>("server_login", { serverUrl, username, password }),
  serverRegister: (
    serverUrl: string,
    username: string,
    password: string,
    inviteCode?: string
  ) =>
    invoke<AuthResponse>("server_register", {
      serverUrl,
      username,
      password,
      inviteCode: inviteCode ?? null,
    }),
  serverLogout: () => invoke<void>("server_logout"),
  syncWithServer: () => invoke<SyncSummary>("sync_with_server"),
  uploadAppDownload: (platform: "android" | "windows", filePath: string) =>
    invoke<string>("upload_app_download", { platform, filePath }),
  saveTrackEdit: (
    trackId: string,
    speed: number,
    gainDb: number,
    trimStartMs: number,
    trimEndMs: number | null
  ) =>
    invoke<Track>("save_track_edit", {
      trackId,
      speed,
      gainDb,
      trimStartMs,
      trimEndMs,
    }),
  resetTrackEdit: (trackId: string) =>
    invoke<Track>("reset_track_edit", { trackId }),
  revealTrackInExplorer: (trackId: string) =>
    invoke<void>("reveal_track_in_explorer", { trackId }),
  exportTrackAsMp3: (trackId: string, destPath: string) =>
    invoke<string>("export_track_as_mp3", { trackId, destPath }),
};

// Legal Internet Radio discovery via public Radio Browser mirrors.
const RADIO_MIRRORS = [
  "https://de1.api.radio-browser.info/json",
  "https://at1.api.radio-browser.info/json",
];

interface RawRadioStation {
  stationuuid: string;
  name: string;
  url_resolved?: string;
  url?: string;
  favicon?: string;
  countrycode?: string;
  tags?: string;
  bitrate?: number;
}

async function fetchRadioMirror(endpoint: string): Promise<RadioStation[]> {
  let lastError: unknown;
  for (const base of RADIO_MIRRORS) {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Radio API HTTP ${response.status}`);
      }
      const raw: RawRadioStation[] = await response.json();
      return raw
        .filter((s) => Boolean(s.url_resolved || s.url))
        .map((s) => ({
          station_uuid: s.stationuuid,
          name: (s.name || "Untitled Station").trim(),
          url: (s.url_resolved || s.url || "").trim(),
          favicon: s.favicon?.trim() || null,
          country: s.countrycode?.trim() || null,
          tags: s.tags?.trim() || null,
          bitrate: s.bitrate && s.bitrate > 0 ? s.bitrate : null,
        }));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to reach Radio Browser directory");
}

export function getTopRadioStations(limit = 30): Promise<RadioStation[]> {
  return fetchRadioMirror(
    `/stations/topvote/${limit}?hidebroken=true`
  );
}

export function searchRadioStations(query: string, limit = 30): Promise<RadioStation[]> {
  const q = encodeURIComponent(query.trim());
  return fetchRadioMirror(
    `/stations/search?name=${q}&order=votes&reverse=true&hidebroken=true&limit=${limit}`
  );
}

export function getRadioByTag(tag: string, limit = 30): Promise<RadioStation[]> {
  const t = encodeURIComponent(tag.trim().toLowerCase());
  return fetchRadioMirror(
    `/stations/bytag/${t}?order=votes&reverse=true&hidebroken=true&limit=${limit}`
  );
}
