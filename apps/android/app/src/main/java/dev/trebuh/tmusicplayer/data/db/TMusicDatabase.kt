package dev.trebuh.tmusicplayer.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        TrackEntity::class,
        PlaylistEntity::class,
        PlaylistTrackCrossRef::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class TMusicDatabase : RoomDatabase() {
    abstract fun musicDao(): MusicDao

    companion object {
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tracks ADD COLUMN editSpeed REAL NOT NULL DEFAULT 1.0")
                db.execSQL("ALTER TABLE tracks ADD COLUMN editGainDb REAL NOT NULL DEFAULT 0.0")
                db.execSQL("ALTER TABLE tracks ADD COLUMN trimStartMs INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE tracks ADD COLUMN trimEndMs INTEGER")
                db.execSQL("ALTER TABLE tracks ADD COLUMN editUpdatedAt INTEGER NOT NULL DEFAULT 0")
            }
        }

        @Volatile
        private var instance: TMusicDatabase? = null

        fun getInstance(context: Context): TMusicDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    TMusicDatabase::class.java,
                    "t_music_android.db",
                )
                    .addMigrations(MIGRATION_1_2)
                    .build()
                    .also { instance = it }
            }
        }
    }
}
