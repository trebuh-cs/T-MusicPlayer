//! Parsers and exporters for Windows Media Player (.wpl, .zpl), M3U/M3U8, and PLS playlists.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::models::{ParsedPlaylist, ParsedPlaylistEntry, Track};
use crate::CoreError;

/// Supported external playlist extensions (lowercase, without leading dot).
pub const SUPPORTED_PLAYLIST_EXTENSIONS: &[&str] = &["wpl", "zpl", "m3u", "m3u8", "pls"];

/// Returns true if the path has a supported external playlist extension.
pub fn is_supported_playlist_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_PLAYLIST_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Parses a `.wpl`, `.zpl`, `.m3u`, `.m3u8`, or `.pls` playlist file and resolves track paths.
pub fn parse_playlist_file(path: &Path) -> Result<ParsedPlaylist, CoreError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| CoreError::UnsupportedFormat(path.display().to_string()))?;

    let raw_bytes = fs::read(path)?;
    let content = decode_playlist_text(&raw_bytes);
    let base_dir = path.parent().unwrap_or_else(|| Path::new(""));
    let fallback_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Imported Playlist")
        .to_string();

    match ext.as_str() {
        "wpl" | "zpl" => parse_wpl_or_zpl(&content, path, base_dir, &ext, &fallback_name),
        "m3u" | "m3u8" => Ok(parse_m3u(&content, path, base_dir, &ext, &fallback_name)),
        "pls" => Ok(parse_pls(&content, path, base_dir, &ext, &fallback_name)),
        _ => Err(CoreError::UnsupportedFormat(ext)),
    }
}

/// Generates a clean UTF-8 `.m3u8` playlist file content from library tracks.
pub fn export_m3u8(name: &str, tracks: &[Track]) -> String {
    let mut out = String::from("#EXTM3U\n");
    let clean_name = name.replace(['\r', '\n'], " ");
    out.push_str(&format!("#PLAYLIST:{clean_name}\n"));

    for track in tracks {
        let secs = track.duration_ms / 1000;
        let artist = track.artist.replace(['\r', '\n'], " ");
        let title = track.title.replace(['\r', '\n'], " ");
        out.push_str(&format!("#EXTINF:{secs},{artist} - {title}\n"));
        out.push_str(&track.file_path);
        out.push('\n');
    }

    out
}

fn decode_playlist_text(bytes: &[u8]) -> String {
    // Handle UTF-16 LE/BE BOMs that older Windows tools occasionally emit, falling back to UTF-8.
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    let text = String::from_utf8_lossy(bytes);
    text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_string()
}

fn parse_wpl_or_zpl(
    content: &str,
    source_path: &Path,
    base_dir: &Path,
    format: &str,
    fallback_name: &str,
) -> Result<ParsedPlaylist, CoreError> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut title: Option<String> = None;
    let mut in_title = false;
    let mut entries = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                if e.local_name().as_ref().eq_ignore_ascii_case(b"title") {
                    in_title = true;
                } else if e.local_name().as_ref().eq_ignore_ascii_case(b"media") {
                    if let Some(entry) = extract_media_entry(e, base_dir)? {
                        entries.push(entry);
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                if e.local_name().as_ref().eq_ignore_ascii_case(b"media") {
                    if let Some(entry) = extract_media_entry(e, base_dir)? {
                        entries.push(entry);
                    }
                }
            }
            Ok(Event::Text(ref e)) if in_title => {
                let text = e.unescape()?.trim().to_string();
                if !text.is_empty() {
                    title = Some(text);
                }
            }
            Ok(Event::End(ref e)) => {
                if e.local_name().as_ref().eq_ignore_ascii_case(b"title") {
                    in_title = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(CoreError::Xml(err)),
            _ => {}
        }
        buf.clear();
    }

    Ok(ParsedPlaylist {
        name: title.unwrap_or_else(|| fallback_name.to_string()),
        source_path: source_path.to_string_lossy().into_owned(),
        format: format.to_string(),
        entries,
    })
}

