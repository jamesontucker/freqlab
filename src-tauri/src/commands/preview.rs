//! Tauri commands for the audio preview system

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Global flag to control the level meter thread
static LEVEL_METER_RUNNING: AtomicBool = AtomicBool::new(false);

use crate::audio::{
    device::{get_default_sample_rate, list_input_devices, list_output_devices, AudioConfig, AudioDeviceInfo},
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
    /// Left channel output level (0.0 - 1.0)
    pub left: f32,
    /// Right channel output level (0.0 - 1.0)
    pub right: f32,
    /// Left channel output level in dB (-60 to 0)
    pub left_db: f32,
    /// Right channel output level in dB (-60 to 0)
    pub right_db: f32,
    /// Left channel input level (0.0 - 1.0) - for live input metering
    pub input_left: f32,
    /// Right channel input level (0.0 - 1.0) - for live input metering
    pub input_right: f32,
    /// Left channel input level in dB (-60 to 0)
    pub input_left_db: f32,
    /// Right channel input level in dB (-60 to 0)
    pub input_right_db: f32,
    /// Spectrum analyzer band magnitudes (0.0 - 1.0)
    pub spectrum: Vec<f32>,
    /// Left channel waveform display buffer (time-domain samples, -1.0 to 1.0)
    pub waveform_left: Vec<f32>,
    /// Right channel waveform display buffer (time-domain samples, -1.0 to 1.0)
    pub waveform_right: Vec<f32>,
    /// Left channel peak hold value (0.0 - 1.0, cleared after read)
    pub waveform_peak_left: f32,
    /// Right channel peak hold value (0.0 - 1.0, cleared after read)
    pub waveform_peak_right: f32,
    /// Left channel clipping indicator
    pub clipping_left: bool,
    /// Right channel clipping indicator
    pub clipping_right: bool,
    /// Stereo imaging positions: Vec of [angle, radius] pairs
    /// angle: 0 = full left, PI/2 = center, PI = full right
    /// radius: 0-1 based on amplitude
    pub stereo_positions: Vec<[f32; 2]>,
    /// Stereo correlation coefficient (-1.0 to +1.0)
    /// +1 = mono/in-phase, 0 = uncorrelated, -1 = out of phase
    pub stereo_correlation: f32,
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
    let result = init_engine(device_name.as_deref(), config);

    // Pre-initialize MIDI player to avoid warm-up lag on first use
    if result.is_ok() {
        init_midi_player();
    }

    result
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
                let (input_left, input_right) = handle.get_input_levels();
                let spectrum = handle.get_spectrum_data();
                let (waveform_left, waveform_right) = handle.get_waveform_data();
                let (waveform_peak_left, waveform_peak_right) = handle.get_waveform_peaks();
                let (clipping_left, clipping_right) = handle.get_clipping();
                let stereo_positions_tuples = handle.get_stereo_positions();
                let stereo_correlation = handle.get_stereo_correlation();

                // Convert stereo positions from tuples to arrays for JSON serialization
                let stereo_positions: Vec<[f32; 2]> = stereo_positions_tuples
                    .into_iter()
                    .map(|(angle, radius)| [angle, radius])
                    .collect();

                // Send combined metering data with dB values, waveform, and clipping indicators
                let metering = MeteringData {
                    left,
                    right,
                    left_db: level_to_db(left),
                    right_db: level_to_db(right),
                    input_left,
                    input_right,
                    input_left_db: level_to_db(input_left),
                    input_right_db: level_to_db(input_right),
                    spectrum: spectrum.to_vec(),
                    waveform_left,
                    waveform_right,
                    waveform_peak_left,
                    waveform_peak_right,
                    clipping_left,
                    clipping_right,
                    stereo_positions,
                    stereo_correlation,
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

/// Pre-warm MIDI code paths by sending silent events through the system
/// This exercises JIT compilation and caches without producing sound
fn prewarm_midi_paths(handle: &crate::audio::engine::AudioEngineHandle) {
    // Send a few silent note on/off pairs to warm up:
    // - Tauri IPC serialization
    // - MIDI queue push/drain
    // - Plugin MIDI processing
    // Velocity 0 = silent, won't produce audible output
    for note in [60u8, 64, 67] {
        handle.midi_note_on(note, 0);
        handle.midi_note_off(note);
    }
    // Also trigger an all-notes-off to warm that path
    handle.midi_all_notes_off();
    log::debug!("MIDI code paths pre-warmed");
}

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
            // Update MIDI queues for pattern playback and live input
            update_midi_player_queue();
            update_midi_input_queue();
            // Pre-warm MIDI code paths to reduce initial lag
            prewarm_midi_paths(&handle);
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
    // Clear MIDI queues before unloading
    clear_midi_player_queue();
    clear_midi_input_queue();
    // Close editor first to save window position
    handle.close_plugin_editor();
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
/// Version 0 (no Claude commits) maps to v1 folder for pre-Claude manual builds
#[tauri::command]
pub fn get_project_plugin_path(project_name: String, version: u32) -> Result<Option<String>, String> {
    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    let folder_version = version.max(1);

    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let output_path = std::path::PathBuf::from(home)
        .join("VSTWorkshop")
        .join("output")
        .join(&project_name)
        .join(format!("v{}", folder_version));

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
            // Update MIDI queues for pattern playback and live input
            update_midi_player_queue();
            update_midi_input_queue();
            // Pre-warm MIDI code paths to reduce initial lag
            prewarm_midi_paths(&handle);
            Ok(())
        }
        Err(e) => {
            let _ = app_handle.emit("plugin-error", &e);
            Err(e)
        }
    }
}

