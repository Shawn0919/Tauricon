//! Loading input images and rendering them at arbitrary square sizes.
//!
//! Raster inputs are resampled with Lanczos3; SVG inputs are rendered directly
//! at every target size, so small icons stay sharp.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{ImageReader, RgbaImage};
use resvg::{tiny_skia, usvg};

use crate::error::{Error, Result};

/// Largest input file we are willing to read.
pub const MAX_INPUT_BYTES: u64 = 50 * 1024 * 1024;
/// Largest raster width/height we are willing to decode.
pub const MAX_RASTER_DIMENSION: u32 = 16_384;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Raster,
    Vector,
}

pub enum Source {
    Raster(RgbaImage),
    Vector(Box<usvg::Tree>),
}

impl Source {
    /// Opens a PNG, JPEG, WebP or SVG/SVGZ file.
    pub fn open(path: &Path) -> Result<Self> {
        let bytes = std::fs::metadata(path)?.len();
        if bytes > MAX_INPUT_BYTES {
            return Err(Error::InputTooLarge {
                bytes,
                limit: MAX_INPUT_BYTES,
            });
        }
        let data = std::fs::read(path)?;

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if matches!(ext.as_deref(), Some("svg" | "svgz")) {
            // Relative <image href> references resolve next to the SVG file.
            return Self::from_svg(&data, path.parent());
        }
        Self::from_bytes(&data, path.parent())
    }

    /// Detects the format from content: raster formats by magic bytes,
    /// otherwise falls back to SVG if the data looks like XML.
    pub fn from_bytes(data: &[u8], resources_dir: Option<&Path>) -> Result<Self> {
        match Self::from_raster(data) {
            Err(Error::UnsupportedFormat) if looks_like_svg(data) => {
                Self::from_svg(data, resources_dir)
            }
            other => other,
        }
    }

    pub fn from_raster(data: &[u8]) -> Result<Self> {
        let mut reader = ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| Error::Decode(e.to_string()))?;
        if reader.format().is_none() {
            return Err(Error::UnsupportedFormat);
        }

        let (width, height) = reader
            .into_dimensions()
            .map_err(|e| Error::Decode(e.to_string()))?;
        check_dimensions(width, height)?;

        // into_dimensions consumed the reader; build a fresh one to decode.
        reader = ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| Error::Decode(e.to_string()))?;
        let image = reader
            .decode()
            .map_err(|e| Error::Decode(e.to_string()))?
            .into_rgba8();
        Ok(Source::Raster(image))
    }

    pub fn from_svg(data: &[u8], resources_dir: Option<&Path>) -> Result<Self> {
        let options = usvg::Options {
            resources_dir: resources_dir.map(PathBuf::from),
            fontdb: system_fonts(),
            ..Default::default()
        };
        let tree = usvg::Tree::from_data(data, &options).map_err(|e| Error::Svg(e.to_string()))?;
        let size = tree.size();
        if size.width() <= 0.0 || size.height() <= 0.0 {
            return Err(Error::EmptyImage);
        }
        Ok(Source::Vector(Box::new(tree)))
    }

    pub fn kind(&self) -> SourceKind {
        match self {
            Source::Raster(_) => SourceKind::Raster,
            Source::Vector(_) => SourceKind::Vector,
        }
    }

    /// Intrinsic size: pixels for raster, the SVG's width/height for vector.
    pub fn size(&self) -> (f32, f32) {
        match self {
            Source::Raster(img) => (img.width() as f32, img.height() as f32),
            Source::Vector(tree) => (tree.size().width(), tree.size().height()),
        }
    }

    /// Renders the source into a transparent `px`×`px` square.
    /// Non-square sources keep their aspect ratio and are centered.
    pub fn render(&self, px: u32) -> Result<RgbaImage> {
        self.render_box(px, px)
    }

    /// Renders the source into a transparent `width`×`height` box, keeping
    /// its aspect ratio and centering it.
    pub fn render_box(&self, width: u32, height: u32) -> Result<RgbaImage> {
        if width == 0 || height == 0 {
            return Err(Error::EmptyImage);
        }
        match self {
            Source::Raster(img) => render_raster(img, width, height),
            Source::Vector(tree) => Ok(render_vector(tree, width, height)),
        }
    }
}

fn check_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(Error::EmptyImage);
    }
    if width > MAX_RASTER_DIMENSION || height > MAX_RASTER_DIMENSION {
        return Err(Error::DimensionsTooLarge {
            width,
            height,
            limit: MAX_RASTER_DIMENSION,
        });
    }
    Ok(())
}

fn looks_like_svg(data: &[u8]) -> bool {
    // Gzip-compressed SVGZ.
    if data.starts_with(&[0x1f, 0x8b]) {
        return true;
    }
    let head = &data[..data.len().min(4096)];
    String::from_utf8_lossy(head).contains("<svg")
}

