//! Core data models shared across T - MusicPlayer desktop, server, and sync clients.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// A locally indexed or synced audio track.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Track {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration_ms: u64,
    pub format: String,
    pub bitrate_kbps: Option<u32>,
    pub file_size: u64,
    pub modified_at: i64,
    pub cover_hash: Option<String>,
    pub play_count: u64,
    pub is_favorite: bool,
    pub added_at: i64,
}

/// Raw metadata extracted from an audio file before database assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannedTrack {
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration_ms: u64,
    pub format: String,
    pub bitrate_kbps: Option<u32>,
    pub file_size: u64,
    pub modified_at: i64,
    pub cover_hash: Option<String>,
}

/// A user or imported playlist stored in the library.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub track_count: usize,
    pub total_duration_ms: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A watched/indexed folder in the user's music library.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MusicFolder {
    pub id: String,
    pub path: String,
    pub track_count: usize,
    pub added_at: i64,
}

/// A saved or discovered Internet Radio station.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RadioStation {
    pub station_uuid: String,
    pub name: String,
    pub url: String,
    pub favicon: Option<String>,
    pub country: Option<String>,
    pub tags: Option<String>,
    pub bitrate: Option<u32>,
}

/// A playlist file discovered on disk (e.g. inside Windows Media Player playlists folder).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DetectedPlaylistFile {
    pub name: String,
    pub path: String,
    pub format: String,
    pub entry_count: usize,
}

/// A single parsed entry inside an external playlist file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedPlaylistEntry {
    pub raw_src: String,
    pub resolved_path: Option<String>,
    pub exists: bool,
    pub title_hint: Option<String>,
    pub artist_hint: Option<String>,
}

/// Result of parsing an external playlist file (.wpl, .zpl, .m3u, .m3u8, .pls).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedPlaylist {
    pub name: String,
    pub source_path: String,
    pub format: String,
    pub entries: Vec<ParsedPlaylistEntry>,
}

/// Result summary returned after importing an external playlist into the database.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportPlaylistReport {
    pub playlist: Playlist,
    pub imported_count: usize,
    pub missing_entries: Vec<String>,
}

/// Summary returned after scanning one or more music folders.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScanReport {
    pub folders_scanned: usize,
    pub tracks_added: usize,
    pub tracks_updated: usize,
    pub tracks_removed: usize,
    pub total_tracks: usize,
}

/// Authenticated home server user profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserProfile {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: i64,
}

/// Token + user profile returned after login or registration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserProfile,
}

/// Health & registration status exposed by `GET /api/v1/health`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerHealth {
    pub status: String,
    pub version: String,
    pub registration_open: bool,
    pub invite_required: bool,
}

/// Track record hosted by `t-music-server`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerTrack {
    pub id: String,
    pub content_hash: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration_ms: u64,
    pub format: String,
    pub bitrate_kbps: Option<u32>,
    pub file_size: u64,
    pub cover_hash: Option<String>,
    pub uploaded_by: Option<String>,
    pub created_at: i64,
}

/// Playlist snapshot exchanged during bidirectional sync.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncPlaylistPayload {
    pub id: String,
    pub name: String,
    pub description: String,
    pub track_ids: Vec<String>,
    pub is_shared: bool,
    pub owner_username: String,
    pub updated_at: i64,
    pub deleted: bool,
}

/// Per-user favorite state exchanged during bidirectional sync.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncFavoritePayload {
    pub track_id: String,
    pub is_favorite: bool,
    pub updated_at: i64,
}

/// Response returned by `GET /api/v1/sync/pull`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncPullResponse {
    pub server_time: i64,
    pub tracks: Vec<ServerTrack>,
    pub playlists: Vec<SyncPlaylistPayload>,
    pub favorites: Vec<SyncFavoritePayload>,
}

/// Request sent to `POST /api/v1/sync/push`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncPushRequest {
    pub playlists: Vec<SyncPlaylistPayload>,
    pub favorites: Vec<SyncFavoritePayload>,
}

/// Response returned by `POST /api/v1/sync/push`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncPushResponse {
    pub server_time: i64,
    pub applied_playlists: usize,
    pub applied_favorites: usize,
}

/// Request sent to `POST /api/v1/tracks/check-hashes` to avoid redundant uploads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CheckHashesRequest {
    pub hashes: Vec<String>,
}

/// Mapping of `content_hash -> server track_id` for files already present on the server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CheckHashesResponse {
    pub existing: HashMap<String, String>,
}
