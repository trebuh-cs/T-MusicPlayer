//! Local SQLite persistence for tracks, deduplicated covers, playlists, radio favorites, and settings.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use t_music_core::models::{
    MusicFolder, Playlist, RadioStation, ScannedTrack, ServerTrack, SyncFavoritePayload,
    SyncPlaylistPayload, Track,
};
use t_music_core::scanner::ExtractedCover;
use uuid::Uuid;

/// Local track fields needed during home-server synchronization.
#[derive(Debug, Clone)]
pub struct LocalTrackSyncRow {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub content_hash: Option<String>,
    pub server_track_id: Option<String>,
    pub is_remote: bool,
    pub is_favorite: bool,
    pub favorite_updated_at: i64,
}

/// Local playlist snapshot mapped to server track IDs for sync push.
#[derive(Debug, Clone)]
pub struct LocalPlaylistSyncRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_shared: bool,
    pub updated_at: i64,
    pub deleted: bool,
    pub track_server_ids: Vec<String>,
}

/// Thread-safe SQLite database wrapper managed as Tauri application state.
pub struct Database {
    conn: Mutex<Connection>,
}

/// Complete library snapshot returned on application startup and resync.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LibrarySnapshot {
    pub tracks: Vec<Track>,
    pub folders: Vec<MusicFolder>,
    pub playlists: Vec<Playlist>,
    pub radio_favorites: Vec<RadioStation>,
    pub settings: HashMap<String, String>,
}

/// Outcome of upserting a scanned track into SQLite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    Added,
    Updated,
    Unchanged,
}

