package dev.trebuh.tmusicplayer.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.OfflinePin
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.player.PlayerUiState
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors

@Composable
fun MiniPlayerBar(
    playerState: PlayerUiState,
    artworkModel: (TrackEntity) -> Any?,
    onTogglePlayPause: () -> Unit,
    onNext: () -> Unit,
    onOpenNowPlaying: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val track = playerState.currentTrack ?: return
    val palette = LocalTMusicColors.current
    val progress = if (playerState.durationMs > 0L) {
        (playerState.positionMs.toFloat() / playerState.durationMs.toFloat()).coerceIn(0f, 1f)
    } else {
        0f
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(palette.bgElevated)
            .border(1.dp, palette.borderSubtle)
            .clickable(onClick = onOpenNowPlaying),
    ) {
        // Matte hairline progress indicator along the top edge.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(palette.bgHover),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(progress)
                    .height(2.dp)
                    .background(palette.accent),
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ArtworkBox(
                model = artworkModel(track),
                contentDescription = track.album,
                size = 44.dp,
                cornerRadius = 8.dp,
            )

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = track.title,
                        color = palette.textPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (track.isDownloaded) {
                        Icon(
                            imageVector = Icons.Rounded.OfflinePin,
                            contentDescription = "Available offline",
                            tint = palette.accent,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
                Text(
                    text = track.artist,
                    color = palette.textSecondary,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            IconButton(onClick = onTogglePlayPause) {
                if (playerState.isBuffering) {
                    CircularProgressIndicator(
                        color = palette.accent,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(20.dp),
                    )
                } else {
                    Icon(
                        imageVector = if (playerState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playerState.isPlaying) "Pause" else "Play",
                        tint = palette.accent,
                    )
                }
            }

            IconButton(onClick = onNext) {
                Icon(
                    imageVector = Icons.Rounded.SkipNext,
                    contentDescription = "Next",
                    tint = palette.textPrimary,
                )
            }
        }
    }
}
