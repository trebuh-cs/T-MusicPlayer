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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
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
import dev.trebuh.tmusicplayer.data.api.AutoPlaylistConfigDto
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.player.AutoPlaylistEngine
import dev.trebuh.tmusicplayer.ui.components.ArtworkBox
import dev.trebuh.tmusicplayer.ui.components.formatDurationMs
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun AutoPlaylistScreen(
    tracks: List<TrackEntity>,
    config: AutoPlaylistConfigDto,
    recentPlayIds: List<String>,
    currentTrackId: String?,
    isAutoMixActive: Boolean,
    isSyncing: Boolean,
    artworkModel: (TrackEntity) -> Any?,
    onSyncNow: () -> Unit,
    onStartAutoMix: (TrackEntity?) -> Unit,
    onSaveConfig: (AutoPlaylistConfigDto) -> Unit,
    onToggleExcluded: (trackId: String, excluded: Boolean) -> Unit,
    onToggleFavorite: (trackId: String) -> Unit,
) {
    val palette = LocalTMusicColors.current
    var showExcluded by remember { mutableStateOf(false) }

    val ranked = remember(tracks, config, recentPlayIds) {
        AutoPlaylistEngine.rankTracks(tracks, config, recentPlayIds)
    }
    val excludedTracks = remember(tracks) { tracks.filter { it.autoExcluded } }
    val maxMinutes = config.maxDurationMs?.let { (it / 60_000L).toInt().coerceIn(1, 30) } ?: 8

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bgBase),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.AutoAwesome,
                            contentDescription = null,
                            tint = palette.accent,
                            modifier = Modifier.size(20.dp),
                        )
                        Text(
                            text = "Auto Playlist",
                            color = palette.textPrimary,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Text(
                        text = "${ranked.size} eligible • ${excludedTracks.size} excluded",
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
                        onClick = { onStartAutoMix(null) },
                        enabled = ranked.isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = palette.accent,
                            contentColor = palette.accentContrast,
                        ),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(modifier = Modifier.size(4.dp))
                        Text(
                            text = if (isAutoMixActive) "Next Auto" else "Play Mix",
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        }

        // Settings Card
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(palette.bgElevated)
                    .border(1.dp, palette.borderSubtle, RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // Max duration filter
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Max Song Length",
                            color = palette.textPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = if (config.maxDurationMs != null) {
                                "Limit to songs under $maxMinutes min"
                            } else {
                                "Unlimited track length"
                            },
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                        )
                    }
                    Switch(
                        checked = config.maxDurationMs != null,
                        onCheckedChange = { enabled ->
                            onSaveConfig(
                                config.copy(maxDurationMs = if (enabled) maxMinutes * 60_000L else null)
                            )
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = palette.accentContrast,
                            checkedTrackColor = palette.accent,
                        ),
                    )
                }

                if (config.maxDurationMs != null) {
                    Slider(
                        value = maxMinutes.toFloat(),
                        onValueChange = { mins ->
                            onSaveConfig(config.copy(maxDurationMs = mins.roundToInt().coerceIn(1, 30) * 60_000L))
                        },
                        valueRange = 1f..30f,
                        colors = SliderDefaults.colors(
                            thumbColor = palette.accent,
                            activeTrackColor = palette.accent,
                            inactiveTrackColor = palette.bgSurface,
                        ),
                    )
                }

                // Favorites Boost
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Favorites Weight Boost",
                            color = palette.textPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = if (config.favoriteBoostEnabled) {
                                String.format(Locale.US, "Favorited songs appear %.1fx more often", config.favoriteBoostFactor)
                            } else {
                                "Favorites treated normally"
                            },
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                        )
                    }
                    Switch(
                        checked = config.favoriteBoostEnabled,
                        onCheckedChange = { enabled ->
                            onSaveConfig(config.copy(favoriteBoostEnabled = enabled))
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = palette.accentContrast,
                            checkedTrackColor = palette.accent,
                        ),
                    )
                }

                if (config.favoriteBoostEnabled) {
                    Slider(
                        value = config.favoriteBoostFactor.coerceIn(1.5f, 10.0f),
                        onValueChange = { raw ->
                            val snapped = ((raw * 2f).roundToInt() / 2f).coerceIn(1.5f, 10.0f)
                            onSaveConfig(config.copy(favoriteBoostFactor = snapped))
                        },
                        valueRange = 1.5f..10.0f,
                        colors = SliderDefaults.colors(
                            thumbColor = palette.accent,
                            activeTrackColor = palette.accent,
                            inactiveTrackColor = palette.bgSurface,
                        ),
                    )
                }

                // 10-Song Cooldown Debuff
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "10-Song Cooldown Debuff",
                            color = palette.textPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "Prevents immediate repeats & cools down every track played anywhere in app",
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                        )
                    }
                    Switch(
                        checked = config.cooldownEnabled,
                        onCheckedChange = { enabled ->
                            onSaveConfig(config.copy(cooldownEnabled = enabled))
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = palette.accentContrast,
                            checkedTrackColor = palette.accent,
                        ),
                    )
                }
            }
        }

        if (excludedTracks.isNotEmpty()) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(palette.bgElevated)
                        .border(1.dp, palette.borderSubtle, RoundedCornerShape(10.dp))
                        .clickable { showExcluded = !showExcluded }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = if (showExcluded) {
                            "Hide Excluded Tracks (${excludedTracks.size})"
                        } else {
                            "Manage Excluded Tracks (${excludedTracks.size})"
                        },
                        color = palette.textSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Icon(
                        imageVector = Icons.Rounded.Block,
                        contentDescription = null,
                        tint = palette.textMuted,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }

            if (showExcluded) {
                items(excludedTracks, key = { "excl-${it.id}" }) { track ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(palette.bgSurface)
                            .border(1.dp, palette.borderSubtle, RoundedCornerShape(10.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = track.title,
                                color = palette.textPrimary,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = "${track.artist} • ${formatDurationMs(track.durationMs)}",
                                color = palette.textSecondary,
                                fontSize = 11.sp,
                                maxLines = 1,
                            )
                        }
                        IconButton(onClick = { onToggleExcluded(track.id, false) }) {
                            Icon(
                                imageVector = Icons.Rounded.Restore,
                                contentDescription = "Restore to Auto Playlist",
                                tint = palette.accent,
                            )
                        }
                    }
                }
            }
        }

        if (ranked.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(palette.bgElevated)
                        .border(1.dp, palette.borderSubtle, RoundedCornerShape(12.dp))
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "Listen to any song at least once (or widen Max Song Length) to populate Auto Playlist.",
                        color = palette.textSecondary,
                        fontSize = 13.sp,
                    )
                }
            }
        } else {
            items(ranked, key = { it.track.id }) { entry ->
                val track = entry.track
                val isPlayingCurrent = track.id == currentTrackId
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
                        .clickable { onStartAutoMix(track) }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    ArtworkBox(
                        model = artworkModel(track),
                        contentDescription = track.album,
                        size = 44.dp,
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
                        val pctLabel = if (entry.probabilityPct >= 10f) {
                            "${entry.probabilityPct.roundToInt()}%"
                        } else {
                            String.format(Locale.US, "%.1f%%", entry.probabilityPct)
                        }
                        val cdTag = if (entry.inCooldown) " • cooldown" else ""
                        Text(
                            text = "${track.artist} • $pctLabel$cdTag",
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = { onToggleFavorite(track.id) }, modifier = Modifier.size(34.dp)) {
                        Icon(
                            imageVector = if (track.isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                            contentDescription = "Favorite",
                            tint = if (track.isFavorite) palette.accent else palette.textMuted,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    IconButton(
                        onClick = { onToggleExcluded(track.id, true) },
                        modifier = Modifier.size(34.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Block,
                            contentDescription = "Exclude from Auto Playlist",
                            tint = palette.textMuted,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }
    }
}