fn extract_media_entry(
    element: &quick_xml::events::BytesStart<'_>,
    base_dir: &Path,
) -> Result<Option<ParsedPlaylistEntry>, CoreError> {
    let mut src: Option<String> = None;
    let mut title_hint: Option<String> = None;
    let mut artist_hint: Option<String> = None;

    for attr in element.attributes() {
        let attr = attr?;
        let key = attr.key.local_name();
        let val = attr.unescape_value()?.into_owned();
        if key.as_ref().eq_ignore_ascii_case(b"src") {
            src = Some(val);
        } else if key.as_ref().eq_ignore_ascii_case(b"trackTitle") {
            title_hint = non_empty(val);
        } else if key.as_ref().eq_ignore_ascii_case(b"trackArtist") {
            artist_hint = non_empty(val);
        }
    }

    let Some(raw_src) = src.and_then(non_empty) else {
        return Ok(None);
    };

    Ok(Some(build_entry(raw_src, base_dir, title_hint, artist_hint)))
}

fn parse_m3u(
    content: &str,
    source_path: &Path,
    base_dir: &Path,
    format: &str,
    fallback_name: &str,
) -> ParsedPlaylist {
    let mut playlist_name = fallback_name.to_string();
    let mut entries = Vec::new();
    let mut pending_title: Option<String> = None;
    let mut pending_artist: Option<String> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_prefix("#PLAYLIST:") {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                playlist_name = trimmed.to_string();
            }
            continue;
        }
        if let Some(info) = line.strip_prefix("#EXTINF:") {
            let (artist, title) = parse_extinf_metadata(info);
            pending_artist = artist;
            pending_title = title;
            continue;
        }
        if line.starts_with('#') {
            continue;
        }

        entries.push(build_entry(
            line.to_string(),
            base_dir,
            pending_title.take(),
            pending_artist.take(),
        ));
    }

    ParsedPlaylist {
        name: playlist_name,
        source_path: source_path.to_string_lossy().into_owned(),
        format: format.to_string(),
        entries,
    }
}

fn parse_extinf_metadata(info: &str) -> (Option<String>, Option<String>) {
    let Some((_, label)) = info.split_once(',') else {
        return (None, None);
    };
    let label = label.trim();
    if label.is_empty() {
        return (None, None);
    }
    if let Some((artist, title)) = label.split_once(" - ") {
        return (non_empty(artist.to_string()), non_empty(title.to_string()));
    }
    (None, Some(label.to_string()))
}

fn parse_pls(
    content: &str,
    source_path: &Path,
    base_dir: &Path,
    format: &str,
    fallback_name: &str,
) -> ParsedPlaylist {
    let mut files: BTreeMap<usize, String> = BTreeMap::new();
    let mut titles: BTreeMap<usize, String> = BTreeMap::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('[') || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key_trimmed = key.trim();
        let val_trimmed = value.trim();

        if let Some(idx_str) = strip_prefix_ignore_ascii_case(key_trimmed, "file") {
            if let Ok(idx) = idx_str.parse::<usize>() {
                if !val_trimmed.is_empty() {
                    files.insert(idx, val_trimmed.to_string());
                }
            }
        } else if let Some(idx_str) = strip_prefix_ignore_ascii_case(key_trimmed, "title") {
            if let Ok(idx) = idx_str.parse::<usize>() {
                if !val_trimmed.is_empty() {
                    titles.insert(idx, val_trimmed.to_string());
                }
            }
        }
    }

    let entries = files
        .into_iter()
        .map(|(idx, raw_src)| {
            let title_hint = titles.remove(&idx);
            build_entry(raw_src, base_dir, title_hint, None)
        })
        .collect();

    ParsedPlaylist {
        name: fallback_name.to_string(),
        source_path: source_path.to_string_lossy().into_owned(),
        format: format.to_string(),
        entries,
    }
}

