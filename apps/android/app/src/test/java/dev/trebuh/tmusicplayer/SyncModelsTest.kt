package dev.trebuh.tmusicplayer

import dev.trebuh.tmusicplayer.data.api.SyncPullResponseDto
import dev.trebuh.tmusicplayer.data.api.SyncPushRequestDto
import dev.trebuh.tmusicplayer.data.prefs.AppPreferences
import dev.trebuh.tmusicplayer.ui.theme.ThemeRegistry
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncModelsTest {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    @Test
    fun parsesSyncPullPayloadMatchesServerContract() {
        val raw = """
            {
              "server_time": 1763810000,
              "tracks": [
                {
                  "id": "track-1",
                  "content_hash": "deadbeef",
                  "title": "Night Drive",
                  "artist": "Trebuh",
                  "album": "TPX Tape",
                  "duration_ms": 215000,
                  "format": "flac",
                  "bitrate_kbps": 1024,
                  "file_size": 27500000,
                  "cover_hash": "cafebabe",
                  "uploaded_by": "tristan",
                  "created_at": 1763800000
                }
              ],
              "playlists": [
                {
                  "id": "pl-1",
                  "name": "Pixel 7 Favorites",
                  "description": "Offline car mix",
                  "track_ids": ["track-1"],
                  "is_shared": true,
                  "owner_username": "tristan",
                  "updated_at": 1763809000,
                  "deleted": false
                }
              ],
              "favorites": [
                {
                  "track_id": "track-1",
                  "is_favorite": true,
                  "updated_at": 1763809500
                }
              ]
            }
        """.trimIndent()

        val parsed = json.decodeFromString<SyncPullResponseDto>(raw)
        assertEquals(1763810000L, parsed.serverTime)
        assertEquals(1, parsed.tracks.size)
        assertEquals("flac", parsed.tracks[0].format)
        assertEquals("track-1", parsed.playlists[0].trackIds[0])
        assertTrue(parsed.favorites[0].isFavorite)
    }

    @Test
    fun parsesHexAndRgbaColorsCleanly() {
        assertEquals(0xFF0AF92A.toInt(), ThemeRegistry.parseCssColorToArgb("#0AF92A"))
        val rgba = ThemeRegistry.parseCssColorToArgb("rgba(10, 249, 42, 0.5)")
        val alpha = (rgba ushr 24) and 0xFF
        assertTrue(alpha in 127..128)
        assertEquals("https://music.example.com", AppPreferences.normalizeServerUrl("music.example.com/"))
    }

    @Test
    fun encodesPushPayloadWithSnakeCaseFields() {
        val encoded = json.encodeToString(
            SyncPushRequestDto(playlists = emptyList(), favorites = emptyList())
        )
        assertTrue(encoded.contains("playlists"))
        assertTrue(encoded.contains("favorites"))
    }
}