impl Database {
    /// Opens or creates a SQLite library database at `db_path` and initializes schema tables.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory: {e}"))?;
        }
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open SQLite database: {e}"))?;
        Self::from_connection(conn)
    }

    /// Wraps an existing SQLite connection (used by unit tests with `:memory:`).
    pub fn from_connection(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;",
        )
        .map_err(|e| format!("Failed to configure SQLite pragmas: {e}"))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                added_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS covers (
                hash TEXT PRIMARY KEY,
                mime TEXT NOT NULL,
                data BLOB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                file_path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                album_artist TEXT,
                track_number INTEGER,
                disc_number INTEGER,
                year INTEGER,
                genre TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                format TEXT NOT NULL,
                bitrate_kbps INTEGER,
                file_size INTEGER NOT NULL DEFAULT 0,
                modified_at INTEGER NOT NULL DEFAULT 0,
                cover_hash TEXT REFERENCES covers(hash) ON DELETE SET NULL,
                play_count INTEGER NOT NULL DEFAULT 0,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_id);
            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);

            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                source_type TEXT NOT NULL DEFAULT 'custom',
                source_path TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id)
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
                ON playlist_tracks(playlist_id, position);

            CREATE TABLE IF NOT EXISTS radio_favorites (
                station_uuid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                favicon TEXT,
                country TEXT,
                tags TEXT,
                bitrate INTEGER,
                added_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;

        for migration in [
            "ALTER TABLE tracks ADD COLUMN content_hash TEXT",
            "ALTER TABLE tracks ADD COLUMN server_track_id TEXT",
            "ALTER TABLE tracks ADD COLUMN is_remote INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tracks ADD COLUMN favorite_updated_at INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE playlists ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE playlists ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0",
        ] {
            let _ = conn.execute(migration, []);
        }

        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_tracks_server_id ON tracks(server_track_id);
             CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash);",
        );

        Ok(())
    }

    /// Returns the complete library state (tracks, folders, playlists, radio favorites, settings).
    pub fn get_library_snapshot(&self) -> Result<LibrarySnapshot, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Ok(LibrarySnapshot {
            tracks: query_all_tracks(&conn)?,
            folders: query_folders(&conn)?,
            playlists: query_playlists(&conn)?,
            radio_favorites: query_radio_favorites(&conn)?,
            settings: query_settings(&conn)?,
        })
    }

    /// Registers a folder path or returns its existing record.
    pub fn register_folder(&self, path: &str) -> Result<MusicFolder, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = conn
            .query_row(
                "SELECT f.id, f.path, COUNT(t.id), f.added_at
                 FROM folders f
                 LEFT JOIN tracks t ON t.folder_id = f.id
                 WHERE LOWER(f.path) = LOWER(?1)
                 GROUP BY f.id",
                params![path],
                map_folder_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            return Ok(existing);
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO folders (id, path, added_at) VALUES (?1, ?2, ?3)",
            params![id, path, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(MusicFolder {
            id,
            path: path.to_string(),
            track_count: 0,
            added_at: now,
        })
    }

    /// Lists all registered folders.
    pub fn list_folders(&self) -> Result<Vec<MusicFolder>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        query_folders(&conn)
    }

    /// Removes a registered folder and cascades deletion to tracks belonging solely to it.
    pub fn remove_folder(&self, folder_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Checks whether a file already exists in SQLite with the exact same `file_size` and `modified_at`.
    pub fn get_track_fingerprint(&self, file_path: &str) -> Result<Option<(String, u64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, file_size, modified_at FROM tracks WHERE LOWER(file_path) = LOWER(?1)",
            params![file_path],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Links an existing track (e.g. previously imported via WMP) to a folder if its folder_id is NULL.
    pub fn attach_track_to_folder(&self, track_id: &str, folder_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET folder_id = COALESCE(folder_id, ?1) WHERE id = ?2",
            params![folder_id, track_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Inserts or updates a scanned track and stores its deduplicated cover artwork if present.
    pub fn upsert_track(
        &self,
        folder_id: Option<&str>,
        scanned: &ScannedTrack,
        cover: Option<&ExtractedCover>,
    ) -> Result<(String, UpsertOutcome), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        if let Some((hash, mime, data)) = cover {
            conn.execute(
                "INSERT OR IGNORE INTO covers (hash, mime, data) VALUES (?1, ?2, ?3)",
                params![hash, mime, data],
            )
            .map_err(|e| e.to_string())?;
        }

        let existing: Option<(String, i64, i64)> = conn
            .query_row(
                "SELECT id, file_size, modified_at FROM tracks WHERE LOWER(file_path) = LOWER(?1)",
                params![scanned.file_path],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((existing_id, old_size, old_mod)) = existing {
            if old_size == scanned.file_size as i64 && old_mod == scanned.modified_at {
                if let Some(fid) = folder_id {
                    conn.execute(
                        "UPDATE tracks SET folder_id = COALESCE(folder_id, ?1) WHERE id = ?2",
                        params![fid, existing_id],
                    )
                    .map_err(|e| e.to_string())?;
                }
                return Ok((existing_id, UpsertOutcome::Unchanged));
            }

            conn.execute(
                "UPDATE tracks SET
                    folder_id = COALESCE(?1, folder_id),
                    file_path = ?2,
                    title = ?3,
                    artist = ?4,
                    album = ?5,
                    album_artist = ?6,
                    track_number = ?7,
                    disc_number = ?8,
                    year = ?9,
                    genre = ?10,
                    duration_ms = ?11,
                    format = ?12,
                    bitrate_kbps = ?13,
                    file_size = ?14,
                    modified_at = ?15,
                    cover_hash = ?16,
                    content_hash = NULL,
                    server_track_id = NULL
                 WHERE id = ?17",
                params![
                    folder_id,
                    scanned.file_path,
                    scanned.title,
                    scanned.artist,
                    scanned.album,
                    scanned.album_artist,
                    scanned.track_number,
                    scanned.disc_number,
                    scanned.year,
                    scanned.genre,
                    scanned.duration_ms as i64,
                    scanned.format,
                    scanned.bitrate_kbps,
                    scanned.file_size as i64,
                    scanned.modified_at,
                    scanned.cover_hash,
                    existing_id,
                ],
            )
            .map_err(|e| e.to_string())?;

            return Ok((existing_id, UpsertOutcome::Updated));
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO tracks (
                id, folder_id, file_path, title, artist, album, album_artist,
                track_number, disc_number, year, genre, duration_ms, format,
                bitrate_kbps, file_size, modified_at, cover_hash, play_count,
                is_favorite, added_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, 0,
                0, ?18
            )",
            params![
                id,
                folder_id,
                scanned.file_path,
                scanned.title,
                scanned.artist,
                scanned.album,
                scanned.album_artist,
                scanned.track_number,
                scanned.disc_number,
                scanned.year,
                scanned.genre,
                scanned.duration_ms as i64,
                scanned.format,
                scanned.bitrate_kbps,
                scanned.file_size as i64,
                scanned.modified_at,
                scanned.cover_hash,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok((id, UpsertOutcome::Added))
    }

    /// Removes tracks belonging to `folder_id` whose paths are no longer present on disk.
    pub fn prune_missing_folder_tracks(
        &self,
        folder_id: &str,
        present_paths_lower: &std::collections::HashSet<String>,
    ) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, file_path FROM tracks WHERE folder_id = ?1")
            .map_err(|e| e.to_string())?;

        let rows: Vec<(String, String)> = stmt
            .query_map(params![folder_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut removed = 0;
        for (id, path) in rows {
            if !present_paths_lower.contains(&path.to_ascii_lowercase()) {
                conn.execute("DELETE FROM tracks WHERE id = ?1", params![id])
                    .map_err(|e| e.to_string())?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Counts all tracks currently indexed in the library.
    pub fn count_tracks(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count as usize)
    }

    /// Looks up the local filesystem path for a track ID (used by the custom `tmusic` protocol).
    pub fn get_track_file_path(&self, track_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT file_path FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Looks up cover bytes and MIME type by SHA-256 hash.
    pub fn get_cover(&self, cover_hash: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT mime, data FROM covers WHERE hash = ?1",
            params![cover_hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Saves or replaces a cover image blob under the specified key/hash.
    pub fn save_cover(&self, hash: &str, mime: &str, data: &[u8]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO covers (hash, mime, data) VALUES (?1, ?2, ?3)",
            params![hash, mime, data],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Toggles `is_favorite` on a track and returns the updated state.
    pub fn toggle_favorite(&self, track_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE tracks
             SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END,
                 favorite_updated_at = ?1
             WHERE id = ?2",
            params![now, track_id],
        )
        .map_err(|e| e.to_string())?;

        let fav: i64 = conn
            .query_row(
                "SELECT is_favorite FROM tracks WHERE id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(fav != 0)
    }

    /// Increments `play_count` for a track and returns the new play count.
    pub fn record_play(&self, track_id: &str) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET play_count = play_count + 1 WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;

        let count: i64 = conn
            .query_row(
                "SELECT play_count FROM tracks WHERE id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count as u64)
    }

    /// Creates a new playlist and returns its summary row.
    pub fn create_playlist(
        &self,
        name: &str,
        description: &str,
        source_type: &str,
        source_path: Option<&str>,
    ) -> Result<Playlist, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();

        conn.execute(
            "INSERT INTO playlists (id, name, description, source_type, source_path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name, description, source_type, source_path, now, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(Playlist {
            id,
            name: name.to_string(),
            description: description.to_string(),
            source_type: source_type.to_string(),
            source_path: source_path.map(str::to_string),
            track_count: 0,
            total_duration_ms: 0,
            created_at: now,
            updated_at: now,
        })
    }

    /// Fetches a single playlist summary by ID.
    pub fn get_playlist(&self, playlist_id: &str) -> Result<Playlist, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        query_playlist_by_id(&conn, playlist_id)?
            .ok_or_else(|| format!("Playlist not found: {playlist_id}"))
    }

    /// Renames an existing playlist and bumps `updated_at`.
    pub fn rename_playlist(&self, playlist_id: &str, name: &str) -> Result<Playlist, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, playlist_id],
        )
        .map_err(|e| e.to_string())?;

        query_playlist_by_id(&conn, playlist_id)?
            .ok_or_else(|| format!("Playlist not found: {playlist_id}"))
    }

    /// Soft-deletes a playlist so deletion propagates during server sync.
    pub fn delete_playlist(&self, playlist_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE playlists SET deleted = 1, updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Returns ordered tracks belonging to a playlist.
    pub fn get_playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {TRACK_SELECT_COLUMNS}
                 FROM playlist_tracks pt
                 INNER JOIN tracks t ON t.id = pt.track_id
                 WHERE pt.playlist_id = ?1
                 ORDER BY pt.position ASC"
            ))
            .map_err(|e| e.to_string())?;

        let tracks = stmt
            .query_map(params![playlist_id], map_track_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(tracks)
    }

    /// Appends tracks to the end of a playlist (ignoring duplicates already in that playlist).
    pub fn add_tracks_to_playlist(
        &self,
        playlist_id: &str,
        track_ids: &[String],
    ) -> Result<Playlist, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let max_pos: Option<i64> = tx
            .query_row(
                "SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut next_pos = max_pos.map(|p| p + 1).unwrap_or(0);
        let now = Utc::now().timestamp();

        for track_id in track_ids {
            let changed = tx
                .execute(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![playlist_id, track_id, next_pos, now],
                )
                .map_err(|e| e.to_string())?;
            if changed > 0 {
                next_pos += 1;
            }
        }

        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;

        query_playlist_by_id(&conn, playlist_id)?
            .ok_or_else(|| format!("Playlist not found: {playlist_id}"))
    }

    /// Removes a track from a playlist and re-compacts positions.
    pub fn remove_track_from_playlist(
        &self,
        playlist_id: &str,
        track_id: &str,
    ) -> Result<Playlist, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )
        .map_err(|e| e.to_string())?;

        let remaining: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT track_id FROM playlist_tracks
                     WHERE playlist_id = ?1 ORDER BY position ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![playlist_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };

        for (idx, tid) in remaining.iter().enumerate() {
            tx.execute(
                "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
                params![idx as i64, playlist_id, tid],
            )
            .map_err(|e| e.to_string())?;
        }

        let now = Utc::now().timestamp();
        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;

        query_playlist_by_id(&conn, playlist_id)?
            .ok_or_else(|| format!("Playlist not found: {playlist_id}"))
    }

    /// Reorders tracks inside a playlist according to `ordered_track_ids`.
    pub fn reorder_playlist_tracks(
        &self,
        playlist_id: &str,
        ordered_track_ids: &[String],
    ) -> Result<Vec<Track>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        for (idx, track_id) in ordered_track_ids.iter().enumerate() {
            tx.execute(
                "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
                params![idx as i64, playlist_id, track_id],
            )
            .map_err(|e| e.to_string())?;
        }

        let now = Utc::now().timestamp();
        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);

        self.get_playlist_tracks(playlist_id)
    }

    /// Toggles a radio station in saved favorites; returns `true` if now favorited.
    pub fn toggle_radio_favorite(&self, station: &RadioStation) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM radio_favorites WHERE station_uuid = ?1",
                params![station.station_uuid],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);

        if exists {
            conn.execute(
                "DELETE FROM radio_favorites WHERE station_uuid = ?1",
                params![station.station_uuid],
            )
            .map_err(|e| e.to_string())?;
            return Ok(false);
        }

        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO radio_favorites (station_uuid, name, url, favicon, country, tags, bitrate, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                station.station_uuid,
                station.name,
                station.url,
                station.favicon,
                station.country,
                station.tags,
                station.bitrate,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Persists a user setting key/value pair.
    pub fn save_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Reads a single setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Removes a setting key.
    pub fn delete_setting(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Checks whether a cover hash already exists in local SQLite.
    pub fn has_cover(&self, hash: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let exists = conn
            .query_row(
                "SELECT 1 FROM covers WHERE hash = ?1",
                params![hash],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        Ok(exists)
    }

    /// Stores the SHA-256 content hash for a local track.
    pub fn set_track_content_hash(&self, track_id: &str, hash: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET content_hash = ?1 WHERE id = ?2",
            params![hash, track_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Links a local track record to its remote `server_track_id`.
    pub fn set_track_server_id(
        &self,
        track_id: &str,
        server_track_id: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET server_track_id = ?1 WHERE id = ?2",
            params![server_track_id, track_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Lists all tracks with fields needed for sync hashing/uploads/favorites.
    pub fn list_tracks_for_sync(&self) -> Result<Vec<LocalTrackSyncRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, title, artist, album, content_hash,
                        server_track_id, is_remote, is_favorite, favorite_updated_at
                 FROM tracks",
            )
            .map_err(|e| e.to_string())?;

        collect_rows(&mut stmt, [], |row| {
            Ok(LocalTrackSyncRow {
                id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                content_hash: row.get(5)?,
                server_track_id: row.get(6)?,
                is_remote: row.get::<_, i64>(7)? != 0,
                is_favorite: row.get::<_, i64>(8)? != 0,
                favorite_updated_at: row.get(9)?,
            })
        })
    }

    /// Lists all playlists (including deleted tombstones) mapped to `server_track_id`s.
    pub fn list_playlists_for_sync(&self) -> Result<Vec<LocalPlaylistSyncRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, is_shared, updated_at, deleted
                 FROM playlists",
            )
            .map_err(|e| e.to_string())?;

        let headers = collect_rows(&mut stmt, [], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)? != 0,
            ))
        })?;

        let mut pt_stmt = conn
            .prepare(
                "SELECT t.server_track_id
                 FROM playlist_tracks pt
                 INNER JOIN tracks t ON t.id = pt.track_id
                 WHERE pt.playlist_id = ?1 AND t.server_track_id IS NOT NULL
                 ORDER BY pt.position ASC",
            )
            .map_err(|e| e.to_string())?;

        let mut out = Vec::with_capacity(headers.len());
        for (id, name, description, is_shared, updated_at, deleted) in headers {
            let track_server_ids = if deleted {
                Vec::new()
            } else {
                collect_rows(&mut pt_stmt, params![id], |r| r.get::<_, String>(0))?
            };
            out.push(LocalPlaylistSyncRow {
                id,
                name,
                description,
                is_shared,
                updated_at,
                deleted,
                track_server_ids,
            });
        }
        Ok(out)
    }

    /// Upserts a track pulled from the home server, linking existing local tracks by hash if found.
    pub fn upsert_remote_track(&self, srv: &ServerTrack) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        if let Some(existing_id) = conn
            .query_row(
                "SELECT id FROM tracks WHERE server_track_id = ?1 OR content_hash = ?2",
                params![srv.id, srv.content_hash],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            conn.execute(
                "UPDATE tracks
                 SET server_track_id = ?1,
                     content_hash = COALESCE(content_hash, ?2),
                     cover_hash = COALESCE(cover_hash, ?3)
                 WHERE id = ?4",
                params![srv.id, srv.content_hash, srv.cover_hash, existing_id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(false);
        }

        let id = Uuid::new_v4().to_string();
        let remote_path = format!("remote://{}", srv.id);
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO tracks (
                id, folder_id, file_path, title, artist, album, album_artist,
                track_number, disc_number, year, genre, duration_ms, format,
                bitrate_kbps, file_size, modified_at, cover_hash, play_count,
                is_favorite, added_at, content_hash, server_track_id, is_remote, favorite_updated_at
            ) VALUES (
                ?1, NULL, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, 0, ?15, 0,
                0, ?16, ?17, ?18, 1, 0
            )",
            params![
                id,
                remote_path,
                srv.title,
                srv.artist,
                srv.album,
                srv.album_artist,
                srv.track_number,
                srv.disc_number,
                srv.year,
                srv.genre,
                srv.duration_ms as i64,
                srv.format,
                srv.bitrate_kbps,
                srv.file_size as i64,
                srv.cover_hash,
                now,
                srv.content_hash,
                srv.id,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(true)
    }

    /// Applies a playlist snapshot pulled from the server using last-write-wins.
    pub fn apply_remote_playlist_sync(&self, pl: &SyncPlaylistPayload) -> Result<bool, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let existing_updated: Option<i64> = tx
            .query_row(
                "SELECT updated_at FROM playlists WHERE id = ?1",
                params![pl.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if existing_updated.is_none() && pl.deleted {
            return Ok(false);
        }
        if existing_updated.is_some_and(|ts| pl.updated_at < ts) {
            return Ok(false);
        }

        let now = Utc::now().timestamp();
        if existing_updated.is_some() {
            tx.execute(
                "UPDATE playlists
                 SET name = ?1, description = ?2, is_shared = ?3, updated_at = ?4, deleted = ?5
                 WHERE id = ?6",
                params![
                    pl.name,
                    pl.description,
                    if pl.is_shared { 1 } else { 0 },
                    pl.updated_at,
                    if pl.deleted { 1 } else { 0 },
                    pl.id,
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO playlists (
                    id, name, description, source_type, source_path,
                    created_at, updated_at, deleted, is_shared
                ) VALUES (?1, ?2, ?3, 'sync', NULL, ?4, ?5, ?6, ?7)",
                params![
                    pl.id,
                    pl.name,
                    pl.description,
                    now,
                    pl.updated_at,
                    if pl.deleted { 1 } else { 0 },
                    if pl.is_shared { 1 } else { 0 },
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![pl.id],
        )
        .map_err(|e| e.to_string())?;

        if !pl.deleted {
            for (pos, server_tid) in pl.track_ids.iter().enumerate() {
                let local_tid: Option<String> = tx
                    .query_row(
                        "SELECT id FROM tracks WHERE server_track_id = ?1",
                        params![server_tid],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if let Some(tid) = local_tid {
                    tx.execute(
                        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![pl.id, tid, pos as i64, now],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Applies a per-user favorite state pulled from the server using last-write-wins.
    pub fn apply_remote_favorite_sync(&self, fav: &SyncFavoritePayload) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let existing: Option<(String, i64)> = conn
            .query_row(
                "SELECT id, favorite_updated_at FROM tracks WHERE server_track_id = ?1",
                params![fav.track_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some((local_id, existing_ts)) = existing else {
            return Ok(false);
        };
        if fav.updated_at < existing_ts {
            return Ok(false);
        }

        conn.execute(
            "UPDATE tracks SET is_favorite = ?1, favorite_updated_at = ?2 WHERE id = ?3",
            params![if fav.is_favorite { 1 } else { 0 }, fav.updated_at, local_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

const TRACK_SELECT_COLUMNS: &str = "
    t.id, t.file_path, t.title, t.artist, t.album, t.album_artist,
    t.track_number, t.disc_number, t.year, t.genre, t.duration_ms,
    t.format, t.bitrate_kbps, t.file_size, t.modified_at, t.cover_hash,
    t.play_count, t.is_favorite, t.added_at
";

fn map_track_row(row: &Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        file_path: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        album_artist: row.get(5)?,
        track_number: row.get(6)?,
        disc_number: row.get(7)?,
        year: row.get(8)?,
        genre: row.get(9)?,
        duration_ms: row.get::<_, i64>(10)? as u64,
        format: row.get(11)?,
        bitrate_kbps: row.get(12)?,
        file_size: row.get::<_, i64>(13)? as u64,
        modified_at: row.get(14)?,
        cover_hash: row.get(15)?,
        play_count: row.get::<_, i64>(16)? as u64,
        is_favorite: row.get::<_, i64>(17)? != 0,
        added_at: row.get(18)?,
    })
}

fn map_folder_row(row: &Row<'_>) -> rusqlite::Result<MusicFolder> {
    Ok(MusicFolder {
        id: row.get(0)?,
        path: row.get(1)?,
        track_count: row.get::<_, i64>(2)? as usize,
        added_at: row.get(3)?,
    })
}

fn map_playlist_row(row: &Row<'_>) -> rusqlite::Result<Playlist> {
    Ok(Playlist {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source_type: row.get(3)?,
        source_path: row.get(4)?,
        track_count: row.get::<_, i64>(5)? as usize,
        total_duration_ms: row.get::<_, i64>(6)? as u64,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn collect_rows<T, F>(
    stmt: &mut rusqlite::Statement<'_>,
    query_params: impl rusqlite::Params,
    mapper: F,
) -> Result<Vec<T>, String>
where
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    stmt.query_map(query_params, mapper)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<T>, _>>()
        .map_err(|e| e.to_string())
}

fn query_all_tracks(conn: &Connection) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TRACK_SELECT_COLUMNS}
             FROM tracks t
             ORDER BY LOWER(t.artist) ASC, LOWER(t.album) ASC,
                      COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC,
                      LOWER(t.title) ASC"
        ))
        .map_err(|e| e.to_string())?;

    collect_rows(&mut stmt, [], map_track_row)
}

fn query_folders(conn: &Connection) -> Result<Vec<MusicFolder>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.path, COUNT(t.id), f.added_at
             FROM folders f
             LEFT JOIN tracks t ON t.folder_id = f.id
             GROUP BY f.id
             ORDER BY f.added_at ASC",
        )
        .map_err(|e| e.to_string())?;

    collect_rows(&mut stmt, [], map_folder_row)
}

fn query_playlists(conn: &Connection) -> Result<Vec<Playlist>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.description, p.source_type, p.source_path,
                    COUNT(pt.track_id), COALESCE(SUM(t.duration_ms), 0),
                    p.created_at, p.updated_at
             FROM playlists p
             LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
             LEFT JOIN tracks t ON t.id = pt.track_id
             WHERE p.deleted = 0
             GROUP BY p.id
             ORDER BY p.updated_at DESC, LOWER(p.name) ASC",
        )
        .map_err(|e| e.to_string())?;

    collect_rows(&mut stmt, [], map_playlist_row)
}

fn query_playlist_by_id(conn: &Connection, playlist_id: &str) -> Result<Option<Playlist>, String> {
    conn.query_row(
        "SELECT p.id, p.name, p.description, p.source_type, p.source_path,
                COUNT(pt.track_id), COALESCE(SUM(t.duration_ms), 0),
                p.created_at, p.updated_at
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks t ON t.id = pt.track_id
         WHERE p.id = ?1 AND p.deleted = 0
         GROUP BY p.id",
        params![playlist_id],
        map_playlist_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn query_radio_favorites(conn: &Connection) -> Result<Vec<RadioStation>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT station_uuid, name, url, favicon, country, tags, bitrate
             FROM radio_favorites
             ORDER BY added_at DESC",
        )
        .map_err(|e| e.to_string())?;

    collect_rows(&mut stmt, [], |row| {
        Ok(RadioStation {
            station_uuid: row.get(0)?,
            name: row.get(1)?,
            url: row.get(2)?,
            favicon: row.get(3)?,
            country: row.get(4)?,
            tags: row.get(5)?,
            bitrate: row.get(6)?,
        })
    })
}

fn query_settings(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scanned(path: &str, title: &str, cover_hash: Option<&str>) -> ScannedTrack {
        ScannedTrack {
            file_path: path.to_string(),
            title: title.to_string(),
            artist: "Test Artist".to_string(),
            album: "Test Album".to_string(),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
            genre: Some("Electronic".to_string()),
            duration_ms: 180_000,
            format: "flac".to_string(),
            bitrate_kbps: Some(950),
            file_size: 2048,
            modified_at: 1000,
            cover_hash: cover_hash.map(str::to_string),
        }
    }

    #[test]
    fn upserts_tracks_and_deduplicates_covers() {
        let db = Database::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let folder = db.register_folder("C:\\Music").unwrap();

        let cover: ExtractedCover = (
            "abc123".to_string(),
            "image/png".to_string(),
            vec![1, 2, 3, 4],
        );
        let t1 = sample_scanned("C:\\Music\\01.flac", "Intro", Some("abc123"));
        let t2 = sample_scanned("C:\\Music\\02.flac", "Outro", Some("abc123"));

        let (id1, out1) = db.upsert_track(Some(&folder.id), &t1, Some(&cover)).unwrap();
        let (_, out2) = db.upsert_track(Some(&folder.id), &t2, Some(&cover)).unwrap();
        let (_, out3) = db.upsert_track(Some(&folder.id), &t1, Some(&cover)).unwrap();

        assert_eq!(out1, UpsertOutcome::Added);
        assert_eq!(out2, UpsertOutcome::Added);
        assert_eq!(out3, UpsertOutcome::Unchanged);
        assert_eq!(db.count_tracks().unwrap(), 2);
        assert_eq!(
            db.get_cover("abc123").unwrap(),
            Some(("image/png".to_string(), vec![1, 2, 3, 4]))
        );

        assert!(db.toggle_favorite(&id1).unwrap());
        assert_eq!(db.record_play(&id1).unwrap(), 1);
    }

    #[test]
    fn creates_reorders_and_deletes_playlists() {
        let db = Database::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let (id1, _) = db
            .upsert_track(None, &sample_scanned("C:\\a.mp3", "Alpha", None), None)
            .unwrap();
        let (id2, _) = db
            .upsert_track(None, &sample_scanned("C:\\b.mp3", "Beta", None), None)
            .unwrap();

        let pl = db.create_playlist("Focus", "Coding mix", "custom", None).unwrap();
        let pl = db
            .add_tracks_to_playlist(&pl.id, &[id1.clone(), id2.clone()])
            .unwrap();
        assert_eq!(pl.track_count, 2);
        assert_eq!(pl.total_duration_ms, 360_000);

        let reordered = db
            .reorder_playlist_tracks(&pl.id, &[id2.clone(), id1.clone()])
            .unwrap();
        assert_eq!(reordered[0].id, id2);
        assert_eq!(reordered[1].id, id1);

        let pl_after_remove = db.remove_track_from_playlist(&pl.id, &id2).unwrap();
        assert_eq!(pl_after_remove.track_count, 1);

        db.delete_playlist(&pl.id).unwrap();
        assert!(db.get_library_snapshot().unwrap().playlists.is_empty());
    }

    #[test]
    fn persists_settings_and_radio_favorites() {
        let db = Database::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        db.save_setting("theme", "retro-vfd").unwrap();
        db.save_setting("theme", "obsidian").unwrap();

        let station = RadioStation {
            station_uuid: "uuid-1".into(),
            name: "Synth Radio".into(),
            url: "https://example.org/stream.mp3".into(),
            favicon: None,
            country: Some("DE".into()),
            tags: Some("synthwave".into()),
            bitrate: Some(192),
        };
        assert!(db.toggle_radio_favorite(&station).unwrap());
        let snap = db.get_library_snapshot().unwrap();
        assert_eq!(snap.settings.get("theme").map(String::as_str), Some("obsidian"));
        assert_eq!(snap.radio_favorites.len(), 1);

        assert!(!db.toggle_radio_favorite(&station).unwrap());
        assert!(db.get_library_snapshot().unwrap().radio_favorites.is_empty());
    }

    #[test]
    fn merges_remote_tracks_and_two_way_playlists() {
        let db = Database::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let srv_track = ServerTrack {
            id: "srv-t1".into(),
            content_hash: "deadbeef".into(),
            title: "Cloud Song".into(),
            artist: "TPX".into(),
            album: "Home Server".into(),
            album_artist: None,
            track_number: Some(1),
            disc_number: None,
            year: Some(2026),
            genre: Some("Electronic".into()),
            duration_ms: 200_000,
            format: "flac".into(),
            bitrate_kbps: Some(980),
            file_size: 123456,
            cover_hash: None,
            uploaded_by: Some("alice".into()),
            created_at: 1000,
        };
        assert!(db.upsert_remote_track(&srv_track).unwrap());
        assert!(!db.upsert_remote_track(&srv_track).unwrap());

        let pl = SyncPlaylistPayload {
            id: "pl-sync-1".into(),
            name: "Synced Mix".into(),
            description: "From Phone".into(),
            track_ids: vec!["srv-t1".into()],
            is_shared: false,
            owner_username: "alice".into(),
            updated_at: 2000,
            deleted: false,
        };
        assert!(db.apply_remote_playlist_sync(&pl).unwrap());

        let snap = db.get_library_snapshot().unwrap();
        assert_eq!(snap.tracks.len(), 1);
        assert_eq!(snap.tracks[0].file_path, "remote://srv-t1");
        assert_eq!(snap.playlists.len(), 1);
        assert_eq!(snap.playlists[0].track_count, 1);

        let fav = SyncFavoritePayload {
            track_id: "srv-t1".into(),
            is_favorite: true,
            updated_at: 3000,
        };
        assert!(db.apply_remote_favorite_sync(&fav).unwrap());
        assert!(db.get_library_snapshot().unwrap().tracks[0].is_favorite);
    }
}
