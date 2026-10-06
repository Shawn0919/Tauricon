//! Turns a [`Source`] plus a set of platform specs into in-memory output files.

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};

use icns::{IconFamily, IconType, PixelFormat};
use image::{DynamicImage, ImageFormat, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::source::Source;
use crate::spec::{AppleSlot, FileSpec, Fill, Mask, PlatformSpec, ShapeKind, find_platform};
use crate::style::{self, Background, Shape};

pub use crate::style::{Color, MAX_CORNER_RADIUS};

/// Largest allowed padding, as a fraction of the icon size on each side.
pub const MAX_PADDING: f32 = 0.4;
/// Smallest artwork scale a user override may set.
pub const MIN_CONTENT_SCALE: f32 = 0.1;

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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOptions {
    /// Platform ids from the built-in presets, e.g. `["ios", "android"]`.
    #[serde(default)]
    pub platforms: Vec<String>,
    /// Background behind the artwork; `None` keeps transparency where allowed.
    #[serde(default)]
    pub background: Option<Background>,
    /// Empty space on each side, as a fraction of the icon body (0.0..=0.4).
    #[serde(default)]
    pub padding: f32,
    /// Corner radius for platforms the OS doesn't mask (macOS, Windows, Web),
    /// as a fraction of the icon size (0.0..=0.5).
    #[serde(default)]
    pub corner_radius: f32,
    /// Use Apple's macOS icon template (inset body, rounded corners, shadow).
    #[serde(default)]
    pub macos_template: bool,
    /// Losslessly recompress PNG files (smaller output, slower).
    #[serde(default)]
    pub optimize_png: bool,
    /// Skip spec files carrying any of these tags (e.g. `["round"]`).
    #[serde(default)]
    pub disabled_tags: Vec<String>,
    /// Overrides for files' `scale_option`s, e.g. `{"android_foreground_scale": 0.7}`.
    #[serde(default)]
    pub scales: HashMap<String, f32>,
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
    let layout = Layout::new(options);

    let jobs: Vec<(&PlatformSpec, &FileSpec)> = platforms
        .iter()
        .flat_map(|p| p.files.iter().map(move |f| (*p, f)))
        .filter(|(_, f)| {
            f.tag()
                .is_none_or(|tag| !options.disabled_tags.iter().any(|d| d == tag))
        })
        .collect();

    // Many files share a size, so render each distinct artwork size only once.
    let sizes: BTreeSet<u32> = jobs
        .iter()
        .flat_map(|(platform, file)| layout.artwork_sizes(platform, file))
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
        layout,
        optimize_png: options.optimize_png,
    };
    jobs.par_iter()
        .map(|(platform, file)| {
            let bytes = ctx.build(platform, file)?;
            tick();
            Ok(GeneratedFile {
                path: output_path(platform, file),
                bytes,
            })
        })
        .collect()
}

/// Renders one `px` square for UI previews, styled exactly like the main
/// icon of `platform` (or as a plain full-bleed square when `None`).
pub fn render_preview(
    source: &Source,
    px: u32,
    options: &GenerateOptions,
    platform: Option<&str>,
) -> Result<RgbaImage> {
    let layout = Layout::new(options);
    let (shape_kind, fill) = match platform {
        Some(id) => {
            let spec = find_platform(id).ok_or_else(|| Error::UnknownPlatform(id.to_string()))?;
            (spec.shape, spec.fill)
        }
        None => (ShapeKind::System, Fill::Auto),
    };
    let shape = layout.shape(shape_kind);
    let art = source.render(layout.artwork_px(px, shape, 1.0))?;
    Ok(compose(
        &art,
        px,
        shape,
        layout.background(fill).as_ref(),
        Mask::None,
    ))
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
                return Err(Error::PlatformConflict(
                    existing.id.clone(),
                    platform.id.clone(),
                ));
            }
            None => platforms.push(platform),
        }
    }
    Ok(platforms)
}

/// Size of the artwork inside a `body_px` body after padding and scaling.
fn artwork_px(body_px: u32, padding: f32, content_scale: f32) -> u32 {
    let size = body_px as f32 * (1.0 - 2.0 * padding) * content_scale;
    (size.round() as u32).clamp(1, body_px)
}

/// The user's style options, resolved per platform/file. Used both to plan
/// which artwork sizes to pre-render and to compose, so they always agree.
struct Layout<'a> {
    background: Option<Background>,
    padding: f32,
    corner_radius: f32,
    macos_template: bool,
    scales: &'a HashMap<String, f32>,
}

impl<'a> Layout<'a> {
    fn new(options: &'a GenerateOptions) -> Self {
        Layout {
            background: options.background,
            padding: options.padding.clamp(0.0, MAX_PADDING),
            corner_radius: options.corner_radius.clamp(0.0, MAX_CORNER_RADIUS),
            macos_template: options.macos_template,
            scales: &options.scales,
        }
    }

