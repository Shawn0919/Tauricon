//! Writing generated files to a folder or a ZIP archive.

use std::fs;
use std::io::{Seek, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{Error, Result};
use crate::generate::GeneratedFile;

/// True for relative `/`-separated paths that cannot escape the output root.
pub fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn check_paths(files: &[GeneratedFile]) -> Result<()> {
    match files.iter().find(|f| !is_safe_relative_path(&f.path)) {
        Some(f) => Err(Error::UnsafePath(f.path.clone())),
        None => Ok(()),
    }
}

/// Writes files under `dir`, creating subfolders and overwriting existing files.
pub fn write_to_folder(files: &[GeneratedFile], dir: &Path) -> Result<()> {
    check_paths(files)?;
    for file in files {
        let target = file
            .path
            .split('/')
            .fold(dir.to_path_buf(), |acc, part| acc.join(part));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, &file.bytes)?;
    }
    Ok(())
}

pub fn write_zip<W: Write + Seek>(files: &[GeneratedFile], writer: W) -> Result<W> {
    check_paths(files)?;
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut zip = ZipWriter::new(writer);
    for file in files {
        zip.start_file(file.path.as_str(), options)?;
        zip.write_all(&file.bytes)?;
    }
    Ok(zip.finish()?)
}

pub fn write_zip_file(files: &[GeneratedFile], path: &Path) -> Result<()> {
    let file = fs::File::create(path)?;
    write_zip(files, std::io::BufWriter::new(file))?.flush()?;
    Ok(())
}

/// Makes batch item names unique by appending `-2`, `-3`, … Two names
/// collide when `key` maps them to the same value (e.g. after the
/// sanitizing a target platform applies), so outputs never overwrite each other.
pub fn unique_names(names: &[String], key: impl Fn(&str) -> String) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    names
        .iter()
        .map(|name| {
            let mut candidate = name.clone();
            let mut n = 2;
            while !seen.insert(key(&candidate)) {
                candidate = format!("{name}-{n}");
                n += 1;
            }
            candidate
        })
        .collect()
}

/// Moves every file under `dir/`, e.g. one folder per batch item.
pub fn prefix_paths(files: Vec<GeneratedFile>, dir: &str) -> Vec<GeneratedFile> {
    files
        .into_iter()
        .map(|f| GeneratedFile {
            path: format!("{dir}/{}", f.path),
            bytes: f.bytes,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_names_suffix_collisions() {
        let names: Vec<String> = ["logo", "Logo", "logo", "other"].map(String::from).into();
        assert_eq!(
            unique_names(&names, str::to_lowercase),
            ["logo", "Logo-2", "logo-3", "other"]
        );
        assert_eq!(
            unique_names(&names, str::to_string),
            ["logo", "Logo", "logo-2", "other"]
        );
    }

    #[test]
    fn path_safety() {
        for ok in [
            "a.png",
            "ios/AppIcon.appiconset/Contents.json",
            "res/mipmap-hdpi/x.png",
        ] {
            assert!(is_safe_relative_path(ok), "{ok}");
        }
        for bad in [
            "", "/abs.png", "../x", "a/../b", "a//b", "./a", "a\\b", "C:/x", "a/",
        ] {
            assert!(!is_safe_relative_path(bad), "{bad}");
        }
    }

    #[test]
    fn unsafe_paths_are_rejected_before_writing() {
        let files = [GeneratedFile {
            path: "../evil.txt".into(),
            bytes: vec![1],
        }];
        let err = write_zip(&files, std::io::Cursor::new(Vec::new())).unwrap_err();
        assert!(matches!(err, Error::UnsafePath(_)));
    }
}
