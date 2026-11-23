package dev.trebuh.tmusicplayer.data.sync

import android.content.Context
import android.net.Uri
import dev.trebuh.tmusicplayer.data.api.AuthResponseDto
import dev.trebuh.tmusicplayer.data.api.AutoPlaylistConfigDto
import dev.trebuh.tmusicplayer.data.api.ServerHealthResponse
import dev.trebuh.tmusicplayer.data.api.SyncFavoriteDto
import dev.trebuh.tmusicplayer.data.api.SyncPlaylistDto
import dev.trebuh.tmusicplayer.data.api.SyncPushRequestDto
import dev.trebuh.tmusicplayer.data.api.SyncTrackEditDto
import dev.trebuh.tmusicplayer.data.api.SyncTrackStatsDto
import dev.trebuh.tmusicplayer.data.api.TMusicApiClient
import dev.trebuh.tmusicplayer.data.db.MusicDao
import dev.trebuh.tmusicplayer.data.db.PlaylistEntity
import dev.trebuh.tmusicplayer.data.db.PlaylistSummary
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.data.prefs.AppPreferences
import dev.trebuh.tmusicplayer.data.prefs.UserSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

data class SyncReport(
    val serverTime: Long,
    val totalTracks: Int,
    val totalPlaylists: Int,
    val pushedPlaylists: Int,
    val pushedFavorites: Int,
)