    fn shape(&self, kind: ShapeKind) -> Shape {
        match kind {
            ShapeKind::System => Shape::FULL_BLEED,
            ShapeKind::Macos if self.macos_template => Shape::MACOS,
            ShapeKind::Custom | ShapeKind::Macos => Shape::rounded(self.corner_radius),
        }
    }

    fn background(&self, fill: Fill) -> Option<Background> {
        match fill {
            Fill::Auto => self.background,
            Fill::Always => Some(self.background.unwrap_or(Background::solid(Color::WHITE))),
            Fill::Never => None,
        }
    }

    fn content_scale(&self, content_scale: f32, option: Option<&String>) -> f32 {
        option
            .and_then(|name| self.scales.get(name))
            .map_or(content_scale, |&s| s.clamp(MIN_CONTENT_SCALE, 1.0))
    }

    fn artwork_px(&self, px: u32, shape: Shape, content_scale: f32) -> u32 {
        artwork_px(shape.body_px(px), self.padding, content_scale)
    }

    fn artwork_sizes(&self, platform: &PlatformSpec, file: &FileSpec) -> Vec<u32> {
        let platform_shape = self.shape(platform.shape);
        match file {
            FileSpec::Png {
                px,
                content_scale,
                scale_option,
                shape,
                ..
            } => {
                let shape = shape.map_or(platform_shape, |kind| self.shape(kind));
                let scale = self.content_scale(*content_scale, scale_option.as_ref());
                vec![self.artwork_px(*px, shape, scale)]
            }
            FileSpec::Ico { sizes, .. } => sizes
                .iter()
                .map(|&s| self.artwork_px(s, platform_shape, 1.0))
                .collect(),
            FileSpec::Icns { .. } => ICNS_TYPES
                .iter()
                .map(|t| self.artwork_px(t.pixel_width(), platform_shape, 1.0))
                .collect(),
            FileSpec::AppleContents { .. } | FileSpec::Text { .. } => Vec::new(),
        }
    }
}

struct Context<'a> {
    renders: HashMap<u32, RgbaImage>,
    layout: Layout<'a>,
    optimize_png: bool,
}

impl Context<'_> {
    fn build(&self, platform: &PlatformSpec, file: &FileSpec) -> Result<Vec<u8>> {
        let encode_err = |message: String| Error::Encode {
            path: output_path(platform, file),
            message,
        };
        let platform_shape = self.layout.shape(platform.shape);

        match file {
            FileSpec::Png {
                px,
                fill,
                mask,
                content_scale,
                scale_option,
                strip_alpha,
                shape,
                ..
            } => {
                let mut background = self.layout.background(fill.unwrap_or(platform.fill));
                if *strip_alpha {
                    // Dropping alpha without a background would turn transparency black.
                    background = background.or(Some(Background::solid(Color::WHITE)));
                }
                let shape = shape.map_or(platform_shape, |kind| self.layout.shape(kind));
                let scale = self
                    .layout
                    .content_scale(*content_scale, scale_option.as_ref());
                let image = self.compose(*px, shape, scale, background.as_ref(), *mask);
                let png = encode_png(image, *strip_alpha).map_err(encode_err)?;
                Ok(if self.optimize_png {
                    optimize_png(png)
                } else {
                    png
                })
            }
            FileSpec::Ico { sizes, .. } => {
                let background = self.layout.background(platform.fill);
                let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
                for &size in sizes {
                    let image =
                        self.compose(size, platform_shape, 1.0, background.as_ref(), Mask::None);
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
                let background = self.layout.background(platform.fill);
                let mut family = IconFamily::new();
                for &icon_type in ICNS_TYPES {
                    let size = icon_type.pixel_width();
                    let image =
                        self.compose(size, platform_shape, 1.0, background.as_ref(), Mask::None);
                    let icon =
                        icns::Image::from_data(PixelFormat::RGBA, size, size, image.into_raw())
                            .map_err(|e| encode_err(e.to_string()))?;
                    family
                        .add_icon_with_type(&icon, icon_type)
                        .map_err(|e| encode_err(e.to_string()))?;
                }
                let mut out = Vec::new();
                family
                    .write(&mut out)
                    .map_err(|e| encode_err(e.to_string()))?;
                Ok(out)
            }
            FileSpec::AppleContents { path } => Ok(apple_contents_json(platform, path)),
            FileSpec::Text { template, .. } => {
                let color = self
                    .layout
                    .background
                    .map_or(Color::WHITE, |bg| bg.primary_color());
                Ok(template
                    .replace("{{background_hex}}", &color.hex())
                    .into_bytes())
            }
        }
    }

    fn compose(
        &self,
        px: u32,
        shape: Shape,
        content_scale: f32,
        background: Option<&Background>,
        mask: Mask,
    ) -> RgbaImage {
        let art = &self.renders[&self.layout.artwork_px(px, shape, content_scale)];
        compose(art, px, shape, background, mask)
    }
}

