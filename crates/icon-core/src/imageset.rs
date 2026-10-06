//! Image sets: in-app images at every screen density, as Xcode image sets
//! (@1x/@2x/@3x + `Contents.json`) and Android drawables (mdpi…xxxhdpi).

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::generate::{GeneratedFile, encode_png, optimize_png};
use crate::source::{MAX_RASTER_DIMENSION, Source, SourceKind};

const IOS_SCALES: &[(&str, f32)] = &[("1x", 1.0), ("2x", 2.0), ("3x", 3.0)];
const ANDROID_DENSITIES: &[(&str, f32)] = &[
    ("mdpi", 1.0),
    ("hdpi", 1.5),
    ("xhdpi", 2.0),
    ("xxhdpi", 3.0),
    ("xxxhdpi", 4.0),
];
/// Largest density multiplier, which bounds the biggest output image.
const MAX_SCALE: f32 = 4.0;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSetOptions {
    /// Xcode image set (`ios/<name>.imageset/`).
    #[serde(default)]
    pub ios: bool,
    /// Android drawables (`android/res/drawable-<density>/<name>.png`).
    #[serde(default)]
    pub android: bool,
    #[serde(default)]
    pub optimize_png: bool,
}

/// The @1x (mdpi) size used when the user doesn't pick one: raster images
/// are assumed to be @3x, vector images use their own width/height.
pub fn default_base_size(source: &Source) -> (u32, u32) {
    let (w, h) = source.size();
    let divisor = match source.kind() {
        SourceKind::Raster => 3.0,
        SourceKind::Vector => 1.0,
    };
    (
        ((w / divisor).round() as u32).max(1),
        ((h / divisor).round() as u32).max(1),
    )
}

/// @1x size for a chosen width, keeping the source's aspect ratio.
pub fn base_size(source: &Source, base_width: Option<u32>) -> (u32, u32) {
    match base_width {
        Some(width) => {
            let (w, h) = source.size();
            let width = width.max(1);
            (width, ((width as f32 * h / w).round() as u32).max(1))
        }
        None => default_base_size(source),
    }
}

/// Generates one image at every density for the selected targets.
pub fn generate_image_set(
    source: &Source,
    name: &str,
    base_width: Option<u32>,
    options: &ImageSetOptions,
) -> Result<Vec<GeneratedFile>> {
    let (base_w, base_h) = base_size(source, base_width);
    let largest = (base_w.max(base_h) as f32 * MAX_SCALE).round() as u32;
    if largest > MAX_RASTER_DIMENSION {
        return Err(Error::DimensionsTooLarge {
            width: (base_w as f32 * MAX_SCALE) as u32,
            height: (base_h as f32 * MAX_SCALE) as u32,
            limit: MAX_RASTER_DIMENSION,
        });
    }

    let ios_name = ios_asset_name(name);
    let android_name = android_resource_name(name);

    // (output path, scale) for every image to render.
    let mut images: Vec<(String, f32)> = Vec::new();
    if options.ios {
        for &(scale_name, scale) in IOS_SCALES {
            images.push((
                format!(
                    "ios/{ios_name}.imageset/{}",
                    ios_file_name(&ios_name, scale_name)
                ),
                scale,
            ));
        }
    }
    if options.android {
        for &(density, scale) in ANDROID_DENSITIES {
            images.push((
                format!("android/res/drawable-{density}/{android_name}.png"),
                scale,
            ));
        }
    }

    let mut files: Vec<GeneratedFile> = images
        .par_iter()
        .map(|(path, scale)| {
            let width = ((base_w as f32 * scale).round() as u32).max(1);
            let height = ((base_h as f32 * scale).round() as u32).max(1);
            let image = source.render_box(width, height)?;
            let png = encode_png(image, false).map_err(|message| Error::Encode {
                path: path.clone(),
                message,
            })?;
            let bytes = if options.optimize_png {
                optimize_png(png)
            } else {
                png
            };
            Ok(GeneratedFile {
                path: path.clone(),
                bytes,
            })
        })
        .collect::<Result<_>>()?;

    if options.ios {
        files.push(GeneratedFile {
            path: format!("ios/{ios_name}.imageset/Contents.json"),
            bytes: ios_contents_json(&ios_name),
        });
    }
    Ok(files)
}

fn ios_file_name(name: &str, scale: &str) -> String {
    if scale == "1x" {
        format!("{name}.png")
    } else {
        format!("{name}@{scale}.png")
    }
}

