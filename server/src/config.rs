//! Runtime environment configuration for `t-music-server`.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use rand_core::{OsRng, RngCore};

/// Runtime settings loaded from environment variables / `.env`.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub data_dir: PathBuf,
    pub music_dir: PathBuf,
    pub jwt_secret: String,
    pub admin_username: Option<String>,
    pub admin_password: Option<String>,
    pub allow_registration: bool,
    pub invite_code: Option<String>,
}

impl ServerConfig {
    /// Loads configuration from process environment (after optional `.env` file).
    pub fn from_env() -> Result<Self, String> {
        let _ = dotenvy::dotenv();

        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(8484);

        let data_dir = PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| "./data".into()));
        let music_dir = PathBuf::from(env::var("MUSIC_DIR").unwrap_or_else(|_| "./music".into()));
        fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create DATA_DIR: {e}"))?;
        fs::create_dir_all(&music_dir).map_err(|e| format!("Failed to create MUSIC_DIR: {e}"))?;

        let jwt_secret = match env::var("JWT_SECRET").ok().filter(|s| !s.trim().is_empty()) {
            Some(secret) => secret,
            None => load_or_generate_jwt_secret(&data_dir)?,
        };

        let admin_username = non_empty_env("ADMIN_USERNAME");
        let admin_password = non_empty_env("ADMIN_PASSWORD");
        let allow_registration = env::var("ALLOW_REGISTRATION")
            .ok()
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "false" | "0" | "no"))
            .unwrap_or(true);
        let invite_code = non_empty_env("INVITE_CODE");

        Ok(Self {
            port,
            data_dir,
            music_dir,
            jwt_secret,
            admin_username,
            admin_password,
            allow_registration,
            invite_code,
        })
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn load_or_generate_jwt_secret(data_dir: &Path) -> Result<String, String> {
    let secret_file = data_dir.join(".jwt_secret");
    if let Ok(existing) = fs::read_to_string(&secret_file) {
        let trimmed = existing.trim();
        if trimmed.len() >= 32 {
            return Ok(trimmed.to_string());
        }
    }

    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    fs::write(&secret_file, &hex)
        .map_err(|e| format!("Failed to persist generated JWT secret: {e}"))?;
    Ok(hex)
}
