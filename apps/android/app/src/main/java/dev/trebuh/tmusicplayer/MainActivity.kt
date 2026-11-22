package dev.trebuh.tmusicplayer

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.trebuh.tmusicplayer.ui.TMusicViewModel
import dev.trebuh.tmusicplayer.ui.components.MiniPlayerBar
import dev.trebuh.tmusicplayer.ui.components.NowPlayingSheet
import dev.trebuh.tmusicplayer.ui.screens.LibraryScreen
import dev.trebuh.tmusicplayer.ui.screens.LoginScreen
import dev.trebuh.tmusicplayer.ui.screens.PlaylistDetailScreen
import dev.trebuh.tmusicplayer.ui.screens.PlaylistsScreen
import dev.trebuh.tmusicplayer.ui.screens.SettingsScreen
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors
import dev.trebuh.tmusicplayer.ui.theme.TMusicTheme

private enum class MainTab(val label: String) {
    LIBRARY("Library"),
    PLAYLISTS("Playlists"),
    SETTINGS("Settings"),
}

class MainActivity : ComponentActivity() {
    private val viewModel: TMusicViewModel by viewModels()

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ -> }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        setContent {
            val palette by viewModel.currentPalette.collectAsState()
            val settings by viewModel.settings.collectAsState()

            LaunchedEffect(palette.isDark) {
                enableEdgeToEdge(
                    statusBarStyle = if (palette.isDark) {
                        SystemBarStyle.dark(Color.TRANSPARENT)
                    } else {
                        SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                    },
                    navigationBarStyle = if (palette.isDark) {
                        SystemBarStyle.dark(Color.TRANSPARENT)
                    } else {
                        SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                    },
                )
            }

            TMusicTheme(palette = palette) {
                if (!settings.isLoggedIn) {
                    val authLoading by viewModel.authLoading.collectAsState()
                    val authError by viewModel.authError.collectAsState()
                    val health by viewModel.healthStatus.collectAsState()
                    LoginScreen(
                        initialServerUrl = settings.serverUrl,
                        isLoading = authLoading,
                        error = authError,
                        healthStatus = health,
                        onTestServer = viewModel::testServerConnection,
                        onLogin = viewModel::login,
                        onRegister = viewModel::register,
                        onClearError = viewModel::clearAuthError,
                    )
                } else {
                    MainAppShell(viewModel = viewModel)
                }
            }
        }
    }
}

