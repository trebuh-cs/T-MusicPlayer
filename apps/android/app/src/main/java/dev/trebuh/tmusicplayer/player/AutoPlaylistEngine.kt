package dev.trebuh.tmusicplayer.player

import dev.trebuh.tmusicplayer.data.api.AutoPlaylistConfigDto
import dev.trebuh.tmusicplayer.data.db.TrackEntity
import kotlin.random.Random

data class AutoMixEntry(
    val track: TrackEntity,
    val weight: Double,
    val probabilityPct: Float,
    val inCooldown: Boolean,
)

object AutoPlaylistEngine {
    fun isEligible(track: TrackEntity, config: AutoPlaylistConfigDto): Boolean {
        if (track.playCount < 1L) return false
        if (track.autoExcluded) return false
        val maxDur = config.maxDurationMs
        if (maxDur != null && maxDur > 0L && track.durationMs > maxDur) return false
        return true
    }

    fun computeWeight(
        track: TrackEntity,
        config: AutoPlaylistConfigDto,
        recentPlayIds: List<String>,
        currentTrackId: String? = null,
    ): Double {
        if (!isEligible(track, config)) return 0.0
        if (currentTrackId != null && track.id == currentTrackId) return 0.0

        val baseWeight =
            1.0 + track.manualPlayCount.coerceAtLeast(0L) * 1.2 + track.playCount.coerceAtLeast(0L) * 0.35
        val skipPenalty = 1.0 / (1.0 + track.skipCount.coerceAtLeast(0L) * 0.85)
        val favFactor = if (config.favoriteBoostEnabled && track.isFavorite) {
            config.favoriteBoostFactor.coerceIn(1.5f, 10.0f).toDouble()
        } else {
            1.0
        }

        val recentIdx = recentPlayIds.indexOf(track.id)
        val windowSize = config.cooldownTracks.coerceIn(10, 50)
        var cooldownFactor = 1.0

        if (recentIdx == 0) {
            return 0.0
        } else if (config.cooldownEnabled && recentIdx in 1..windowSize) {
            val progress = (recentIdx - 1).toDouble() / (windowSize - 1).coerceAtLeast(1).toDouble()
            cooldownFactor = 0.04 + progress * 0.65
        }

        return (baseWeight * skipPenalty * favFactor * cooldownFactor).coerceAtLeast(0.0001)
    }

    fun pickNextTrack(
        tracks: List<TrackEntity>,
        config: AutoPlaylistConfigDto,
        recentPlayIds: List<String>,
        currentTrackId: String? = null,
        random: Random = Random.Default,
    ): TrackEntity? {
        val eligible = tracks.filter { isEligible(it, config) }
        if (eligible.isEmpty()) return null
        if (eligible.size == 1) return eligible[0]

        val effectiveRecent = if (currentTrackId != null && recentPlayIds.firstOrNull() != currentTrackId) {
            listOf(currentTrackId) + recentPlayIds
        } else {
            recentPlayIds
        }

        val weighted = eligible.mapNotNull { track ->
            val w = computeWeight(track, config, effectiveRecent, currentTrackId)
            if (w > 0.0) track to w else null
        }

        if (weighted.isEmpty()) {
            val pool = eligible.filter { it.id != currentTrackId }.ifEmpty { eligible }
            return pool[random.nextInt(pool.size)]
        }

        val total = weighted.sumOf { it.second }
        var target = random.nextDouble() * total
        for ((track, weight) in weighted) {
            target -= weight
            if (target <= 0.0) return track
        }
        return weighted.last().first
    }

    fun rankTracks(
        tracks: List<TrackEntity>,
        config: AutoPlaylistConfigDto,
        recentPlayIds: List<String>,
    ): List<AutoMixEntry> {
        val eligible = tracks.filter { isEligible(it, config) }
        val windowSize = config.cooldownTracks.coerceIn(10, 50)

        val raw = eligible.map { track ->
            val recentIdx = recentPlayIds.indexOf(track.id)
            val baseWeight =
                1.0 + track.manualPlayCount.coerceAtLeast(0L) * 1.2 + track.playCount.coerceAtLeast(0L) * 0.35
            val skipPenalty = 1.0 / (1.0 + track.skipCount.coerceAtLeast(0L) * 0.85)
            val favFactor = if (config.favoriteBoostEnabled && track.isFavorite) {
                config.favoriteBoostFactor.coerceIn(1.5f, 10.0f).toDouble()
            } else {
                1.0
            }

            var cooldownFactor = 1.0
            var inCooldown = false
            if (config.cooldownEnabled && recentIdx in 0..windowSize) {
                inCooldown = true
                val progress = recentIdx.toDouble() / windowSize.coerceAtLeast(1).toDouble()
                cooldownFactor = 0.04 + progress * 0.65
            }

            Triple(
                track,
                (baseWeight * skipPenalty * favFactor * cooldownFactor).coerceAtLeast(0.01),
                inCooldown,
            )
        }

        val total = raw.sumOf { it.second }.takeIf { it > 0.0 } ?: 1.0
        return raw.map { (track, weight, inCooldown) ->
            AutoMixEntry(
                track = track,
                weight = weight,
                probabilityPct = ((weight / total) * 100.0).toFloat(),
                inCooldown = inCooldown,
            )
        }.sortedByDescending { it.weight }
    }
}
