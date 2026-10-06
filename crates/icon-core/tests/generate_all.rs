use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Mutex;

use icon_core::spec::FileSpec;
use icon_core::{builtin_platforms, generate, Color, GenerateOptions, GeneratedFile, Source};
use image::{ColorType, ImageFormat, ImageReader, Rgba, RgbaImage};

/// Opaque blue circle on a transparent background, so fills and masks are observable.
const CIRCLE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="40" fill="#0000ff"/></svg>"##;

fn raster_source() -> Source {
    let img = RgbaImage::from_fn(1024, 1024, |x, y| Rgba([(x / 4) as u8, (y / 4) as u8, 128, 255]));
    let mut png = Cursor::new(Vec::new());
    img.write_to(&mut png, ImageFormat::Png).unwrap();
    Source::from_bytes(png.get_ref(), None).unwrap()
}

fn all_platform_ids() -> Vec<String> {
    builtin_platforms().iter().filter(|p| p.variant_of.is_none()).map(|p| p.id.clone()).collect()
}

fn generate_all(source: &Source, background: Option<Color>) -> HashMap<String, Vec<u8>> {
    let options = GenerateOptions { platforms: all_platform_ids(), background, padding: 0.0, optimize_png: false };
    let files = generate(source, &options, |_, _| {}).unwrap();
    let count = files.len();
    let map: HashMap<_, _> = files.into_iter().map(|f| (f.path, f.bytes)).collect();
    assert_eq!(map.len(), count, "output paths must be unique");
    map
}

fn decode(bytes: &[u8]) -> image::DynamicImage {
    ImageReader::new(Cursor::new(bytes)).with_guessed_format().unwrap().decode().unwrap()
}

#[test]
fn every_spec_file_is_produced_with_the_right_size() {
    for source in [raster_source(), Source::from_bytes(CIRCLE_SVG.as_bytes(), None).unwrap()] {
        let out = generate_all(&source, None);

        for platform in builtin_platforms().iter().filter(|p| p.variant_of.is_none()) {
            for file in &platform.files {
                let path = format!("{}/{}", platform.output_dir(), file.path());
                let bytes = out.get(&path).unwrap_or_else(|| panic!("missing {path}"));
                if let FileSpec::Png { px, .. } = file {
                    let img = decode(bytes);
                    assert_eq!((img.width(), img.height()), (*px, *px), "{path}");
                }
            }
        }
    }
}

#[test]
fn ios_contents_json_references_existing_opaque_files() {
    let source = Source::from_bytes(CIRCLE_SVG.as_bytes(), None).unwrap();
    let out = generate_all(&source, None);

    let contents: serde_json::Value =
        serde_json::from_slice(&out["ios/AppIcon.appiconset/Contents.json"]).unwrap();
    let images = contents["images"].as_array().unwrap();
    assert_eq!(images.len(), 18, "iPhone + iPad + marketing slots");
    assert_eq!(contents["info"]["author"], "xcode");

    for entry in images {
        let filename = entry["filename"].as_str().unwrap();
        let bytes = &out[&format!("ios/AppIcon.appiconset/{filename}")];
        let img = decode(bytes);
        assert_eq!(img.color(), ColorType::Rgb8, "{filename} must have no alpha channel");
        // Transparent corners of the source become the default white background.
        assert_eq!(img.to_rgb8().get_pixel(0, 0).0, [255, 255, 255], "{filename}");
    }

    let marketing = images.iter().find(|e| e["idiom"] == "ios-marketing").unwrap();
    assert_eq!(marketing["size"], "1024x1024");
}

#[test]
fn android_layers_masks_and_background_color() {
    let source = Source::from_bytes(CIRCLE_SVG.as_bytes(), None).unwrap();
    let bg = Color { r: 0x12, g: 0x34, b: 0x56 };
    let out = generate_all(&source, Some(bg));

    let round = decode(&out["android/res/mipmap-xxxhdpi/ic_launcher_round.png"]).to_rgba8();
    assert_eq!(round.get_pixel(0, 0)[3], 0, "round icon corners are masked");
    assert_eq!(round.get_pixel(96, 96)[3], 255);

    let square = decode(&out["android/res/mipmap-xxxhdpi/ic_launcher.png"]).to_rgba8();
    assert_eq!(square.get_pixel(0, 0).0, [0x12, 0x34, 0x56, 255], "chosen background fills corners");

    let foreground = decode(&out["android/res/mipmap-xxxhdpi/ic_launcher_foreground.png"]).to_rgba8();
    assert_eq!(foreground.get_pixel(0, 0)[3], 0, "foreground layer stays transparent");
    assert_eq!(foreground.get_pixel(216, 216).0, [0, 0, 255, 255], "artwork is centered");

    let colors = String::from_utf8(out["android/res/values/ic_launcher_background.xml"].clone()).unwrap();
    assert!(colors.contains(">#123456<"), "{colors}");
}

#[test]
fn transparent_platforms_keep_alpha_without_background() {
    let source = Source::from_bytes(CIRCLE_SVG.as_bytes(), None).unwrap();
    let out = generate_all(&source, None);

    let mac = decode(&out["macos/AppIcon.appiconset/icon_512.png"]).to_rgba8();
    assert_eq!(mac.get_pixel(0, 0)[3], 0);
    assert_eq!(mac.get_pixel(256, 256).0, [0, 0, 255, 255]);
}

