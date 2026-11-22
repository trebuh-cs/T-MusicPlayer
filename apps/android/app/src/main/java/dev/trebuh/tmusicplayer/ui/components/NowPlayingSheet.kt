package dev.trebuh.tmusicplayer.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.OfflinePin
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.Player
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.player.PlayerUiState
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors
import java.util.Locale
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NowPlayingSheet(
    playerState: PlayerUiState,
    track: TrackEntity,
    artworkModel: Any?,
    downloadProgress: Float?,
    onDismiss: () -> Unit,
    onSeek: (Long) -> Unit,
    onTogglePlayPause: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleShuffle: () -> Unit,
    onCycleRepeat: () -> Unit,
    onToggleFavorite: () -> Unit,
    onDownloadOffline: () -> Unit,
    onRemoveOffline: () -> Unit,
    onAddToPlaylist: () -> Unit,
    onSetPlaybackRate: (Float) -> Unit,
) {
    val palette = LocalTMusicColors.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var userScrubPos by remember(track.id) { mutableStateOf<Float?>(null) }
    val duration = playerState.durationMs.coerceAtLeast(1L)
    val sliderPos = userScrubPos ?: playerState.positionMs.toFloat().coerceIn(0f, duration.toFloat())

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.bgElevated,
        contentColor = palette.textPrimary,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .navigationBarsPadding()
                .padding(bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ArtworkBox(
                model = artworkModel,
                contentDescription = track.album,
                size = 240.dp,
                cornerRadius = 16.dp,
            )

            Spacer(modifier = Modifier.height(20.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        color = palette.textPrimary,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${track.artist} • ${track.album}",
                        color = palette.textSecondary,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                IconButton(onClick = onToggleFavorite) {
                    Icon(
                        imageVector = if (track.isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = "Favorite",
                        tint = if (track.isFavorite) palette.accent else palette.textSecondary,
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val qualityBadge = buildString {
                    append(track.format.uppercase(Locale.US).ifBlank { "AUDIO" })
                    track.bitrateKbps?.let { append(" • ${it} kbps") }
                }
                StatusChip(label = qualityBadge)
                if (track.isDownloaded) {
                    StatusChip(label = "OFFLINE READY", highlighted = true)
                } else {
                    StatusChip(label = "STREAM")
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Slider(
                value = sliderPos,
                onValueChange = { userScrubPos = it },
                onValueChangeFinished = {
                    val target = userScrubPos?.toLong() ?: playerState.positionMs
                    userScrubPos = null
                    onSeek(target)
                },
                valueRange = 0f..duration.toFloat(),
                colors = SliderDefaults.colors(
                    thumbColor = palette.accent,
                    activeTrackColor = palette.accent,
                    inactiveTrackColor = palette.bgHover,
                ),
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = formatDurationMs(sliderPos.toLong()),
                    color = palette.textMuted,
                    fontSize = 12.sp,
                )
                Text(
                    text = formatDurationMs(playerState.durationMs),
                    color = palette.textMuted,
                    fontSize = 12.sp,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                IconButton(onClick = onToggleShuffle) {
                    Icon(
                        imageVector = Icons.Rounded.Shuffle,
                        contentDescription = "Shuffle",
                        tint = if (playerState.shuffleEnabled) palette.accent else palette.textSecondary,
                    )
                }

                IconButton(onClick = onPrevious, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = Icons.Rounded.SkipPrevious,
                        contentDescription = "Previous",
                        tint = palette.textPrimary,
                        modifier = Modifier.size(32.dp),
                    )
                }

                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(palette.accent)
                        .clickable(onClick = onTogglePlayPause),
                    contentAlignment = Alignment.Center,
                ) {
                    if (playerState.isBuffering) {
                        CircularProgressIndicator(
                            color = palette.accentContrast,
                            strokeWidth = 2.5.dp,
                            modifier = Modifier.size(26.dp),
                        )
                    } else {
                        Icon(
                            imageVector = if (playerState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            contentDescription = "Play/Pause",
                            tint = palette.accentContrast,
                            modifier = Modifier.size(34.dp),
                        )
                    }
                }

                IconButton(onClick = onNext, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = Icons.Rounded.SkipNext,
                        contentDescription = "Next",
                        tint = palette.textPrimary,
                        modifier = Modifier.size(32.dp),
                    )
                }

                IconButton(onClick = onCycleRepeat) {
                    Icon(
                        imageVector = if (playerState.repeatMode == Player.REPEAT_MODE_ONE) {
                            Icons.Rounded.RepeatOne
                        } else {
                            Icons.Rounded.Repeat
                        },
                        contentDescription = "Repeat",
                        tint = if (playerState.repeatMode == Player.REPEAT_MODE_OFF) {
                            palette.textSecondary
                        } else {
                            palette.accent
                        },
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Quick utility row: Offline Download + Add to Playlist
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(palette.bgSurface)
                        .border(1.dp, palette.borderSubtle, RoundedCornerShape(10.dp))
                        .clickable {
                            if (downloadProgress == null) {
                                if (track.isDownloaded) onRemoveOffline() else onDownloadOffline()
                            }
                        }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (downloadProgress != null) {
                            CircularProgressIndicator(
                                progress = { downloadProgress },
                                color = palette.accent,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = "${(downloadProgress * 100).toInt()}%",
                                color = palette.accent,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        } else if (track.isDownloaded) {
                            Icon(
                                imageVector = Icons.Rounded.OfflinePin,
                                contentDescription = null,
                                tint = palette.accent,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = "Remove Offline",
                                color = palette.textPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Rounded.Download,
                                contentDescription = null,
                                tint = palette.textPrimary,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = "Save Offline",
                                color = palette.textPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(palette.bgSurface)
                        .border(1.dp, palette.borderSubtle, RoundedCornerShape(10.dp))
                        .clickable(onClick = onAddToPlaylist)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Rounded.PlaylistAdd,
                            contentDescription = null,
                            tint = palette.textPrimary,
                            modifier = Modifier.size(18.dp),
                        )
                        Text(
                            text = "Add to Playlist",
                            color = palette.textPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Pitch-preserved playback speed control
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(palette.bgSurface)
                    .border(1.dp, palette.borderSubtle, RoundedCornerShape(12.dp))
                    .padding(14.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Speed,
                        contentDescription = null,
                        tint = palette.accent,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = String.format(Locale.US, "Speed %.2fx (pitch preserved)", playerState.playbackRate),
                        color = palette.textPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(0.75f, 1.0f, 1.15f, 1.25f, 1.5f, 2.0f).forEach { speed ->
                        val selected = abs(playerState.playbackRate - speed) < 0.02f
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (selected) palette.accentSoft else palette.bgElevated)
                                .border(
                                    1.dp,
                                    if (selected) palette.accent else palette.borderSubtle,
                                    RoundedCornerShape(8.dp),
                                )
                                .clickable { onSetPlaybackRate(speed) }
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            Text(
                                text = String.format(Locale.US, "%.2gx", speed),
                                color = if (selected) palette.accent else palette.textSecondary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusChip(label: String, highlighted: Boolean = false) {
    val palette = LocalTMusicColors.current
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(if (highlighted) palette.accentSoft else palette.bgSurface)
            .border(
                1.dp,
                if (highlighted) palette.accent else palette.borderSubtle,
                RoundedCornerShape(6.dp),
            )
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(
            text = label,
            color = if (highlighted) palette.accent else palette.textSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

fun formatDurationMs(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val mins = totalSec / 60L
    val secs = totalSec % 60L
    return String.format(Locale.US, "%d:%02d", mins, secs)
}