/// Open the plugin's editor window
///
/// Uses stored position if available, otherwise centers the window.
#[tauri::command]
pub fn plugin_open_editor() -> Result<(), String> {
    log::info!("plugin_open_editor command called");
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
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

    // Small delay to ensure editor window is fully closed
    std::thread::sleep(std::time::Duration::from_millis(50));

    // Unload and reload the plugin
    handle.unload_plugin();

    // Small delay to ensure file handles are released
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Reload
    match handle.load_plugin(std::path::Path::new(&plugin_path)) {
        Ok(()) => {
            let state = handle.get_plugin_state();
            let _ = app_handle.emit("plugin-loaded", &state);
            // Update MIDI queues for pattern playback and live input
            update_midi_player_queue();
            update_midi_input_queue();
            // Pre-warm MIDI code paths to reduce initial lag
            prewarm_midi_paths(&handle);
            log::info!("Plugin hot reload successful");
            Ok(())
        }
        Err(e) => {
            let _ = app_handle.emit("plugin-error", &e);
            Err(e)
        }
    }
}

// =============================================================================
// Live Input Commands
// =============================================================================

/// Get list of available audio input devices
#[tauri::command]
pub fn get_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    list_input_devices()
}

/// Set the input source to live audio input
/// chunk_size: Resampler chunk size (default: 256). Smaller = lower latency, larger = less CPU
#[tauri::command]
pub fn preview_set_live_input(device_name: Option<String>, chunk_size: Option<usize>) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_input_source(InputSource::Live { device: device_name, chunk_size });
    Ok(())
}

/// Set the live input paused state
#[tauri::command]
pub fn preview_set_live_paused(paused: bool) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_live_paused(paused);
    Ok(())
}

/// Get live input paused state
#[tauri::command]
pub fn preview_is_live_paused() -> Result<bool, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.is_live_paused())
}

/// Get input levels (for live input metering)
#[tauri::command]
pub fn preview_get_input_levels() -> Result<(f32, f32), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.get_input_levels())
}

/// Set master volume (0.0 - 1.0)
#[tauri::command]
pub fn preview_set_master_volume(volume: f32) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_master_volume(volume);
    Ok(())
}

/// Get master volume (0.0 - 1.0)
#[tauri::command]
pub fn preview_get_master_volume() -> Result<f32, String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    Ok(handle.get_master_volume())
}

// =============================================================================
// MIDI Commands (for instrument plugins)
// =============================================================================

/// MIDI event for batched processing
#[derive(serde::Deserialize)]
pub struct MidiEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub note: u8,
    pub velocity: Option<u8>,
}

/// Process a batch of MIDI events in a single IPC call
#[tauri::command]
pub fn midi_batch(events: Vec<MidiEvent>) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;

    for event in events {
        match event.event_type.as_str() {
            "on" => {
                let velocity = event.velocity.unwrap_or(100);
                handle.midi_note_on(event.note, velocity);
            }
            "off" => {
                handle.midi_note_off(event.note);
            }
            _ => {}
        }
    }

    Ok(())
}

/// Send a MIDI note on event to the loaded plugin
#[tauri::command]
pub fn midi_note_on(note: u8, velocity: u8) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.midi_note_on(note, velocity);
    Ok(())
}

/// Send a MIDI note off event to the loaded plugin
#[tauri::command]
pub fn midi_note_off(note: u8) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.midi_note_off(note);
    Ok(())
}