/// Builds one icon: background and centered artwork form the body, which is
/// clipped to `shape`, placed on the canvas (with shadow), then masked.
fn compose(
    art: &RgbaImage,
    px: u32,
    shape: Shape,
    background: Option<&Background>,
    mask: Mask,
) -> RgbaImage {
    let body_px = shape.body_px(px);
    let art_offset = i64::from((body_px - art.width()) / 2);

    let mut body = match background {
        Some(bg) => {
            let mut body = bg.paint(body_px);
            image::imageops::overlay(&mut body, art, art_offset, art_offset);
            body
        }
        None if art.width() == body_px => art.clone(),
        None => {
            let mut body = RgbaImage::new(body_px, body_px);
            image::imageops::replace(&mut body, art, art_offset, art_offset);
            body
        }
    };
    style::round_corners(&mut body, shape.radius);

    let mut canvas = if body_px == px && !shape.shadow {
        body
    } else {
        let offset = (px - body_px) / 2;
        let mut canvas = RgbaImage::new(px, px);
        if shape.shadow {
            style::draw_shadow(&mut canvas, &body, offset);
        }
        image::imageops::overlay(&mut canvas, &body, i64::from(offset), i64::from(offset));
        canvas
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
        DynamicImage::ImageRgba8(image)
            .into_rgb8()
            .write_to(&mut out, ImageFormat::Png)
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
    use image::Rgba;

    use super::*;

    const BLACK_SQUARE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect width="10" height="10" fill="#000000"/></svg>"##;

    fn options(background: Option<Background>, padding: f32) -> GenerateOptions {
        GenerateOptions {
            background,
            padding,
            ..Default::default()
        }
    }

    #[test]
    fn artwork_px_applies_padding_and_scale() {
        assert_eq!(artwork_px(100, 0.0, 1.0), 100);
        assert_eq!(artwork_px(100, 0.1, 1.0), 80);
        assert_eq!(artwork_px(108, 0.0, 0.61), 66);
        assert_eq!(
            artwork_px(16, MAX_PADDING, 0.1),
            1,
            "never collapses to zero"
        );
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
        let source = Source::from_bytes(BLACK_SQUARE_SVG.as_bytes(), None).unwrap();
        let red = Background::solid(Color { r: 255, g: 0, b: 0 });

        let preview = render_preview(&source, 100, &options(Some(red), 0.2), None).unwrap();
        assert_eq!(preview.dimensions(), (100, 100));
        assert_eq!(
            preview.get_pixel(5, 5).0,
            [255, 0, 0, 255],
            "padding shows background"
        );
        assert_eq!(
            preview.get_pixel(50, 50).0,
            [0, 0, 0, 255],
            "artwork in the middle"
        );
    }

    #[test]
    fn corner_radius_only_applies_to_unmasked_platforms() {
        let source = Source::from_bytes(BLACK_SQUARE_SVG.as_bytes(), None).unwrap();
        let opts = GenerateOptions {
            corner_radius: 0.25,
            ..Default::default()
        };
        let windows = render_preview(&source, 100, &opts, Some("windows")).unwrap();
        let ios = render_preview(&source, 100, &opts, Some("ios")).unwrap();
        assert_eq!(windows.get_pixel(1, 1)[3], 0, "Windows corners are rounded");
        assert_eq!(ios.get_pixel(1, 1)[3], 255, "iOS stays a full square");
    }

    #[test]
    fn macos_template_insets_body_and_adds_shadow() {
        let source = Source::from_bytes(BLACK_SQUARE_SVG.as_bytes(), None).unwrap();
        let opts = GenerateOptions {
            macos_template: true,
            ..Default::default()
        };
        let mac = render_preview(&source, 1024, &opts, Some("macos")).unwrap();
        assert_eq!(mac.get_pixel(512, 60)[3], 0, "margin above the body");
        assert_eq!(mac.get_pixel(512, 512)[3], 255, "body in the middle");
        let below = mac.get_pixel(512, 924 + 8);
        assert!(below[3] > 0 && below[0] < 10, "dark shadow under the body");
        assert_eq!(mac.get_pixel(110, 110)[3], 0, "body corners are rounded");
    }

    #[test]
    fn gradient_text_outputs_use_its_first_color() {
        let source = Source::from_bytes(BLACK_SQUARE_SVG.as_bytes(), None).unwrap();
        let opts = GenerateOptions {
            platforms: vec!["android".into()],
            background: Some(Background::LinearGradient {
                from: Color {
                    r: 0x11,
                    g: 0x22,
                    b: 0x33,
                },
                to: Color::WHITE,
                angle: 180.0,
            }),
            ..Default::default()
        };
        let files = generate(&source, &opts, |_, _| {}).unwrap();
        let colors = files
            .iter()
            .find(|f| f.path.ends_with("values/ic_launcher_background.xml"))
            .unwrap();
        assert!(String::from_utf8_lossy(&colors.bytes).contains("#112233"));
    }

    #[test]
    fn color_hex_is_uppercase_rrggbb() {
        assert_eq!(
            Color {
                r: 255,
                g: 8,
                b: 171
            }
            .hex(),
            "#FF08AB"
        );
    }
}
