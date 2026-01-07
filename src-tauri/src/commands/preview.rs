//! Tauri commands for the audio preview system

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Global flag to control the level meter thread
static LEVEL_METER_RUNNING: AtomicBool = AtomicBool::new(false);

use crate::audio::{
    device::{get_default_sample_rate, list_output_devices, AudioConfig, AudioDeviceInfo},
    engine::{get_engine_handle, get_engine_sample_rate, init_engine, reinit_engine, shutdown_engine, EngineState, InputSource},
    plugin::PluginState,
    signals::{GatePattern, SignalConfig, SignalType},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewState {
    pub state: EngineState,
    pub output_left: f32,
    pub output_right: f32,
}

/// Audio metering data sent to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeteringData {
    /// Left channel level (0.0 - 1.0)
    pub left: f32,
    /// Right channel level (0.0 - 1.0)
    pub right: f32,
    /// Left channel level in dB (-60 to 0)
    pub left_db: f32,
    /// Right channel level in dB (-60 to 0)
    pub right_db: f32,
    /// Spectrum analyzer band magnitudes (0.0 - 1.0)
    pub spectrum: Vec<f32>,
}

/// Convert linear level to dB
fn level_to_db(level: f32) -> f32 {
    if level <= 0.0 {
        -60.0
    } else {
        (20.0 * level.log10()).max(-60.0)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DemoSample {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Initialize the audio engine with optional custom settings
#[tauri::command]
pub fn init_audio_engine(
    device_name: Option<String>,
    sample_rate: Option<u32>,
    buffer_size: Option<u32>,
) -> Result<(), String> {
    let config = AudioConfig {
        sample_rate: sample_rate.unwrap_or(48000),
        channels: 2,
        buffer_size: buffer_size.unwrap_or(512),
    };
    init_engine(device_name.as_deref(), config)
}

/// Shutdown the audio engine
#[tauri::command]
pub fn shutdown_audio_engine() {
    shutdown_engine();
}

/// Get list of available audio output devices
#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    list_output_devices()
}

/// Get current audio engine sample rate
#[tauri::command]
pub fn get_audio_sample_rate() -> Result<u32, String> {
    get_engine_sample_rate().ok_or_else(|| "Audio engine not initialized".to_string())
}

/// Update audio settings and reinitialize the engine
/// NOTE: This command is kept for potential future use but is currently not called
/// from the frontend. Audio settings changes now require an app restart to avoid
/// ObjC WebView class collision issues with webview-based plugins.
#[tauri::command]
pub fn set_audio_config(
    device_name: Option<String>,
    sample_rate: u32,
    buffer_size: Option<u32>,
    _app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Stop any current playback
    if let Some(handle) = get_engine_handle() {
        handle.stop();
    }

    // Reinitialize the engine with new settings
    let config = AudioConfig {
        sample_rate,
        channels: 2,
        buffer_size: buffer_size.unwrap_or(512),
    };
    reinit_engine(device_name.as_deref(), config)
}

/// Get the system's default audio sample rate
#[tauri::command]
pub fn get_system_sample_rate() -> Result<u32, String> {
    get_default_sample_rate()
}

/// Start audio playback
#[tauri::command]
pub fn preview_play() -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.play();
    Ok(())
}

/// Stop audio playback
#[tauri::command]
pub fn preview_stop() -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.stop();
    Ok(())
}

/// Pause audio playback
#[tauri::command]
pub fn preview_pause() -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.pause();
    Ok(())
}

