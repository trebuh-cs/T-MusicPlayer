//! Native Windows Now Playing detector via WinRT GlobalSystemMediaTransportControls (GSMTC).
//! Automatically detects the currently playing track, artist, album, app name (Spotify, Chrome/YouTube,
//! Edge, Firefox, VLC, T - MusicPlayer, Apple Music, etc.), and album cover thumbnail with zero API keys.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct NowPlayingMedia {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub source_app: String,
    pub is_playing: bool,
    pub thumbnail_data_url: Option<String>,
}

pub struct MediaTracker {
    current: Arc<Mutex<Option<NowPlayingMedia>>>,
    running: Arc<AtomicBool>,
}

impl MediaTracker {
    pub fn start() -> Self {
        let current = Arc::new(Mutex::new(None));
        let running = Arc::new(AtomicBool::new(true));

        #[cfg(windows)]
        {
            let cur = Arc::clone(&current);
            let run = Arc::clone(&running);
            let _ = thread::Builder::new()
                .name("gsmtc-now-playing".to_string())
                .spawn(move || {
                    win_gsmtc::tracker_loop(cur, run);
                });
        }

        Self { current, running }
    }

    pub fn get_current(&self) -> Option<NowPlayingMedia> {
        self.current.lock().ok().and_then(|g| g.clone())
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

pub fn prettify_source_app(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("spotify") {
        return "Spotify".to_string();
    }
    if lower.contains("t-music") || lower.contains("tmusic") {
        return "T - MusicPlayer".to_string();
    }
    if lower.contains("chrome") {
        return "Chrome".to_string();
    }
    if lower.contains("msedge") || lower.contains("edge") {
        return "Edge".to_string();
    }
    if lower.contains("firefox") {
        return "Firefox".to_string();
    }
    if lower.contains("brave") {
        return "Brave".to_string();
    }
    if lower.contains("opera") {
        return "Opera".to_string();
    }
    if lower.contains("vlc") {
        return "VLC".to_string();
    }
    if lower.contains("applemusic") || lower.contains("itunes") {
        return "Apple Music".to_string();
    }
    if lower.contains("tidal") {
        return "TIDAL".to_string();
    }
    if lower.contains("foobar") {
        return "foobar2000".to_string();
    }
    let trimmed = raw
        .rsplit(['\\', '/', '!'])
        .next()
        .unwrap_or(raw)
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE");
    if trimmed.is_empty() {
        "Media".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(windows)]
mod win_gsmtc {
    use super::*;
    use base64::Engine as _;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    fn read_thumbnail_data_url(thumb_ref: &IRandomAccessStreamReference) -> Option<String> {
        let stream = thumb_ref.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 3 * 1024 * 1024 {
            return None;
        }
        let content_type = stream
            .ContentType()
            .ok()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "image/png".to_string());
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()?;
        if loaded == 0 {
            return None;
        }
        let mut buf = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
        Some(format!("data:{content_type};base64,{b64}"))
    }

    fn pick_best_session(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
    ) -> Option<GlobalSystemMediaTransportControlsSession> {
        // Prefer an actively playing session (especially Spotify if playing), else fall back to current.
        if let Ok(sessions) = manager.GetSessions() {
            let count = sessions.Size().unwrap_or(0);
            let mut playing_fallback: Option<GlobalSystemMediaTransportControlsSession> = None;
            for i in 0..count {
                let Ok(sess) = sessions.GetAt(i) else {
                    continue;
                };
                let is_playing = sess
                    .GetPlaybackInfo()
                    .ok()
                    .and_then(|p| p.PlaybackStatus().ok())
                    .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                    .unwrap_or(false);
                if is_playing {
                    let app_id = sess
                        .SourceAppUserModelId()
                        .ok()
                        .map(|s| s.to_string().to_ascii_lowercase())
                        .unwrap_or_default();
                    if app_id.contains("spotify") {
                        return Some(sess);
                    }
                    if playing_fallback.is_none() {
                        playing_fallback = Some(sess);
                    }
                }
            }
            if playing_fallback.is_some() {
                return playing_fallback;
            }
        }
        manager.GetCurrentSession().ok()
    }

    pub fn tracker_loop(
        current: Arc<Mutex<Option<NowPlayingMedia>>>,
        running: Arc<AtomicBool>,
    ) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let mut cached_key = String::new();
        let mut cached_thumb: Option<String> = None;

        while running.load(Ordering::Relaxed) {
            let next_media = (|| -> Option<NowPlayingMedia> {
                let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                    .ok()?
                    .get()
                    .ok()?;
                let session = pick_best_session(&manager)?;
                let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
                let title = props.Title().ok().map(|s| s.to_string()).unwrap_or_default();
                let artist = props.Artist().ok().map(|s| s.to_string()).unwrap_or_default();
                let album = props
                    .AlbumTitle()
                    .ok()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                let raw_app = session
                    .SourceAppUserModelId()
                    .ok()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                let is_playing = session
                    .GetPlaybackInfo()
                    .ok()
                    .and_then(|p| p.PlaybackStatus().ok())
                    .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                    .unwrap_or(false);

                if title.trim().is_empty() && artist.trim().is_empty() {
                    return None;
                }

                let key = format!("{raw_app}|{title}|{artist}|{album}");
                if key != cached_key {
                    cached_key = key;
                    cached_thumb = props
                        .Thumbnail()
                        .ok()
                        .and_then(|t| read_thumbnail_data_url(&t));
                }

                Some(NowPlayingMedia {
                    title: title.trim().to_string(),
                    artist: artist.trim().to_string(),
                    album: album.trim().to_string(),
                    source_app: prettify_source_app(&raw_app),
                    is_playing,
                    thumbnail_data_url: cached_thumb.clone(),
                })
            })();

            if let Ok(mut guard) = current.lock() {
                if *guard != next_media {
                    *guard = next_media;
                }
            }

            thread::sleep(Duration::from_millis(800));
        }

        unsafe {
            CoUninitialize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prettifies_common_media_source_names() {
        assert_eq!(prettify_source_app("Spotify.exe"), "Spotify");
        assert_eq!(
            prettify_source_app("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "Spotify"
        );
        assert_eq!(prettify_source_app("chrome.exe"), "Chrome");
        assert_eq!(prettify_source_app("t-music-desktop.exe"), "T - MusicPlayer");
    }
}