/// System fonts are loaded once and shared; only SVGs containing text need them.
fn system_fonts() -> Arc<usvg::fontdb::Database> {
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut db = usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

/// Scale and size of a `w`×`h` image fitted inside a `bw`×`bh` box.
fn fit(w: f32, h: f32, bw: u32, bh: u32) -> (f32, u32, u32) {
    let scale = (bw as f32 / w).min(bh as f32 / h);
    let fw = ((w * scale).round() as u32).clamp(1, bw);
    let fh = ((h * scale).round() as u32).clamp(1, bh);
    (scale, fw, fh)
}

fn render_raster(img: &RgbaImage, bw: u32, bh: u32) -> Result<RgbaImage> {
    let (_, fw, fh) = fit(img.width() as f32, img.height() as f32, bw, bh);

    let resized = if (fw, fh) == img.dimensions() {
        img.clone()
    } else {
        let mut dst = RgbaImage::new(fw, fh);
        // Alpha is premultiplied during resampling by default, avoiding dark fringes.
        let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
        Resizer::new()
            .resize(img, &mut dst, &options)
            .map_err(|e| Error::Decode(e.to_string()))?;
        dst
    };

    if (fw, fh) == (bw, bh) {
        return Ok(resized);
    }
    let mut canvas = RgbaImage::new(bw, bh);
    image::imageops::replace(
        &mut canvas,
        &resized,
        i64::from((bw - fw) / 2),
        i64::from((bh - fh) / 2),
    );
    Ok(canvas)
}

fn render_vector(tree: &usvg::Tree, bw: u32, bh: u32) -> RgbaImage {
    let size = tree.size();
    let (scale, _, _) = fit(size.width(), size.height(), bw, bh);
    let dx = (bw as f32 - size.width() * scale) / 2.0;
    let dy = (bh as f32 - size.height() * scale) / 2.0;

    let mut pixmap = tiny_skia::Pixmap::new(bw, bh).expect("size is non-zero");
    let transform = tiny_skia::Transform::from_row(scale, 0.0, 0.0, scale, dx, dy);
    resvg::render(tree, transform, &mut pixmap.as_mut());

    // tiny-skia stores premultiplied alpha; image expects straight alpha.
    let data = pixmap
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    RgbaImage::from_raw(bw, bh, data).expect("buffer matches dimensions")
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgba};

    fn png_bytes(img: &RgbaImage) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    const RED_SQUARE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#ff0000"/></svg>"##;

    #[test]
    fn raster_square_resizes_to_target() {
        let src = RgbaImage::from_pixel(1024, 1024, Rgba([10, 20, 30, 255]));
        let source = Source::from_bytes(&png_bytes(&src), None).unwrap();
        assert_eq!(source.kind(), SourceKind::Raster);

        let out = source.render(29).unwrap();
        assert_eq!(out.dimensions(), (29, 29));
        assert_eq!(out.get_pixel(14, 14), &Rgba([10, 20, 30, 255]));
    }

    #[test]
    fn raster_non_square_is_centered_with_transparent_bars() {
        let src = RgbaImage::from_pixel(200, 100, Rgba([0, 255, 0, 255]));
        let source = Source::from_bytes(&png_bytes(&src), None).unwrap();

        let out = source.render(100).unwrap();
        assert_eq!(out.dimensions(), (100, 100));
        assert_eq!(out.get_pixel(50, 10)[3], 0, "top bar should be transparent");
        assert_eq!(out.get_pixel(50, 50), &Rgba([0, 255, 0, 255]));
    }

    #[test]
    fn svg_renders_at_exact_size() {
        let source = Source::from_bytes(RED_SQUARE_SVG.as_bytes(), None).unwrap();
        assert_eq!(source.kind(), SourceKind::Vector);

        for px in [16, 1024] {
            let out = source.render(px).unwrap();
            assert_eq!(out.dimensions(), (px, px));
            assert_eq!(out.get_pixel(0, 0), &Rgba([255, 0, 0, 255]));
            assert_eq!(out.get_pixel(px - 1, px - 1), &Rgba([255, 0, 0, 255]));
        }
    }

    #[test]
    fn svg_without_viewbox_uses_width_and_height() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="50" height="25">
            <rect width="50" height="25" fill="#0000ff"/></svg>"##;
        let source = Source::from_bytes(svg.as_bytes(), None).unwrap();
        assert_eq!(source.size(), (50.0, 25.0));

        let out = source.render(100).unwrap();
        assert_eq!(out.get_pixel(50, 5)[3], 0);
        assert_eq!(out.get_pixel(50, 50), &Rgba([0, 0, 255, 255]));
    }

    #[test]
    fn garbage_is_rejected() {
        assert!(matches!(
            Source::from_bytes(b"definitely not an image", None),
            Err(Error::UnsupportedFormat)
        ));
    }

    #[test]
    fn broken_svg_reports_svg_error() {
        assert!(matches!(
            Source::from_bytes(b"<svg xmlns=\"http://www.w3.org/2000/svg\"", None),
            Err(Error::Svg(_))
        ));
    }
}