fn strip_prefix_ignore_ascii_case<'a>(input: &'a str, prefix: &str) -> Option<&'a str> {
    if input.len() >= prefix.len() && input[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&input[prefix.len()..])
    } else {
        None
    }
}

fn build_entry(
    raw_src: String,
    base_dir: &Path,
    title_hint: Option<String>,
    artist_hint: Option<String>,
) -> ParsedPlaylistEntry {
    let resolved = resolve_track_path(&raw_src, base_dir);
    let exists = resolved.as_ref().map(|p| p.is_file()).unwrap_or(false);
    let resolved_path = resolved.map(|p| p.to_string_lossy().into_owned());

    ParsedPlaylistEntry {
        raw_src,
        resolved_path,
        exists,
        title_hint,
        artist_hint,
    }
}

/// Resolves relative paths, `file://` URIs, and mixed slash styles against `base_dir`.
pub fn resolve_track_path(raw_src: &str, base_dir: &Path) -> Option<PathBuf> {
    let trimmed = raw_src.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Remote HTTP/HTTPS entries inside a local playlist aren't local filesystem tracks.
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return None;
    }

    let cleaned = if let Some(uri_rest) = strip_file_uri_prefix(trimmed) {
        percent_decode(&uri_rest)
    } else {
        trimmed.to_string()
    };

    let normalized_sep = normalize_platform_separators(&cleaned);
    let candidate = PathBuf::from(&normalized_sep);

    let joined = if candidate.is_absolute() || is_windows_drive_path(&normalized_sep) {
        candidate
    } else {
        base_dir.join(candidate)
    };

    Some(normalize_lexical_path(&joined))
}

fn strip_file_uri_prefix(input: &str) -> Option<String> {
    let rest = strip_prefix_ignore_ascii_case(input, "file://")?;
    if let Some(after_localhost) = strip_prefix_ignore_ascii_case(rest, "localhost/") {
        return Some(strip_leading_slash_for_drive(after_localhost));
    }
    if let Some(after_slash) = rest.strip_prefix('/') {
        return Some(strip_leading_slash_for_drive(after_slash));
    }
    Some(rest.to_string())
}

