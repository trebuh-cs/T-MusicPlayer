//! Shared core domain models, audio library scanner, and playlist parsers for T - MusicPlayer.

pub mod models;
pub mod scanner;
pub mod wmp;

use thiserror::Error;

/// Errors produced by core library scanning and playlist parsing operations.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Audio tag error: {0}")]
    Tag(#[from] lofty::error::LoftyError),

    #[error("XML parse error: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("XML attribute error: {0}")]
    XmlAttr(#[from] quick_xml::events::attributes::AttrError),

    #[error("Unsupported playlist format: {0}")]
    UnsupportedFormat(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),
}
