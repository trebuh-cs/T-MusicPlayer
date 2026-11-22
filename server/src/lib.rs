//! Library entrypoint for `t-music-server`, exposing router & state setup for binaries and tests.

pub mod auth;
pub mod config;
pub mod db;
pub mod routes;

use std::sync::Arc;

use config::ServerConfig;
use db::ServerDb;

/// Shared server application state passed into Axum handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<ServerConfig>,
    pub db: Arc<ServerDb>,
}

impl AppState {
    /// Initializes SQLite database and optional bootstrap admin account.
    pub fn initialize(config: ServerConfig, db: ServerDb) -> Result<Self, String> {
        if let (Some(user), Some(pass)) = (&config.admin_username, &config.admin_password) {
            let hash = auth::hash_password(pass)?;
            db.ensure_bootstrap_admin(user, &hash)?;
        }

        Ok(Self {
            config: Arc::new(config),
            db: Arc::new(db),
        })
    }
}
