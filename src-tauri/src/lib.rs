mod commands;
mod error;

use tauri::{LogicalSize, Manager, WebviewWindow};

/// Fraction of the monitor's work area the window may cover at most.
const MAX_SCREEN_FRACTION: f64 = 0.95;

/// The configured size (1600×1000) is too big for small or highly scaled
/// screens; shrink to fit the monitor's work area (taskbar excluded) and
/// re-center. The window starts hidden so the resize isn't visible.
fn fit_to_screen(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area().size.to_logical::<f64>(scale);
    let outer = window.outer_size()?.to_logical::<f64>(scale);
    let inner = window.inner_size()?.to_logical::<f64>(scale);

    let max_width = work.width * MAX_SCREEN_FRACTION;
    let max_height = work.height * MAX_SCREEN_FRACTION;
    if outer.width <= max_width && outer.height <= max_height {
        return Ok(());
    }

    // Title bar and borders are outside the inner (content) size.
    let frame_width = outer.width - inner.width;
    let frame_height = outer.height - inner.height;
    window.set_size(LogicalSize::new(
        inner.width.min(max_width - frame_width),
        inner.height.min(max_height - frame_height),
    ))?;
    window.center()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Sizing is best effort; always show the window.
                let _ = fit_to_screen(&window);
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_platforms,
            commands::load_source,
            commands::load_layer,
            commands::clear_layer,
            commands::render_preview,
            commands::generate_icons,
            commands::describe_image,
            commands::render_thumbnail,
            commands::generate_icon_batch,
            commands::generate_image_sets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