/// Send all notes off to the loaded plugin
#[tauri::command]
pub fn midi_all_notes_off() -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.midi_all_notes_off();
    Ok(())
}

/// Set whether the loaded plugin is an instrument (vs effect)
/// Instrument plugins are processed even when not "playing" for MIDI input
#[tauri::command]
pub fn set_plugin_is_instrument(is_instrument: bool) -> Result<(), String> {
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    handle.set_is_instrument(is_instrument);
    Ok(())
}

// =============================================================================
// Pattern Playback Commands
// =============================================================================

use crate::audio::midi::{MidiPlayer, PatternCategory, PatternInfo, list_patterns, get_pattern};
use once_cell::sync::Lazy;
use parking_lot::Mutex;

/// Global MIDI player instance
static MIDI_PLAYER: Lazy<Mutex<Option<MidiPlayer>>> = Lazy::new(|| Mutex::new(None));

/// Initialize the MIDI player (called when engine starts)
fn init_midi_player() {
    let mut player_lock = MIDI_PLAYER.lock();
    if player_lock.is_none() {
        *player_lock = Some(MidiPlayer::new());
        log::info!("MIDI player initialized");
    }
}

/// Get the MIDI player, initializing if needed
fn get_midi_player() -> Result<parking_lot::MutexGuard<'static, Option<MidiPlayer>>, String> {
    init_midi_player();
    Ok(MIDI_PLAYER.lock())
}

/// Update the MIDI player's queue when a plugin is loaded
/// Note: We don't create the player here - it's created lazily when pattern_play is called
/// This avoids the background thread running when patterns aren't being used
pub fn update_midi_player_queue() {
    log::info!("update_midi_player_queue: called");

    let player_lock = MIDI_PLAYER.lock();
    // Only update queue if player already exists (created by pattern_play)
    if let Some(ref player) = *player_lock {
        // Get the current plugin's midi queue
        if let Some(handle) = get_engine_handle() {
            if let Some(queue) = handle.get_plugin_midi_queue() {
                player.set_midi_queue(Some(queue));
                log::info!("update_midi_player_queue: queue set successfully");
            } else {
                player.set_midi_queue(None);
                log::warn!("update_midi_player_queue: no queue available from plugin");
            }
        } else {
            log::warn!("update_midi_player_queue: no engine handle");
        }
    } else {
        log::info!("update_midi_player_queue: player not created yet, will set queue on first play");
    }
}

/// Clear the MIDI player's queue when a plugin is unloaded
pub fn clear_midi_player_queue() {
    if let Some(ref player) = *MIDI_PLAYER.lock() {
        player.set_midi_queue(None);
        player.stop();
        log::info!("MIDI player queue cleared");
    }
}

/// List all available patterns
#[tauri::command]
pub fn pattern_list() -> Vec<PatternInfo> {
    let patterns = list_patterns();
    log::info!("pattern_list: returning {} patterns", patterns.len());
    patterns
}

/// List patterns by category
#[tauri::command]
pub fn pattern_list_by_category(category: PatternCategory) -> Vec<PatternInfo> {
    crate::audio::midi::patterns::get_patterns_by_category(category)
}

/// Start playing a pattern
#[tauri::command]
pub fn pattern_play(
    pattern_id: String,
    bpm: u32,
    octave_shift: i8,
    looping: bool,
) -> Result<(), String> {
    log::info!("pattern_play: pattern={}, bpm={}, octave={}, loop={}", pattern_id, bpm, octave_shift, looping);

    // Verify pattern exists first
    if get_pattern(&pattern_id).is_none() {
        return Err(format!("Pattern not found: {}", pattern_id));
    }

    let player_lock = get_midi_player()?;
    let player = player_lock.as_ref().ok_or("MIDI player not initialized")?;

    // Ensure the MIDI queue is set (may not be if this is the first play)
    if let Some(handle) = get_engine_handle() {
        if let Some(queue) = handle.get_plugin_midi_queue() {
            player.set_midi_queue(Some(queue));
            log::info!("pattern_play: queue set");
        } else {
            return Err("No plugin loaded - cannot play pattern".to_string());
        }
    } else {
        return Err("Audio engine not initialized".to_string());
    }

    let result = player.play(&pattern_id, bpm, octave_shift, looping);
    log::info!("pattern_play: result={:?}", result);
    result
}

/// Stop pattern playback
#[tauri::command]
pub fn pattern_stop() -> Result<(), String> {
    let player_lock = get_midi_player()?;
    if let Some(player) = player_lock.as_ref() {
        player.stop();
    }
    Ok(())
}

