package dev.trebuh.tmusicplayer.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface MusicDao {
    @Query("SELECT * FROM tracks ORDER BY artist COLLATE NOCASE ASC, album COLLATE NOCASE ASC, COALESCE(discNumber, 0) ASC, COALESCE(trackNumber, 0) ASC, title COLLATE NOCASE ASC")
    fun observeAllTracks(): Flow<List<TrackEntity>>

    @Query("SELECT * FROM tracks")
    suspend fun getAllTracks(): List<TrackEntity>

    @Query("SELECT * FROM tracks WHERE id = :id LIMIT 1")
    suspend fun getTrackById(id: String): TrackEntity?

    @Query("SELECT * FROM tracks WHERE localAudioPath IS NOT NULL")
    suspend fun getDownloadedTracks(): List<TrackEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTracks(tracks: List<TrackEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTrack(track: TrackEntity)

    @Query("UPDATE tracks SET isFavorite = :isFavorite, favoriteUpdatedAt = :updatedAt WHERE id = :trackId")
    suspend fun updateFavorite(trackId: String, isFavorite: Boolean, updatedAt: Long)

    @Query("UPDATE tracks SET localAudioPath = :localPath WHERE id = :trackId")
    suspend fun updateLocalAudioPath(trackId: String, localPath: String?)

    @Query("UPDATE tracks SET localCoverPath = :localCoverPath WHERE coverHash = :coverHash")
    suspend fun updateLocalCoverPathForHash(coverHash: String, localCoverPath: String?)

    @Query("DELETE FROM tracks WHERE id NOT IN (:validIds)")
    suspend fun deleteTracksNotIn(validIds: List<String>)

    @Query("DELETE FROM tracks")
    suspend fun deleteAllTracks()

    @Query("UPDATE tracks SET localAudioPath = NULL, localCoverPath = NULL")
    suspend fun clearAllLocalPaths()

    @Query(
        """
        SELECT p.id, p.name, p.description, p.isShared, p.ownerUsername, p.updatedAt, p.deleted,
               COUNT(t.id) AS trackCount,
               SUM(CASE WHEN t.localAudioPath IS NOT NULL THEN 1 ELSE 0 END) AS downloadedCount
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON p.id = pt.playlistId
        LEFT JOIN tracks t ON pt.trackId = t.id
        WHERE p.deleted = 0
        GROUP BY p.id
        ORDER BY p.updatedAt DESC
        """
    )
    fun observePlaylistSummaries(): Flow<List<PlaylistSummary>>

    @Query("SELECT * FROM playlists")
    suspend fun getAllPlaylistsIncludingDeleted(): List<PlaylistEntity>

    @Query("SELECT * FROM playlists WHERE id = :playlistId LIMIT 1")
    suspend fun getPlaylistById(playlistId: String): PlaylistEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPlaylist(playlist: PlaylistEntity)

    @Query("SELECT * FROM playlist_tracks WHERE playlistId = :playlistId ORDER BY position ASC")
    suspend fun getPlaylistTrackRefs(playlistId: String): List<PlaylistTrackCrossRef>

    @Query(
        """
        SELECT t.* FROM tracks t
        INNER JOIN playlist_tracks pt ON t.id = pt.trackId
        WHERE pt.playlistId = :playlistId
        ORDER BY pt.position ASC
        """
    )
    fun observeTracksForPlaylist(playlistId: String): Flow<List<TrackEntity>>

    @Query(
        """
        SELECT t.* FROM tracks t
        INNER JOIN playlist_tracks pt ON t.id = pt.trackId
        WHERE pt.playlistId = :playlistId
        ORDER BY pt.position ASC
        """
    )
    suspend fun getTracksForPlaylist(playlistId: String): List<TrackEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlaylistTrackRefs(refs: List<PlaylistTrackCrossRef>)

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :playlistId")
    suspend fun clearPlaylistTrackRefs(playlistId: String)

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :playlistId AND trackId = :trackId")
    suspend fun removeTrackFromPlaylist(playlistId: String, trackId: String)

    @Query("DELETE FROM playlists")
    suspend fun deleteAllPlaylists()

    @Query("DELETE FROM playlist_tracks")
    suspend fun deleteAllPlaylistTrackRefs()

    @Transaction
    suspend fun replacePlaylistTracks(playlistId: String, trackIds: List<String>) {
        clearPlaylistTrackRefs(playlistId)
        val distinct = trackIds.distinct()
        if (distinct.isNotEmpty()) {
            insertPlaylistTrackRefs(
                distinct.mapIndexed { index, trackId ->
                    PlaylistTrackCrossRef(
                        playlistId = playlistId,
                        trackId = trackId,
                        position = index,
                    )
                }
            )
        }
    }

    @Transaction
    suspend fun resetLibraryForSignOut() {
        deleteAllPlaylistTrackRefs()
        deleteAllPlaylists()
        deleteAllTracks()
    }
}