/// Set the input source to a test signal
#[tauri::command]
pub fn preview_set_signal(
    signal_type: String,
    frequency: Option<f32>,
    amplitude: Option<f32>,
    gate_pattern: Option<String>,
    gate_rate: Option<f32>,
    gate_duty: Option<f32>,
) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;

    let sig_type = match signal_type.as_str() {
        "sine" => SignalType::Sine,
        "square" => SignalType::Square,
        "white_noise" => SignalType::WhiteNoise,
        "pink_noise" => SignalType::PinkNoise,
        "impulse" => SignalType::Impulse,
        "sweep" => SignalType::Sweep,
        _ => return Err(format!("Unknown signal type: {}", signal_type)),
    };

    let gate = match gate_pattern.as_deref() {
        Some("pulse") => GatePattern::Pulse,
        Some("quarter") => GatePattern::Quarter,
        Some("eighth") => GatePattern::Eighth,
        Some("sixteenth") => GatePattern::Sixteenth,
        _ => GatePattern::Continuous,
    };

    let config = SignalConfig {
        signal_type: sig_type,
        frequency: frequency.unwrap_or(440.0),
        amplitude: amplitude.unwrap_or(0.5),
        gate_pattern: gate,
        gate_rate: gate_rate.unwrap_or(2.0),
        gate_duty: gate_duty.unwrap_or(0.5),
        ..Default::default()
    };

    handle.set_input_source(InputSource::Signal { config });
    Ok(())
}

/// Set the gate pattern for the current signal
#[tauri::command]
pub fn preview_set_gate(
    pattern: String,
    rate: Option<f32>,
    duty: Option<f32>,
) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;

    let gate = match pattern.as_str() {
        "continuous" => GatePattern::Continuous,
        "pulse" => GatePattern::Pulse,
        "quarter" => GatePattern::Quarter,
        "eighth" => GatePattern::Eighth,
        "sixteenth" => GatePattern::Sixteenth,
        _ => return Err(format!("Unknown gate pattern: {}", pattern)),
    };

    handle.set_gate_pattern(gate);
    if let Some(r) = rate {
        handle.set_gate_rate(r);
    }
    if let Some(d) = duty {
        handle.set_gate_duty(d);
    }

    Ok(())
}

/// Set the signal frequency
#[tauri::command]
pub fn preview_set_frequency(frequency: f32) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_frequency(frequency);
    Ok(())
}

/// Set the signal amplitude (0.0 - 1.0)
#[tauri::command]
pub fn preview_set_amplitude(amplitude: f32) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_amplitude(amplitude);
    Ok(())
}

/// Load and set input source to a sample file
#[tauri::command]
pub fn preview_load_sample(path: String) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_input_source(InputSource::Sample { path });
    Ok(())
}

/// Set looping mode
#[tauri::command]
pub fn preview_set_looping(looping: bool) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_looping(looping);
    Ok(())
}

/// Get current preview state
#[tauri::command]
pub fn preview_get_state() -> Result<PreviewState, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    let (left, right) = handle.get_output_levels();

    Ok(PreviewState {
        state: handle.get_state(),
        output_left: left,
        output_right: right,
    })
}

/// Get output levels (for metering)
#[tauri::command]
pub fn preview_get_levels() -> Result<(f32, f32), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.get_output_levels())
}

/// Get list of available demo samples
#[tauri::command]
pub fn get_demo_samples(app_handle: tauri::AppHandle) -> Result<Vec<DemoSample>, String> {
    let mut samples = Vec::new();

    // In development, look for .samples relative to the Cargo.toml (src-tauri's parent)
    // The CARGO_MANIFEST_DIR is set at compile time for debug builds
    #[cfg(debug_assertions)]
    {
        // Try multiple possible locations for the .samples directory
        let possible_dirs = vec![
            // From current working directory
            std::env::current_dir().ok().map(|p| p.join(".samples")),
            // From src-tauri's parent (project root)
            std::env::current_dir().ok().map(|p| p.parent().map(|pp| pp.join(".samples"))).flatten(),
            // Hard-coded fallback for common dev setup
            Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().map(|p| p.join(".samples")).unwrap_or_default()),
        ];

        for dir_opt in possible_dirs {
            if let Some(dir) = dir_opt {
                log::info!("Checking for samples in: {:?}", dir);
                if dir.exists() {
                    log::info!("Found samples directory: {:?}", dir);
                    match scan_samples_dir(&dir) {
                        Ok(found) => {
                            log::info!("Found {} samples in {:?}", found.len(), dir);
                            samples.extend(found);
                            break; // Found samples, stop searching
                        }
                        Err(e) => log::warn!("Error scanning {:?}: {}", dir, e),
                    }
                }
            }
        }
    }

    // In production, look in the bundled resources
    #[cfg(not(debug_assertions))]
    {
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let bundled_samples = resource_dir.join("samples");
            log::info!("Looking for bundled samples in: {:?}", bundled_samples);
            if bundled_samples.exists() {
                match scan_samples_dir(&bundled_samples) {
                    Ok(found) => samples.extend(found),
                    Err(e) => log::warn!("Error scanning bundled samples: {}", e),
                }
            }
        }
    }

    // Also check app data directory for user-installed samples
    if let Ok(app_data) = app_handle.path().app_local_data_dir() {
        let user_samples = app_data.join("samples");
        if user_samples.exists() {
            match scan_samples_dir(&user_samples) {
                Ok(found) => samples.extend(found),
                Err(e) => log::warn!("Error scanning user samples: {}", e),
            }
        }
    }

    log::info!("Total samples found: {}", samples.len());
    Ok(samples)
}

