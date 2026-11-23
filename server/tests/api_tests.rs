use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use rusqlite::Connection;
use serde_json::{json, Value};
use t_music_core::models::{
    AuthResponse, AutoPlaylistConfig, CheckHashesRequest, CheckHashesResponse, ServerHealth,
    ServerTrack, SyncFavoritePayload, SyncPlaylistPayload, SyncPullResponse, SyncPushRequest,
    SyncTrackEditPayload, SyncTrackStatsPayload,
};
use t_music_server::config::ServerConfig;
use t_music_server::db::ServerDb;
use t_music_server::routes::build_router;
use t_music_server::AppState;
use tower::ServiceExt;

fn temp_test_state(invite_code: Option<&str>) -> (AppState, PathBuf) {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("t_music_server_test_{nanos}"));
    let data_dir = root.join("data");
    let music_dir = root.join("music");
    let downloads_dir = root.join("downloads");
    fs::create_dir_all(&data_dir).unwrap();
    fs::create_dir_all(&music_dir).unwrap();
    fs::create_dir_all(&downloads_dir).unwrap();

    let cfg = ServerConfig {
        port: 0,
        data_dir,
        music_dir,
        downloads_dir,
        jwt_secret: "unit_test_secret_0123456789abcdef".to_string(),
        admin_username: None,
        admin_password: None,
        allow_registration: true,
        invite_code: invite_code.map(str::to_string),
    };
    let db = ServerDb::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    (AppState::initialize(cfg, db).unwrap(), root)
}

async fn read_body_bytes(resp: axum::response::Response) -> Vec<u8> {
    resp.into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec()
}

