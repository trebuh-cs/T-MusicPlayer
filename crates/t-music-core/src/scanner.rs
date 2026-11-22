//! Audio file discovery and tag/artwork extraction powered by `lofty`.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use lofty::config::ParseOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::models::ScannedTrack;
use crate::CoreError;

/// Supported audio file extensions (lowercase, without leading dot).
pub const SUPPORTED_AUDIO_EXTENSIONS: &[&str] =
    &["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "webm"];

/// Extracted embedded album cover payload: `(hash, mime_type, bytes)`.
pub type ExtractedCover = (String, String, Vec<u8>);

/// Returns true if the given path points to a supported audio file extension.
pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Recursively walks `root` and collects all supported audio file paths.
pub fn scan_directory(root: &Path) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }

    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_supported_audio_file(entry.path()))
        .map(|entry| entry.into_path())
        .collect()
}

/// Extracts metadata tags, audio properties, and optional SHA-256 deduplicated cover artwork.
pub fn extract_track_metadata(
    path: &Path,
) -> Result<(ScannedTrack, Option<ExtractedCover>), CoreError> {
    let fs_meta = fs::metadata(path)?;
    let file_size = fs_meta.len();
    let modified_at = fs_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Unknown Track")
        .to_string();

    let format = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "audio".to_string());

    let tagged_file = Probe::open(path)?
        .options(ParseOptions::new())
        .read()?;

    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as u64;
    let bitrate_kbps = properties.audio_bitrate();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|t| t.title())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_title);

    let artist = tag
        .and_then(|t| t.artist())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let album = tag
        .and_then(|t| t.album())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Album".to_string());

    let album_artist = tag
        .and_then(|t| t.get_string(&ItemKey::AlbumArtist))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let genre = tag
        .and_then(|t| t.genre())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let track_number = tag.and_then(|t| t.track());
    let disc_number = tag.and_then(|t| t.disk());
    let year = tag.and_then(|t| t.year());

    let extracted_cover = tag.and_then(|t| select_best_picture(t.pictures())).map(hash_cover);
    let cover_hash = extracted_cover.as_ref().map(|(hash, _, _)| hash.clone());

    let track = ScannedTrack {
        file_path: path.to_string_lossy().into_owned(),
        title,
        artist,
        album,
        album_artist,
        track_number,
        disc_number,
        year,
        genre,
        duration_ms,
        format,
        bitrate_kbps,
        file_size,
        modified_at,
        cover_hash,
    };

    Ok((track, extracted_cover))
}

/// Computes the lowercase hex SHA-256 hash of a file on disk using streaming 64 KB chunks.
pub fn compute_file_hash(path: &Path) -> Result<String, CoreError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];

    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }

    Ok(bytes_to_hex(&hasher.finalize()))
}

fn select_best_picture(pictures: &[Picture]) -> Option<&Picture> {
    pictures
        .iter()
        .find(|pic| pic.pic_type() == PictureType::CoverFront)
        .or_else(|| pictures.first())
}

fn hash_cover(pic: &Picture) -> ExtractedCover {
    let mut hasher = Sha256::new();
    hasher.update(pic.data());
    let hash = bytes_to_hex(&hasher.finalize());
    let mime = pic
        .mime_type()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());

    (hash, mime, pic.data().to_vec())
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn recognizes_supported_audio_extensions() {
        assert!(is_supported_audio_file(Path::new("song.FLAC")));
        assert!(is_supported_audio_file(Path::new("track.mp3")));
        assert!(is_supported_audio_file(Path::new("voice.opus")));
        assert!(!is_supported_audio_file(Path::new("cover.jpg")));
        assert!(!is_supported_audio_file(Path::new("playlist.wpl")));
    }

    #[test]
    fn computes_deterministic_sha256_file_hash() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("t_music_hash_test_{nanos}.bin"));
        fs::write(&path, b"hello t-music").unwrap();

        let h1 = compute_file_hash(&path).unwrap();
        let h2 = compute_file_hash(&path).unwrap();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);

        let _ = fs::remove_file(&path);
    }
}