/// Set pattern BPM
#[tauri::command]
pub fn pattern_set_bpm(bpm: u32) -> Result<(), String> {
    let player_lock = get_midi_player()?;
    if let Some(player) = player_lock.as_ref() {
        player.set_bpm(bpm);
    }
    Ok(())
}

/// Set pattern octave shift
#[tauri::command]
pub fn pattern_set_octave_shift(shift: i8) -> Result<(), String> {
    let player_lock = get_midi_player()?;
    if let Some(player) = player_lock.as_ref() {
        player.set_octave_shift(shift);
    }
    Ok(())
}

/// Set pattern looping
#[tauri::command]
pub fn pattern_set_looping(looping: bool) -> Result<(), String> {
    let player_lock = get_midi_player()?;
    if let Some(player) = player_lock.as_ref() {
        player.set_looping(looping);
    }
    Ok(())
}

/// Check if pattern is playing
#[tauri::command]
pub fn pattern_is_playing() -> bool {
    if let Some(player) = MIDI_PLAYER.lock().as_ref() {
        player.is_playing()
    } else {
        false
    }
}

// =============================================================================
// MIDI File Commands
// =============================================================================

use crate::audio::midi::{MidiFileInfo, parse_midi_file, get_midi_file_info};
use std::path::Path;

/// Global state for loaded MIDI file
static LOADED_MIDI_FILE: Lazy<Mutex<Option<crate::audio::midi::ParsedMidiFile>>> = Lazy::new(|| Mutex::new(None));

/// Load a MIDI file and return track information
#[tauri::command]
pub fn midi_file_load(path: String) -> Result<MidiFileInfo, String> {
    log::info!("midi_file_load: {}", path);

    let parsed = parse_midi_file(Path::new(&path))?;
    let info = get_midi_file_info(&parsed);

    // Store the parsed file for playback
    *LOADED_MIDI_FILE.lock() = Some(parsed);

    log::info!("midi_file_load: loaded {} tracks", info.tracks.len());
    Ok(info)
}

/// Get info about the currently loaded MIDI file
#[tauri::command]
pub fn midi_file_get_info() -> Option<MidiFileInfo> {
    LOADED_MIDI_FILE.lock().as_ref().map(get_midi_file_info)
}

/// Unload the current MIDI file
#[tauri::command]
pub fn midi_file_unload() {
    log::info!("midi_file_unload");

    // Clear the file first (consistent lock order: LOADED_MIDI_FILE before MIDI_PLAYER)
    *LOADED_MIDI_FILE.lock() = None;

    // Then stop playback if playing a MIDI file
    if let Some(player) = MIDI_PLAYER.lock().as_ref() {
        if player.get_source() == crate::audio::midi::PlaybackSource::MidiFile {
            player.stop();
        }
    }
}

/// Play a track from the loaded MIDI file
#[tauri::command]
pub fn midi_file_play(
    track_index: usize,
    bpm: Option<u32>,
    octave_shift: i8,
    looping: bool,
    use_tempo_automation: bool,
) -> Result<(), String> {
    log::info!("midi_file_play: track={}, bpm={:?}, octave={}, loop={}, tempo_auto={}",
        track_index, bpm, octave_shift, looping, use_tempo_automation);

    // Get the loaded file
    let file_lock = LOADED_MIDI_FILE.lock();
    let parsed = file_lock.as_ref().ok_or("No MIDI file loaded")?;

    // Find the track (track_index is the index in our tracks array, not the original MIDI track index)
    if track_index >= parsed.track_notes.len() {
        return Err(format!("Track index {} out of range (have {} tracks)", track_index, parsed.track_notes.len()));
    }

    let notes = parsed.track_notes[track_index].clone();
    let duration_beats = parsed.tracks[track_index].duration_beats;
    let file_bpm = bpm.unwrap_or(parsed.bpm as u32);
    let tempo_map = parsed.tempo_map.clone();

    // Get the player
    let player_lock = get_midi_player()?;
    let player = player_lock.as_ref().ok_or("MIDI player not initialized")?;

    // Ensure the MIDI queue is set
    if let Some(handle) = get_engine_handle() {
        if let Some(queue) = handle.get_plugin_midi_queue() {
            player.set_midi_queue(Some(queue));
        } else {
            return Err("No plugin loaded - cannot play MIDI file".to_string());
        }
    } else {
        return Err("Audio engine not running".to_string());
    }

    // Start playback
    player.play_midi_file(notes, duration_beats, file_bpm, octave_shift, looping, tempo_map, use_tempo_automation)?;

    Ok(())
}

