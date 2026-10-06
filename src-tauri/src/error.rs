use serde::Serialize;

/// Error sent to the frontend. `code` is stable and used for localized messages;
/// `message` is English detail for logs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

pub type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn no_source() -> Self {
        Self::new("noSource", "no source image loaded")
    }
}

impl From<icon_core::Error> for CommandError {
    fn from(err: icon_core::Error) -> Self {
        use icon_core::Error as E;
        let code = match &err {
            E::Io(_) => "io",
            E::UnsupportedFormat => "unsupportedFormat",
            E::Decode(_) => "decode",
            E::Svg(_) => "svg",
            E::InputTooLarge { .. } => "inputTooLarge",
            E::DimensionsTooLarge { .. } => "dimensionsTooLarge",
            E::EmptyImage => "emptyImage",
            E::UnknownPlatform(_) => "unknownPlatform",
            E::PlatformConflict(..) => "platformConflict",
            E::UnsafePath(_) => "unsafePath",
            E::Encode { .. } => "encode",
            E::Zip(_) => "zip",
        };
        Self::new(code, err.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(err: tauri::Error) -> Self {
        Self::new("internal", err.to_string())
    }
}
