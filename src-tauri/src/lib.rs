mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize file logging
    commands::logging::init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::prerequisites::check_prerequisites,
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::delete_project,
            commands::projects::open_project_folder,
            commands::projects::get_workspace_path_string,
            commands::claude::send_to_claude,
            commands::claude::test_claude_cli,
            commands::build::build_project,
            commands::build::open_output_folder,
            commands::git::revert_to_commit,
            commands::chat::save_chat_history,
            commands::chat::load_chat_history,
            commands::chat::set_active_version,
            commands::chat::update_active_version,
            commands::chat::get_current_version,
            commands::publish::publish_to_daw,
            commands::publish::check_available_formats,
            commands::logging::get_log_file_path,
            commands::logging::read_log_file,
            commands::logging::clear_log_file,
            commands::logging::get_log_file_size,
            commands::files::store_chat_attachments,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
