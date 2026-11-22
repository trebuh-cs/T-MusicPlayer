export interface Track {
  id: string;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  genre: string | null;
  duration_ms: number;
  format: string;
  bitrate_kbps: number | null;
  file_size: number;
  modified_at: number;
  cover_hash: string | null;
  play_count: number;
  is_favorite: boolean;
  added_at: number;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  source_type: "custom" | "wmp" | "m3u" | string;
  source_path: string | null;
  track_count: number;
  total_duration_ms: number;
  created_at: number;
  updated_at: number;
}

export interface MusicFolder {
  id: string;
  path: string;
  track_count: number;
  added_at: number;
}

export interface RadioStation {
  station_uuid: string;
  name: string;
  url: string;
  favicon: string | null;
  country: string | null;
  tags: string | null;
  bitrate: number | null;
}

export interface DetectedPlaylistFile {
  name: string;
  path: string;
  format: string;
  entry_count: number;
}

export interface ParsedPlaylistEntry {
  raw_src: string;
  resolved_path: string | null;
  exists: boolean;
  title_hint: string | null;
  artist_hint: string | null;
}

export interface ParsedPlaylist {
  name: string;
  source_path: string;
  format: string;
  entries: ParsedPlaylistEntry[];
}

export interface ImportPlaylistReport {
  playlist: Playlist;
  imported_count: number;
  missing_entries: string[];
}

export interface ScanReport {
  folders_scanned: number;
  tracks_added: number;
  tracks_updated: number;
  tracks_removed: number;
  total_tracks: number;
}

export interface LibrarySnapshot {
  tracks: Track[];
  folders: MusicFolder[];
  playlists: Playlist[];
  radio_favorites: RadioStation[];
  settings: Record<string, string>;
}

export type ActiveView =
  | { kind: "library" }
  | { kind: "favorites" }
  | { kind: "playlist"; playlistId: string }
  | { kind: "radio" }
  | { kind: "sync" };

export type RepeatMode = "off" | "all" | "one";
export type VisualizerStyle = "bars" | "mirrored" | "off";

export interface EqSettings {
  bass: number;   // dB -12..12
  mid: number;    // dB -12..12
  treble: number; // dB -12..12
}

export type PlayingItem =
  | { kind: "track"; track: Track }
  | { kind: "radio"; station: RadioStation };

export type CinematicColorMode =
  | "theme"
  | "solid"
  | "height-dynamic"
  | "radial-fade"
  | "rainbow";

export type CinematicTitlePosition = "hidden" | "above" | "below";

export type CinematicCenterSource =
  | "auto"
  | "tpx"
  | "album-art"
  | "music-icon"
  | "custom";

export interface CinematicConfig {
  circleSize: number;
  barGapFromCircle: number;
  barCount: number;
  barMaxHeight: number;
  barThickness: number;
  barSensitivity: number;
  barSmoothing: number;
  mirrored: boolean;
  bidirectionalBars: boolean;
  colorMode: CinematicColorMode;
  barColorLow: string;
  barColorMid: string;
  barColorHigh: string;
  roundedCaps: boolean;
  bassPulse: boolean;
  rotationSpeed: number;
  showCircleRing: boolean;
  titlePosition: CinematicTitlePosition;
  showArtistInTitle: boolean;
  centerSource: CinematicCenterSource;
  customImageHash: string | null;
  enterFullscreen: boolean;
}

export const DEFAULT_CINEMATIC_CONFIG: CinematicConfig = {
  circleSize: 200,
  barGapFromCircle: 14,
  barCount: 72,
  barMaxHeight: 120,
  barThickness: 4.5,
  barSensitivity: 1.35,
  barSmoothing: 0.72,
  mirrored: true,
  bidirectionalBars: false,
  colorMode: "theme",
  barColorLow: "#0AF92A",
  barColorMid: "#49ECC1",
  barColorHigh: "#FFB020",
  roundedCaps: true,
  bassPulse: true,
  rotationSpeed: 0.15,
  showCircleRing: true,
  titlePosition: "below",
  showArtistInTitle: true,
  centerSource: "auto",
  customImageHash: null,
  enterFullscreen: true,
};

export interface UserProfile {
  id: string;
  username: string;
  role: string;
  created_at: number;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface ServerHealth {
  status: string;
  version: string;
  registration_open: boolean;
  invite_required: boolean;
}

export interface SyncSummary {
  uploaded_tracks: number;
  pulled_tracks: number;
  synced_playlists: number;
  synced_favorites: number;
  server_time: number;
}

export interface SyncProgressEvent {
  phase:
    | "hashing"
    | "checking"
    | "uploading"
    | "pushing"
    | "pulling"
    | "covers"
    | "done"
    | "error";
  percent: number;
  current: number;
  total: number;
  file_name: string | null;
  bytes_sent: number;
  bytes_total: number;
  message: string;
}
