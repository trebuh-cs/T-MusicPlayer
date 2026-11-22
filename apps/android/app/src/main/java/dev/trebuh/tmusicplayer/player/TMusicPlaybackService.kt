package dev.trebuh.tmusicplayer.player

import android.app.PendingIntent
import android.content.Intent
import android.media.audiofx.LoudnessEnhancer
import android.os.Bundle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dev.trebuh.tmusicplayer.MainActivity
import kotlin.math.pow
import kotlin.math.roundToInt

class TMusicPlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var loudnessEnhancer: LoudnessEnhancer? = null
    private var attachedAudioSessionId: Int = C.AUDIO_SESSION_ID_UNSET

    override fun onCreate() {
        super.onCreate()
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        val launchIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val callback = object : MediaSession.Callback {
            override fun onConnect(
                session: MediaSession,
                controller: MediaSession.ControllerInfo,
            ): MediaSession.ConnectionResult {
                val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS
                    .buildUpon()
                    .add(SessionCommand(ACTION_SET_TRACK_GAIN, Bundle.EMPTY))
                    .build()
                return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                    .setAvailableSessionCommands(commands)
                    .build()
            }

            override fun onCustomCommand(
                session: MediaSession,
                controller: MediaSession.ControllerInfo,
                customCommand: SessionCommand,
                args: Bundle,
            ): ListenableFuture<SessionResult> {
                if (customCommand.customAction == ACTION_SET_TRACK_GAIN) {
                    val gainDb = args.getFloat(EXTRA_GAIN_DB, 0f).coerceIn(-18f, 12f)
                    applyTrackGain(session.player as? ExoPlayer, gainDb)
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                return super.onCustomCommand(session, controller, customCommand, args)
            }
        }

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(pendingIntent)
            .setCallback(callback)
            .build()
    }

    private fun applyTrackGain(exoPlayer: ExoPlayer?, gainDb: Float) {
        val player = exoPlayer ?: return
        if (gainDb <= 0.05f) {
            val linear = 10.0.pow(gainDb.toDouble() / 20.0).toFloat().coerceIn(0.05f, 1.0f)
            player.volume = linear
            runCatching { loudnessEnhancer?.enabled = false }
            return
        }

        player.volume = 1.0f
        val audioSessionId = player.audioSessionId
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET || audioSessionId == 0) return

        runCatching {
            if (loudnessEnhancer == null || attachedAudioSessionId != audioSessionId) {
                loudnessEnhancer?.release()
                loudnessEnhancer = LoudnessEnhancer(audioSessionId)
                attachedAudioSessionId = audioSessionId
            }
            val targetMb = (gainDb * 100f).roundToInt().coerceIn(0, 1200)
            loudnessEnhancer?.setTargetGain(targetMb)
            loudnessEnhancer?.enabled = true
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        runCatching { loudnessEnhancer?.release() }
        loudnessEnhancer = null
        attachedAudioSessionId = C.AUDIO_SESSION_ID_UNSET
        mediaSession?.run {
            player.release()
            release()
            mediaSession = null
        }
        super.onDestroy()
    }

    companion object {
        const val ACTION_SET_TRACK_GAIN = "dev.trebuh.tmusicplayer.SET_TRACK_GAIN_DB"
        const val EXTRA_GAIN_DB = "gain_db"
    }
}
