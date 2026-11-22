//! Argon2id password hashing and HS256 JWT authentication helpers.

use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use t_music_core::models::UserProfile;

use crate::AppState;

/// JWT claims embedded in bearer tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    pub role: String,
    pub exp: usize,
}

/// Authenticated user extracted from `Authorization: Bearer <token>` or `?token=<jwt>`.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
    pub role: String,
}

/// Hashes a plaintext password using Argon2id with a random salt.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Failed to hash password: {e}"))
}

/// Verifies a plaintext password against a stored Argon2 PHC string.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Issues an HS256 JWT valid for 30 days.
pub fn sign_token(secret: &str, user: &UserProfile) -> Result<String, String> {
    let exp = (Utc::now() + Duration::days(30)).timestamp() as usize;
    let claims = Claims {
        sub: user.id.clone(),
        username: user.username.clone(),
        role: user.role.clone(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| format!("Failed to sign token: {e}"))
}

/// Validates an HS256 JWT and returns its claims.
pub fn verify_token(secret: &str, token: &str) -> Result<Claims, String> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|e| format!("Invalid or expired token: {e}"))
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let bearer = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let query_token = parts
            .uri
            .query()
            .and_then(|q| extract_query_param(q, "token"));

        let token = bearer
            .or(query_token)
            .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing authentication token".into()))?;

        let claims = verify_token(&state.config.jwt_secret, &token)
            .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;

        Ok(AuthUser {
            id: claims.sub,
            username: claims.username,
            role: claims.role,
        })
    }
}

fn extract_query_param(query: &str, target_key: &str) -> Option<String> {
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == target_key && !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}