fn scan_samples_dir(dir: &PathBuf) -> Result<Vec<DemoSample>, String> {
    let mut samples = Vec::new();

    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read samples dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if ext == "wav" || ext == "mp3" || ext == "flac" || ext == "ogg" {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                let id = name.to_lowercase().replace(' ', "_");

                samples.push(DemoSample {
                    id,
                    name: capitalize_first(&name),
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }

    Ok(samples)
}

fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().chain(chars).collect(),
    }
}

/// Start the level meter polling (emits events to frontend)
#[tauri::command]
pub fn start_level_meter(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Check if meter is already running using compare_exchange to atomically check and set
    if LEVEL_METER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        // Already running, don't spawn another thread
        log::debug!("Level meter already running, skipping spawn");
        return Ok(());
    }

    std::thread::spawn(move || {
        log::debug!("Level meter thread started");
        while LEVEL_METER_RUNNING.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(16)); // ~60fps

            // Check flag again after sleep (in case stop was called)
            if !LEVEL_METER_RUNNING.load(Ordering::SeqCst) {
                break;
            }

            if let Some(handle) = get_engine_handle() {
                let (left, right) = handle.get_output_levels();
                let spectrum = handle.get_spectrum_data();

                // Send combined metering data with dB values
                let metering = MeteringData {
                    left,
                    right,
                    left_db: level_to_db(left),
                    right_db: level_to_db(right),
                    spectrum: spectrum.to_vec(),
                };
                let _ = app_handle.emit("preview-metering", &metering);
            } else {
                // Engine was shut down, stop the meter
                break;
            }
        }
        // Ensure flag is cleared when thread exits
        LEVEL_METER_RUNNING.store(false, Ordering::SeqCst);
        log::debug!("Level meter thread stopped");
    });

    Ok(())
}

/// Stop the level meter polling thread
#[tauri::command]
pub fn stop_level_meter() -> Result<(), String> {
    LEVEL_METER_RUNNING.store(false, Ordering::SeqCst);
    log::debug!("Level meter stop requested");
    Ok(())
}

// =============================================================================
// Plugin Commands
// =============================================================================

/// Load a CLAP plugin from a .clap bundle path
#[tauri::command]
pub fn plugin_load(path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;

    // Emit loading event
    let _ = app_handle.emit("plugin-loading", &path);

    match handle.load_plugin(std::path::Path::new(&path)) {
        Ok(()) => {
            let state = handle.get_plugin_state();
            let _ = app_handle.emit("plugin-loaded", &state);
            Ok(())
        }
        Err(e) => {
            let _ = app_handle.emit("plugin-error", &e);
            Err(e)
        }
    }
}

/// Unload the current plugin
#[tauri::command]
pub fn plugin_unload(app_handle: tauri::AppHandle) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.unload_plugin();
    let _ = app_handle.emit("plugin-unloaded", ());
    Ok(())
}

/// Get the current plugin state
#[tauri::command]
pub fn plugin_get_state() -> Result<PluginState, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.get_plugin_state())
}

/// Check if a plugin is loaded
#[tauri::command]
pub fn plugin_has_plugin() -> Result<bool, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.has_plugin())
}

/// Check if the loaded plugin has an editor GUI
#[tauri::command]
pub fn plugin_has_editor() -> Result<bool, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.plugin_has_editor())
}