/// Set tempo automation mode for MIDI file playback
#[tauri::command]
pub fn midi_file_set_tempo_automation(enabled: bool) -> Result<(), String> {
    let player_lock = get_midi_player()?;
    if let Some(player) = player_lock.as_ref() {
        player.set_tempo_automation(enabled);
    }
    Ok(())
}

/// Stop MIDI file playback
#[tauri::command]
pub fn midi_file_stop() -> Result<(), String> {
    let player_lock = get_midi_player()?;
    if let Some(player) = player_lock.as_ref() {
        player.stop();
    }
    Ok(())
}

/// Playback position info returned to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct PlaybackPositionInfo {
    /// Current position in beats
    pub position: f32,
    /// Total duration in beats
    pub duration: f32,
    /// Whether playback is active
    pub is_playing: bool,
}

/// Get current MIDI file playback position
#[tauri::command]
pub fn midi_file_get_position() -> Result<PlaybackPositionInfo, String> {
    let player_lock = get_midi_player()?;
    let player = player_lock.as_ref().ok_or("MIDI player not initialized")?;

    Ok(PlaybackPositionInfo {
        position: player.get_position(),
        duration: player.get_duration(),
        is_playing: player.is_playing(),
    })
}

/// Seek to a position in the MIDI file
#[tauri::command]
pub fn midi_file_seek(position_beats: f32) -> Result<(), String> {
    let player_lock = get_midi_player()?;
    let player = player_lock.as_ref().ok_or("MIDI player not initialized")?;
    player.seek(position_beats);
    Ok(())
}

// =============================================================================
// Live MIDI Device Input Commands
// =============================================================================

use crate::audio::midi::{MidiDeviceInfo, MidiInputManager};

/// Global MIDI input manager instance
static MIDI_INPUT_MANAGER: Lazy<MidiInputManager> = Lazy::new(MidiInputManager::new);

/// Update the MIDI input manager's queue when a plugin is loaded/reloaded
fn update_midi_input_queue() {
    if MIDI_INPUT_MANAGER.is_connected() {
        if let Some(handle) = get_engine_handle() {
            if let Some(queue) = handle.get_plugin_midi_queue() {
                MIDI_INPUT_MANAGER.set_queue(Some(queue));
                log::info!("MIDI input manager queue updated");
            } else {
                log::warn!("MIDI input manager: no queue available from plugin");
            }
        }
    }
}

/// Clear the MIDI input manager's queue and disconnect when a plugin is unloaded
/// This ensures user doesn't see "connected" state that doesn't work
fn clear_midi_input_queue() {
    if MIDI_INPUT_MANAGER.is_connected() {
        MIDI_INPUT_MANAGER.disconnect();
        log::info!("MIDI input manager disconnected due to plugin unload");
    }
    MIDI_INPUT_MANAGER.set_queue(None);
    log::info!("MIDI input manager queue cleared");
}

/// List available MIDI input devices
#[tauri::command]
pub fn midi_device_list() -> Result<Vec<MidiDeviceInfo>, String> {
    MIDI_INPUT_MANAGER.list_devices()
}

/// Connect to a MIDI input device by index
#[tauri::command]
pub fn midi_device_connect(device_index: usize) -> Result<String, String> {
    // Get the plugin's MIDI queue
    let handle = get_engine_handle().ok_or_else(|| "Audio engine not initialized".to_string())?;
    let queue = handle.get_plugin_midi_queue()
        .ok_or_else(|| "No plugin loaded - cannot connect MIDI device".to_string())?;

    MIDI_INPUT_MANAGER.connect(device_index, queue)
}

/// Disconnect from the current MIDI input device
#[tauri::command]
pub fn midi_device_disconnect() {
    MIDI_INPUT_MANAGER.disconnect();
}

/// Check if connected to a MIDI input device
#[tauri::command]
pub fn midi_device_is_connected() -> bool {
    MIDI_INPUT_MANAGER.is_connected()
}

/// Get the name of the connected MIDI device (if any)
#[tauri::command]
pub fn midi_device_get_connected() -> Option<String> {
    MIDI_INPUT_MANAGER.connected_device_name()
}

/// Get the last received MIDI note (for activity indicator)
#[tauri::command]
pub fn midi_device_get_last_note() -> Option<u8> {
    MIDI_INPUT_MANAGER.get_last_note()
}
