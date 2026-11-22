# Keep kotlinx.serialization & Room generated classes intact
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keep,includedescriptorclasses class dev.trebuh.tmusicplayer.data.api.**$$serializer { *; }
-keepclassmembers class dev.trebuh.tmusicplayer.data.api.** {
    *** Companion;
}
