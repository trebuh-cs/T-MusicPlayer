package dev.trebuh.tmusicplayer.player

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.data.sync.SyncRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

data class PlayerUiState(
    val queue: List<TrackEntity> = emptyList(),
    val currentIndex: Int = -1,
    val currentTrack: TrackEntity? = null,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val shuffleEnabled: Boolean = false,
    val repeatMode: Int = Player.REPEAT_MODE_OFF,
    val playbackRate: Float = 1.0f,
    val isBuffering: Boolean = false,
)

class PlayerController(
    context: Context,
    private val repository: SyncRepository,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var controller: MediaController? = null
    private var positionTickerJob: Job? = null

    private val _state = MutableStateFlow(
        PlayerUiState(playbackRate = repository.settings.value.playbackRate)
    )
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    private var currentQueue: List<TrackEntity> = emptyList()

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            syncStateFromPlayer()
            updatePositionTicker(isPlaying)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            syncStateFromPlayer()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val activeTrack = resolveActiveTrack()
            applyPerTrackOverrides(controller, activeTrack)
            syncStateFromPlayer()
        }

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
            syncStateFromPlayer()
        }

        override fun onRepeatModeChanged(repeatMode: Int) {
            syncStateFromPlayer()
        }

        override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
            _state.update { it.copy(playbackRate = repository.settings.value.playbackRate) }
        }
    }

    init {
        scope.launch {
            ensureController()
        }
    }

    private suspend fun ensureController(): MediaController? {
        controller?.let { return it }
        return runCatching {
            val token = SessionToken(
                appContext,
                ComponentName(appContext, TMusicPlaybackService::class.java),
            )
            val built = MediaController.Builder(appContext, token).buildAsync().await()
            built.addListener(listener)
            val savedRate = repository.settings.value.playbackRate
            built.setPlaybackParameters(PlaybackParameters(savedRate, 1.0f))
            controller = built
            syncStateFromPlayer()
            built
        }.getOrNull()
    }

    private fun resolveActiveTrack(): TrackEntity? {
        val ctrl = controller
        val idx = ctrl?.currentMediaItemIndex ?: -1
        val mediaId = ctrl?.currentMediaItem?.mediaId
        return currentQueue.firstOrNull { it.id == mediaId } ?: currentQueue.getOrNull(idx)
    }

    private fun applyPerTrackOverrides(ctrl: MediaController?, track: TrackEntity?) {
        if (ctrl == null) return
        val globalRate = repository.settings.value.playbackRate
        val trackSpeed = track?.editSpeed?.takeIf { it > 0f } ?: 1.0f
        val effectiveRate = (globalRate * trackSpeed).coerceIn(0.5f, 2.0f)
        ctrl.setPlaybackParameters(PlaybackParameters(effectiveRate, 1.0f))

        val gainDb = (track?.editGainDb ?: 0f).coerceIn(-18f, 12f)
        val args = Bundle().apply {
            putFloat(TMusicPlaybackService.EXTRA_GAIN_DB, gainDb)
        }
        runCatching {
            ctrl.sendCustomCommand(
                SessionCommand(TMusicPlaybackService.ACTION_SET_TRACK_GAIN, Bundle.EMPTY),
                args,
            )
        }
    }

    fun playQueue(tracks: List<TrackEntity>, startIndex: Int = 0) {
        if (tracks.isEmpty()) return
        val safeIndex = startIndex.coerceIn(0, tracks.lastIndex)
        scope.launch {
            val ctrl = ensureController() ?: return@launch
            val settings = repository.settings.value
            val playableItems = tracks.mapNotNull { track ->
                val uri = resolvePlayableUri(track, settings.serverUrl, settings.authToken, settings.audioQuality)
                    ?: return@mapNotNull null
                val artworkUri = resolveArtworkUri(track, settings.serverUrl)
                val metadata = MediaMetadata.Builder()
                    .setTitle(track.title)
                    .setArtist(track.artist)
                    .setAlbumTitle(track.album)
                    .apply {
                        if (artworkUri != null) setArtworkUri(artworkUri)
                    }
                    .build()
                val builder = MediaItem.Builder()
                    .setMediaId(track.id)
                    .setUri(uri)
                    .setMediaMetadata(metadata)

                // Non-destructive front/end trim applied directly in Media3 ExoPlayer pipeline.
                val startMs = track.trimStartMs.coerceAtLeast(0L)
                val endMs = track.trimEndMs
                if (startMs > 0L || (endMs != null && endMs > startMs)) {
                    val clip = MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(startMs)
                    if (endMs != null && endMs > startMs) {
                        clip.setEndPositionMs(endMs)
                    }
                    builder.setClippingConfiguration(clip.build())
                }

                builder.build() to track
            }

            if (playableItems.isEmpty()) return@launch
            currentQueue = playableItems.map { it.second }
            val startTrackId = tracks[safeIndex].id
            val resolvedIndex = currentQueue.indexOfFirst { it.id == startTrackId }.coerceAtLeast(0)

            ctrl.setMediaItems(playableItems.map { it.first }, resolvedIndex, 0L)
            applyPerTrackOverrides(ctrl, currentQueue.getOrNull(resolvedIndex))
            ctrl.prepare()
            ctrl.play()
            syncStateFromPlayer()
        }
    }

    fun togglePlayPause() {
        val ctrl = controller ?: return
        if (ctrl.isPlaying) {
            ctrl.pause()
        } else {
            ctrl.play()
        }
    }

    fun next() {
        controller?.seekToNextMediaItem()
    }

    fun previous() {
        val ctrl = controller ?: return
        if (ctrl.currentPosition > 3000L) {
            ctrl.seekTo(0L)
        } else {
            ctrl.seekToPreviousMediaItem()
        }
    }

    fun seekTo(positionMs: Long) {
        controller?.seekTo(positionMs.coerceAtLeast(0L))
        _state.update { it.copy(positionMs = positionMs.coerceAtLeast(0L)) }
    }

    fun toggleShuffle() {
        val ctrl = controller ?: return
        ctrl.shuffleModeEnabled = !ctrl.shuffleModeEnabled
        syncStateFromPlayer()
    }

    fun cycleRepeatMode() {
        val ctrl = controller ?: return
        ctrl.repeatMode = when (ctrl.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
        syncStateFromPlayer()
    }

    /** Pitch-preserved global playback speed combined with active track's per-track default speed. */
    fun setPlaybackRate(rate: Float) {
        val clamped = rate.coerceIn(0.5f, 2.0f)
        repository.prefs.setPlaybackRate(clamped)
        applyPerTrackOverrides(controller, resolveActiveTrack())
        _state.update { it.copy(playbackRate = clamped) }
    }

    fun refreshTrackMetadata(updatedTracks: List<TrackEntity>) {
        if (currentQueue.isEmpty()) return
        val byId = updatedTracks.associateBy { it.id }
        currentQueue = currentQueue.map { byId[it.id] ?: it }
        applyPerTrackOverrides(controller, resolveActiveTrack())
        syncStateFromPlayer()
    }

    fun stopAndClear() {
        controller?.stop()
        controller?.clearMediaItems()
        currentQueue = emptyList()
        _state.update {
            PlayerUiState(playbackRate = repository.settings.value.playbackRate)
        }
        updatePositionTicker(false)
    }

    fun release() {
        positionTickerJob?.cancel()
        controller?.removeListener(listener)
        controller?.release()
        controller = null
    }

    private fun resolvePlayableUri(
        track: TrackEntity,
        serverUrl: String,
        token: String,
        quality: String,
    ): Uri? {
        val localPath = track.localAudioPath
        if (!localPath.isNullOrBlank()) {
            val file = File(localPath)
            if (file.exists()) {
                return Uri.fromFile(file)
            }
        }
        if (serverUrl.isBlank() || token.isBlank()) return null
        val url = repository.api.buildStreamUrl(
            baseUrl = serverUrl,
            token = token,
            trackId = track.id,
            quality = quality,
            download = false,
        )
        return Uri.parse(url)
    }

    private fun resolveArtworkUri(track: TrackEntity, serverUrl: String): Uri? {
        val localCover = track.localCoverPath
        if (!localCover.isNullOrBlank()) {
            val file = File(localCover)
            if (file.exists()) return Uri.fromFile(file)
        }
        val hash = track.coverHash ?: return null
        if (serverUrl.isBlank()) return null
        return Uri.parse(repository.api.buildCoverUrl(serverUrl, hash))
    }

    private fun syncStateFromPlayer() {
        val ctrl = controller
        val idx = ctrl?.currentMediaItemIndex ?: -1
        val activeTrack = resolveActiveTrack()
        val rawDuration = ctrl?.duration ?: 0L
        val durationMs = if (rawDuration > 0L) rawDuration else (activeTrack?.durationMs ?: 0L)
        _state.update {
            it.copy(
                queue = currentQueue,
                currentIndex = idx,
                currentTrack = activeTrack,
                isPlaying = ctrl?.isPlaying == true,
                positionMs = (ctrl?.currentPosition ?: 0L).coerceAtLeast(0L),
                durationMs = durationMs,
                shuffleEnabled = ctrl?.shuffleModeEnabled == true,
                repeatMode = ctrl?.repeatMode ?: Player.REPEAT_MODE_OFF,
                playbackRate = repository.settings.value.playbackRate,
                isBuffering = ctrl?.playbackState == Player.STATE_BUFFERING,
            )
        }
    }

    private fun updatePositionTicker(isPlaying: Boolean) {
        positionTickerJob?.cancel()
        if (!isPlaying) return
        positionTickerJob = scope.launch {
            while (isActive) {
                val ctrl = controller
                if (ctrl != null) {
                    val rawDuration = ctrl.duration
                    val dur = if (rawDuration > 0L) rawDuration else (_state.value.currentTrack?.durationMs ?: 0L)
                    _state.update {
                        it.copy(
                            positionMs = ctrl.currentPosition.coerceAtLeast(0L),
                            durationMs = dur,
                        )
                    }
                }
                delay(250L)
            }
        }
    }
}
