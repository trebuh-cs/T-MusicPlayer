package dev.trebuh.tmusicplayer.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.trebuh.tmusicplayer.data.api.ServerHealthResponse
import dev.trebuh.tmusicplayer.data.api.TMusicApiClient
import dev.trebuh.tmusicplayer.data.db.PlaylistSummary
import dev.trebuh.tmusicplayer.data.db.TMusicDatabase
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.data.prefs.AppPreferences
import dev.trebuh.tmusicplayer.data.prefs.UserSettings
import dev.trebuh.tmusicplayer.data.sync.SyncRepository
import dev.trebuh.tmusicplayer.player.PlayerController
import dev.trebuh.tmusicplayer.player.PlayerUiState
import dev.trebuh.tmusicplayer.ui.theme.TMusicColors
import dev.trebuh.tmusicplayer.ui.theme.ThemeDefinition
import dev.trebuh.tmusicplayer.ui.theme.ThemeRegistry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TMusicViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = AppPreferences(application)
    private val db = TMusicDatabase.getInstance(application)
    private val api = TMusicApiClient()
    val repository = SyncRepository(application, db.musicDao(), api, prefs)
    val playerController = PlayerController(application, repository)

    val themes: List<ThemeDefinition> = ThemeRegistry.loadThemes(application)

    val settings: StateFlow<UserSettings> = repository.settings
    val currentPalette: StateFlow<TMusicColors> = settings
        .map { s ->
            val match = themes.firstOrNull { it.id == s.themeId } ?: themes.first()
            ThemeRegistry.toPalette(match)
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, TMusicColors.FallbackTpx)

    val tracks: StateFlow<List<TrackEntity>> = repository.tracks
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val playlists: StateFlow<List<PlaylistSummary>> = repository.playlists
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val playerState: StateFlow<PlayerUiState> = playerController.state
    val isSyncing: StateFlow<Boolean> = repository.isSyncing
    val downloadProgress: StateFlow<Map<String, Float>> = repository.downloadProgress
    val syncMessage: StateFlow<String?> = repository.syncMessage

    private val _offlineBytes = MutableStateFlow(0L)
    val offlineBytes: StateFlow<Long> = _offlineBytes.asStateFlow()

    private val _authLoading = MutableStateFlow(false)
    val authLoading: StateFlow<Boolean> = _authLoading.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    private val _healthStatus = MutableStateFlow<ServerHealthResponse?>(null)
    val healthStatus: StateFlow<ServerHealthResponse?> = _healthStatus.asStateFlow()

    init {
        viewModelScope.launch {
            tracks.collect { updated ->
                playerController.refreshTrackMetadata(updated)
                _offlineBytes.value = repository.getOfflineStorageBytes()
            }
        }
        // Automatically attempt background refresh if already logged in on launch.
        if (settings.value.isLoggedIn) {
            viewModelScope.launch {
                repository.syncNow()
            }
        }
    }

    fun observePlaylistTracks(playlistId: String): Flow<List<TrackEntity>> =
        repository.observeTracksForPlaylist(playlistId)

    fun testServerConnection(serverUrl: String) {
        viewModelScope.launch {
            _authLoading.value = true
            _authError.value = null
            repository.checkHealth(serverUrl)
                .onSuccess { res ->
                    _healthStatus.value = res
                }
                .onFailure { err ->
                    _healthStatus.value = null
                    _authError.value = err.message ?: "Unable to reach server"
                }
            _authLoading.value = false
        }
    }

    fun login(serverUrl: String, username: String, password: String) {
        viewModelScope.launch {
            _authLoading.value = true
            _authError.value = null
            repository.login(serverUrl, username, password)
                .onFailure { err ->
                    _authError.value = err.message ?: "Sign in failed"
                }
            _authLoading.value = false
        }
    }

    fun register(serverUrl: String, username: String, password: String, inviteCode: String?) {
        viewModelScope.launch {
            _authLoading.value = true
            _authError.value = null
            repository.register(serverUrl, username, password, inviteCode)
                .onFailure { err ->
                    _authError.value = err.message ?: "Registration failed"
                }
            _authLoading.value = false
        }
    }

    fun clearAuthError() {
        _authError.value = null
    }

    fun syncNow() {
        viewModelScope.launch {
            repository.syncNow()
            _offlineBytes.value = repository.getOfflineStorageBytes()
        }
    }

    fun clearSyncMessage() {
        repository.clearSyncMessage()
    }

    fun toggleFavorite(trackId: String) {
        viewModelScope.launch {
            repository.toggleFavorite(trackId)
        }
    }

    fun downloadTrackOffline(trackId: String) {
        viewModelScope.launch {
            repository.downloadTrackOffline(trackId)
            _offlineBytes.value = repository.getOfflineStorageBytes()
        }
    }

    fun removeOfflineTrack(trackId: String) {
        viewModelScope.launch {
            repository.removeOfflineTrack(trackId)
            _offlineBytes.value = repository.getOfflineStorageBytes()
        }
    }

    fun downloadPlaylistOffline(playlistId: String) {
        viewModelScope.launch {
            repository.downloadPlaylistOffline(playlistId)
            _offlineBytes.value = repository.getOfflineStorageBytes()
        }
    }

    fun createPlaylist(
        name: String,
        description: String,
        isShared: Boolean,
        initialTrackIds: List<String> = emptyList(),
    ) {
        viewModelScope.launch {
            repository.createPlaylist(name, description, isShared, initialTrackIds)
        }
    }

    fun renamePlaylist(playlistId: String, name: String, description: String) {
        viewModelScope.launch {
            repository.renamePlaylist(playlistId, name, description)
        }
    }

    fun deletePlaylist(playlistId: String) {
        viewModelScope.launch {
            repository.deletePlaylist(playlistId)
        }
    }

    fun addTrackToPlaylist(playlistId: String, trackId: String) {
        viewModelScope.launch {
            repository.addTrackToPlaylist(playlistId, trackId)
        }
    }

    fun removeTrackFromPlaylist(playlistId: String, trackId: String) {
        viewModelScope.launch {
            repository.removeTrackFromPlaylist(playlistId, trackId)
        }
    }

    fun setTheme(themeId: String) {
        prefs.setThemeId(themeId)
    }

    fun setAudioQuality(quality: String) {
        prefs.setAudioQuality(quality)
    }

    fun setPlaybackRate(rate: Float) {
        playerController.setPlaybackRate(rate)
    }

    fun clearOfflineStorage() {
        viewModelScope.launch {
            repository.clearAllOfflineDownloads()
            _offlineBytes.value = repository.getOfflineStorageBytes()
        }
    }

    fun signOut() {
        viewModelScope.launch {
            playerController.stopAndClear()
            repository.signOut()
            _offlineBytes.value = 0L
        }
    }

    fun playTracks(queue: List<TrackEntity>, startIndex: Int = 0) {
        playerController.playQueue(queue, startIndex)
    }

    override fun onCleared() {
        playerController.release()
        super.onCleared()
    }
}
