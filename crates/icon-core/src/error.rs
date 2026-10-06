use std::io;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("unsupported image format")]
    UnsupportedFormat,

    #[error("failed to decode image: {0}")]
    Decode(String),

    #[error("failed to parse SVG: {0}")]
    Svg(String),

    #[error("input file is too large ({bytes} bytes, limit is {limit} bytes)")]
    InputTooLarge { bytes: u64, limit: u64 },

    #[error("image dimensions {width}x{height} exceed the limit of {limit}px")]
    DimensionsTooLarge { width: u32, height: u32, limit: u32 },

    #[error("image has zero size")]
    EmptyImage,

    #[error("unknown platform: {0}")]
    UnknownPlatform(String),

    #[error("unsafe output path: {0}")]
    UnsafePath(String),

    #[error("failed to encode {path}: {message}")]
    Encode { path: String, message: String },

    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
}
