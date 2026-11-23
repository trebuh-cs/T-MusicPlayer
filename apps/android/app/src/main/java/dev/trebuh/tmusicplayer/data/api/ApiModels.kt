package dev.trebuh.tmusicplayer.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ServerHealthResponse(
    val status: String,
    val version: String,
    @SerialName("registration_open") val registrationOpen: Boolean = true,
    @SerialName("invite_required") val inviteRequired: Boolean = false,
)

@Serializable
data class AuthLoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class AuthRegisterRequest(
    val username: String,
    val password: String,
    @SerialName("invite_code") val inviteCode: String? = null,
)

@Serializable
data class UserProfileDto(
    val id: String,
    val username: String,
    val role: String,
    @SerialName("created_at") val createdAt: Long = 0L,
)

@Serializable
data class AuthResponseDto(
    val token: String,
    val user: UserProfileDto,
)

@Serializable
data class ServerTrackDto(
    val id: String,
    @SerialName("content_hash") val contentHash: String,
    val title: String,
    val artist: String,
    val album: String,
    @SerialName("album_artist") val albumArtist: String? = null,
    @SerialName("track_number") val trackNumber: Int? = null,
    @SerialName("disc_number") val discNumber: Int? = null,
    val year: Int? = null,
    val genre: String? = null,
    @SerialName("duration_ms") val durationMs: Long = 0L,
    val format: String = "",
    @SerialName("bitrate_kbps") val bitrateKbps: Int? = null,
    @SerialName("file_size") val fileSize: Long = 0L,
    @SerialName("cover_hash") val coverHash: String? = null,
    @SerialName("uploaded_by") val uploadedBy: String = "",
    @SerialName("created_at") val createdAt: Long = 0L,
)

@Serializable
data class SyncPlaylistDto(
    val id: String,
    val name: String,
    val description: String = "",
    @SerialName("track_ids") val trackIds: List<String> = emptyList(),
    @SerialName("is_shared") val isShared: Boolean = false,
    @SerialName("owner_username") val ownerUsername: String = "",
    @SerialName("updated_at") val updatedAt: Long = 0L,
    val deleted: Boolean = false,
)

@Serializable
data class SyncFavoriteDto(
    @SerialName("track_id") val trackId: String,
    @SerialName("is_favorite") val isFavorite: Boolean,
    @SerialName("updated_at") val updatedAt: Long = 0L,
)

@Serializable
data class SyncTrackEditDto(
    @SerialName("track_id") val trackId: String,
    val speed: Float = 1.0f,
    @SerialName("gain_db") val gainDb: Float = 0.0f,
    @SerialName("trim_start_ms") val trimStartMs: Long = 0L,
    @SerialName("trim_end_ms") val trimEndMs: Long? = null,
    @SerialName("updated_at") val updatedAt: Long = 0L,
)

@Serializable
data class SyncTrackStatsDto(
    @SerialName("track_id") val trackId: String,
    @SerialName("play_count") val playCount: Long = 0L,
    @SerialName("manual_play_count") val manualPlayCount: Long = 0L,
    @SerialName("skip_count") val skipCount: Long = 0L,
    @SerialName("auto_excluded") val autoExcluded: Boolean = false,
    @SerialName("last_played_at") val lastPlayedAt: Long = 0L,
    @SerialName("updated_at") val updatedAt: Long = 0L,
)

@Serializable
data class AutoPlaylistConfigDto(
    @SerialName("max_duration_ms") val maxDurationMs: Long? = null,
    @SerialName("favorite_boost_enabled") val favoriteBoostEnabled: Boolean = true,
    @SerialName("favorite_boost_factor") val favoriteBoostFactor: Float = 3.0f,
    @SerialName("cooldown_enabled") val cooldownEnabled: Boolean = true,
    @SerialName("cooldown_tracks") val cooldownTracks: Int = 10,
    @SerialName("updated_at") val updatedAt: Long = 0L,
)

@Serializable
data class UploadInitRequestDto(
    @SerialName("content_hash") val contentHash: String,
    val filename: String,
    @SerialName("total_size") val totalSize: Long,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
)

@Serializable
data class UploadInitResponseDto(
    val status: String,
    @SerialName("upload_id") val uploadId: String? = null,
    @SerialName("chunk_size") val chunkSize: Int = 8 * 1024 * 1024,
    val track: ServerTrackDto? = null,
)

@Serializable
data class SyncPullResponseDto(
    @SerialName("server_time") val serverTime: Long = 0L,
    val tracks: List<ServerTrackDto> = emptyList(),
    val playlists: List<SyncPlaylistDto> = emptyList(),
    val favorites: List<SyncFavoriteDto> = emptyList(),
    @SerialName("track_edits") val trackEdits: List<SyncTrackEditDto> = emptyList(),
    @SerialName("track_stats") val trackStats: List<SyncTrackStatsDto> = emptyList(),
    @SerialName("auto_playlist_config") val autoPlaylistConfig: AutoPlaylistConfigDto? = null,
)

@Serializable
data class SyncPushRequestDto(
    val playlists: List<SyncPlaylistDto>,
    val favorites: List<SyncFavoriteDto>,
    @SerialName("track_edits") val trackEdits: List<SyncTrackEditDto> = emptyList(),
    @SerialName("track_stats") val trackStats: List<SyncTrackStatsDto> = emptyList(),
    @SerialName("auto_playlist_config") val autoPlaylistConfig: AutoPlaylistConfigDto? = null,
)

@Serializable
data class SyncPushResponseDto(
    @SerialName("server_time") val serverTime: Long = 0L,
    @SerialName("applied_playlists") val appliedPlaylists: Int = 0,
    @SerialName("applied_favorites") val appliedFavorites: Int = 0,
    @SerialName("applied_track_edits") val appliedTrackEdits: Int = 0,
    @SerialName("applied_track_stats") val appliedTrackStats: Int = 0,
)

@Serializable
data class ApiErrorDto(
    val error: String = "",
)
