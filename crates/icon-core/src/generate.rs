//! Turns a [`Source`] plus a set of platform specs into in-memory output files.

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};

use icns::{IconFamily, IconType, PixelFormat};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::source::Source;
use crate::spec::{find_platform, AppleSlot, FileSpec, Fill, Mask, PlatformSpec};

/// Largest allowed padding, as a fraction of the icon size on each side.
pub const MAX_PADDING: f32 = 0.4;

/// Every image an `.icns` file carries, matching what `iconutil` produces.
const ICNS_TYPES: &[IconType] = &[
    IconType::RGBA32_16x16,
    IconType::RGBA32_16x16_2x,
    IconType::RGBA32_32x32,
    IconType::RGBA32_32x32_2x,
    IconType::RGBA32_128x128,
    IconType::RGBA32_128x128_2x,
    IconType::RGBA32_256x256,
    IconType::RGBA32_256x256_2x,
    IconType::RGBA32_512x512,
    IconType::RGBA32_512x512_2x,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Color {
    pub const WHITE: Color = Color { r: 255, g: 255, b: 255 };

    pub fn hex(self) -> String {
        format!("#{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }

    fn rgba(self) -> Rgba<u8> {
        Rgba([self.r, self.g, self.b, 255])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOptions {
    /// Platform ids from the built-in presets, e.g. `["ios", "android"]`.
    pub platforms: Vec<String>,
    /// Background placed behind the artwork; `None` keeps transparency where allowed.
    #[serde(default)]
    pub background: Option<Color>,
    /// Empty space on each side, as a fraction of the icon size (0.0..=0.4).
    #[serde(default)]
    pub padding: f32,
    /// Losslessly recompress PNG files (smaller output, slower).
    #[serde(default)]
    pub optimize_png: bool,
}

#[derive(Debug, Clone)]
pub struct GeneratedFile {
    /// Relative path with `/` separators, prefixed by the platform id.
    pub path: String,
    pub bytes: Vec<u8>,
}

/// Generates every file for the selected platforms.
///
/// `on_progress(done, total)` may be called from multiple threads.
pub fn generate(
    source: &Source,
    options: &GenerateOptions,
    on_progress: impl Fn(usize, usize) + Sync,
) -> Result<Vec<GeneratedFile>> {
    let platforms = resolve_platforms(&options.platforms)?;
    let padding = options.padding.clamp(0.0, MAX_PADDING);

    let jobs: Vec<(&PlatformSpec, &FileSpec)> = platforms
        .iter()
        .flat_map(|p| p.files.iter().map(move |f| (*p, f)))
        .collect();

    // Many files share a size, so render each distinct artwork size only once.
    let sizes: BTreeSet<u32> = jobs
        .iter()
        .flat_map(|(_, file)| artwork_sizes(file, padding))
        .collect();

    let total = sizes.len() + jobs.len();
    let done = AtomicUsize::new(0);
    let tick = || on_progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);

    let renders: HashMap<u32, RgbaImage> = sizes
        .par_iter()
        .map(|&px| {
            let image = source.render(px)?;
            tick();
            Ok((px, image))
        })
        .collect::<Result<_>>()?;

    let ctx = Context {
        renders,
        background: options.background,
        padding,
        optimize_png: options.optimize_png,
    };
    jobs.par_iter()
        .map(|(platform, file)| {
            let bytes = ctx.build(platform, file)?;
            tick();
            Ok(GeneratedFile { path: output_path(platform, file), bytes })
        })
        .collect()
}

fn output_path(platform: &PlatformSpec, file: &FileSpec) -> String {
    format!("{}/{}", platform.output_dir(), file.path())
}

fn resolve_platforms(ids: &[String]) -> Result<Vec<&'static PlatformSpec>> {
    let mut platforms: Vec<&PlatformSpec> = Vec::new();
    for id in ids {
        let platform = find_platform(id).ok_or_else(|| Error::UnknownPlatform(id.clone()))?;
        match platforms.iter().find(|p| p.family() == platform.family()) {
            Some(existing) if existing.id == platform.id => {}
            Some(existing) => {
                return Err(Error::PlatformConflict(existing.id.clone(), platform.id.clone()));
            }
            None => platforms.push(platform),
        }
    }
    Ok(platforms)
}

/// Size of the artwork inside a `px` canvas after padding and scaling.
fn artwork_px(px: u32, padding: f32, content_scale: f32) -> u32 {
    let size = px as f32 * (1.0 - 2.0 * padding) * content_scale;
    (size.round() as u32).clamp(1, px)
}

fn artwork_sizes(file: &FileSpec, padding: f32) -> Vec<u32> {
    match file {
        FileSpec::Png { px, content_scale, .. } => vec![artwork_px(*px, padding, *content_scale)],
        FileSpec::Ico { sizes, .. } => sizes.iter().map(|&s| artwork_px(s, padding, 1.0)).collect(),
        FileSpec::Icns { .. } => ICNS_TYPES
            .iter()
            .map(|t| artwork_px(t.pixel_width(), padding, 1.0))
            .collect(),
        FileSpec::AppleContents { .. } | FileSpec::Text { .. } => Vec::new(),
    }
}

struct Context {
    renders: HashMap<u32, RgbaImage>,
    background: Option<Color>,
    padding: f32,
    optimize_png: bool,
}

impl Context {
    fn build(&self, platform: &PlatformSpec, file: &FileSpec) -> Result<Vec<u8>> {
        let encode_err = |message: String| Error::Encode { path: output_path(platform, file), message };

        match file {
            FileSpec::Png { px, fill, mask, content_scale, strip_alpha, .. } => {
                let mut background = self.resolve_fill(fill.unwrap_or(platform.fill));
                if *strip_alpha {
                    // Dropping alpha without a background would turn transparency black.
                    background = background.or(Some(Color::WHITE));
                }
                let image = self.compose(*px, *content_scale, background, *mask);
                let png = encode_png(image, *strip_alpha).map_err(encode_err)?;
                Ok(if self.optimize_png { optimize_png(png) } else { png })
            }
            FileSpec::Ico { sizes, .. } => {
                let background = self.resolve_fill(platform.fill);
                let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
                for &size in sizes {
                    let image = self.compose(size, 1.0, background, Mask::None);
                    let icon = ico::IconImage::from_rgba_data(size, size, image.into_raw());
                    let entry =
                        ico::IconDirEntry::encode(&icon).map_err(|e| encode_err(e.to_string()))?;
                    dir.add_entry(entry);
                }
                let mut out = Vec::new();
                dir.write(&mut out).map_err(|e| encode_err(e.to_string()))?;
                Ok(out)
            }
            FileSpec::Icns { .. } => {
                let background = self.resolve_fill(platform.fill);
                let mut family = IconFamily::new();
                for &icon_type in ICNS_TYPES {
                    let size = icon_type.pixel_width();
                    let image = self.compose(size, 1.0, background, Mask::None);
                    let icon = icns::Image::from_data(PixelFormat::RGBA, size, size, image.into_raw())
                        .map_err(|e| encode_err(e.to_string()))?;
                    family
                        .add_icon_with_type(&icon, icon_type)
                        .map_err(|e| encode_err(e.to_string()))?;
                }
                let mut out = Vec::new();
                family.write(&mut out).map_err(|e| encode_err(e.to_string()))?;
                Ok(out)
            }
            FileSpec::AppleContents { path } => Ok(apple_contents_json(platform, path)),
            FileSpec::Text { template, .. } => {
                let background = self.background.unwrap_or(Color::WHITE);
                Ok(template.replace("{{background_hex}}", &background.hex()).into_bytes())
            }
        }
    }

    fn resolve_fill(&self, fill: Fill) -> Option<Color> {
        match fill {
            Fill::Auto => self.background,
            Fill::Always => Some(self.background.unwrap_or(Color::WHITE)),
            Fill::Never => None,
        }
    }

    fn compose(&self, px: u32, content_scale: f32, background: Option<Color>, mask: Mask) -> RgbaImage {
        let art = &self.renders[&artwork_px(px, self.padding, content_scale)];
        compose(art, px, background, mask)
    }
}

/// Renders a single `px` square exactly as a full-bleed output icon would look,
/// for UI previews.
pub fn render_preview(
    source: &Source,
    px: u32,
    background: Option<Color>,
    padding: f32,
) -> Result<RgbaImage> {
    let art = source.render(artwork_px(px, padding.clamp(0.0, MAX_PADDING), 1.0))?;
    Ok(compose(&art, px, background, Mask::None))
}

/// Places pre-rendered artwork centered on a `px` canvas.
fn compose(art: &RgbaImage, px: u32, background: Option<Color>, mask: Mask) -> RgbaImage {
    let offset = i64::from((px - art.width()) / 2);

    let mut canvas = match background {
        Some(color) => {
            let mut canvas = RgbaImage::from_pixel(px, px, color.rgba());
            image::imageops::overlay(&mut canvas, art, offset, offset);
            canvas
        }
        None if art.width() == px => art.clone(),
        None => {
            let mut canvas = RgbaImage::new(px, px);
            image::imageops::replace(&mut canvas, art, offset, offset);
            canvas
        }
    };

    if mask == Mask::Circle {
        apply_circle_mask(&mut canvas);
    }
    canvas
}

/// Anti-aliased circular mask inscribed in the image.
fn apply_circle_mask(image: &mut RgbaImage) {
    let radius = image.width() as f32 / 2.0;
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let dx = x as f32 + 0.5 - radius;
        let dy = y as f32 + 0.5 - radius;
        let coverage = (radius - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0);
        pixel[3] = (pixel[3] as f32 * coverage).round() as u8;
    }
}

fn encode_png(image: RgbaImage, strip_alpha: bool) -> std::result::Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    let result = if strip_alpha {
        DynamicImage::ImageRgba8(image).into_rgb8().write_to(&mut out, ImageFormat::Png)
    } else {
        image.write_to(&mut out, ImageFormat::Png)
    };
    result.map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Lossless recompression that keeps the color type and bit depth, so files
/// still meet store rules (e.g. Play Store's 32-bit PNG, App Store's no-alpha).
/// Falls back to the original bytes if optimization fails or doesn't help.
fn optimize_png(png: Vec<u8>) -> Vec<u8> {
    let mut options = oxipng::Options::from_preset(2);
    options.bit_depth_reduction = false;
    options.color_type_reduction = false;
    options.palette_reduction = false;
    options.grayscale_reduction = false;
    match oxipng::optimize_from_memory(&png, &options) {
        Ok(smaller) if smaller.len() < png.len() => smaller,
        _ => png,
    }
}

/// Builds Xcode's `Contents.json` from the platform's PNG slots.
/// Filenames are relative to the directory containing `contents_path`.
fn apple_contents_json(platform: &PlatformSpec, contents_path: &str) -> Vec<u8> {
    #[derive(Serialize)]
    struct Entry<'a> {
        filename: &'a str,
        #[serde(flatten)]
        slot: &'a AppleSlot,
    }

    let dir = contents_path.rsplit_once('/').map_or("", |(dir, _)| dir);
    let images: Vec<Entry> = platform
        .files
        .iter()
        .filter_map(|file| match file {
            FileSpec::Png { path, apple, .. } => {
                let filename = path
                    .strip_prefix(dir)
                    .and_then(|rest| rest.strip_prefix('/'))
                    .unwrap_or(path);
                Some(apple.iter().map(move |slot| Entry { filename, slot }))
            }
            _ => None,
        })
        .flatten()
        .collect();

    let json = serde_json::json!({
        "images": images,
        "info": { "author": "xcode", "version": 1 },
    });
    let mut out = serde_json::to_vec_pretty(&json).expect("contents serialize");
    out.push(b'\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artwork_px_applies_padding_and_scale() {
        assert_eq!(artwork_px(100, 0.0, 1.0), 100);
        assert_eq!(artwork_px(100, 0.1, 1.0), 80);
        assert_eq!(artwork_px(108, 0.0, 0.61), 66);
        assert_eq!(artwork_px(16, MAX_PADDING, 0.1), 1, "never collapses to zero");
    }

    #[test]
    fn circle_mask_clears_corners_and_keeps_center() {
        let mut image = RgbaImage::from_pixel(48, 48, Rgba([1, 2, 3, 255]));
        apply_circle_mask(&mut image);
        assert_eq!(image.get_pixel(0, 0)[3], 0);
        assert_eq!(image.get_pixel(47, 47)[3], 0);
        assert_eq!(image.get_pixel(24, 24)[3], 255);
    }

    #[test]
    fn preview_applies_background_and_padding() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
            <rect width="10" height="10" fill="#000000"/></svg>"##;
        let source = Source::from_bytes(svg.as_bytes(), None).unwrap();
        let bg = Color { r: 255, g: 0, b: 0 };

        let preview = render_preview(&source, 100, Some(bg), 0.2).unwrap();
        assert_eq!(preview.dimensions(), (100, 100));
        assert_eq!(preview.get_pixel(5, 5).0, [255, 0, 0, 255], "padding shows background");
        assert_eq!(preview.get_pixel(50, 50).0, [0, 0, 0, 255], "artwork in the middle");
    }

    #[test]
    fn color_hex_is_uppercase_rrggbb() {
        assert_eq!(Color { r: 255, g: 8, b: 171 }.hex(), "#FF08AB");
    }
}
