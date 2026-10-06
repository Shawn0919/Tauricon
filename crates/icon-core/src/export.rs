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
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
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
        let target = file.path.split('/').fold(dir.to_path_buf(), |acc, part| acc.join(part));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_safety() {
        for ok in ["a.png", "ios/AppIcon.appiconset/Contents.json", "res/mipmap-hdpi/x.png"] {
            assert!(is_safe_relative_path(ok), "{ok}");
        }
        for bad in ["", "/abs.png", "../x", "a/../b", "a//b", "./a", "a\\b", "C:/x", "a/"] {
            assert!(!is_safe_relative_path(bad), "{bad}");
        }
    }

    #[test]
    fn unsafe_paths_are_rejected_before_writing() {
        let files = [GeneratedFile { path: "../evil.txt".into(), bytes: vec![1] }];
        let err = write_zip(&files, std::io::Cursor::new(Vec::new())).unwrap_err();
        assert!(matches!(err, Error::UnsafePath(_)));
    }
}
