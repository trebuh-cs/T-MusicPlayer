use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use rusqlite::Connection;
use serde_json::{json, Value};
use t_music_core::models::{
    AuthResponse, CheckHashesRequest, CheckHashesResponse, ServerHealth, ServerTrack,
    SyncFavoritePayload, SyncPlaylistPayload, SyncPullResponse, SyncPushRequest,
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
    fs::create_dir_all(&data_dir).unwrap();
    fs::create_dir_all(&music_dir).unwrap();

    let cfg = ServerConfig {
        port: 0,
        data_dir,
        music_dir,
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

    // Check hashes returns the uploaded hash.
    let check_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/tracks/check-hashes")
                .header(header::AUTHORIZATION, format!("Bearer {}", auth_b.token))
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

    // 4. HTTP Range streaming returns exact slice (206 Partial Content).
    let range_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/stream/{}?token={}", uploaded.id, auth_b.token))
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
