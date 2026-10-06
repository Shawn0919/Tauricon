//! Data-driven platform specs. Each platform is described by a JSON file in
//! `presets/`, so icon sizes can be updated without touching rendering code.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformSpec {
    pub id: String,
    pub name: String,
    /// Set on alternative outputs of another platform (e.g. iOS single-size
    /// is a variant of "ios"). Only one platform per family can be generated.
    #[serde(default)]
    pub variant_of: Option<String>,
    /// Top-level output folder; defaults to `id`.
    #[serde(default)]
    pub output_dir: Option<String>,
    /// Default background behavior for this platform's images.
    #[serde(default)]
    pub fill: Fill,
    pub files: Vec<FileSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FileSpec {
    Png {
        path: String,
        px: u32,
        /// Overrides the platform's `fill`.
        #[serde(default)]
        fill: Option<Fill>,
        #[serde(default)]
        mask: Mask,
        /// Fraction of the canvas the artwork occupies (before user padding).
        #[serde(default = "one")]
        content_scale: f32,
        /// Write an RGB PNG without an alpha channel (App Store requirement).
        #[serde(default)]
        strip_alpha: bool,
        /// Asset catalog slots this file fills, for `Contents.json`.
        #[serde(default)]
        apple: Vec<AppleSlot>,
    },
    Ico {
        path: String,
        sizes: Vec<u32>,
    },
    Icns {
        path: String,
    },
    /// Xcode `Contents.json` built from the platform's `apple` slots.
    AppleContents {
        path: String,
    },
    /// Text file; `{{background_hex}}` is replaced with the background color.
    Text {
        path: String,
        template: String,
    },
}

impl PlatformSpec {
    pub fn output_dir(&self) -> &str {
        self.output_dir.as_deref().unwrap_or(&self.id)
    }

    /// The platform family: its own id, or the id it is a variant of.
    pub fn family(&self) -> &str {
        self.variant_of.as_deref().unwrap_or(&self.id)
    }
}

impl FileSpec {
    pub fn path(&self) -> &str {
        match self {
            FileSpec::Png { path, .. }
            | FileSpec::Ico { path, .. }
            | FileSpec::Icns { path }
            | FileSpec::AppleContents { path }
            | FileSpec::Text { path, .. } => path,
        }
    }
}

/// Whether an image gets a solid background behind the artwork.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fill {
    /// Only when the user picked a background color.
    #[default]
    Auto,
    /// Always; white when the user picked none.
    Always,
    /// Never (e.g. adaptive icon foreground layers).
    Never,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mask {
    #[default]
    None,
    Circle,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppleSlot {
    pub idiom: String,
    pub size: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

fn one() -> f32 {
    1.0
}

const PRESET_SOURCES: &[&str] = &[
    include_str!("../presets/ios.json"),
    include_str!("../presets/ios-single.json"),
    include_str!("../presets/watchos.json"),
    include_str!("../presets/macos.json"),
    include_str!("../presets/android.json"),
    include_str!("../presets/windows.json"),
    include_str!("../presets/web.json"),
];

/// All built-in platforms, in display order.
pub fn builtin_platforms() -> &'static [PlatformSpec] {
    static PLATFORMS: OnceLock<Vec<PlatformSpec>> = OnceLock::new();
    PLATFORMS.get_or_init(|| {
        PRESET_SOURCES
            .iter()
            .map(|src| serde_json::from_str(src).expect("built-in preset is valid JSON"))
            .collect()
    })
}

pub fn find_platform(id: &str) -> Option<&'static PlatformSpec> {
    builtin_platforms().iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::export::is_safe_relative_path;

    #[test]
    fn builtin_presets_are_well_formed() {
        let platforms = builtin_platforms();
        assert_eq!(platforms.len(), PRESET_SOURCES.len());

        let mut ids = HashSet::new();
        for platform in platforms {
            assert!(ids.insert(&platform.id), "duplicate platform id {}", platform.id);

            let mut paths = HashSet::new();
            for file in &platform.files {
                let path = file.path();
                assert!(is_safe_relative_path(path), "{}: unsafe path {path}", platform.id);
                assert!(paths.insert(path), "{}: duplicate path {path}", platform.id);

                match file {
                    FileSpec::Png { px, content_scale, .. } => {
                        assert!(*px > 0 && *px <= 4096, "{path}: bad px");
                        assert!(*content_scale > 0.0 && *content_scale <= 1.0, "{path}: bad scale");
                    }
                    FileSpec::Ico { sizes, .. } => {
                        assert!(!sizes.is_empty());
                        assert!(sizes.iter().all(|s| (1..=256).contains(s)), "{path}: ico sizes");
                    }
                    _ => {}
                }
            }
        }
    }

    #[test]
    fn variants_point_at_a_base_platform_and_share_its_folder() {
        for platform in builtin_platforms().iter().filter(|p| p.variant_of.is_some()) {
            let base = find_platform(platform.family()).expect("variant base exists");
            assert!(base.variant_of.is_none(), "{}: variants must not chain", platform.id);
            assert_eq!(platform.output_dir(), base.output_dir(), "{}", platform.id);
        }
    }

    #[test]
    fn apple_contents_only_where_slots_exist() {
        for platform in builtin_platforms() {
            let has_contents =
                platform.files.iter().any(|f| matches!(f, FileSpec::AppleContents { .. }));
            let has_slots = platform
                .files
                .iter()
                .any(|f| matches!(f, FileSpec::Png { apple, .. } if !apple.is_empty()));
            assert_eq!(has_contents, has_slots, "{}", platform.id);
        }
    }
}
