package dev.trebuh.tmusicplayer.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.OfflinePin
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.trebuh.tmusicplayer.data.db.PlaylistSummary
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors

@Composable
fun PlaylistsScreen(
    playlists: List<PlaylistSummary>,
    currentUsername: String,
    isSyncing: Boolean,
    onSyncNow: () -> Unit,
    onOpenPlaylist: (PlaylistSummary) -> Unit,
    onDownloadPlaylistOffline: (String) -> Unit,
    onCreatePlaylist: (name: String, description: String, isShared: Boolean) -> Unit,
    onDeletePlaylist: (String) -> Unit,
) {
    val palette = LocalTMusicColors.current
    var showCreateDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bgBase),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(
                    text = "Playlists",
                    color = palette.textPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "Synced between PC & Pixel 7",
                    color = palette.textSecondary,
                    fontSize = 12.sp,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(onClick = onSyncNow, enabled = !isSyncing) {
                    if (isSyncing) {
                        CircularProgressIndicator(
                            color = palette.accent,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(18.dp),
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Rounded.Sync,
                            contentDescription = "Sync",
                            tint = palette.accent,
                        )
                    }
                }

                Button(
                    onClick = { showCreateDialog = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = palette.accent,
                        contentColor = palette.accentContrast,
                    ),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Add,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.size(4.dp))
                    Text("New", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
        }

        if (playlists.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "No playlists yet. Create one here or import WMP playlists on PC and tap Sync.",
                    color = palette.textSecondary,
                    fontSize = 14.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(playlists, key = { it.id }) { pl ->
                    val allOffline = pl.trackCount > 0 && pl.downloadedCount >= pl.trackCount
                    val canDelete = pl.ownerUsername.isBlank() || pl.ownerUsername == currentUsername

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(palette.bgElevated)
                            .border(1.dp, palette.borderSubtle, RoundedCornerShape(12.dp))
                            .clickable { onOpenPlaylist(pl) }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(46.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(palette.accentSoft)
                                .border(1.dp, palette.borderSubtle, RoundedCornerShape(10.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Rounded.QueueMusic,
                                contentDescription = null,
                                tint = palette.accent,
                            )
                        }

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = pl.name,
                                color = palette.textPrimary,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            val subtitle = buildString {
                                append("${pl.trackCount} tracks")
                                if (pl.downloadedCount > 0) {
                                    append(" • ${pl.downloadedCount} offline")
                                }
                                if (pl.isShared) {
                                    append(" • Shared")
                                }
                            }
                            Text(
                                text = subtitle,
                                color = palette.textSecondary,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }

                        IconButton(onClick = { onDownloadPlaylistOffline(pl.id) }) {
                            Icon(
                                imageVector = if (allOffline) Icons.Rounded.OfflinePin else Icons.Rounded.Download,
                                contentDescription = "Download playlist offline",
                                tint = if (allOffline) palette.accent else palette.textSecondary,
                            )
                        }

                        if (canDelete) {
                            IconButton(onClick = { onDeletePlaylist(pl.id) }) {
                                Icon(
                                    imageVector = Icons.Rounded.DeleteOutline,
                                    contentDescription = "Delete playlist",
                                    tint = palette.textMuted,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        var name by remember { mutableStateOf("") }
        var description by remember { mutableStateOf("") }
        var isShared by remember { mutableStateOf(false) }

        val fieldColors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = palette.accent,
            unfocusedBorderColor = palette.borderSubtle,
            focusedTextColor = palette.textPrimary,
            unfocusedTextColor = palette.textPrimary,
        )

        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            containerColor = palette.bgElevated,
            title = {
                Text("New Playlist", color = palette.textPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Playlist Name") },
                        singleLine = true,
                        colors = fieldColors,
                    )
                    OutlinedTextField(
                        value = description,
                        onValueChange = { description = it },
                        label = { Text("Description (optional)") },
                        singleLine = true,
                        colors = fieldColors,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.clickable { isShared = !isShared },
                    ) {
                        Checkbox(
                            checked = isShared,
                            onCheckedChange = { isShared = it },
                            colors = CheckboxDefaults.colors(
                                checkedColor = palette.accent,
                                checkmarkColor = palette.accentContrast,
                            ),
                        )
                        Text(
                            text = "Share with other server users",
                            color = palette.textSecondary,
                            fontSize = 13.sp,
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onCreatePlaylist(name, description, isShared)
                        showCreateDialog = false
                    },
                    enabled = name.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = palette.accent,
                        contentColor = palette.accentContrast,
                    ),
                ) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text("Cancel", color = palette.textSecondary)
                }
            },
        )
    }
}

@Composable
fun PlaylistDetailScreen(
    playlist: PlaylistSummary,
    tracks: List<TrackEntity>,
    allLibraryTracks: List<TrackEntity>,
    currentTrackId: String?,
    currentUsername: String,
    isSyncing: Boolean,
    downloadProgress: Map<String, Float>,
    artworkModel: (TrackEntity) -> Any?,
    onBack: () -> Unit,
    onSyncNow: () -> Unit,
    onPlayQueue: (List<TrackEntity>, Int) -> Unit,
    onDownloadAllOffline: () -> Unit,
    onToggleFavorite: (String) -> Unit,
    onDownloadTrackOffline: (String) -> Unit,
    onRemoveOfflineTrack: (String) -> Unit,
    onAddTrackToPlaylist: (String) -> Unit,
    onRemoveTrackFromPlaylist: (String) -> Unit,
    onReorderTracks: (List<String>) -> Unit,
) {
    val palette = LocalTMusicColors.current
    var showAddTracksDialog by remember { mutableStateOf(false) }
    val canEdit = playlist.ownerUsername.isBlank() || playlist.ownerUsername == currentUsername

    val orderedTracks = remember { mutableStateListOf<TrackEntity>() }
    var draggingTrackId by remember { mutableStateOf<String?>(null) }
    var dragOffsetY by remember { mutableFloatStateOf(0f) }
    val rowStepPx = with(LocalDensity.current) { 78.dp.toPx() }

    LaunchedEffect(tracks, draggingTrackId) {
        if (draggingTrackId == null) {
            orderedTracks.clear()
            orderedTracks.addAll(tracks)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bgBase),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f),
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "Back",
                        tint = palette.textPrimary,
                    )
                }
                Column {
                    Text(
                        text = playlist.name,
                        color = palette.textPrimary,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${tracks.size} tracks • ${tracks.count { it.isDownloaded }} offline",
                        color = palette.textSecondary,
                        fontSize = 12.sp,
                    )
                }
            }

            IconButton(onClick = onSyncNow, enabled = !isSyncing) {
                if (isSyncing) {
                    CircularProgressIndicator(
                        color = palette.accent,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                } else {
                    Icon(
                        imageVector = Icons.Rounded.Sync,
                        contentDescription = "Sync",
                        tint = palette.accent,
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { if (tracks.isNotEmpty()) onPlayQueue(tracks, 0) },
                enabled = tracks.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = palette.accent,
                    contentColor = palette.accentContrast,
                ),
                shape = RoundedCornerShape(10.dp),
            ) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.size(4.dp))
                Text("Play", fontWeight = FontWeight.Bold)
            }

            OutlinedButton(
                onClick = onDownloadAllOffline,
                enabled = tracks.isNotEmpty(),
                shape = RoundedCornerShape(10.dp),
            ) {
                Icon(
                    Icons.Rounded.Download,
                    contentDescription = null,
                    tint = palette.accent,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.size(4.dp))
                Text("Download Offline", color = palette.textPrimary, fontSize = 12.sp)
            }

            if (canEdit) {
                OutlinedButton(
                    onClick = { showAddTracksDialog = true },
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Icon(
                        Icons.Rounded.Add,
                        contentDescription = null,
                        tint = palette.textPrimary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (tracks.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "This playlist is empty.",
                    color = palette.textSecondary,
                    fontSize = 14.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                itemsIndexed(orderedTracks, key = { _, item -> item.id }) { index, track ->
                    val isDragging = draggingTrackId == track.id
                    val leadingDragModifier = if (canEdit) {
                        Modifier.pointerInput(track.id) {
                            detectDragGestures(
                                onDragStart = {
                                    draggingTrackId = track.id
                                    dragOffsetY = 0f
                                },
                                onDrag = { change, dragAmount ->
                                    change.consume()
                                    dragOffsetY += dragAmount.y
                                    val currentIdx = orderedTracks.indexOfFirst { it.id == track.id }
                                    if (currentIdx >= 0) {
                                        if (dragOffsetY > rowStepPx * 0.55f && currentIdx < orderedTracks.lastIndex) {
                                            val moved = orderedTracks.removeAt(currentIdx)
                                            orderedTracks.add(currentIdx + 1, moved)
                                            dragOffsetY -= rowStepPx
                                        } else if (dragOffsetY < -rowStepPx * 0.55f && currentIdx > 0) {
                                            val moved = orderedTracks.removeAt(currentIdx)
                                            orderedTracks.add(currentIdx - 1, moved)
                                            dragOffsetY += rowStepPx
                                        }
                                    }
                                },
                                onDragEnd = {
                                    draggingTrackId = null
                                    dragOffsetY = 0f
                                    onReorderTracks(orderedTracks.map { it.id })
                                },
                                onDragCancel = {
                                    draggingTrackId = null
                                    dragOffsetY = 0f
                                    orderedTracks.clear()
                                    orderedTracks.addAll(tracks)
                                },
                            )
                        }
                    } else {
                        Modifier
                    }

                    Column(
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                        modifier = Modifier
                            .zIndex(if (isDragging) 10f else 0f)
                            .graphicsLayer {
                                translationY = if (isDragging) dragOffsetY else 0f
                            },
                    ) {
                        TrackRow(
                            track = track,
                            isPlayingCurrent = track.id == currentTrackId,
                            downloadProgress = downloadProgress[track.id],
                            artworkModel = artworkModel(track),
                            onClick = { onPlayQueue(orderedTracks.toList(), index) },
                            onToggleFavorite = { onToggleFavorite(track.id) },
                            onToggleOffline = {
                                if (track.isDownloaded) onRemoveOfflineTrack(track.id) else onDownloadTrackOffline(track.id)
                            },
                            leadingModifier = leadingDragModifier,
                            showDragGripBadge = canEdit,
                        )
                        if (canEdit) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                Text(
                                    text = "Remove from playlist",
                                    color = palette.textMuted,
                                    fontSize = 11.sp,
                                    modifier = Modifier
                                        .clickable { onRemoveTrackFromPlaylist(track.id) }
                                        .padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAddTracksDialog) {
        val currentIds = remember(tracks) { tracks.map { it.id }.toSet() }
        val candidates = remember(allLibraryTracks, currentIds) {
            allLibraryTracks.filter { it.id !in currentIds }
        }
        AlertDialog(
            onDismissRequest = { showAddTracksDialog = false },
            containerColor = palette.bgElevated,
            title = { Text("Add Tracks", color = palette.textPrimary, fontWeight = FontWeight.Bold) },
            text = {
                if (candidates.isEmpty()) {
                    Text("All library tracks are already in this playlist.", color = palette.textSecondary)
                } else {
                    LazyColumn(
                        modifier = Modifier.height(320.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(candidates, key = { it.id }) { candidate ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(palette.bgSurface)
                                    .clickable { onAddTrackToPlaylist(candidate.id) }
                                    .padding(10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = candidate.title,
                                        color = palette.textPrimary,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        text = candidate.artist,
                                        color = palette.textSecondary,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                    )
                                }
                                Icon(Icons.Rounded.Add, contentDescription = null, tint = palette.accent)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAddTracksDialog = false }) {
                    Text("Done", color = palette.accent)
                }
            },
        )
    }
}
