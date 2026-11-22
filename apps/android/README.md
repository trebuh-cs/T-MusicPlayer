# T - MusicPlayer Android (`apps/android`)

Native **Kotlin**, **Jetpack Compose**, and **Media3 (ExoPlayer + MediaSession)** companion app tuned for **Google Pixel** devices.

## Features
- **Cloudflare Tunnel & LAN Support**: Connect securely to `https://music.yourdomain.com` or a local LAN endpoint.
- **Multi-User Auth**: Sign in or register with an optional server invite code.
- **Best Audio Quality + Data Saver**: Streams lossless FLAC/WAV or original files directly via HTTP `Range`, with an optional 160 kbps Opus data-saver toggle for mobile connections.
- **Full Offline Downloads**: Download individual tracks or entire playlists for offline listening (tracks, cover art, and library index persist in local Room SQLite storage).
- **Two-Way Sync (PC ↔ Phone)**: Create playlists, add/remove songs, or toggle favorites on your phone and hit **Sync** to update your home server and Windows PC—and vice versa.
- **Matte Themes & Pitch-Preserved Speed**: Includes all 6 matte themes from `shared/themes/themes.json` (including **TPX Matte** with the TPX emblem) and `0.50x–2.00x` speed playback without pitch distortion.
- **Pixel System Integration**: Foreground `MediaSessionService` notification, lockscreen controls, headphone/Bluetooth auto-pause, and Android 13+ notification permission handling.

## Build & Install

```powershell
# From apps/android/ (with JDK 17 and Android SDK 35 configured)
.\gradlew.bat testDebugUnitTest assembleDebug
```

Install the generated APK on your Pixel 7 via USB debugging:
```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```
