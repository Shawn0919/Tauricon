mod commands;
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
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