fn strip_leading_slash_for_drive(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    if is_windows_drive_path(trimmed) {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn is_windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn normalize_platform_separators(input: &str) -> String {
    if cfg!(windows) {
        input.replace('/', "\\")
    } else {
        input.replace('\\', "/")
    }
}

fn normalize_lexical_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !matches!(
                    out.components().next_back(),
                    None | Some(Component::RootDir) | Some(Component::Prefix(_))
                ) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                decoded.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("t_music_wmp_test_{label}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_wpl_with_entities_and_relative_paths() {
        let root = make_temp_dir("wpl");
        let playlists_dir = root.join("Playlists");
        let artist_dir = root.join("Artist & Co");
        fs::create_dir_all(&playlists_dir).unwrap();
        fs::create_dir_all(&artist_dir).unwrap();

        let existing_song = artist_dir.join("Track 'One'.mp3");
        fs::write(&existing_song, b"dummy").unwrap();

        let wpl_path = playlists_dir.join("Favorites.wpl");
        let wpl_xml = r#"<?wpl version="1.0"?>
<smil>
  <head>
    <title>Late Night &amp; Chill</title>
  </head>
  <body>
    <seq>
      <media src="..\Artist &amp; Co\Track &apos;One&apos;.mp3" trackTitle="Track One" trackArtist="Artist &amp; Co"/>
      <media src="..\Missing\Ghost.flac"/>
    </seq>
  </body>
</smil>"#;
        fs::write(&wpl_path, wpl_xml).unwrap();

        let parsed = parse_playlist_file(&wpl_path).unwrap();
        assert_eq!(parsed.name, "Late Night & Chill");
        assert_eq!(parsed.format, "wpl");
        assert_eq!(parsed.entries.len(), 2);

        assert!(parsed.entries[0].exists);
        assert_eq!(
            parsed.entries[0].resolved_path.as_deref(),
            Some(existing_song.to_string_lossy().as_ref())
        );
        assert_eq!(parsed.entries[0].title_hint.as_deref(), Some("Track One"));
        assert_eq!(parsed.entries[0].artist_hint.as_deref(), Some("Artist & Co"));

        assert!(!parsed.entries[1].exists);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_zpl_playlist() {
        let root = make_temp_dir("zpl");
        let song = root.join("Synthwave.mp3");
        fs::write(&song, b"dummy").unwrap();

        let zpl_path = root.join("Drive.zpl");
        let zpl_xml = r#"<?zpl version="2.0"?>
<smil>
  <head><title>Midnight Drive</title></head>
  <body>
    <seq>
      <media src="Synthwave.mp3" trackTitle="Synthwave" trackArtist="Neon" />
    </seq>
  </body>
</smil>"#;
        fs::write(&zpl_path, zpl_xml).unwrap();

        let parsed = parse_playlist_file(&zpl_path).unwrap();
        assert_eq!(parsed.name, "Midnight Drive");
        assert_eq!(parsed.format, "zpl");
        assert_eq!(parsed.entries.len(), 1);
        assert!(parsed.entries[0].exists);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_m3u8_with_bom_and_extinf_and_exports() {
        let root = make_temp_dir("m3u8");
        let song = root.join("Focus Flow.flac");
        fs::write(&song, b"dummy").unwrap();

        let m3u_path = root.join("Work.m3u8");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(
            b"#EXTM3U\n#PLAYLIST:Deep Focus\n#EXTINF:215,Lofi Artist - Focus Flow\nFocus Flow.flac\n",
        );
        fs::write(&m3u_path, bytes).unwrap();

        let parsed = parse_playlist_file(&m3u_path).unwrap();
        assert_eq!(parsed.name, "Deep Focus");
        assert_eq!(parsed.entries.len(), 1);
        assert!(parsed.entries[0].exists);
        assert_eq!(parsed.entries[0].artist_hint.as_deref(), Some("Lofi Artist"));
        assert_eq!(parsed.entries[0].title_hint.as_deref(), Some("Focus Flow"));

        let track = Track {
            id: "t1".into(),
            file_path: song.to_string_lossy().into_owned(),
            title: "Focus Flow".into(),
            artist: "Lofi Artist".into(),
            album: "Study".into(),
            album_artist: None,
            track_number: Some(1),
            disc_number: None,
            year: Some(2026),
            genre: Some("Lo-Fi".into()),
            duration_ms: 215_000,
            format: "flac".into(),
            bitrate_kbps: Some(900),
            file_size: 5,
            modified_at: 0,
            cover_hash: None,
            play_count: 0,
            is_favorite: false,
            added_at: 0,
            edit_speed: 1.0,
            edit_gain_db: 0.0,
            trim_start_ms: 0,
            trim_end_ms: None,
        };
        let exported = export_m3u8("Deep Focus", &[track]);
        assert!(exported.starts_with("#EXTM3U\n#PLAYLIST:Deep Focus\n#EXTINF:215,Lofi Artist - Focus Flow\n"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_pls_playlist() {
        let root = make_temp_dir("pls");
        let song_a = root.join("a.mp3");
        let song_b = root.join("b.ogg");
        fs::write(&song_a, b"a").unwrap();
        fs::write(&song_b, b"b").unwrap();

        let pls_path = root.join("Mix.pls");
        let content = "[playlist]\nFile2=b.ogg\nTitle2=Second\nFile1=a.mp3\nTitle1=First\nNumberOfEntries=2\nVersion=2\n";
        fs::write(&pls_path, content).unwrap();

        let parsed = parse_playlist_file(&pls_path).unwrap();
        assert_eq!(parsed.name, "Mix");
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].title_hint.as_deref(), Some("First"));
        assert_eq!(parsed.entries[1].title_hint.as_deref(), Some("Second"));
        assert!(parsed.entries.iter().all(|e| e.exists));

        let _ = fs::remove_dir_all(&root);
    }
}