#[tokio::test]
async fn multi_user_auth_upload_dedup_range_stream_and_two_way_sync() {
    let (state, root) = temp_test_state(Some("TEAM-INVITE"));
    let app = build_router(state);

    // 1. Health check reports invite required.
    let health_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_resp.status(), StatusCode::OK);
    let health: ServerHealth =
        serde_json::from_slice(&read_body_bytes(health_resp).await).unwrap();
    assert!(health.registration_open);
    assert!(health.invite_required);

    // 2. Wrong invite code is rejected; valid invite registers User A (admin) & User B (user).
    let bad_reg = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"username":"alice","password":"secret12","invite_code":"WRONG"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_reg.status(), StatusCode::FORBIDDEN);

    let reg_a = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"username":"alice","password":"secret12","invite_code":"TEAM-INVITE"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reg_a.status(), StatusCode::CREATED);
    let auth_a: AuthResponse = serde_json::from_slice(&read_body_bytes(reg_a).await).unwrap();
    assert_eq!(auth_a.user.role, "admin");

    let reg_b = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"username":"bob","password":"secret34","invite_code":"TEAM-INVITE"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reg_b.status(), StatusCode::CREATED);
    let auth_b: AuthResponse = serde_json::from_slice(&read_body_bytes(reg_b).await).unwrap();
    assert_eq!(auth_b.user.role, "user");

    // 3. Upload a binary audio payload via multipart & check content-hash deduplication.
    let boundary = "TMUSICBOUNDARY123";
    let payload_bytes = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut mp_body = Vec::new();
    mp_body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nNeon Drive\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"artist\"\r\n\r\nTPX\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"neon.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n"
        )
        .as_bytes(),
    );
    mp_body.extend_from_slice(payload_bytes);
    mp_body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let upload_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/tracks/upload")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_a.token))
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(mp_body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upload_resp.status(), StatusCode::CREATED);
    let uploaded: ServerTrack =
        serde_json::from_slice(&read_body_bytes(upload_resp).await).unwrap();
    assert_eq!(uploaded.title, "Neon Drive");
    assert_eq!(uploaded.artist, "TPX");

    // 3b. Private library isolation: Bob has NOT uploaded this file and Alice hasn't shared any playlist,
    // so Bob sees 0 tracks and gets 403 Forbidden if attempting to stream Alice's private track.
    let bob_initial_pull_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/pull")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_b.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bob_initial_pull_resp.status(), StatusCode::OK);
    let bob_initial_pull: SyncPullResponse =
        serde_json::from_slice(&read_body_bytes(bob_initial_pull_resp).await).unwrap();
    assert!(bob_initial_pull.tracks.is_empty());

    let forbidden_stream_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/stream/{}?token={}", uploaded.id, auth_b.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_stream_resp.status(), StatusCode::FORBIDDEN);

    // 4. Alice streams her own track with HTTP Range (206 Partial Content).
    let range_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/stream/{}?token={}", uploaded.id, auth_a.token))
                .header(header::RANGE, "bytes=5-14")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(range_resp.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        range_resp
            .headers()
            .get(header::CONTENT_RANGE)
            .unwrap()
            .to_str()
            .unwrap(),
        "bytes 5-14/36"
    );
    assert_eq!(read_body_bytes(range_resp).await, b"FGHIJKLMNO");

    // If a third user (Charlie) independently owns the identical file and checks its SHA-256 hash,
    // the server deduplicates it on disk and links it to Charlie's private library.
    let reg_c_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"charlie","password":"password123","invite_code":"TEAM-INVITE"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reg_c_resp.status(), StatusCode::CREATED);
    let auth_c: AuthResponse = serde_json::from_slice(&read_body_bytes(reg_c_resp).await).unwrap();

    let check_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/tracks/check-hashes")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_c.token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&CheckHashesRequest {
                        hashes: vec![uploaded.content_hash.clone(), "missing_hash".into()],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(check_resp.status(), StatusCode::OK);
    let checked: CheckHashesResponse =
        serde_json::from_slice(&read_body_bytes(check_resp).await).unwrap();
    assert_eq!(
        checked.existing.get(&uploaded.content_hash),
        Some(&uploaded.id)
    );
    assert!(!checked.existing.contains_key("missing_hash"));

    // Charlie now sees the deduplicated track in his own library and can stream it.
    let pull_c_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/pull")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_c.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let pull_c: SyncPullResponse =
        serde_json::from_slice(&read_body_bytes(pull_c_resp).await).unwrap();
    assert_eq!(pull_c.tracks.len(), 1);

    // 5. Two-way sync & per-user playlist isolation + shared playlists + tombstones.
    let push_a = SyncPushRequest {
        playlists: vec![
            SyncPlaylistPayload {
                id: "pl-private-a".into(),
                name: "Alice Private".into(),
                description: "".into(),
                track_ids: vec![uploaded.id.clone()],
                is_shared: false,
                owner_username: "alice".into(),
                updated_at: 100,
                deleted: false,
            },
            SyncPlaylistPayload {
                id: "pl-shared-a".into(),
                name: "Shared Roadtrip".into(),
                description: "Group mix".into(),
                track_ids: vec![uploaded.id.clone()],
                is_shared: true,
                owner_username: "alice".into(),
                updated_at: 100,
                deleted: false,
            },
        ],
        favorites: vec![SyncFavoritePayload {
            track_id: uploaded.id.clone(),
            is_favorite: true,
            updated_at: 100,
        }],
        track_edits: vec![SyncTrackEditPayload {
            track_id: uploaded.id.clone(),
            speed: 1.25,
            gain_db: 3.5,
            trim_start_ms: 4000,
            trim_end_ms: Some(120000),
            updated_at: 100,
        }],
        track_stats: vec![SyncTrackStatsPayload {
            track_id: uploaded.id.clone(),
            play_count: 5,
            manual_play_count: 3,
            skip_count: 1,
            auto_excluded: false,
            last_played_at: 1000,
            updated_at: 100,
        }],
        auto_playlist_config: Some(AutoPlaylistConfig {
            max_duration_ms: Some(480_000),
            favorite_boost_enabled: true,
            favorite_boost_factor: 4.5,
            cooldown_enabled: true,
            cooldown_tracks: 10,
            updated_at: 100,
        }),
    };
    let push_a_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/sync/push")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_a.token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(&push_a).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(push_a_resp.status(), StatusCode::OK);
    let push_val: Value = serde_json::from_slice(&read_body_bytes(push_a_resp).await).unwrap();
    assert_eq!(push_val["applied_playlists"], 2);
    assert_eq!(push_val["applied_favorites"], 1);
    assert_eq!(push_val["applied_track_edits"], 1);
    assert_eq!(push_val["applied_track_stats"], 1);

    // Verify monotonic merge for track_stats counters + LWW auto_excluded & auto_playlist_config.
    let push_a_second = SyncPushRequest {
        playlists: vec![],
        favorites: vec![],
        track_edits: vec![],
        track_stats: vec![SyncTrackStatsPayload {
            track_id: uploaded.id.clone(),
            play_count: 2, // lower than existing 5 -> keeps 5
            manual_play_count: 6, // higher than existing 3 -> takes 6
            skip_count: 0, // lower than existing 1 -> keeps 1
            auto_excluded: true, // newer updated_at (150 >= 100) -> becomes true
            last_played_at: 900, // lower than 1000 -> keeps 1000
            updated_at: 150,
        }],
        auto_playlist_config: Some(AutoPlaylistConfig {
            max_duration_ms: Some(300_000),
            favorite_boost_enabled: false,
            favorite_boost_factor: 6.0,
            cooldown_enabled: false,
            cooldown_tracks: 10,
            updated_at: 150,
        }),
    };
    let push_a2_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/sync/push")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_a.token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(&push_a_second).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(push_a2_resp.status(), StatusCode::OK);

    // Alice pulls her own edit, merged stats, and auto playlist config back cleanly.
    let pull_a_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/pull")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_a.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let pull_a: SyncPullResponse =
        serde_json::from_slice(&read_body_bytes(pull_a_resp).await).unwrap();
    assert_eq!(pull_a.track_edits.len(), 1);
    assert!((pull_a.track_edits[0].speed - 1.25).abs() < 0.001);
    assert!((pull_a.track_edits[0].gain_db - 3.5).abs() < 0.001);
    assert_eq!(pull_a.track_edits[0].trim_start_ms, 4000);
    assert_eq!(pull_a.track_edits[0].trim_end_ms, Some(120000));
    assert_eq!(pull_a.track_stats.len(), 1);
    assert_eq!(pull_a.track_stats[0].play_count, 5);
    assert_eq!(pull_a.track_stats[0].manual_play_count, 6);
    assert_eq!(pull_a.track_stats[0].skip_count, 1);
    assert!(pull_a.track_stats[0].auto_excluded);
    assert_eq!(pull_a.track_stats[0].last_played_at, 1000);
    let pulled_cfg = pull_a.auto_playlist_config.unwrap();
    assert_eq!(pulled_cfg.max_duration_ms, Some(300_000));
    assert!(!pulled_cfg.favorite_boost_enabled);
    assert!((pulled_cfg.favorite_boost_factor - 6.0).abs() < 0.01);
    assert!(!pulled_cfg.cooldown_enabled);

    // Verify full non-Range stream via ReaderStream returns exact bytes.
    let full_stream_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/stream/{}?token={}", uploaded.id, auth_a.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(full_stream_resp.status(), StatusCode::OK);
    assert_eq!(read_body_bytes(full_stream_resp).await, payload_bytes);

    // Bob pulls: sees the shared playlist and shared tracks, NOT Alice's private playlist or favorite.
    let pull_b_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/pull")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_b.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pull_b_resp.status(), StatusCode::OK);
    let pull_b: SyncPullResponse =
        serde_json::from_slice(&read_body_bytes(pull_b_resp).await).unwrap();
    assert_eq!(pull_b.tracks.len(), 1);
    assert_eq!(pull_b.playlists.len(), 1);
    assert_eq!(pull_b.playlists[0].id, "pl-shared-a");
    assert!(pull_b.favorites.is_empty());

    // Bob cannot delete Alice's shared playlist.
    let tamper_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/sync/push")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_b.token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&SyncPushRequest {
                        playlists: vec![SyncPlaylistPayload {
                            id: "pl-shared-a".into(),
                            name: "Hacked".into(),
                            description: "".into(),
                            track_ids: vec![],
                            is_shared: true,
                            owner_username: "bob".into(),
                            updated_at: 9999,
                            deleted: true,
                        }],
                        favorites: vec![],
                        track_edits: vec![],
                        track_stats: vec![],
                        auto_playlist_config: None,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let tamper_val: Value = serde_json::from_slice(&read_body_bytes(tamper_resp).await).unwrap();
    assert_eq!(tamper_val["applied_playlists"], 0);

    let _ = fs::remove_dir_all(&root);
}

