package dev.trebuh.tmusicplayer.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trebuh.tmusicplayer.R
import dev.trebuh.tmusicplayer.data.prefs.UserSettings
import dev.trebuh.tmusicplayer.ui.theme.LocalTMusicColors
import dev.trebuh.tmusicplayer.ui.theme.ThemeDefinition
import dev.trebuh.tmusicplayer.ui.theme.ThemeRegistry
import java.text.DateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SettingsScreen(
    settings: UserSettings,
    themes: List<ThemeDefinition>,
    isSyncing: Boolean,
    offlineBytes: Long,
    onSyncNow: () -> Unit,
    onSelectTheme: (String) -> Unit,
    onSelectAudioQuality: (String) -> Unit,
    onSetPlaybackRate: (Float) -> Unit,
    onClearOfflineCache: () -> Unit,
    onSignOut: () -> Unit,
) {
    val palette = LocalTMusicColors.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "Settings",
            color = palette.textPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )

        // Server & Two-Way Sync Card
        SettingsCard {
            Text(
                text = "Home Server & Sync",
                color = palette.textPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Signed in as ${settings.username} (${settings.role}) • ${settings.serverUrl}",
                color = palette.textSecondary,
                fontSize = 12.sp,
            )
            val syncLabel = if (settings.lastSyncAt > 0L) {
                "Last synced: ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(settings.lastSyncAt * 1000L))}"
            } else {
                "Not synced yet"
            }
            Text(
                text = syncLabel,
                color = palette.textMuted,
                fontSize = 11.sp,
            )

            Button(
                onClick = onSyncNow,
                enabled = !isSyncing,
                colors = ButtonDefaults.buttonColors(
                    containerColor = palette.accent,
                    contentColor = palette.accentContrast,
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (isSyncing) {
                    CircularProgressIndicator(
                        color = palette.accentContrast,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                } else {
                    Icon(Icons.Rounded.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                }
                Spacer(modifier = Modifier.size(8.dp))
                Text(
                    text = if (isSyncing) "Syncing Library & Playlists..." else "Sync PC ↔ Phone Now",
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        // Audio Quality & Speed Card
        SettingsCard {
            Text(
                text = "Audio Quality",
                color = palette.textPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Controls streaming and new offline downloads over Cloudflare Tunnel.",
                color = palette.textSecondary,
                fontSize = 12.sp,
            )

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                QualityOptionRow(
                    title = "Best Quality (Original Lossless / Source)",
                    subtitle = "Direct bit-exact FLAC, WAV, ALAC or original MP3 stream",
                    selected = settings.audioQuality != "saver",
                    onClick = { onSelectAudioQuality("best") },
                )
                QualityOptionRow(
                    title = "Mobile Data Saver (160 kbps Opus)",
                    subtitle = "Transcoded on home server for low mobile bandwidth",
                    selected = settings.audioQuality == "saver",
                    onClick = { onSelectAudioQuality("saver") },
                )
            }

            Spacer(modifier = Modifier.height(6.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.Speed, contentDescription = null, tint = palette.accent, modifier = Modifier.size(18.dp))
                Text(
                    text = String.format(Locale.US, "Default Speed: %.2fx (pitch preserved)", settings.playbackRate),
                    color = palette.textPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            Slider(
                value = settings.playbackRate,
                onValueChange = onSetPlaybackRate,
                valueRange = 0.5f..2.0f,
                colors = SliderDefaults.colors(
                    thumbColor = palette.accent,
                    activeTrackColor = palette.accent,
                    inactiveTrackColor = palette.bgHover,
                ),
            )
        }

        // Matte Theme Picker (includes TPX Matte + logo)
        SettingsCard {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.Palette, contentDescription = null, tint = palette.accent, modifier = Modifier.size(18.dp))
                Text(
                    text = "Matte Themes",
                    color = palette.textPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                themes.forEach { theme ->
                    val selected = theme.id == settings.themeId
                    val accentColor = Color(ThemeRegistry.parseCssColorToArgb(theme.colors.accent))
                    val bgPreview = Color(ThemeRegistry.parseCssColorToArgb(theme.colors.bgBase))

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (selected) palette.accentSoft else palette.bgSurface)
                            .border(
                                1.dp,
                                if (selected) palette.accent else palette.borderSubtle,
                                RoundedCornerShape(10.dp),
                            )
                            .clickable { onSelectTheme(theme.id) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(bgPreview)
                                .border(2.dp, accentColor, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (theme.id == "tpx") {
                                Image(
                                    painter = painterResource(id = R.drawable.ic_tpx_logo),
                                    contentDescription = "TPX",
                                    modifier = Modifier.size(20.dp),
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(12.dp)
                                        .clip(CircleShape)
                                        .background(accentColor),
                                )
                            }
                        }

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = theme.name,
                                color = palette.textPrimary,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = theme.description,
                                color = palette.textSecondary,
                                fontSize = 11.sp,
                            )
                        }

                        if (selected) {
                            Icon(
                                imageVector = Icons.Rounded.Check,
                                contentDescription = "Selected",
                                tint = palette.accent,
                            )
                        }
                    }
                }
            }
        }

        // Offline Storage & Account Sign Out
        SettingsCard {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.Storage, contentDescription = null, tint = palette.accent, modifier = Modifier.size(18.dp))
                Text(
                    text = "Offline Storage",
                    color = palette.textPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                text = "Cached offline audio & covers: ${formatBytes(offlineBytes)}",
                color = palette.textSecondary,
                fontSize = 12.sp,
            )

            OutlinedButton(
                onClick = onClearOfflineCache,
                enabled = offlineBytes > 0L,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Clear Offline Audio Files", color = palette.textPrimary)
            }

            OutlinedButton(
                onClick = onSignOut,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.Logout,
                    contentDescription = null,
                    tint = palette.textSecondary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.size(8.dp))
                Text("Sign Out", color = palette.textPrimary)
            }
        }

        Spacer(modifier = Modifier.height(12.dp))
    }
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    val palette = LocalTMusicColors.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(palette.bgElevated)
            .border(1.dp, palette.borderSubtle, RoundedCornerShape(14.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        content()
    }
}

@Composable
private fun QualityOptionRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val palette = LocalTMusicColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) palette.accentSoft else palette.bgSurface)
            .border(
                1.dp,
                if (selected) palette.accent else palette.borderSubtle,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = palette.textPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = subtitle,
                color = palette.textSecondary,
                fontSize = 11.sp,
            )
        }
        if (selected) {
            Icon(Icons.Rounded.Check, contentDescription = null, tint = palette.accent)
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0L) return "0 MB"
    val mb = bytes / (1024.0 * 1024.0)
    return if (mb >= 1024.0) {
        String.format(Locale.US, "%.2f GB", mb / 1024.0)
    } else {
        String.format(Locale.US, "%.1f MB", mb)
    }
}