/// Scan a directory for .clap plugin bundles
#[tauri::command]
pub fn plugin_scan_directory(path: String) -> Result<Vec<PluginInfo>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "clap").unwrap_or(false) {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                plugins.push(PluginInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }

    Ok(plugins)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub path: String,
}

/// Get the .clap plugin path for a project (based on current version)
#[tauri::command]
pub fn get_project_plugin_path(project_name: String, version: u32) -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let output_path = std::path::PathBuf::from(home)
        .join("VSTWorkshop")
        .join("output")
        .join(&project_name)
        .join(format!("v{}", version));

    // Look for .clap bundle in the version folder
    if let Ok(entries) = std::fs::read_dir(&output_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "clap").unwrap_or(false) {
                return Ok(Some(path.to_string_lossy().to_string()));
            }
        }
    }

    Ok(None)
}

/// Load the plugin for the current project (auto-detect from output folder)
#[tauri::command]
pub fn plugin_load_for_project(
    project_name: String,
    version: u32,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;

    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;

    // Get plugin path
    let plugin_path = get_project_plugin_path(project_name.clone(), version)?
        .ok_or_else(|| format!("No .clap plugin found for {} v{}", project_name, version))?;

    // Emit loading event
    let _ = app_handle.emit("plugin-loading", &plugin_path);

    match handle.load_plugin(std::path::Path::new(&plugin_path)) {
        Ok(()) => {
            let state = handle.get_plugin_state();
            let _ = app_handle.emit("plugin-loaded", &state);
            Ok(())
        }
        Err(e) => {
            let _ = app_handle.emit("plugin-error", &e);
            Err(e)
        }
    }
}

/// Open the plugin's editor window
#[tauri::command]
pub fn plugin_open_editor() -> Result<(), String> {
    log::info!("plugin_open_editor command called");
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    log::info!("plugin_open_editor: got engine handle, calling open_plugin_editor");
    let result = handle.open_plugin_editor();
    log::info!("plugin_open_editor: result = {:?}", result.is_ok());
    result
}

/// Close the plugin's editor window
#[tauri::command]
pub fn plugin_close_editor() -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.close_plugin_editor();
    Ok(())
}

/// Check if the plugin editor is open
#[tauri::command]
pub fn plugin_is_editor_open() -> Result<bool, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.is_plugin_editor_open())
}

/// Process plugin idle tasks (flush params, handle callbacks)
/// This should be called periodically (~60fps) when the editor is open
/// to ensure GUI interactions work even without audio playing.
#[tauri::command]
pub fn plugin_idle() {
    if let Some(handle) = get_engine_handle() {
        handle.plugin_idle();
    }
}

/// Reload the current plugin (for hot reload)
/// If a project is specified, reload from that project's output folder
#[tauri::command]
pub fn plugin_reload(
    project_name: Option<String>,
    version: Option<u32>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;

    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;

    // Get the current plugin path or find it from project
    let plugin_path = if let (Some(name), Some(ver)) = (project_name.as_ref(), version) {
        get_project_plugin_path(name.clone(), ver)?
            .ok_or_else(|| format!("No .clap plugin found for {} v{}", name, ver))?
    } else {
        // Try to get path from current plugin state
        match handle.get_plugin_state() {
            PluginState::Active { path, .. } => path,
            PluginState::Reloading { path } => path,
            _ => return Err("No plugin loaded to reload".to_string()),
        }
    };

    log::info!("Hot reloading plugin: {}", plugin_path);

    // Emit reloading event
    let _ = app_handle.emit("plugin-reloading", &plugin_path);

    // Close editor if open
    handle.close_plugin_editor();

    // Unload and reload the plugin
    handle.unload_plugin();

    // Small delay to ensure file handles are released
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Reload
    match handle.load_plugin(std::path::Path::new(&plugin_path)) {
        Ok(()) => {
            let state = handle.get_plugin_state();
            let _ = app_handle.emit("plugin-loaded", &state);
            log::info!("Plugin hot reload successful");
            Ok(())
        }
        Err(e) => {
            let _ = app_handle.emit("plugin-error", &e);
            Err(e)
        }
    }
}