@Composable
private fun MainAppShell(viewModel: TMusicViewModel) {
    val palette = LocalTMusicColors.current
    val tracks by viewModel.tracks.collectAsState()
    val playlists by viewModel.playlists.collectAsState()
    val settings by viewModel.settings.collectAsState()
    val playerState by viewModel.playerState.collectAsState()
    val isSyncing by viewModel.isSyncing.collectAsState()
    val downloadProgress by viewModel.downloadProgress.collectAsState()
    val syncMessage by viewModel.syncMessage.collectAsState()
    val offlineBytes by viewModel.offlineBytes.collectAsState()

    var currentTab by rememberSaveable { mutableStateOf(MainTab.LIBRARY) }
    var selectedPlaylistId by rememberSaveable { mutableStateOf<String?>(null) }
    var showNowPlaying by remember { mutableStateOf(false) }
    var playlistPickerTrackId by remember { mutableStateOf<String?>(null) }

    val selectedPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId }
    if (selectedPlaylistId != null && selectedPlaylist == null) {
        selectedPlaylistId = null
    }

    Scaffold(
        containerColor = palette.bgBase,
        bottomBar = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (playerState.currentTrack != null) {
                    MiniPlayerBar(
                        playerState = playerState,
                        artworkModel = viewModel.repository::resolveArtworkModel,
                        onTogglePlayPause = viewModel.playerController::togglePlayPause,
                        onNext = viewModel.playerController::next,
                        onOpenNowPlaying = { showNowPlaying = true },
                    )
                }
                NavigationBar(
                    containerColor = palette.bgElevated,
                    contentColor = palette.textPrimary,
                ) {
                    NavigationBarItem(
                        selected = currentTab == MainTab.LIBRARY,
                        onClick = {
                            selectedPlaylistId = null
                            currentTab = MainTab.LIBRARY
                        },
                        icon = { Icon(Icons.Rounded.LibraryMusic, contentDescription = null) },
                        label = { Text(MainTab.LIBRARY.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = palette.accent,
                            selectedTextColor = palette.accent,
                            indicatorColor = palette.accentSoft,
                            unselectedIconColor = palette.textSecondary,
                            unselectedTextColor = palette.textSecondary,
                        ),
                    )
                    NavigationBarItem(
                        selected = currentTab == MainTab.PLAYLISTS,
                        onClick = { currentTab = MainTab.PLAYLISTS },
                        icon = { Icon(Icons.AutoMirrored.Rounded.QueueMusic, contentDescription = null) },
                        label = { Text(MainTab.PLAYLISTS.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = palette.accent,
                            selectedTextColor = palette.accent,
                            indicatorColor = palette.accentSoft,
                            unselectedIconColor = palette.textSecondary,
                            unselectedTextColor = palette.textSecondary,
                        ),
                    )
                    NavigationBarItem(
                        selected = currentTab == MainTab.SETTINGS,
                        onClick = {
                            selectedPlaylistId = null
                            currentTab = MainTab.SETTINGS
                        },
                        icon = { Icon(Icons.Rounded.Settings, contentDescription = null) },
                        label = { Text(MainTab.SETTINGS.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = palette.accent,
                            selectedTextColor = palette.accent,
                            indicatorColor = palette.accentSoft,
                            unselectedIconColor = palette.textSecondary,
                            unselectedTextColor = palette.textSecondary,
                        ),
                    )
                }
            }
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            when (currentTab) {
                MainTab.LIBRARY -> LibraryScreen(
                    tracks = tracks,
                    playlists = playlists,
                    currentTrackId = playerState.currentTrack?.id,
                    isSyncing = isSyncing,
                    syncMessage = syncMessage,
                    downloadProgress = downloadProgress,
                    artworkModel = viewModel.repository::resolveArtworkModel,
                    onSyncNow = viewModel::syncNow,
                    onDismissSyncMessage = viewModel::clearSyncMessage,
                    onPlayQueue = viewModel::playTracks,
                    onToggleFavorite = viewModel::toggleFavorite,
                    onDownloadOffline = viewModel::downloadTrackOffline,
                    onRemoveOffline = viewModel::removeOfflineTrack,
                    onAddTrackToPlaylist = viewModel::addTrackToPlaylist,
                )

                MainTab.PLAYLISTS -> {
                    if (selectedPlaylist != null) {
                        val playlistTracks by viewModel
                            .observePlaylistTracks(selectedPlaylist.id)
                            .collectAsState(initial = emptyList())
                        PlaylistDetailScreen(
                            playlist = selectedPlaylist,
                            tracks = playlistTracks,
                            allLibraryTracks = tracks,
                            currentTrackId = playerState.currentTrack?.id,
                            currentUsername = settings.username,
                            isSyncing = isSyncing,
                            downloadProgress = downloadProgress,
                            artworkModel = viewModel.repository::resolveArtworkModel,
                            onBack = { selectedPlaylistId = null },
                            onSyncNow = viewModel::syncNow,
                            onPlayQueue = viewModel::playTracks,
                            onDownloadAllOffline = { viewModel.downloadPlaylistOffline(selectedPlaylist.id) },
                            onToggleFavorite = viewModel::toggleFavorite,
                            onDownloadTrackOffline = viewModel::downloadTrackOffline,
                            onRemoveOfflineTrack = viewModel::removeOfflineTrack,
                            onAddTrackToPlaylist = { trackId ->
                                viewModel.addTrackToPlaylist(selectedPlaylist.id, trackId)
                            },
                            onRemoveTrackFromPlaylist = { trackId ->
                                viewModel.removeTrackFromPlaylist(selectedPlaylist.id, trackId)
                            },
                        )
                    } else {
                        PlaylistsScreen(
                            playlists = playlists,
                            currentUsername = settings.username,
                            isSyncing = isSyncing,
                            onSyncNow = viewModel::syncNow,
                            onOpenPlaylist = { selectedPlaylistId = it.id },
                            onDownloadPlaylistOffline = viewModel::downloadPlaylistOffline,
                            onCreatePlaylist = { name, desc, shared ->
                                viewModel.createPlaylist(name, desc, shared)
                            },
                            onDeletePlaylist = viewModel::deletePlaylist,
                        )
                    }
                }

                MainTab.SETTINGS -> SettingsScreen(
                    settings = settings,
                    themes = viewModel.themes,
                    isSyncing = isSyncing,
                    offlineBytes = offlineBytes,
                    onSyncNow = viewModel::syncNow,
                    onSelectTheme = viewModel::setTheme,
                    onSelectAudioQuality = viewModel::setAudioQuality,
                    onSetPlaybackRate = viewModel::setPlaybackRate,
                    onClearOfflineCache = viewModel::clearOfflineStorage,
                    onSignOut = viewModel::signOut,
                )
            }
        }
    }

    val activeTrack = playerState.currentTrack
    if (showNowPlaying && activeTrack != null) {
        NowPlayingSheet(
            playerState = playerState,
            track = activeTrack,
            artworkModel = viewModel.repository.resolveArtworkModel(activeTrack),
            downloadProgress = downloadProgress[activeTrack.id],
            onDismiss = { showNowPlaying = false },
            onSeek = viewModel.playerController::seekTo,
            onTogglePlayPause = viewModel.playerController::togglePlayPause,
            onNext = viewModel.playerController::next,
            onPrevious = viewModel.playerController::previous,
            onToggleShuffle = viewModel.playerController::toggleShuffle,
            onCycleRepeat = viewModel.playerController::cycleRepeatMode,
            onToggleFavorite = { viewModel.toggleFavorite(activeTrack.id) },
            onDownloadOffline = { viewModel.downloadTrackOffline(activeTrack.id) },
            onRemoveOffline = { viewModel.removeOfflineTrack(activeTrack.id) },
            onAddToPlaylist = { playlistPickerTrackId = activeTrack.id },
            onSetPlaybackRate = viewModel::setPlaybackRate,
        )
    }

    val pendingTrackId = playlistPickerTrackId
    if (pendingTrackId != null) {
        AlertDialog(
            onDismissRequest = { playlistPickerTrackId = null },
            containerColor = palette.bgElevated,
            title = { Text("Add to Playlist", color = palette.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (playlists.isEmpty()) {
                        Text("Create a playlist first in the Playlists tab.", color = palette.textSecondary)
                    } else {
                        playlists.forEach { pl ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(palette.bgSurface)
                                    .border(1.dp, palette.borderSubtle, RoundedCornerShape(8.dp))
                                    .clickable {
                                        viewModel.addTrackToPlaylist(pl.id, pendingTrackId)
                                        playlistPickerTrackId = null
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                            ) {
                                Text(pl.name, color = palette.textPrimary, fontSize = 14.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { playlistPickerTrackId = null }) {
                    Text("Close", color = palette.accent)
                }
            },
        )
    }
}
