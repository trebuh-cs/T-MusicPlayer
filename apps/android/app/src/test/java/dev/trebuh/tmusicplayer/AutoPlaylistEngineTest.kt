package dev.trebuh.tmusicplayer

import dev.trebuh.tmusicplayer.data.api.AutoPlaylistConfigDto
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import dev.trebuh.tmusicplayer.player.AutoPlaylistEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class AutoPlaylistEngineTest {
    private fun track(
        id: String,
        playCount: Long = 1L,
        manualPlayCount: Long = 0L,
        skipCount: Long = 0L,
        autoExcluded: Boolean = false,
        isFavorite: Boolean = false,
        durationMs: Long = 180_000L,
    ) = TrackEntity(
        id = id,
        contentHash = "hash-$id",
        title = "Track $id",
        artist = "Artist",
        album = "Album",
        durationMs = durationMs,
        format = "mp3",
        playCount = playCount,
        manualPlayCount = manualPlayCount,
        skipCount = skipCount,
        autoExcluded = autoExcluded,
        isFavorite = isFavorite,
    )

    @Test
    fun filtersUnplayedExcludedAndOverMaxDuration() {
        val cfg = AutoPlaylistConfigDto(maxDurationMs = 240_000L)
        val unplayed = track("unplayed", playCount = 0L)
        val excluded = track("excluded", playCount = 5L, autoExcluded = true)
        val tooLong = track("tooLong", playCount = 5L, durationMs = 600_000L)
        val valid = track("valid", playCount = 1L, durationMs = 200_000L)

        assertFalse(AutoPlaylistEngine.isEligible(unplayed, cfg))
        assertFalse(AutoPlaylistEngine.isEligible(excluded, cfg))
        assertFalse(AutoPlaylistEngine.isEligible(tooLong, cfg))
        assertTrue(AutoPlaylistEngine.isEligible(valid, cfg))

        val picked = AutoPlaylistEngine.pickNextTrack(listOf(unplayed, excluded, tooLong), cfg, emptyList())
        assertNull(picked)
    }

    @Test
    fun neverRepeatsImmediatelyWhenTwoOrMoreEligibleExist() {
        val cfg = AutoPlaylistConfigDto(cooldownEnabled = false)
        val a = track("a", playCount = 10L)
        val b = track("b", playCount = 10L)

        repeat(25) {
            val next = AutoPlaylistEngine.pickNextTrack(
                tracks = listOf(a, b),
                config = cfg,
                recentPlayIds = listOf("a"),
                currentTrackId = "a",
                random = Random(it),
            )
            assertNotEquals("a", next?.id)
        }
    }

    @Test
    fun weightsManualPlaysFavoritesSkipsAndTenSongCooldown() {
        val baseCfg = AutoPlaylistConfigDto(
            favoriteBoostEnabled = true,
            favoriteBoostFactor = 5.0f,
            cooldownEnabled = true,
            cooldownTracks = 10,
        )
        val plain = track("plain", playCount = 2L)
        val favored = track("fav", playCount = 2L, isFavorite = true)
        val skippedLots = track("skip", playCount = 2L, skipCount = 10L)
        val targeted = track("manual", playCount = 5L, manualPlayCount = 5L)

        val wPlain = AutoPlaylistEngine.computeWeight(plain, baseCfg, emptyList())
        val wFav = AutoPlaylistEngine.computeWeight(favored, baseCfg, emptyList())
        val wSkip = AutoPlaylistEngine.computeWeight(skippedLots, baseCfg, emptyList())
        val wManual = AutoPlaylistEngine.computeWeight(targeted, baseCfg, emptyList())

        assertEquals(wPlain * 5.0, wFav, 0.001)
        assertTrue(wManual > wPlain)
        assertTrue(wSkip < wPlain)

        // Played 2 songs ago gets heavy debuff when cooldown enabled vs disabled.
        val recent = listOf("other0", "other1", "plain")
        val wDebuffed = AutoPlaylistEngine.computeWeight(plain, baseCfg, recent)
        val wNoCooldown = AutoPlaylistEngine.computeWeight(
            plain,
            baseCfg.copy(cooldownEnabled = false),
            recent,
        )
        assertTrue(wDebuffed < wNoCooldown * 0.25)
    }
}
