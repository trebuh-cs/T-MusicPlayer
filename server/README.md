# T - MusicPlayer Home Server (`t-music-server`)

Lightweight, multi-user Rust media & sync server powered by **Axum**, **SQLite**, **Argon2id**, and **JWT**, designed to run in Docker alongside your existing services behind a **Cloudflare Tunnel**.

## Features
- **Multi-User Accounts**: Per-user libraries/playlists/favorites, optional `INVITE_CODE` for friends, and `is_shared` collaborative playlists.
- **Content-Hash Deduplication**: Uploads are SHA-256 deduplicated (`/api/v1/tracks/check-hashes`), so identical songs aren't stored twice.
- **Best Audio Quality**: Direct HTTP `Range` (`206 Partial Content`) original-quality streaming (FLAC/MP3/Opus/WAV/M4A) + offline download support (`?download=1`), plus optional `?quality=saver` 160kbps Opus transcoding via FFmpeg.
- **Two-Way Delta Sync**: Last-write-wins sync for playlists (including track ordering & deletion tombstones) and favorites across Windows PC and Pixel Android.

## Quick Start on Your Linux Home Server

1. Clone the repo and create your `.env` from the example template:
   ```bash
   git clone https://github.com/trebuh-cs/T-MusicPlayer.git
   cd T-MusicPlayer
   cp server/.env.example server/.env
   # Edit server/.env to set ADMIN_PASSWORD and an optional INVITE_CODE for friends
   ```
2. Start the container:
   ```bash
   docker compose up -d --build
   ```
3. Point your **Cloudflare Tunnel** public hostname (e.g. `https://music.yourdomain.com`) to:
   ```text
   http://localhost:8484
   ```
   *(Verify health: `curl http://localhost:8484/api/v1/health`.)*

## Self-Hosted Client Downloads (`/downloads`)

The download portal runs on the **exact same domain and Cloudflare Tunnel** (`/` and `/downloads`)—no second domain is needed.

- **Option A — Upload from Desktop App (Admin):** Sign into the desktop app with your admin account and open **Home Server Sync -> Self-Hosted Download Page** to upload your `.apk` or `.exe` straight to the server.
- **Option B — Copy directly into `./server-downloads/`:**
  ```bash
  # Android APK (served at /downloads/android.apk)
  cp T-MusicPlayer.apk ./server-downloads/T-MusicPlayer.apk
  # Optional Windows EXE (served at /downloads/windows.exe)
  cp t-music-desktop.exe ./server-downloads/T-MusicPlayer.exe
  ```
  *(Note: When publishing from the desktop UI over Cloudflare Tunnel, free-tier Cloudflare proxy enforces a ~100 MB per-request cap, while music uploads stream in 8 MB chunks so multi-hour audio files of any size upload cleanly.)*
