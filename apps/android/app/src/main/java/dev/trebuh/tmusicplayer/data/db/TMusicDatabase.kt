package dev.trebuh.tmusicplayer.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        TrackEntity::class,
        PlaylistEntity::class,
        PlaylistTrackCrossRef::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class TMusicDatabase : RoomDatabase() {
    abstract fun musicDao(): MusicDao

    companion object {
        @Volatile
        private var instance: TMusicDatabase? = null

        fun getInstance(context: Context): TMusicDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    TMusicDatabase::class.java,
                    "t_music_android.db",
                ).build().also { instance = it }
            }
        }
    }
}