class SyncRepository(
    context: Context,
    private val dao: MusicDao,
    val api: TMusicApiClient,
    val prefs: AppPreferences,
) {
    private val appContext = context.applicationContext
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val syncMutex = Mutex()
    private val activeDownloadsMutex = Mutex()
    private val activeDownloads = mutableSetOf<String>()
    private var autoSyncJob: Job? = null

    private val audioDir = File(appContext.filesDir, "offline_audio")
    private val coversDir = File(appContext.filesDir, "offline_covers")

    val settings: StateFlow<UserSettings> = prefs.settings
    val tracks: Flow<List<TrackEntity>> = dao.observeAllTracks()
    val playlists: Flow<List<PlaylistSummary>> = dao.observePlaylistSummaries()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _uploadProgress = MutableStateFlow<String?>(null)
    val uploadProgress: StateFlow<String?> = _uploadProgress.asStateFlow()

    private val _downloadProgress = MutableStateFlow<Map<String, Float>>(emptyMap())
    val downloadProgress: StateFlow<Map<String, Float>> = _downloadProgress.asStateFlow()

    private val _syncMessage = MutableStateFlow<String?>(null)
    val syncMessage: StateFlow<String?> = _syncMessage.asStateFlow()

    fun observeTracksForPlaylist(playlistId: String): Flow<List<TrackEntity>> =
        dao.observeTracksForPlaylist(playlistId)

    fun clearSyncMessage() {
        _syncMessage.value = null
    }

    fun scheduleAutoSync(delayMs: Long = 2500L) {
        if (!prefs.settings.value.isLoggedIn) return
        autoSyncJob?.cancel()
        autoSyncJob = ioScope.launch {
            delay(delayMs)
            syncNow(silent = true)
        }
    }

    suspend fun checkHealth(rawServerUrl: String): Result<ServerHealthResponse> {
        val normalized = AppPreferences.normalizeServerUrl(rawServerUrl)
        if (normalized.isBlank()) {
            return Result.failure(IllegalArgumentException("Enter a valid server URL."))
        }
        return api.checkHealth(normalized)
    }

    suspend fun login(
        rawServerUrl: String,
        username: String,
        password: String,
    ): Result<AuthResponseDto> {
        val normalized = AppPreferences.normalizeServerUrl(rawServerUrl)
        if (normalized.isBlank()) {
            return Result.failure(IllegalArgumentException("Server URL is required."))
        }
        val result = api.login(normalized, username, password)
        result.onSuccess { auth ->
            prefs.saveSession(
                serverUrl = normalized,
                token = auth.token,
                userId = auth.user.id,
                username = auth.user.username,
                role = auth.user.role,
            )
            syncNow()
        }
        return result
    }

    suspend fun register(
        rawServerUrl: String,
        username: String,
        password: String,
        inviteCode: String?,
    ): Result<AuthResponseDto> {
        val normalized = AppPreferences.normalizeServerUrl(rawServerUrl)
        if (normalized.isBlank()) {
            return Result.failure(IllegalArgumentException("Server URL is required."))
        }
        val result = api.register(normalized, username, password, inviteCode)
        result.onSuccess { auth ->
            prefs.saveSession(
                serverUrl = normalized,
                token = auth.token,
                userId = auth.user.id,
                username = auth.user.username,
                role = auth.user.role,
            )
            syncNow()
        }
        return result
    }

    suspend fun signOut() {
        prefs.clearSession()
        withContext(Dispatchers.IO) {
            dao.resetLibraryForSignOut()
            audioDir.deleteRecursively()
            coversDir.deleteRecursively()
        }
        _downloadProgress.value = emptyMap()
        _syncMessage.value = null
    }

    suspend fun syncNow(silent: Boolean = false): Result<SyncReport> = syncMutex.withLock {
        val current = prefs.settings.value
        if (!current.isLoggedIn) {
            return Result.failure(IllegalStateException("Not connected to a server."))
        }

        _isSyncing.value = true
        return try {
            val localTracks = dao.getAllTracks()
            val localTracksById = localTracks.associateBy { it.id }
            val localPlaylists = dao.getAllPlaylistsIncludingDeleted()
            val localPlaylistsById = localPlaylists.associateBy { it.id }

            // Push only playlists owned by this user (shared playlists from other users are read-only locally).
            val ownedPlaylistsToPush = localPlaylists
                .filter { it.ownerUsername.isBlank() || it.ownerUsername == current.username }
                .map { pl ->
                    val refs = dao.getPlaylistTrackRefs(pl.id)
                    SyncPlaylistDto(
                        id = pl.id,
                        name = pl.name,
                        description = pl.description,
                        trackIds = refs.map { it.trackId },
                        isShared = pl.isShared,
                        ownerUsername = pl.ownerUsername.ifBlank { current.username },
                        updatedAt = pl.updatedAt,
                        deleted = pl.deleted,
                    )
                }

            val favoritesToPush = localTracks
                .filter { it.favoriteUpdatedAt > 0L }
                .map { tr ->
                    SyncFavoriteDto(
                        trackId = tr.id,
                        isFavorite = tr.isFavorite,
                        updatedAt = tr.favoriteUpdatedAt,
                    )
                }

            val editsToPush = localTracks
                .filter { it.editUpdatedAt > 0L }
                .map { tr ->
                    SyncTrackEditDto(
                        trackId = tr.id,
                        speed = tr.editSpeed,
                        gainDb = tr.editGainDb,
                        trimStartMs = tr.trimStartMs,
                        trimEndMs = tr.trimEndMs,
                        updatedAt = tr.editUpdatedAt,
                    )
                }

            val statsToPush = localTracks
                .filter {
                    it.playCount > 0L ||
                        it.manualPlayCount > 0L ||
                        it.skipCount > 0L ||
                        it.autoExcluded ||
                        it.statsUpdatedAt > 0L
                }
                .map { tr ->
                    SyncTrackStatsDto(
                        trackId = tr.id,
                        playCount = tr.playCount,
                        manualPlayCount = tr.manualPlayCount,
                        skipCount = tr.skipCount,
                        autoExcluded = tr.autoExcluded,
                        lastPlayedAt = tr.lastPlayedAt,
                        updatedAt = tr.statsUpdatedAt,
                    )
                }

            val autoCfgToPush = current.toAutoPlaylistConfigDto().takeIf { it.updatedAt > 0L }

            var pushedPlaylists = 0
            var pushedFavorites = 0
            if (ownedPlaylistsToPush.isNotEmpty() ||
                favoritesToPush.isNotEmpty() ||
                editsToPush.isNotEmpty() ||
                statsToPush.isNotEmpty() ||
                autoCfgToPush != null
            ) {
                val pushRes = api.pushSync(
                    current.serverUrl,
                    current.authToken,
                    SyncPushRequestDto(
                        playlists = ownedPlaylistsToPush,
                        favorites = favoritesToPush,
                        trackEdits = editsToPush,
                        trackStats = statsToPush,
                        autoPlaylistConfig = autoCfgToPush,
                    ),
                ).getOrElse { err ->
                    if (!silent) {
                        _syncMessage.value = "Sync failed: ${err.message}"
                    }
                    return Result.failure(err)
                }
                pushedPlaylists = pushRes.appliedPlaylists
                pushedFavorites = pushRes.appliedFavorites
            }

            val pull = api.pullSync(current.serverUrl, current.authToken).getOrElse { err ->
                if (!silent) {
                    _syncMessage.value = "Sync failed: ${err.message}"
                }
                return Result.failure(err)
            }

            val remoteFavByTrackId = pull.favorites.associateBy { it.trackId }
            val remoteEditByTrackId = pull.trackEdits.associateBy { it.trackId }
            val remoteStatsByTrackId = pull.trackStats.associateBy { it.trackId }
            val pulledTrackIds = pull.tracks.map { it.id }.toSet()

            // Remove offline audio for tracks that no longer exist on the server.
            for (local in localTracks) {
                if (local.id !in pulledTrackIds && !local.localAudioPath.isNullOrBlank()) {
                    runCatching { File(local.localAudioPath).delete() }
                }
            }

            val mergedTracks = pull.tracks.map { dto ->
                val existing = localTracksById[dto.id]
                val validLocalAudio = existing?.localAudioPath?.takeIf { File(it).exists() }
                val coverCandidate = dto.coverHash?.let { hash ->
                    val file = File(coversDir, "$hash.img")
                    when {
                        existing?.localCoverPath != null && File(existing.localCoverPath).exists() -> existing.localCoverPath
                        file.exists() -> file.absolutePath
                        else -> null
                    }
                }
                val remoteFav = remoteFavByTrackId[dto.id]
                val (resolvedFav, resolvedFavTs) = when {
                    existing != null && remoteFav != null -> {
                        if (existing.favoriteUpdatedAt > remoteFav.updatedAt) {
                            existing.isFavorite to existing.favoriteUpdatedAt
                        } else {
                            remoteFav.isFavorite to remoteFav.updatedAt
                        }
                    }
                    remoteFav != null -> remoteFav.isFavorite to remoteFav.updatedAt
                    existing != null -> existing.isFavorite to existing.favoriteUpdatedAt
                    else -> false to 0L
                }

                val remoteEdit = remoteEditByTrackId[dto.id]
                val useLocalEdit = existing != null && (remoteEdit == null || existing.editUpdatedAt > remoteEdit.updatedAt)
                val resolvedSpeed = when {
                    useLocalEdit -> existing!!.editSpeed
                    remoteEdit != null -> remoteEdit.speed.coerceIn(0.5f, 2.0f)
                    else -> 1.0f
                }
                val resolvedGainDb = when {
                    useLocalEdit -> existing!!.editGainDb
                    remoteEdit != null -> remoteEdit.gainDb.coerceIn(-18f, 12f)
                    else -> 0.0f
                }
                val resolvedTrimStart = when {
                    useLocalEdit -> existing!!.trimStartMs
                    remoteEdit != null -> remoteEdit.trimStartMs.coerceAtLeast(0L)
                    else -> 0L
                }
                val resolvedTrimEnd = when {
                    useLocalEdit -> existing!!.trimEndMs
                    remoteEdit != null -> remoteEdit.trimEndMs
                    else -> null
                }
                val resolvedEditTs = when {
                    useLocalEdit -> existing!!.editUpdatedAt
                    remoteEdit != null -> remoteEdit.updatedAt
                    else -> 0L
                }

                val remoteStats = remoteStatsByTrackId[dto.id]
                val resolvedPlayCount = maxOf(existing?.playCount ?: 0L, remoteStats?.playCount ?: 0L)
                val resolvedManualCount = maxOf(existing?.manualPlayCount ?: 0L, remoteStats?.manualPlayCount ?: 0L)
                val resolvedSkipCount = maxOf(existing?.skipCount ?: 0L, remoteStats?.skipCount ?: 0L)
                val resolvedLastPlayed = maxOf(existing?.lastPlayedAt ?: 0L, remoteStats?.lastPlayedAt ?: 0L)
                val localStatsTs = existing?.statsUpdatedAt ?: 0L
                val remoteStatsTs = remoteStats?.updatedAt ?: 0L
                val resolvedAutoExcluded = when {
                    remoteStats != null && remoteStatsTs >= localStatsTs -> remoteStats.autoExcluded
                    else -> existing?.autoExcluded ?: false
                }
                val resolvedStatsTs = maxOf(localStatsTs, remoteStatsTs)

                TrackEntity(
                    id = dto.id,
                    contentHash = dto.contentHash,
                    title = dto.title,
                    artist = dto.artist,
                    album = dto.album,
                    albumArtist = dto.albumArtist,
                    trackNumber = dto.trackNumber,
                    discNumber = dto.discNumber,
                    year = dto.year,
                    genre = dto.genre,
                    durationMs = dto.durationMs,
                    format = dto.format,
                    bitrateKbps = dto.bitrateKbps,
                    fileSize = dto.fileSize,
                    coverHash = dto.coverHash,
                    uploadedBy = dto.uploadedBy,
                    createdAt = dto.createdAt,
                    isFavorite = resolvedFav,
                    favoriteUpdatedAt = resolvedFavTs,
                    editSpeed = resolvedSpeed,
                    editGainDb = resolvedGainDb,
                    trimStartMs = resolvedTrimStart,
                    trimEndMs = resolvedTrimEnd,
                    editUpdatedAt = resolvedEditTs,
                    playCount = resolvedPlayCount,
                    manualPlayCount = resolvedManualCount,
                    skipCount = resolvedSkipCount,
                    autoExcluded = resolvedAutoExcluded,
                    lastPlayedAt = resolvedLastPlayed,
                    statsUpdatedAt = resolvedStatsTs,
                    localAudioPath = validLocalAudio,
                    localCoverPath = coverCandidate,
                )
            }

            if (mergedTracks.isEmpty()) {
                dao.deleteAllTracks()
            } else {
                dao.upsertTracks(mergedTracks)
                dao.deleteTracksNotIn(pulledTrackIds.toList())
            }

            val remotePlaylistIds = pull.playlists.map { it.id }.toSet()
            for (remotePl in pull.playlists) {
                val localPl = localPlaylistsById[remotePl.id]
                if (localPl != null && localPl.updatedAt > remotePl.updatedAt) {
                    continue
                }
                dao.upsertPlaylist(
                    PlaylistEntity(
                        id = remotePl.id,
                        name = remotePl.name,
                        description = remotePl.description,
                        isShared = remotePl.isShared,
                        ownerUsername = remotePl.ownerUsername,
                        updatedAt = remotePl.updatedAt,
                        deleted = remotePl.deleted,
                    )
                )
                if (remotePl.deleted) {
                    dao.clearPlaylistTrackRefs(remotePl.id)
                } else {
                    dao.replacePlaylistTracks(
                        remotePl.id,
                        remotePl.trackIds.filter { it in pulledTrackIds },
                    )
                }
            }

            // Re-clean refs pointing to tracks no longer present for local-only unsynced playlists.
            for (localPl in localPlaylists) {
                if (localPl.id !in remotePlaylistIds && !localPl.deleted) {
                    val existingRefs = dao.getPlaylistTrackRefs(localPl.id)
                    val filtered = existingRefs.map { it.trackId }.filter { it in pulledTrackIds }
                    if (filtered.size != existingRefs.size) {
                        dao.replacePlaylistTracks(localPl.id, filtered)
                    }
                }
            }

            pull.autoPlaylistConfig?.let { remoteCfg ->
                val localTs = prefs.settings.value.autoConfigUpdatedAt
                if (remoteCfg.updatedAt >= localTs) {
                    prefs.setAutoPlaylistConfig(remoteCfg)
                }
            }

            val syncTime = pull.serverTime.takeIf { it > 0L } ?: nowEpochSeconds()
            prefs.setLastSyncAt(syncTime)

            // Warm local cover cache in the background for offline artwork.
            prefetchCovers(current.serverUrl, mergedTracks)

            val activePlaylistCount = pull.playlists.count { !it.deleted }
            val report = SyncReport(
                serverTime = syncTime,
                totalTracks = mergedTracks.size,
                totalPlaylists = activePlaylistCount,
                pushedPlaylists = pushedPlaylists,
                pushedFavorites = pushedFavorites,
            )
            if (!silent) {
                _syncMessage.value =
                    "Synced ${report.totalTracks} tracks, ${report.totalPlaylists} playlists"
            }
            Result.success(report)
        } catch (t: Throwable) {
            if (!silent) {
                _syncMessage.value = "Sync failed: ${t.message ?: "unknown error"}"
            }
            Result.failure(t)
        } finally {
            _isSyncing.value = false
        }
    }

    suspend fun uploadAudioUris(uris: List<Uri>): Result<Int> {
        val current = prefs.settings.value
        if (!current.isLoggedIn) {
            _syncMessage.value = "Sign in to your home server before uploading."
            return Result.failure(IllegalStateException("Not logged in"))
        }
        if (uris.isEmpty()) return Result.success(0)

        var uploadedCount = 0
        try {
            for ((idx, uri) in uris.withIndex()) {
                _uploadProgress.value = "Preparing file ${idx + 1}/${uris.size}…"
                val res = api.uploadAudioFromUri(
                    context = appContext,
                    baseUrl = current.serverUrl,
                    token = current.authToken,
                    uri = uri,
                ) { status ->
                    _uploadProgress.value = if (uris.size > 1) "[${idx + 1}/${uris.size}] $status" else status
                }
                if (res.isSuccess) {
                    uploadedCount++
                } else {
                    val errMsg = res.exceptionOrNull()?.message ?: "Upload failed"
                    _syncMessage.value = "Upload error: $errMsg"
                    return Result.failure(res.exceptionOrNull() ?: IllegalStateException(errMsg))
                }
            }
            _uploadProgress.value = "Syncing library…"
            syncNow(silent = false)
            _syncMessage.value = "Uploaded $uploadedCount track(s) and synced."
            return Result.success(uploadedCount)
        } finally {
            _uploadProgress.value = null
        }
    }

    private fun prefetchCovers(serverUrl: String, tracks: List<TrackEntity>) {
        val hashes = tracks.mapNotNull { it.coverHash }.distinct()
        if (hashes.isEmpty()) return
        ioScope.launch {
            for (hash in hashes) {
                val dest = File(coversDir, "$hash.img")
                if (dest.exists()) {
                    dao.updateLocalCoverPathForHash(hash, dest.absolutePath)
                    continue
                }
                val url = api.buildCoverUrl(serverUrl, hash)
                api.downloadToFile(url, dest).onSuccess {
                    dao.updateLocalCoverPathForHash(hash, dest.absolutePath)
                }
            }
        }
    }

    suspend fun toggleFavorite(trackId: String) {
        val track = dao.getTrackById(trackId) ?: return
        val nextFavorite = !track.isFavorite
        val nextTimestamp = maxOf(nowEpochSeconds(), track.favoriteUpdatedAt + 1L)
        dao.updateFavorite(trackId, nextFavorite, nextTimestamp)
        scheduleAutoSync()
    }

    suspend fun recordPlay(trackId: String, isManual: Boolean) {
        prefs.recordRecentPlayId(trackId)
        dao.recordTrackPlay(trackId, if (isManual) 1L else 0L, nowEpochSeconds())
        scheduleAutoSync(delayMs = 4000L)
    }

    suspend fun recordSkip(trackId: String) {
        dao.recordTrackSkip(trackId, nowEpochSeconds())
        scheduleAutoSync(delayMs = 4000L)
    }

    suspend fun setTrackAutoExcluded(trackId: String, excluded: Boolean) {
        dao.updateTrackAutoExcluded(trackId, excluded, nowEpochSeconds())
        scheduleAutoSync()
    }

    fun saveAutoPlaylistConfig(config: AutoPlaylistConfigDto) {
        val prevTs = prefs.settings.value.autoConfigUpdatedAt
        val clean = config.copy(
            maxDurationMs = config.maxDurationMs?.takeIf { it > 0L },
            favoriteBoostFactor = config.favoriteBoostFactor.coerceIn(1.5f, 10.0f),
            cooldownTracks = config.cooldownTracks.coerceIn(10, 50),
            updatedAt = maxOf(nowEpochSeconds(), prevTs + 1L),
        )
        prefs.setAutoPlaylistConfig(clean)
        scheduleAutoSync()
    }

    suspend fun createPlaylist(
        name: String,
        description: String,
        isShared: Boolean,
        initialTrackIds: List<String> = emptyList(),
    ): PlaylistEntity {
        val cleanName = name.trim().ifBlank { "New Playlist" }
        val username = prefs.settings.value.username
        val playlist = PlaylistEntity(
            id = UUID.randomUUID().toString(),
            name = cleanName,
            description = description.trim(),
            isShared = isShared,
            ownerUsername = username,
            updatedAt = nowEpochSeconds(),
            deleted = false,
        )
        dao.upsertPlaylist(playlist)
        if (initialTrackIds.isNotEmpty()) {
            dao.replacePlaylistTracks(playlist.id, initialTrackIds)
        }
        scheduleAutoSync()
        return playlist
    }

    suspend fun renamePlaylist(playlistId: String, name: String, description: String) {
        val existing = dao.getPlaylistById(playlistId) ?: return
        val nextTs = maxOf(nowEpochSeconds(), existing.updatedAt + 1L)
        dao.upsertPlaylist(
            existing.copy(
                name = name.trim().ifBlank { existing.name },
                description = description.trim(),
                updatedAt = nextTs,
            )
        )
        scheduleAutoSync()
    }

    suspend fun deletePlaylist(playlistId: String) {
        val existing = dao.getPlaylistById(playlistId) ?: return
        val nextTs = maxOf(nowEpochSeconds(), existing.updatedAt + 1L)
        dao.upsertPlaylist(
            existing.copy(
                deleted = true,
                updatedAt = nextTs,
            )
        )
        dao.clearPlaylistTrackRefs(playlistId)
        scheduleAutoSync()
    }

    suspend fun addTrackToPlaylist(playlistId: String, trackId: String) {
        val existing = dao.getPlaylistById(playlistId) ?: return
        val refs = dao.getPlaylistTrackRefs(playlistId).map { it.trackId }
        if (trackId in refs) return
        dao.replacePlaylistTracks(playlistId, refs + trackId)
        val nextTs = maxOf(nowEpochSeconds(), existing.updatedAt + 1L)
        dao.upsertPlaylist(existing.copy(updatedAt = nextTs))
        scheduleAutoSync()
    }

    suspend fun removeTrackFromPlaylist(playlistId: String, trackId: String) {
        val existing = dao.getPlaylistById(playlistId) ?: return
        val refs = dao.getPlaylistTrackRefs(playlistId).map { it.trackId }.filter { it != trackId }
        dao.replacePlaylistTracks(playlistId, refs)
        val nextTs = maxOf(nowEpochSeconds(), existing.updatedAt + 1L)
        dao.upsertPlaylist(existing.copy(updatedAt = nextTs))
        scheduleAutoSync()
    }

    suspend fun reorderPlaylistTracks(playlistId: String, orderedTrackIds: List<String>) {
        val existing = dao.getPlaylistById(playlistId) ?: return
        dao.replacePlaylistTracks(playlistId, orderedTrackIds)
        val nextTs = maxOf(nowEpochSeconds(), existing.updatedAt + 1L)
        dao.upsertPlaylist(existing.copy(updatedAt = nextTs))
        scheduleAutoSync()
    }

    suspend fun downloadTrackOffline(trackId: String): Result<Unit> {
        val current = prefs.settings.value
        if (!current.isLoggedIn) {
            return Result.failure(IllegalStateException("Connect to your server to download tracks."))
        }
        val track = dao.getTrackById(trackId)
            ?: return Result.failure(IllegalArgumentException("Track not found."))

        val existingPath = track.localAudioPath
        if (!existingPath.isNullOrBlank() && File(existingPath).exists()) {
            return Result.success(Unit)
        }

        val acquired = activeDownloadsMutex.withLock {
            if (trackId in activeDownloads) {
                false
            } else {
                activeDownloads.add(trackId)
                true
            }
        }
        if (!acquired) {
            return Result.success(Unit)
        }

        _downloadProgress.update { it + (trackId to 0f) }
        return try {
            val quality = current.audioQuality
            val ext = if (quality == "saver") "ogg" else track.format.ifBlank { "audio" }
            val destFile = File(audioDir, "${track.id}.$ext")
            val url = api.buildStreamUrl(
                baseUrl = current.serverUrl,
                token = current.authToken,
                trackId = track.id,
                quality = quality,
                download = true,
            )
            api.downloadToFile(
                url = url,
                destFile = destFile,
                authToken = current.authToken,
            ) { downloaded, total ->
                val ratio = if (total > 0L) (downloaded.toFloat() / total.toFloat()).coerceIn(0f, 1f) else 0.5f
                _downloadProgress.update { it + (trackId to ratio) }
            }.getOrElse { err ->
                return Result.failure(err)
            }

            dao.updateLocalAudioPath(track.id, destFile.absolutePath)

            // Ensure cover art is cached alongside offline track.
            track.coverHash?.let { hash ->
                val coverFile = File(coversDir, "$hash.img")
                if (!coverFile.exists()) {
                    api.downloadToFile(api.buildCoverUrl(current.serverUrl, hash), coverFile)
                        .onSuccess {
                            dao.updateLocalCoverPathForHash(hash, coverFile.absolutePath)
                        }
                }
            }
            Result.success(Unit)
        } finally {
            activeDownloadsMutex.withLock {
                activeDownloads.remove(trackId)
            }
            _downloadProgress.update { it - trackId }
        }
    }

    suspend fun downloadPlaylistOffline(playlistId: String): Result<Int> {
        val tracks = dao.getTracksForPlaylist(playlistId)
        var downloadedCount = 0
        for (track in tracks) {
            val existing = track.localAudioPath
            if (!existing.isNullOrBlank() && File(existing).exists()) {
                continue
            }
            val res = downloadTrackOffline(track.id)
            if (res.isSuccess) {
                downloadedCount++
            } else {
                return Result.failure(res.exceptionOrNull() ?: IllegalStateException("Download failed"))
            }
        }
        return Result.success(downloadedCount)
    }

    suspend fun removeOfflineTrack(trackId: String) {
        val track = dao.getTrackById(trackId) ?: return
        track.localAudioPath?.let { path ->
            withContext(Dispatchers.IO) {
                runCatching { File(path).delete() }
            }
        }
        dao.updateLocalAudioPath(trackId, null)
    }

    suspend fun clearAllOfflineDownloads() {
        withContext(Dispatchers.IO) {
            audioDir.deleteRecursively()
            dao.clearAllLocalPaths()
        }
    }

    suspend fun getOfflineStorageBytes(): Long = withContext(Dispatchers.IO) {
        val audioBytes = audioDir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        val coverBytes = coversDir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        audioBytes + coverBytes
    }

    fun resolveArtworkModel(track: TrackEntity): Any? {
        val localCover = track.localCoverPath?.takeIf { File(it).exists() }
        if (localCover != null) return File(localCover)
        val hash = track.coverHash ?: return null
        val serverUrl = prefs.settings.value.serverUrl
        if (serverUrl.isBlank()) return null
        return api.buildCoverUrl(serverUrl, hash)
    }

    companion object {
        fun nowEpochSeconds(): Long = System.currentTimeMillis() / 1000L
    }
}
