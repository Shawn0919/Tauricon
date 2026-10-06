//! Visual styling applied while composing icons: backgrounds (solid or
//! gradient), rounded corners and the macOS icon template (inset body,
//! rounded corners, drop shadow).

use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Color {
    pub const WHITE: Color = Color {
        r: 255,
        g: 255,
        b: 255,
    };

    pub fn hex(self) -> String {
        format!("#{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }

    fn lerp(self, other: Color, t: f32) -> Rgba<u8> {
        let mix = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
        Rgba([
            mix(self.r, other.r),
            mix(self.g, other.g),
            mix(self.b, other.b),
            255,
        ])
    }

    fn rgba(self) -> Rgba<u8> {
        Rgba([self.r, self.g, self.b, 255])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Background {
    Solid {
        color: Color,
    },
    /// CSS-style linear gradient: `angle` in degrees, 0 = bottom→top,
    /// 90 = left→right, 180 = top→bottom.
    LinearGradient {
        from: Color,
        to: Color,
        #[serde(default = "default_angle")]
        angle: f32,
    },
}

fn default_angle() -> f32 {
    180.0
}

impl Background {
    pub fn solid(color: Color) -> Self {
        Background::Solid { color }
    }

    /// A single representative color, for outputs that can't hold a gradient
    /// (e.g. Android's `ic_launcher_background` color resource).
    pub fn primary_color(&self) -> Color {
        match *self {
            Background::Solid { color } => color,
            Background::LinearGradient { from, .. } => from,
        }
    }

    /// An opaque `size`×`size` image filled with this background.
    pub(crate) fn paint(&self, size: u32) -> RgbaImage {
        match *self {
            Background::Solid { color } => RgbaImage::from_pixel(size, size, color.rgba()),
            Background::LinearGradient { from, to, angle } => {
                // Same geometry as CSS linear-gradient on a square box.
                let (sin, cos) = angle.to_radians().sin_cos();
                let (dx, dy) = (sin, -cos);
                let s = size as f32;
                let length = s * (sin.abs() + cos.abs());
                let center = s / 2.0;
                RgbaImage::from_fn(size, size, |x, y| {
                    let px = x as f32 + 0.5 - center;
                    let py = y as f32 + 0.5 - center;
                    let t = ((px * dx + py * dy) / length + 0.5).clamp(0.0, 1.0);
                    from.lerp(to, t)
                })
            }
        }
    }
}

/// How the icon body sits on the canvas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Shape {
    /// Body size as a fraction of the canvas.
    pub inset: f32,
    /// Corner radius as a fraction of the body size (0.5 = circle).
    pub radius: f32,
    pub shadow: bool,
}

/// Apple's macOS icon grid (Big Sur and later): an 824px body on a 1024px
/// canvas with ~185px continuous corners and a soft drop shadow below.
const MACOS_BODY: f32 = 824.0 / 1024.0;
const MACOS_RADIUS: f32 = 185.4 / 824.0;
const SHADOW_OFFSET_Y: f32 = 12.0 / 1024.0;
const SHADOW_BLUR: f32 = 14.0 / 1024.0;
const SHADOW_OPACITY: f32 = 0.3;

/// Largest corner radius a user may pick (a circle).
pub const MAX_CORNER_RADIUS: f32 = 0.5;

impl Shape {
    pub const FULL_BLEED: Shape = Shape {
        inset: 1.0,
        radius: 0.0,
        shadow: false,
    };

    pub const MACOS: Shape = Shape {
        inset: MACOS_BODY,
        radius: MACOS_RADIUS,
        shadow: true,
    };

    pub fn rounded(radius: f32) -> Shape {
        Shape {
            radius: radius.clamp(0.0, MAX_CORNER_RADIUS),
            ..Shape::FULL_BLEED
        }
    }

    pub fn body_px(self, px: u32) -> u32 {
        ((px as f32 * self.inset).round() as u32).clamp(1, px)
    }
}

/// Clips `image` to a rounded square with anti-aliased edges.
pub(crate) fn round_corners(image: &mut RgbaImage, radius: f32) {
    let size = image.width() as f32;
    let r = (radius.clamp(0.0, MAX_CORNER_RADIUS) * size).max(0.0);
    if r <= 0.0 {
        return;
    }
    let half = size / 2.0;
    let inner = half - r;
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        // Signed distance to a rounded box centered in the image.
        let qx = (x as f32 + 0.5 - half).abs() - inner;
        let qy = (y as f32 + 0.5 - half).abs() - inner;
        let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
        let distance = outside + qx.max(qy).min(0.0) - r;
        let coverage = (0.5 - distance).clamp(0.0, 1.0);
        if coverage < 1.0 {
            pixel[3] = (pixel[3] as f32 * coverage).round() as u8;
        }
    }
}

/// Draws a soft black shadow of `body`'s alpha onto `canvas`, as if `body`
/// were placed at (`offset`, `offset`).
pub(crate) fn draw_shadow(canvas: &mut RgbaImage, body: &RgbaImage, offset: u32) {
    let px = canvas.width() as usize;
    let dy = (SHADOW_OFFSET_Y * px as f32).round() as usize;
    let mut alpha = vec![0f32; px * px];
    for (x, y, pixel) in body.enumerate_pixels() {
        let (cx, cy) = (
            x as usize + offset as usize,
            y as usize + offset as usize + dy,
        );
        if cx < px && cy < px {
            alpha[cy * px + cx] = pixel[3] as f32 / 255.0;
        }
    }

    // Three box blurs approximate a Gaussian.
    let radius = (SHADOW_BLUR * px as f32).round() as usize;
    if radius > 0 {
        for _ in 0..3 {
            box_blur(&mut alpha, px, radius);
        }
    }

    for (i, pixel) in canvas.pixels_mut().enumerate() {
        let a = alpha[i] * SHADOW_OPACITY;
        if a > 0.0 {
            // Source-over black onto whatever is already there.
            let base = pixel[3] as f32 / 255.0;
            let out = a + base * (1.0 - a);
            for c in 0..3 {
                pixel[c] = if out > 0.0 {
                    (pixel[c] as f32 * base * (1.0 - a) / out).round() as u8
                } else {
                    0
                };
            }
            pixel[3] = (out * 255.0).round() as u8;
        }
    }
}

/// Separable box blur over a square `size`×`size` buffer; outside is zero.
fn box_blur(data: &mut [f32], size: usize, radius: usize) {
    let width = (2 * radius + 1) as f32;
    let mut line = vec![0f32; size];
    for pass in 0..2 {
        for i in 0..size {
            let at = |j: usize| {
                if pass == 0 {
                    i * size + j
                } else {
                    j * size + i
                }
            };
            let mut sum: f32 = (0..=radius.min(size - 1)).map(|j| data[at(j)]).sum();
            for (j, slot) in line.iter_mut().enumerate() {
                *slot = sum / width;
                if j + radius + 1 < size {
                    sum += data[at(j + radius + 1)];
                }
                if j >= radius {
                    sum -= data[at(j - radius)];
                }
            }
            for (j, &value) in line.iter().enumerate() {
                data[at(j)] = value;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Color = Color { r: 255, g: 0, b: 0 };
    const BLUE: Color = Color { r: 0, g: 0, b: 255 };

    #[test]
    fn vertical_gradient_runs_top_to_bottom() {
        let bg = Background::LinearGradient {
            from: RED,
            to: BLUE,
            angle: 180.0,
        };
        let img = bg.paint(100);
        let top = img.get_pixel(50, 0);
        let bottom = img.get_pixel(50, 99);
        assert!(top[0] > 250 && top[2] < 5, "top is red: {top:?}");
        assert!(
            bottom[2] > 250 && bottom[0] < 5,
            "bottom is blue: {bottom:?}"
        );
        assert_eq!(
            img.get_pixel(0, 50),
            img.get_pixel(99, 50),
            "rows are uniform"
        );
    }

    #[test]
    fn horizontal_gradient_runs_left_to_right() {
        let bg = Background::LinearGradient {
            from: RED,
            to: BLUE,
            angle: 90.0,
        };
        let img = bg.paint(100);
        assert!(img.get_pixel(0, 50)[0] > 250);
        assert!(img.get_pixel(99, 50)[2] > 250);
    }

    #[test]
    fn rounded_corners_clear_corners_only() {
        let mut img = RgbaImage::from_pixel(100, 100, Rgba([1, 2, 3, 255]));
        round_corners(&mut img, 0.25);
        assert_eq!(img.get_pixel(0, 0)[3], 0);
        assert_eq!(img.get_pixel(99, 99)[3], 0);
        assert_eq!(img.get_pixel(50, 0)[3], 255, "edge midpoints stay");
        assert_eq!(img.get_pixel(50, 50)[3], 255);
    }

    #[test]
    fn half_radius_is_a_circle() {
        let mut img = RgbaImage::from_pixel(100, 100, Rgba([1, 2, 3, 255]));
        round_corners(&mut img, 0.5);
        // (10, 10) is inside a 0.25 rounded square but outside the circle.
        assert_eq!(img.get_pixel(10, 10)[3], 0);
    }

    #[test]
    fn shadow_darkens_below_the_body() {
        let body = RgbaImage::from_pixel(80, 80, Rgba([255, 255, 255, 255]));
        let mut canvas = RgbaImage::new(100, 100);
        draw_shadow(&mut canvas, &body, 10);
        assert!(
            canvas.get_pixel(50, 92)[3] > 0,
            "shadow spills below the body"
        );
        assert_eq!(canvas.get_pixel(50, 0)[3], 0, "nothing far above");
    }
}
