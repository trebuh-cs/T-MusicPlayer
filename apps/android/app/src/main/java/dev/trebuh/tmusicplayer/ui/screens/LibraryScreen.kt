package dev.trebuh.tmusicplayer.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.OfflinePin
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trebuh.tmusicplayer.data.db.PlaylistSummary
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.ui.components.ArtworkBox
import dev.trebuh.tmusicplayer.ui.components.formatDurationMs
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors

private enum class LibraryFilter(val label: String) {
    ALL("All"),
    FAVORITES("Favorites"),
    OFFLINE("Offline"),
}

@Composable
fun LibraryScreen(
    tracks: List<TrackEntity>,
    playlists: List<PlaylistSummary>,
    currentTrackId: String?,
    isSyncing: Boolean,
    syncMessage: String?,
    downloadProgress: Map<String, Float>,
    artworkModel: (TrackEntity) -> Any?,
    onSyncNow: () -> Unit,
    onDismissSyncMessage: () -> Unit,
    onPlayQueue: (List<TrackEntity>, Int) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onDownloadOffline: (String) -> Unit,
    onRemoveOffline: (String) -> Unit,
    onAddTrackToPlaylist: (playlistId: String, trackId: String) -> Unit,
) {
    val palette = LocalTMusicColors.current
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(LibraryFilter.ALL) }
    var trackForPlaylistDialog by remember { mutableStateOf<TrackEntity?>(null) }

    val filteredTracks = remember(tracks, query, filter) {
        val cleanQuery = query.trim().lowercase()
        tracks.filter { track ->
            val matchesFilter = when (filter) {
                LibraryFilter.ALL -> true
                LibraryFilter.FAVORITES -> track.isFavorite
                LibraryFilter.OFFLINE -> track.isDownloaded
            }
            val matchesQuery = cleanQuery.isEmpty() ||
                track.title.lowercase().contains(cleanQuery) ||
                track.artist.lowercase().contains(cleanQuery) ||
                track.album.lowercase().contains(cleanQuery)
            matchesFilter && matchesQuery
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bgBase),
    ) {
        // Header + Two-Way Sync Button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(
                    text = "Library",
                    color = palette.textPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "${tracks.size} tracks • ${tracks.count { it.isDownloaded }} offline",
                    color = palette.textSecondary,
                    fontSize = 12.sp,
                )
            }

            Button(
                onClick = onSyncNow,
                enabled = !isSyncing,
                colors = ButtonDefaults.buttonColors(
                    containerColor = palette.accentSoft,
                    contentColor = palette.accent,
                ),
                shape = RoundedCornerShape(10.dp),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) {
                if (isSyncing) {
                    CircularProgressIndicator(
                        color = palette.accent,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                } else {
                    Icon(
                        imageVector = Icons.Rounded.Sync,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                }
                Spacer(modifier = Modifier.size(6.dp))
                Text(
                    text = if (isSyncing) "Syncing..." else "Sync",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        if (!syncMessage.isNullOrBlank()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 2.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(palette.bgSurface)
                    .border(1.dp, palette.borderSubtle, RoundedCornerShape(10.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = syncMessage,
                    color = palette.textPrimary,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    imageVector = Icons.Rounded.Close,
                    contentDescription = "Dismiss",
                    tint = palette.textSecondary,
                    modifier = Modifier
                        .size(16.dp)
                        .clickable(onClick = onDismissSyncMessage),
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
        }

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search tracks, artists, albums...") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Rounded.Search,
                    contentDescription = null,
                    tint = palette.textMuted,
                )
            },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { query = "" }) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = "Clear search",
                            tint = palette.textSecondary,
                        )
                    }
                }
            },
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = palette.accent,
                unfocusedBorderColor = palette.borderSubtle,
                focusedTextColor = palette.textPrimary,
                unfocusedTextColor = palette.textPrimary,
                focusedContainerColor = palette.bgElevated,
                unfocusedContainerColor = palette.bgElevated,
            ),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        )

        Spacer(modifier = Modifier.height(10.dp))

        // Filters + Play All
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LibraryFilter.entries.forEach { tab ->
                    val selected = filter == tab
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) palette.accentSoft else palette.bgSurface)
                            .border(
                                1.dp,
                                if (selected) palette.accent else palette.borderSubtle,
                                RoundedCornerShape(8.dp),
                            )
                            .clickable { filter = tab }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = tab.label,
                            color = if (selected) palette.accent else palette.textSecondary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            if (filteredTracks.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(palette.accent)
                        .clickable { onPlayQueue(filteredTracks, 0) }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.PlayArrow,
                        contentDescription = null,
                        tint = palette.accentContrast,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        text = "Play All",
                        color = palette.accentContrast,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (filteredTracks.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (tracks.isEmpty()) {
                        "No tracks yet. Upload music from your PC or tap Sync."
                    } else {
                        "No matching tracks found."
                    },
                    color = palette.textSecondary,
                    fontSize = 14.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                itemsIndexed(filteredTracks, key = { _, item -> item.id }) { index, track ->
                    TrackRow(
                        track = track,
                        isPlayingCurrent = track.id == currentTrackId,
                        downloadProgress = downloadProgress[track.id],
                        artworkModel = artworkModel(track),
                        onClick = { onPlayQueue(filteredTracks, index) },
                        onToggleFavorite = { onToggleFavorite(track.id) },
                        onToggleOffline = {
                            if (track.isDownloaded) onRemoveOffline(track.id) else onDownloadOffline(track.id)
                        },
                        onAddToPlaylist = { trackForPlaylistDialog = track },
                    )
                }
            }
        }
    }

    val chosenTrack = trackForPlaylistDialog
    if (chosenTrack != null) {
        AlertDialog(
            onDismissRequest = { trackForPlaylistDialog = null },
            containerColor = palette.bgElevated,
            title = {
                Text("Add to Playlist", color = palette.textPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                if (playlists.isEmpty()) {
                    Text(
                        "Create a playlist in the Playlists tab first.",
                        color = palette.textSecondary,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        playlists.forEach { pl ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(palette.bgSurface)
                                    .border(1.dp, palette.borderSubtle, RoundedCornerShape(8.dp))
                                    .clickable {
                                        onAddTrackToPlaylist(pl.id, chosenTrack.id)
                                        trackForPlaylistDialog = null
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                            ) {
                                Text(
                                    text = "${pl.name} (${pl.trackCount} tracks)",
                                    color = palette.textPrimary,
                                    fontSize = 14.sp,
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { trackForPlaylistDialog = null }) {
                    Text("Close", color = palette.accent)
                }
            },
        )
    }
}

@Composable
fun TrackRow(
    track: TrackEntity,
    isPlayingCurrent: Boolean,
    downloadProgress: Float?,
    artworkModel: Any?,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
    onToggleOffline: () -> Unit,
    onAddToPlaylist: (() -> Unit)? = null,
) {
    val palette = LocalTMusicColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (isPlayingCurrent) palette.accentSoft else palette.bgElevated)
            .border(
                1.dp,
                if (isPlayingCurrent) palette.accent else palette.borderSubtle,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ArtworkBox(
            model = artworkModel,
            contentDescription = track.album,
            size = 46.dp,
            cornerRadius = 8.dp,
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = track.title,
                color = if (isPlayingCurrent) palette.accent else palette.textPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${track.artist} • ${formatDurationMs(track.durationMs)}",
                color = palette.textSecondary,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        IconButton(onClick = onToggleFavorite, modifier = Modifier.size(34.dp)) {
            Icon(
                imageVector = if (track.isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = "Favorite",
                tint = if (track.isFavorite) palette.accent else palette.textMuted,
                modifier = Modifier.size(18.dp),
            )
        }

        if (onAddToPlaylist != null) {
            IconButton(onClick = onAddToPlaylist, modifier = Modifier.size(34.dp)) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.PlaylistAdd,
                    contentDescription = "Add to playlist",
                    tint = palette.textSecondary,
                    modifier = Modifier.size(19.dp),
                )
            }
        }

        IconButton(
            onClick = { if (downloadProgress == null) onToggleOffline() },
            modifier = Modifier.size(34.dp),
        ) {
            when {
                downloadProgress != null -> CircularProgressIndicator(
                    progress = { downloadProgress },
                    color = palette.accent,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp),
                )
                track.isDownloaded -> Icon(
                    imageVector = Icons.Rounded.OfflinePin,
                    contentDescription = "Saved offline",
                    tint = palette.accent,
                    modifier = Modifier.size(19.dp),
                )
                else -> Icon(
                    imageVector = Icons.Rounded.Download,
                    contentDescription = "Download offline",
                    tint = palette.textSecondary,
                    modifier = Modifier.size(19.dp),
                )
            }
        }
    }
}