#[test]
fn ico_and_icns_contain_all_sizes() {
    let out = generate_all(&raster_source(), None);

    let ico = ico::IconDir::read(Cursor::new(&out["windows/app.ico"])).unwrap();
    let mut sizes: Vec<u32> = ico.entries().iter().map(|e| e.width()).collect();
    sizes.sort_unstable();
    assert_eq!(sizes, [16, 24, 32, 48, 64, 128, 256]);

    let icns = icns::IconFamily::read(Cursor::new(&out["macos/AppIcon.icns"])).unwrap();
    assert_eq!(icns.available_icons().len(), 10);
    let big = icns.get_icon_with_type(icns::IconType::RGBA32_512x512_2x).unwrap();
    assert_eq!((big.width(), big.height()), (1024, 1024));
}

#[test]
fn padding_shrinks_artwork() {
    let source = Source::from_bytes(CIRCLE_SVG.as_bytes(), None).unwrap();
    let options = GenerateOptions { platforms: vec!["macos".into()], background: None, padding: 0.25, optimize_png: false };
    let files = generate(&source, &options, |_, _| {}).unwrap();
    let file = files.iter().find(|f| f.path == "macos/AppIcon.appiconset/icon_1024.png").unwrap();
    let img = decode(&file.bytes).to_rgba8();

    // Circle radius is 40% of the artwork; artwork is half the canvas -> radius ~205px.
    assert_eq!(img.get_pixel(512, 512)[3], 255);
    assert_eq!(img.get_pixel(512, 512 - 230)[3], 0, "outside the shrunken circle");
}

#[test]
fn progress_reaches_total() {
    let calls = Mutex::new(Vec::new());
    let options = GenerateOptions { platforms: all_platform_ids(), background: None, padding: 0.0, optimize_png: false };
    generate(&raster_source(), &options, |done, total| calls.lock().unwrap().push((done, total))).unwrap();

    let mut calls = calls.into_inner().unwrap();
    calls.sort_unstable();
    let total = calls[0].1;
    assert_eq!(calls.len(), total);
    assert_eq!(calls.last().unwrap().0, total);
}

#[test]
fn unknown_platform_is_an_error() {
    let options = GenerateOptions { platforms: vec!["symbian".into()], background: None, padding: 0.0, optimize_png: false };
    let err = generate(&raster_source(), &options, |_, _| {}).unwrap_err();
    assert!(matches!(err, icon_core::Error::UnknownPlatform(id) if id == "symbian"));
}

#[test]
fn zip_and_folder_export_round_trip() {
    let options = GenerateOptions { platforms: vec!["ios".into(), "android".into()], background: None, padding: 0.0, optimize_png: false };
    let files: Vec<GeneratedFile> = generate(&raster_source(), &options, |_, _| {}).unwrap();

    let zip_bytes = icon_core::write_zip(&files, Cursor::new(Vec::new())).unwrap().into_inner();
    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
    assert_eq!(archive.len(), files.len());
    assert!(archive.by_name("ios/AppIcon.appiconset/Contents.json").is_ok());

    let dir = std::env::temp_dir().join(format!("icon-core-test-{}", std::process::id()));
    icon_core::write_to_folder(&files, &dir).unwrap();
    for file in &files {
        let on_disk = std::fs::read(dir.join(&file.path)).unwrap();
        assert_eq!(on_disk, file.bytes, "{}", file.path);
    }
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn ios_single_size_variant_writes_one_universal_icon_to_ios_folder() {
    let options = GenerateOptions { platforms: vec!["ios-single".into()], background: None, padding: 0.0, optimize_png: false };
    let files = generate(&raster_source(), &options, |_, _| {}).unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths.len(), 2, "{paths:?}");

    let contents = files.iter().find(|f| f.path == "ios/AppIcon.appiconset/Contents.json").unwrap();
    let json: serde_json::Value = serde_json::from_slice(&contents.bytes).unwrap();
    let images = json["images"].as_array().unwrap();
    assert_eq!(images.len(), 1);
    assert_eq!(images[0]["idiom"], "universal");
    assert_eq!(images[0]["platform"], "ios");
    assert_eq!(images[0]["filename"], "Icon-1024.png");
}

#[test]
fn variants_of_the_same_platform_conflict() {
    let options = GenerateOptions {
        platforms: vec!["ios".into(), "ios-single".into()],
        background: None,
        padding: 0.0,
        optimize_png: false,
    };
    let err = generate(&raster_source(), &options, |_, _| {}).unwrap_err();
    assert!(matches!(err, icon_core::Error::PlatformConflict(..)));
}

#[test]
fn png_optimization_is_lossless_and_keeps_color_type() {
    let source = Source::from_bytes(CIRCLE_SVG.as_bytes(), None).unwrap();
    let run = |optimize_png| {
        let options = GenerateOptions {
            platforms: vec!["ios".into(), "android".into()],
            background: None,
            padding: 0.0,
            optimize_png,
        };
        let files = generate(&source, &options, |_, _| {}).unwrap();
        files.into_iter().map(|f| (f.path, f.bytes)).collect::<HashMap<_, _>>()
    };
    let plain = run(false);
    let optimized = run(true);

    let total = |m: &HashMap<String, Vec<u8>>| m.values().map(Vec::len).sum::<usize>();
    assert!(total(&optimized) < total(&plain), "optimization should shrink output");

    for (path, bytes) in plain.iter().filter(|(p, _)| p.ends_with(".png")) {
        let before = decode(bytes);
        let after = decode(&optimized[path]);
        assert_eq!(before.color(), after.color(), "{path}: color type changed");
        assert_eq!(before.to_rgba8(), after.to_rgba8(), "{path}: pixels changed");
    }
}
