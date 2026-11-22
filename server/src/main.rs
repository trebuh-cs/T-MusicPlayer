//! Binary entrypoint for `t-music-server`.

use std::net::SocketAddr;

use t_music_server::config::ServerConfig;
use t_music_server::db::ServerDb;
use t_music_server::routes::{build_router, scan_server_music_directory};
use t_music_server::AppState;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = ServerConfig::from_env().expect("Invalid server configuration");
    let db_path = config.data_dir.join("t-music-server.db");
    let db = ServerDb::open(&db_path).expect("Failed to open server SQLite database");
    let state = AppState::initialize(config, db).expect("Failed to initialize server state");

    let admin_id = state.db.get_first_admin_user_id().ok().flatten();
    if let Ok(scanned) =
        scan_server_music_directory(&state.db, &state.config.music_dir, admin_id.as_deref())
    {
        tracing::info!(
            "Indexed {scanned} track(s) from {}",
            state.config.music_dir.display()
        );
    }

    let addr = SocketAddr::from(([0, 0, 0, 0], state.config.port));
    let app = build_router(state);
    tracing::info!("t-music-server listening on http://{addr}");

    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");
    axum::serve(listener, app)
        .await
        .expect("HTTP server exited unexpectedly");
}
