//! SQLite persistence for multi-user accounts, tracks, deduplicated covers, playlists, and favorites.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use t_music_core::models::{
    ScannedTrack, ServerTrack, SyncFavoritePayload, SyncPlaylistPayload, SyncPullResponse,
    SyncPushRequest, SyncPushResponse, SyncTrackEditPayload, UserProfile,
};
use t_music_core::scanner::ExtractedCover;
use uuid::Uuid;

/// Stored track metadata + server disk path used for streaming.
pub struct StoredServerTrack {
    pub meta: ServerTrack,
    pub file_path: String,
}

/// Thread-safe SQLite database handle for `t-music-server`.
pub struct ServerDb {
    conn: Mutex<Connection>,
}

impl ServerDb {
    /// Opens or creates the server SQLite database at `db_path`.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create server DB directory: {e}"))?;
        }
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open server SQLite database: {e}"))?;
        Self::from_connection(conn)
    }

    /// Initializes schema on an existing SQLite connection (used by integration tests).
    pub fn from_connection(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;",
        )
        .map_err(|e| format!("Failed to configure server SQLite pragmas: {e}"))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS covers (
                hash TEXT PRIMARY KEY,
                mime TEXT NOT NULL,
                data BLOB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL UNIQUE,
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
                cover_hash TEXT REFERENCES covers(hash) ON DELETE SET NULL,
                uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_srv_tracks_hash ON tracks(content_hash);

            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                is_shared INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id)
            );

            CREATE TABLE IF NOT EXISTS user_favorites (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, track_id)
            );

            CREATE TABLE IF NOT EXISTS user_tracks (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, track_id)
            );

            CREATE INDEX IF NOT EXISTS idx_user_tracks_user ON user_tracks(user_id);

            CREATE TABLE IF NOT EXISTS user_track_edits (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                speed REAL NOT NULL DEFAULT 1.0,
                gain_db REAL NOT NULL DEFAULT 0.0,
                trim_start_ms INTEGER NOT NULL DEFAULT 0,
                trim_end_ms INTEGER,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, track_id)
            );

            INSERT OR IGNORE INTO user_tracks (user_id, track_id, added_at)
            SELECT uploaded_by, id, created_at FROM tracks WHERE uploaded_by IS NOT NULL;",
        )
        .map_err(|e| format!("Failed to initialize server schema: {e}"))?;
        Ok(())
    }

    /// Creates an initial admin user if no users exist yet.
    pub fn ensure_bootstrap_admin(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if count > 0 {
            return Ok(());
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at)
             VALUES (?1, ?2, ?3, 'admin', ?4)",
            params![id, username, password_hash, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Registers a new user; promotes the first registered user to `'admin'`.
    pub fn create_user(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<UserProfile, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM users WHERE username = ?1",
                params![username],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if exists {
            return Err("Username already taken".to_string());
        }

        let user_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let role = if user_count == 0 { "admin" } else { "user" };

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, username, password_hash, role, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(UserProfile {
            id,
            username: username.to_string(),
            role: role.to_string(),
            created_at: now,
        })
    }

    /// Looks up user profile + stored password hash by username.
    pub fn find_user_for_login(
        &self,
        username: &str,
    ) -> Result<Option<(UserProfile, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, username, role, created_at, password_hash FROM users WHERE username = ?1",
            params![username],
            |row| {
                Ok((
                    UserProfile {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        role: row.get(2)?,
                        created_at: row.get(3)?,
                    },
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Looks up a user profile by user ID.
    pub fn get_user_by_id(&self, user_id: &str) -> Result<Option<UserProfile>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, username, role, created_at FROM users WHERE id = ?1",
            params![user_id],
            |row| {
                Ok(UserProfile {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    role: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Looks up the first admin user's ID (used to assign host-scanned `MUSIC_DIR` tracks).
    pub fn get_first_admin_user_id(&self) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Associates a track with a user's private library (`user_tracks`).
    pub fn link_track_to_user(&self, user_id: &str, track_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT OR IGNORE INTO user_tracks (user_id, track_id, added_at)
             VALUES (?1, ?2, ?3)",
            params![user_id, track_id, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Maps existing `content_hash` values to server `track_id`s and links matched tracks
    /// into `user_id`'s private library (preserving SHA-256 disk deduplication across users).
    pub fn claim_existing_hashes_for_user(
        &self,
        user_id: &str,
        hashes: &[String],
    ) -> Result<HashMap<String, String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM tracks WHERE content_hash = ?1")
            .map_err(|e| e.to_string())?;
        let mut link_stmt = conn
            .prepare(
                "INSERT OR IGNORE INTO user_tracks (user_id, track_id, added_at)
                 VALUES (?1, ?2, ?3)",
            )
            .map_err(|e| e.to_string())?;
        let now = Utc::now().timestamp();
        let mut out = HashMap::new();
        for hash in hashes {
            if let Some(id) = stmt
                .query_row(params![hash], |r| r.get::<_, String>(0))
                .optional()
                .map_err(|e| e.to_string())?
            {
                link_stmt
                    .execute(params![user_id, &id, now])
                    .map_err(|e| e.to_string())?;
                out.insert(hash.clone(), id);
            }
        }
        Ok(out)
    }

    /// Returns true if `user_id` owns the track or can view it via a non-deleted shared playlist.
    pub fn user_can_access_track(&self, user_id: &str, track_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let allowed = conn
            .query_row(
                "SELECT 1 FROM tracks t
                 WHERE t.id = ?1
                   AND (
                       EXISTS (
                           SELECT 1 FROM user_tracks ut
                           WHERE ut.track_id = t.id AND ut.user_id = ?2
                       )
                       OR EXISTS (
                           SELECT 1 FROM playlist_tracks pt
                           INNER JOIN playlists p ON p.id = pt.playlist_id
                           WHERE pt.track_id = t.id AND p.is_shared = 1 AND p.deleted = 0
                       )
                   )",
                params![track_id, user_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        Ok(allowed)
    }

    /// Fetches a track by `content_hash`.
    pub fn get_track_by_hash(&self, content_hash: &str) -> Result<Option<ServerTrack>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("{SERVER_TRACK_SELECT} WHERE t.content_hash = ?1"),
            params![content_hash],
            map_server_track_row,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Fetches a track + disk path by server `track_id`.
    pub fn get_track_for_stream(
        &self,
        track_id: &str,
    ) -> Result<Option<StoredServerTrack>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("{SERVER_TRACK_SELECT_WITH_PATH} WHERE t.id = ?1"),
            params![track_id],
            |row| {
                let meta = map_server_track_row(row)?;
                let file_path: String = row.get(17)?;
                Ok(StoredServerTrack { meta, file_path })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Inserts or returns an existing track deduplicated by `content_hash`, linking it to `uploaded_by_user_id`.
    pub fn insert_track_if_missing(
        &self,
        content_hash: &str,
        scanned: &ScannedTrack,
        cover: Option<&ExtractedCover>,
        uploaded_by_user_id: Option<&str>,
    ) -> Result<ServerTrack, String> {
        if let Some(existing) = self.get_track_by_hash(content_hash)? {
            if let Some(uid) = uploaded_by_user_id {
                self.link_track_to_user(uid, &existing.id)?;
            }
            return Ok(existing);
        }

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if let Some((hash, mime, data)) = cover {
            conn.execute(
                "INSERT OR IGNORE INTO covers (hash, mime, data) VALUES (?1, ?2, ?3)",
                params![hash, mime, data],
            )
            .map_err(|e| e.to_string())?;
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO tracks (
                id, content_hash, file_path, title, artist, album, album_artist,
                track_number, disc_number, year, genre, duration_ms, format,
                bitrate_kbps, file_size, cover_hash, uploaded_by, created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18
            )",
            params![
                id,
                content_hash,
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
                scanned.cover_hash,
                uploaded_by_user_id,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        if let Some(uid) = uploaded_by_user_id {
            conn.execute(
                "INSERT OR IGNORE INTO user_tracks (user_id, track_id, added_at)
                 VALUES (?1, ?2, ?3)",
                params![uid, id, now],
            )
            .map_err(|e| e.to_string())?;
        }

        drop(conn);
        self.get_track_by_hash(content_hash)?
            .ok_or_else(|| "Failed to load newly inserted track".to_string())
    }

    /// Lists tracks visible to `user_id` (private user library + tracks inside shared playlists).
    pub fn list_tracks_for_user(&self, user_id: &str) -> Result<Vec<ServerTrack>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "{SERVER_TRACK_SELECT}
                 WHERE EXISTS (
                     SELECT 1 FROM user_tracks ut
                     WHERE ut.track_id = t.id AND ut.user_id = ?1
                 )
                 OR EXISTS (
                     SELECT 1 FROM playlist_tracks pt
                     INNER JOIN playlists p ON p.id = pt.playlist_id
                     WHERE pt.track_id = t.id AND p.is_shared = 1 AND p.deleted = 0
                 )
                 ORDER BY LOWER(t.artist) ASC, LOWER(t.album) ASC,
                          COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC,
                          LOWER(t.title) ASC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id], map_server_track_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// Looks up cover bytes by hash.
    pub fn get_cover(&self, hash: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT mime, data FROM covers WHERE hash = ?1",
            params![hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Pulls the user's private library (+ shared playlist tracks), user-owned + shared playlists, and user's favorites.
    pub fn pull_sync(&self, user_id: &str) -> Result<SyncPullResponse, String> {
        let tracks = self.list_tracks_for_user(user_id)?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let mut pl_stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.description, p.is_shared, u.username, p.updated_at, p.deleted
                 FROM playlists p
                 INNER JOIN users u ON u.id = p.owner_user_id
                 WHERE p.owner_user_id = ?1 OR p.is_shared = 1
                 ORDER BY p.updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let playlist_headers = pl_stmt
            .query_map(params![user_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)? != 0,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut pt_stmt = conn
            .prepare(
                "SELECT track_id FROM playlist_tracks
                 WHERE playlist_id = ?1 ORDER BY position ASC",
            )
            .map_err(|e| e.to_string())?;

        let mut playlists = Vec::with_capacity(playlist_headers.len());
        for (id, name, description, is_shared, owner_username, updated_at, deleted) in
            playlist_headers
        {
            let track_ids = if deleted {
                Vec::new()
            } else {
                pt_stmt
                    .query_map(params![id], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            playlists.push(SyncPlaylistPayload {
                id,
                name,
                description,
                track_ids,
                is_shared,
                owner_username,
                updated_at,
                deleted,
            });
        }

        let mut fav_stmt = conn
            .prepare(
                "SELECT track_id, is_favorite, updated_at
                 FROM user_favorites WHERE user_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let favorites = fav_stmt
            .query_map(params![user_id], |row| {
                Ok(SyncFavoritePayload {
                    track_id: row.get(0)?,
                    is_favorite: row.get::<_, i64>(1)? != 0,
                    updated_at: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut edit_stmt = conn
            .prepare(
                "SELECT track_id, speed, gain_db, trim_start_ms, trim_end_ms, updated_at
                 FROM user_track_edits WHERE user_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let track_edits = edit_stmt
            .query_map(params![user_id], |row| {
                Ok(SyncTrackEditPayload {
                    track_id: row.get(0)?,
                    speed: row.get::<_, f64>(1)? as f32,
                    gain_db: row.get::<_, f64>(2)? as f32,
                    trim_start_ms: row.get::<_, i64>(3)?.max(0) as u64,
                    trim_end_ms: row.get::<_, Option<i64>>(4)?.map(|v| v.max(0) as u64),
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(SyncPullResponse {
            server_time: Utc::now().timestamp(),
            tracks,
            playlists,
            favorites,
            track_edits,
        })
    }

    /// Merges playlist edits/deletions (owned by caller), favorites, and per-track edits using last-write-wins.
    pub fn push_sync(
        &self,
        user_id: &str,
        req: &SyncPushRequest,
    ) -> Result<SyncPushResponse, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut applied_playlists = 0;
        let mut applied_favorites = 0;
        let mut applied_track_edits = 0;

        for pl in &req.playlists {
            let existing: Option<(String, i64)> = tx
                .query_row(
                    "SELECT owner_user_id, updated_at FROM playlists WHERE id = ?1",
                    params![pl.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if let Some((owner_id, existing_updated)) = existing {
                if owner_id != user_id {
                    // Only the playlist owner can mutate or delete their playlist.
                    continue;
                }
                if pl.updated_at < existing_updated {
                    continue;
                }
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
                    "INSERT INTO playlists (id, owner_user_id, name, description, is_shared, updated_at, deleted)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        pl.id,
                        user_id,
                        pl.name,
                        pl.description,
                        if pl.is_shared { 1 } else { 0 },
                        pl.updated_at,
                        if pl.deleted { 1 } else { 0 },
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
                for (pos, track_id) in pl.track_ids.iter().enumerate() {
                    // Skip unknown track IDs rather than aborting the batch.
                    let track_exists: bool = tx
                        .query_row(
                            "SELECT 1 FROM tracks WHERE id = ?1",
                            params![track_id],
                            |_| Ok(true),
                        )
                        .optional()
                        .map_err(|e| e.to_string())?
                        .unwrap_or(false);
                    if track_exists {
                        tx.execute(
                            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
                             VALUES (?1, ?2, ?3)",
                            params![pl.id, track_id, pos as i64],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }

            applied_playlists += 1;
        }

        for fav in &req.favorites {
            let track_exists: bool = tx
                .query_row(
                    "SELECT 1 FROM tracks WHERE id = ?1",
                    params![fav.track_id],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or(false);
            if !track_exists {
                continue;
            }

            let existing_ts: Option<i64> = tx
                .query_row(
                    "SELECT updated_at FROM user_favorites WHERE user_id = ?1 AND track_id = ?2",
                    params![user_id, fav.track_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if existing_ts.is_some_and(|ts| fav.updated_at < ts) {
                continue;
            }

            tx.execute(
                "INSERT INTO user_favorites (user_id, track_id, is_favorite, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(user_id, track_id) DO UPDATE SET
                    is_favorite = excluded.is_favorite,
                    updated_at = excluded.updated_at",
                params![
                    user_id,
                    fav.track_id,
                    if fav.is_favorite { 1 } else { 0 },
                    fav.updated_at,
                ],
            )
            .map_err(|e| e.to_string())?;
            applied_favorites += 1;
        }

        for edit in &req.track_edits {
            let track_exists: bool = tx
                .query_row(
                    "SELECT 1 FROM tracks WHERE id = ?1",
                    params![edit.track_id],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or(false);
            if !track_exists {
                continue;
            }

            let existing_ts: Option<i64> = tx
                .query_row(
                    "SELECT updated_at FROM user_track_edits WHERE user_id = ?1 AND track_id = ?2",
                    params![user_id, edit.track_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if existing_ts.is_some_and(|ts| edit.updated_at < ts) {
                continue;
            }

            let speed = edit.speed.clamp(0.5, 2.0) as f64;
            let gain_db = edit.gain_db.clamp(-18.0, 12.0) as f64;
            let trim_start = edit.trim_start_ms as i64;
            let trim_end = edit.trim_end_ms.map(|v| v as i64);

            tx.execute(
                "INSERT INTO user_track_edits (user_id, track_id, speed, gain_db, trim_start_ms, trim_end_ms, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(user_id, track_id) DO UPDATE SET
                    speed = excluded.speed,
                    gain_db = excluded.gain_db,
                    trim_start_ms = excluded.trim_start_ms,
                    trim_end_ms = excluded.trim_end_ms,
                    updated_at = excluded.updated_at",
                params![
                    user_id,
                    edit.track_id,
                    speed,
                    gain_db,
                    trim_start,
                    trim_end,
                    edit.updated_at,
                ],
            )
            .map_err(|e| e.to_string())?;
            applied_track_edits += 1;
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(SyncPushResponse {
            server_time: Utc::now().timestamp(),
            applied_playlists,
            applied_favorites,
            applied_track_edits,
        })
    }
}

const SERVER_TRACK_SELECT: &str = "
    SELECT t.id, t.content_hash, t.title, t.artist, t.album, t.album_artist,
           t.track_number, t.disc_number, t.year, t.genre, t.duration_ms,
           t.format, t.bitrate_kbps, t.file_size, t.cover_hash, u.username, t.created_at
    FROM tracks t
    LEFT JOIN users u ON u.id = t.uploaded_by
";

const SERVER_TRACK_SELECT_WITH_PATH: &str = "
    SELECT t.id, t.content_hash, t.title, t.artist, t.album, t.album_artist,
           t.track_number, t.disc_number, t.year, t.genre, t.duration_ms,
           t.format, t.bitrate_kbps, t.file_size, t.cover_hash, u.username, t.created_at,
           t.file_path
    FROM tracks t
    LEFT JOIN users u ON u.id = t.uploaded_by
";

fn map_server_track_row(row: &Row<'_>) -> rusqlite::Result<ServerTrack> {
    Ok(ServerTrack {
        id: row.get(0)?,
        content_hash: row.get(1)?,
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
        cover_hash: row.get(14)?,
        uploaded_by: row.get(15)?,
        created_at: row.get(16)?,
    })
}