fn ios_contents_json(name: &str) -> Vec<u8> {
    let images: Vec<_> = IOS_SCALES
        .iter()
        .map(|(scale, _)| {
            serde_json::json!({
                "filename": ios_file_name(name, scale),
                "idiom": "universal",
                "scale": scale,
            })
        })
        .collect();
    let json = serde_json::json!({
        "images": images,
        "info": { "author": "xcode", "version": 1 },
    });
    let mut out = serde_json::to_vec_pretty(&json).expect("contents serialize");
    out.push(b'\n');
    out
}

/// Xcode accepts most characters in asset names; only strip ones that are
/// invalid in file names.
pub fn ios_asset_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if cleaned.is_empty() {
        "image".to_string()
    } else {
        cleaned.to_string()
    }
}

/// Android resource names allow only `[a-z0-9_]` and must start with a letter.
pub fn android_resource_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    let out = out.trim_matches('_');
    match out.chars().next() {
        None => "image".to_string(),
        Some(first) if !first.is_ascii_lowercase() => format!("img_{out}"),
        Some(_) => out.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageFormat, ImageReader, Rgba, RgbaImage};

    use super::*;

    fn raster(width: u32, height: u32) -> Source {
        let img = RgbaImage::from_pixel(width, height, Rgba([10, 20, 30, 255]));
        let mut png = Cursor::new(Vec::new());
        img.write_to(&mut png, ImageFormat::Png).unwrap();
        Source::from_bytes(png.get_ref(), None).unwrap()
    }

    fn dims(bytes: &[u8]) -> (u32, u32) {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap()
    }

    fn both() -> ImageSetOptions {
        ImageSetOptions {
            ios: true,
            android: true,
            optimize_png: false,
        }
    }

    #[test]
    fn raster_is_treated_as_3x_and_keeps_aspect_ratio() {
        let files = generate_image_set(&raster(300, 150), "Banner", None, &both()).unwrap();
        let size = |path: &str| dims(&files.iter().find(|f| f.path == path).unwrap().bytes);

        assert_eq!(size("ios/Banner.imageset/Banner.png"), (100, 50));
        assert_eq!(size("ios/Banner.imageset/Banner@2x.png"), (200, 100));
        assert_eq!(size("ios/Banner.imageset/Banner@3x.png"), (300, 150));
        assert_eq!(size("android/res/drawable-mdpi/banner.png"), (100, 50));
        assert_eq!(size("android/res/drawable-hdpi/banner.png"), (150, 75));
        assert_eq!(size("android/res/drawable-xxxhdpi/banner.png"), (400, 200));
        assert_eq!(files.len(), 3 + 1 + 5);
    }

    #[test]
    fn explicit_base_width_and_vector_default() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12">
            <rect width="24" height="12" fill="#000"/></svg>"##;
        let vector = Source::from_bytes(svg.as_bytes(), None).unwrap();
        assert_eq!(default_base_size(&vector), (24, 12));
        assert_eq!(base_size(&vector, Some(40)), (40, 20));

        let options = ImageSetOptions {
            ios: true,
            ..Default::default()
        };
        let files = generate_image_set(&vector, "icon", Some(40), &options).unwrap();
        let at3x = files
            .iter()
            .find(|f| f.path.ends_with("icon@3x.png"))
            .unwrap();
        assert_eq!(dims(&at3x.bytes), (120, 60));
        assert!(files.iter().all(|f| f.path.starts_with("ios/")));
    }

    #[test]
    fn contents_json_lists_all_scales() {
        let options = ImageSetOptions {
            ios: true,
            ..Default::default()
        };
        let files = generate_image_set(&raster(30, 30), "Logo", None, &options).unwrap();
        let contents = files
            .iter()
            .find(|f| f.path == "ios/Logo.imageset/Contents.json")
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&contents.bytes).unwrap();
        let names: Vec<_> = json["images"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["filename"].as_str().unwrap(),
                    e["scale"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            names,
            [
                ("Logo.png", "1x"),
                ("Logo@2x.png", "2x"),
                ("Logo@3x.png", "3x")
            ]
        );
    }

    #[test]
    fn oversized_outputs_are_rejected() {
        let err = generate_image_set(&raster(30, 30), "x", Some(5000), &both()).unwrap_err();
        assert!(matches!(err, Error::DimensionsTooLarge { .. }));
    }

    #[test]
    fn names_are_sanitized_per_platform() {
        assert_eq!(android_resource_name("My Icon-2"), "my_icon_2");
        assert_eq!(android_resource_name("3D view"), "img_3d_view");
        assert_eq!(android_resource_name("  ***  "), "image");
        assert_eq!(android_resource_name("中文名稱"), "image");
        assert_eq!(ios_asset_name("Hero/Image?"), "Hero-Image-");
        assert_eq!(ios_asset_name("  ..  "), "image");
        assert_eq!(ios_asset_name("首頁 Banner"), "首頁 Banner");
    }
}
