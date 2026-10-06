//! Core icon generation engine: load one source image (PNG/JPEG/WebP/SVG),
//! render it to every size a platform needs, and export as a folder or ZIP.
//!
//! Shared by the Tauri app and (later) a CLI; it has no UI or Tauri dependency.

pub mod error;
pub mod export;
pub mod generate;
pub mod source;
pub mod spec;

pub use error::{Error, Result};
pub use export::{write_to_folder, write_zip, write_zip_file};
pub use generate::{generate, render_preview, Color, GenerateOptions, GeneratedFile};
pub use source::{Source, SourceKind};
pub use spec::{builtin_platforms, PlatformSpec};
