package dev.trebuh.tmusicplayer.data.prefs

import android.content.Context
import android.content.SharedPreferences
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
) {
    val isLoggedIn: Boolean
        get() = serverUrl.isNotBlank() && authToken.isNotBlank()
}

class AppPreferences(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(readSettings())
    val settings: StateFlow<UserSettings> = _settings.asStateFlow()

    private fun readSettings(): UserSettings = UserSettings(
        serverUrl = prefs.getString(KEY_SERVER_URL, "") ?: "",
        authToken = prefs.getString(KEY_AUTH_TOKEN, "") ?: "",
        userId = prefs.getString(KEY_USER_ID, "") ?: "",
        username = prefs.getString(KEY_USERNAME, "") ?: "",
        role = prefs.getString(KEY_ROLE, "") ?: "",
        themeId = prefs.getString(KEY_THEME_ID, "tpx") ?: "tpx",
        audioQuality = prefs.getString(KEY_AUDIO_QUALITY, "best") ?: "best",
        playbackRate = prefs.getFloat(KEY_PLAYBACK_RATE, 1.0f).coerceIn(0.5f, 2.0f),
        lastSyncAt = prefs.getLong(KEY_LAST_SYNC_AT, 0L),
    )

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
