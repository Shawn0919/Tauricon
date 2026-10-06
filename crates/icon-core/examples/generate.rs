//! Try the engine without the UI:
//!
//! cargo run -p icon-core --release --example generate -- <input> <output.zip|output-dir> [platform...]
//!
//! Set ICON_OPTIONS to a JSON object to apply style options.

use std::path::PathBuf;
use std::time::Instant;

use icon_core::{GenerateOptions, Source, builtin_platforms, generate};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let (Some(input), Some(output)) = (args.next(), args.next()) else {
        eprintln!("usage: generate <input> <output.zip|output-dir> [platform...]");
        eprintln!(
            "platforms: {}",
            builtin_platforms()
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        std::process::exit(2);
    };
    let mut platforms: Vec<String> = args.collect();
    if platforms.is_empty() {
        platforms = builtin_platforms()
            .iter()
            .filter(|p| p.variant_of.is_none())
            .map(|p| p.id.clone())
            .collect();
    }

    let started = Instant::now();
    let source = Source::open(&PathBuf::from(&input))?;
    // Style options as JSON (same shape the app sends), e.g.
    // ICON_OPTIONS='{"macosTemplate":true,"cornerRadius":0.2}'
    let mut options: GenerateOptions = match std::env::var("ICON_OPTIONS") {
        Ok(json) => serde_json::from_str(&json)?,
        Err(_) => GenerateOptions::default(),
    };
    options.platforms = platforms;
    let files = generate(&source, &options, |_, _| {})?;

    let output = PathBuf::from(output);
    if output
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
    {
        icon_core::write_zip_file(&files, &output)?;
    } else {
        icon_core::write_to_folder(&files, &output)?;
    }
    println!(
        "{} files ({:?} source) -> {} in {:.2?}",
        files.len(),
        source.kind(),
        output.display(),
        started.elapsed()
    );
    Ok(())
}
