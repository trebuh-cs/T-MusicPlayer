package dev.trebuh.tmusicplayer.data.db

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Junction
import androidx.room.PrimaryKey
import androidx.room.Relation

@Entity(tableName = "tracks")
data class TrackEntity(
    @PrimaryKey val id: String,
    val contentHash: String,
    val title: String,
    val artist: String,
    val album: String,
    val albumArtist: String? = null,
    val trackNumber: Int? = null,
    val discNumber: Int? = null,
    val year: Int? = null,
    val genre: String? = null,
    val durationMs: Long = 0L,
    val format: String = "",
    val bitrateKbps: Int? = null,
    val fileSize: Long = 0L,
    val coverHash: String? = null,
    val uploadedBy: String = "",
    val createdAt: Long = 0L,
    val isFavorite: Boolean = false,
    val favoriteUpdatedAt: Long = 0L,
    val editSpeed: Float = 1.0f,
    val editGainDb: Float = 0.0f,
    val trimStartMs: Long = 0L,
    val trimEndMs: Long? = null,
    val editUpdatedAt: Long = 0L,
    val playCount: Long = 0L,
    val manualPlayCount: Long = 0L,
    val skipCount: Long = 0L,
    val autoExcluded: Boolean = false,
    val lastPlayedAt: Long = 0L,
    val statsUpdatedAt: Long = 0L,
    val localAudioPath: String? = null,
    val localCoverPath: String? = null,
) {
    val isDownloaded: Boolean
        get() = !localAudioPath.isNullOrBlank()

    val hasCustomEdit: Boolean
        get() = kotlin.math.abs(editSpeed - 1.0f) > 0.01f ||
            kotlin.math.abs(editGainDb) > 0.05f ||
            trimStartMs > 0L ||
            trimEndMs != null
}

@Entity(tableName = "playlists")
data class PlaylistEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String = "",
    val isShared: Boolean = false,
    val ownerUsername: String = "",
    val updatedAt: Long = 0L,
    val deleted: Boolean = false,
)

@Entity(
    tableName = "playlist_tracks",
    primaryKeys = ["playlistId", "trackId"],
    indices = [Index(value = ["trackId"])],
)
data class PlaylistTrackCrossRef(
    val playlistId: String,
    val trackId: String,
    val position: Int = 0,
)

data class PlaylistSummary(
    val id: String,
    val name: String,
    val description: String,
    val isShared: Boolean,
    val ownerUsername: String,
    val updatedAt: Long,
    val deleted: Boolean,
    val trackCount: Int,
    val downloadedCount: Int,
)

data class PlaylistWithTracks(
    @Embedded val playlist: PlaylistEntity,
    @Relation(
        parentColumn = "id",
        entityColumn = "id",
        associateBy = Junction(
            value = PlaylistTrackCrossRef::class,
            parentColumn = "playlistId",
            entityColumn = "trackId",
        ),
    )
    val tracks: List<TrackEntity>,
)
