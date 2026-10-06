//! Tauri commands. All image work runs on blocking threads so the UI stays responsive.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use icon_core::{Color, GenerateOptions, Source, SourceKind};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::{Channel, Response};
use tauri::State;

use crate::error::{CommandError, CommandResult};

/// Below this size raster sources visibly blur in the 1024px store icons.
const RECOMMENDED_MIN_PX: f32 = 1024.0;

/// The currently loaded source image, shared by preview and generate.
#[derive(Default)]
pub struct AppState {
    source: Mutex<Option<Arc<Source>>>,
}

impl AppState {
    fn current(&self) -> CommandResult<Arc<Source>> {
        self.source.lock().unwrap().clone().ok_or_else(CommandError::no_source)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    id: String,
    name: String,
    /// Base platform id when this is an alternative output of it.
    variant_of: Option<String>,
    file_count: usize,
}

#[tauri::command]
pub fn list_platforms() -> Vec<PlatformInfo> {
    icon_core::builtin_platforms()
        .iter()
        .map(|p| PlatformInfo {
            id: p.id.clone(),
            name: p.name.clone(),
            variant_of: p.variant_of.clone(),
            file_count: p.files.len(),
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceWarning {
    NotSquare,
    LowResolution,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    path: String,
    file_name: String,
    kind: SourceKind,
    width: f32,
    height: f32,
    warnings: Vec<SourceWarning>,
}

#[tauri::command]
pub async fn load_source(path: PathBuf, state: State<'_, AppState>) -> CommandResult<SourceInfo> {
    let source = {
        let path = path.clone();
        spawn_blocking(move || Source::open(&path)).await??
    };

    let (width, height) = source.size();
    let mut warnings = Vec::new();
    if (width - height).abs() > 0.5 {
        warnings.push(SourceWarning::NotSquare);
    }
    if source.kind() == SourceKind::Raster && width.min(height) < RECOMMENDED_MIN_PX {
        warnings.push(SourceWarning::LowResolution);
    }

    let info = SourceInfo {
        file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        kind: source.kind(),
        width,
        height,
        warnings,
    };
    *state.source.lock().unwrap() = Some(Arc::new(source));
    Ok(info)
}

/// Returns PNG bytes (an `ArrayBuffer` on the JS side).
#[tauri::command]
pub async fn render_preview(
    size: u32,
    background: Option<Color>,
    padding: f32,
    state: State<'_, AppState>,
) -> CommandResult<Response> {
    let source = state.current()?;
    let size = size.clamp(16, 1024);
    let png = spawn_blocking(move || -> CommandResult<Vec<u8>> {
        let image = icon_core::render_preview(&source, size, background, padding)?;
        let mut out = Cursor::new(Vec::new());
        image
            .write_to(&mut out, ImageFormat::Png)
            .map_err(|e| CommandError::new("encode", e.to_string()))?;
        Ok(out.into_inner())
    })
    .await??;
    Ok(Response::new(png))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutputTarget {
    /// A `.zip` file path, typically from a save dialog.
    Zip { path: PathBuf },
    /// A folder; platform subfolders are created inside it.
    Folder { path: PathBuf },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    done: usize,
    total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateReport {
    file_count: usize,
    total_bytes: u64,
    output_path: String,
    elapsed_ms: u64,
}

#[tauri::command]
pub async fn generate_icons(
    options: GenerateOptions,
    target: OutputTarget,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> CommandResult<GenerateReport> {
    let source = state.current()?;
    if options.platforms.is_empty() {
        return Err(CommandError::new("noPlatforms", "no platforms selected"));
    }

    spawn_blocking(move || -> CommandResult<GenerateReport> {
        let started = Instant::now();
        let files = icon_core::generate(&source, &options, |done, total| {
            // A closed channel only means the window went away; keep generating.
            let _ = on_progress.send(Progress { done, total });
        })?;

        let output_path = match &target {
            OutputTarget::Zip { path } => {
                icon_core::write_zip_file(&files, path)?;
                path
            }
            OutputTarget::Folder { path } => {
                icon_core::write_to_folder(&files, path)?;
                path
            }
        };

        Ok(GenerateReport {
            file_count: files.len(),
            total_bytes: files.iter().map(|f| f.bytes.len() as u64).sum(),
            output_path: output_path.to_string_lossy().into_owned(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    })
    .await?
}
