pub mod audio;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize file logging
    commands::logging::init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Register updater plugin (desktop only)
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

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
            commands::publish::package_plugins,
            commands::logging::get_log_file_path,
            commands::logging::read_log_file,
            commands::logging::clear_log_file,
            commands::logging::get_log_file_size,
            commands::files::store_chat_attachments,
            commands::share::export_project,
            commands::share::import_project,
            commands::share::check_import_conflict,
            // Preview/Audio commands
            commands::preview::init_audio_engine,
            commands::preview::shutdown_audio_engine,
            commands::preview::get_audio_devices,
            commands::preview::get_audio_sample_rate,
            commands::preview::get_system_sample_rate,
            commands::preview::set_audio_config,
            commands::preview::preview_play,
            commands::preview::preview_stop,
            commands::preview::preview_pause,
            commands::preview::preview_set_signal,
            commands::preview::preview_set_frequency,
            commands::preview::preview_set_amplitude,
            commands::preview::preview_set_gate,
            commands::preview::preview_load_sample,
            commands::preview::preview_set_looping,
            commands::preview::preview_get_state,
            commands::preview::preview_get_levels,
            commands::preview::get_demo_samples,
            commands::preview::start_level_meter,
            commands::preview::stop_level_meter,
            // Plugin commands
            commands::preview::plugin_load,
            commands::preview::plugin_unload,
            commands::preview::plugin_get_state,
            commands::preview::plugin_has_plugin,
            commands::preview::plugin_has_editor,
            commands::preview::plugin_scan_directory,
            commands::preview::get_project_plugin_path,
            commands::preview::plugin_load_for_project,
            commands::preview::plugin_open_editor,
            commands::preview::plugin_close_editor,
            commands::preview::plugin_is_editor_open,
            commands::preview::plugin_idle,
            commands::preview::plugin_reload,
            // Live input commands
            commands::preview::get_input_devices,
            commands::preview::preview_set_live_input,
            commands::preview::preview_set_live_paused,
            commands::preview::preview_is_live_paused,
            commands::preview::preview_get_input_levels,
            // Master volume commands
            commands::preview::preview_set_master_volume,
            commands::preview::preview_get_master_volume,
            // MIDI commands (for instrument plugins)
            commands::preview::midi_batch,
            commands::preview::midi_note_on,
            commands::preview::midi_note_off,
            commands::preview::midi_all_notes_off,
            commands::preview::set_plugin_is_instrument,
            // Pattern playback commands
            commands::preview::pattern_list,
            commands::preview::pattern_list_by_category,
            commands::preview::pattern_play,
            commands::preview::pattern_stop,
            commands::preview::pattern_set_bpm,
            commands::preview::pattern_set_octave_shift,
            commands::preview::pattern_set_looping,
            commands::preview::pattern_is_playing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