#[tokio::test]
async fn chunked_upload_and_self_hosted_downloads_portal() {
    use sha2::{Digest, Sha256};

    let (state, root) = temp_test_state(None);
    let app = build_router(state);

    // Register admin (first user) and regular friend user.
    let admin_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"host","password":"password123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let admin_auth: AuthResponse = serde_json::from_slice(&read_body_bytes(admin_resp).await).unwrap();
    assert_eq!(admin_auth.user.role, "admin");

    let friend_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"friend","password":"password123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let friend_auth: AuthResponse = serde_json::from_slice(&read_body_bytes(friend_resp).await).unwrap();
    assert_eq!(friend_auth.user.role, "user");

    // 1. Multi-chunk upload (split across two slices).
    let part1 = b"ID3chunked-part-one-";
    let part2 = b"chunked-part-two-end";
    let mut full = Vec::new();
    full.extend_from_slice(part1);
    full.extend_from_slice(part2);
    let digest = Sha256::digest(&full);
    let expected_hash: String = digest.iter().map(|b| format!("{b:02x}")).collect();

    let init_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/tracks/upload/init")
                .header(header::AUTHORIZATION, format!("Bearer {}", admin_auth.token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "content_hash": expected_hash,
                        "filename": "two_hour_mix.mp3",
                        "total_size": full.len(),
                        "title": "Two Hour Set",
                        "artist": "DJ Test",
                        "album": "Long Mixes"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(init_resp.status(), StatusCode::OK);
    let init_val: Value = serde_json::from_slice(&read_body_bytes(init_resp).await).unwrap();
    assert_eq!(init_val["status"], "ready");
    let upload_id = init_val["upload_id"].as_str().unwrap().to_string();

    let chunk1_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/tracks/upload/{upload_id}/chunk?offset=0"))
                .header(header::AUTHORIZATION, format!("Bearer {}", admin_auth.token))
                .body(Body::from(part1.to_vec()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(chunk1_resp.status(), StatusCode::OK);

    let chunk2_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/v1/tracks/upload/{upload_id}/chunk?offset={}",
                    part1.len()
                ))
                .header(header::AUTHORIZATION, format!("Bearer {}", admin_auth.token))
                .body(Body::from(part2.to_vec()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(chunk2_resp.status(), StatusCode::OK);

    let complete_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/tracks/upload/{upload_id}/complete"))
                .header(header::AUTHORIZATION, format!("Bearer {}", admin_auth.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(complete_resp.status(), StatusCode::CREATED);
    let uploaded_track: ServerTrack =
        serde_json::from_slice(&read_body_bytes(complete_resp).await).unwrap();
    assert_eq!(uploaded_track.content_hash, expected_hash);
    assert_eq!(uploaded_track.title, "Two Hour Set");

    // 2. Self-hosted download portal permissions & serving.
    let fake_apk = b"PK\x03\x04fake-android-apk-binary";
    let forbidden_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/downloads/android")
                .header(header::AUTHORIZATION, format!("Bearer {}", friend_auth.token))
                .body(Body::from(fake_apk.to_vec()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_resp.status(), StatusCode::FORBIDDEN);

    let upload_apk_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/downloads/android")
                .header(header::AUTHORIZATION, format!("Bearer {}", admin_auth.token))
                .body(Body::from(fake_apk.to_vec()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upload_apk_resp.status(), StatusCode::OK);

    let portal_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/downloads")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(portal_resp.status(), StatusCode::OK);
    let portal_html = String::from_utf8(read_body_bytes(portal_resp).await).unwrap();
    assert!(portal_html.contains("/downloads/android.apk"));

    let dl_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/downloads/android.apk")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dl_resp.status(), StatusCode::OK);
    assert_eq!(
        dl_resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/vnd.android.package-archive")
    );
    assert_eq!(read_body_bytes(dl_resp).await, fake_apk);

    let _ = fs::remove_dir_all(&root);
}
