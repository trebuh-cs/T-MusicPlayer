package dev.trebuh.tmusicplayer.data.prefs

import android.content.Context
import android.content.SharedPreferences
import dev.trebuh.tmusicplayer.data.api.AutoPlaylistConfigDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class UserSettings(
    val serverUrl: String = "",
    val authToken: String = "",
    val userId: String = "",
    val username: String = "",
    val role: String = "",
    val themeId: String = "tpx",
    val audioQuality: String = "best",
    val playbackRate: Float = 1.0f,
    val lastSyncAt: Long = 0L,
    val autoMaxDurationMs: Long? = null,
    val autoFavBoostEnabled: Boolean = true,
    val autoFavBoostFactor: Float = 3.0f,
    val autoCooldownEnabled: Boolean = true,
    val autoCooldownTracks: Int = 10,
    val autoConfigUpdatedAt: Long = 0L,
    val recentPlayIds: List<String> = emptyList(),
) {
    val isLoggedIn: Boolean
        get() = serverUrl.isNotBlank() && authToken.isNotBlank()

    fun toAutoPlaylistConfigDto(): AutoPlaylistConfigDto = AutoPlaylistConfigDto(
        maxDurationMs = autoMaxDurationMs,
        favoriteBoostEnabled = autoFavBoostEnabled,
        favoriteBoostFactor = autoFavBoostFactor,
        cooldownEnabled = autoCooldownEnabled,
        cooldownTracks = autoCooldownTracks,
        updatedAt = autoConfigUpdatedAt,
    )
}

class AppPreferences(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(readSettings())
    val settings: StateFlow<UserSettings> = _settings.asStateFlow()

    private fun readSettings(): UserSettings {
        val rawMaxDur = prefs.getLong(KEY_AUTO_MAX_DUR_MS, 0L)
        val rawRecent = prefs.getString(KEY_RECENT_PLAY_IDS, "") ?: ""
        return UserSettings(
            serverUrl = prefs.getString(KEY_SERVER_URL, "") ?: "",
            authToken = prefs.getString(KEY_AUTH_TOKEN, "") ?: "",
            userId = prefs.getString(KEY_USER_ID, "") ?: "",
            username = prefs.getString(KEY_USERNAME, "") ?: "",
            role = prefs.getString(KEY_ROLE, "") ?: "",
            themeId = prefs.getString(KEY_THEME_ID, "tpx") ?: "tpx",
            audioQuality = prefs.getString(KEY_AUDIO_QUALITY, "best") ?: "best",
            playbackRate = prefs.getFloat(KEY_PLAYBACK_RATE, 1.0f).coerceIn(0.5f, 2.0f),
            lastSyncAt = prefs.getLong(KEY_LAST_SYNC_AT, 0L),
            autoMaxDurationMs = rawMaxDur.takeIf { it > 0L },
            autoFavBoostEnabled = prefs.getBoolean(KEY_AUTO_FAV_BOOST_ENABLED, true),
            autoFavBoostFactor = prefs.getFloat(KEY_AUTO_FAV_BOOST_FACTOR, 3.0f).coerceIn(1.5f, 10.0f),
            autoCooldownEnabled = prefs.getBoolean(KEY_AUTO_COOLDOWN_ENABLED, true),
            autoCooldownTracks = prefs.getInt(KEY_AUTO_COOLDOWN_TRACKS, 10).coerceIn(10, 50),
            autoConfigUpdatedAt = prefs.getLong(KEY_AUTO_CONFIG_UPDATED_AT, 0L),
            recentPlayIds = rawRecent.split(',').map { it.trim() }.filter { it.isNotEmpty() }.take(25),
        )
    }

    fun saveSession(
        serverUrl: String,
        token: String,
        userId: String,
        username: String,
        role: String,
    ) {
        val normalizedUrl = normalizeServerUrl(serverUrl)
        prefs.edit()
            .putString(KEY_SERVER_URL, normalizedUrl)
            .putString(KEY_AUTH_TOKEN, token)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_USERNAME, username)
            .putString(KEY_ROLE, role)
            .apply()
        _settings.value = readSettings()
    }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_AUTH_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USERNAME)
            .remove(KEY_ROLE)
            .putLong(KEY_LAST_SYNC_AT, 0L)
            .apply()
        _settings.value = readSettings()
    }

    fun setThemeId(themeId: String) {
        prefs.edit().putString(KEY_THEME_ID, themeId).apply()
        _settings.value = readSettings()
    }

    fun setAudioQuality(quality: String) {
        val clean = if (quality == "saver") "saver" else "best"
        prefs.edit().putString(KEY_AUDIO_QUALITY, clean).apply()
        _settings.value = readSettings()
    }

    fun setPlaybackRate(rate: Float) {
        val clamped = rate.coerceIn(0.5f, 2.0f)
        prefs.edit().putFloat(KEY_PLAYBACK_RATE, clamped).apply()
        _settings.value = readSettings()
    }

    fun setLastSyncAt(epochSeconds: Long) {
        prefs.edit().putLong(KEY_LAST_SYNC_AT, epochSeconds).apply()
        _settings.value = readSettings()
    }

    fun setAutoPlaylistConfig(config: AutoPlaylistConfigDto) {
        prefs.edit()
            .putLong(KEY_AUTO_MAX_DUR_MS, config.maxDurationMs ?: 0L)
            .putBoolean(KEY_AUTO_FAV_BOOST_ENABLED, config.favoriteBoostEnabled)
            .putFloat(KEY_AUTO_FAV_BOOST_FACTOR, config.favoriteBoostFactor.coerceIn(1.5f, 10.0f))
            .putBoolean(KEY_AUTO_COOLDOWN_ENABLED, config.cooldownEnabled)
            .putInt(KEY_AUTO_COOLDOWN_TRACKS, config.cooldownTracks.coerceIn(10, 50))
            .putLong(KEY_AUTO_CONFIG_UPDATED_AT, config.updatedAt)
            .apply()
        _settings.value = readSettings()
    }

    fun recordRecentPlayId(trackId: String) {
        val current = _settings.value.recentPlayIds
        val updated = (listOf(trackId) + current.filter { it != trackId }).take(25)
        prefs.edit().putString(KEY_RECENT_PLAY_IDS, updated.joinToString(",")).apply()
        _settings.value = readSettings()
    }

    companion object {
        private const val PREFS_NAME = "t_music_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USERNAME = "username"
        private const val KEY_ROLE = "role"
        private const val KEY_THEME_ID = "theme_id"
        private const val KEY_AUDIO_QUALITY = "audio_quality"
        private const val KEY_PLAYBACK_RATE = "playback_rate"
        private const val KEY_LAST_SYNC_AT = "last_sync_at"
        private const val KEY_AUTO_MAX_DUR_MS = "auto_max_dur_ms"
        private const val KEY_AUTO_FAV_BOOST_ENABLED = "auto_fav_boost_enabled"
        private const val KEY_AUTO_FAV_BOOST_FACTOR = "auto_fav_boost_factor"
        private const val KEY_AUTO_COOLDOWN_ENABLED = "auto_cooldown_enabled"
        private const val KEY_AUTO_COOLDOWN_TRACKS = "auto_cooldown_tracks"
        private const val KEY_AUTO_CONFIG_UPDATED_AT = "auto_config_updated_at"
        private const val KEY_RECENT_PLAY_IDS = "recent_play_ids"

        fun normalizeServerUrl(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            if (trimmed.isEmpty()) return ""
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "https://$trimmed"
            }
        }
    }
}
