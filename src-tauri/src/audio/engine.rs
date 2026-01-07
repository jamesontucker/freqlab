//! Main audio engine using cpal for real-time audio output

use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;

use super::device::{get_output_device, get_supported_config, AudioConfig};
use super::plugin::{PluginInstance, PluginState};
use super::samples::{AudioSample, SamplePlayer};
use super::signals::{GatePattern, SignalConfig, SignalGenerator};

/// Current state of the audio engine
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineState {
    Stopped,
    Playing,
    Paused,
}

/// Input source for the audio engine
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputSource {
    Signal { config: SignalConfig },
    Sample { path: String },
    None,
}

/// Commands that can be sent to the audio engine
#[derive(Debug, Clone)]
pub enum EngineCommand {
    Play,
    Stop,
    Pause,
    SetInputSource(InputSource),
    SetFrequency(f32),
    SetAmplitude(f32),
    SetLooping(bool),
    LoadSample(String),
}

/// Crossfade state for hot reload
const CROSSFADE_NONE: u8 = 0;
const CROSSFADE_OUT: u8 = 1;
const CROSSFADE_IN: u8 = 2;

/// Crossfade duration in samples (at 44.1kHz: 4410 = 100ms)
const CROSSFADE_SAMPLES: u32 = 4410;

/// Shared state between engine and audio thread
struct SharedState {
    input_source: RwLock<InputSource>,
    signal_generator: RwLock<SignalGenerator>,
    sample_player: RwLock<SamplePlayer>,
    is_playing: AtomicBool,
    is_looping: AtomicBool,
    // Output levels for metering - using AtomicU32 with f32 bit patterns for lock-free access
    output_level_left: AtomicU32,
    output_level_right: AtomicU32,
    // Plugin hosting
    plugin_instance: RwLock<Option<PluginInstance>>,
    plugin_state: RwLock<PluginState>,
    // Crossfade for hot reload
    crossfade_state: AtomicU8,
    crossfade_position: AtomicU32,
}

/// Helper to store f32 in AtomicU32
#[inline]
fn f32_to_u32(f: f32) -> u32 {
    f.to_bits()
}

/// Helper to load f32 from AtomicU32
#[inline]
fn u32_to_f32(u: u32) -> f32 {
    f32::from_bits(u)
}

/// Handle to control the audio engine from other threads
#[derive(Clone)]
pub struct AudioEngineHandle {
    shared: Arc<SharedState>,
    sample_rate: u32,
}

impl AudioEngineHandle {
    pub fn play(&self) {
        log::info!("AudioEngine: play() called");
        self.shared.is_playing.store(true, Ordering::SeqCst);
        self.shared.sample_player.write().play();
        let source = self.shared.input_source.read().clone();
        let has_sample = self.shared.sample_player.read().has_sample();
        let player_playing = self.shared.sample_player.read().is_playing();
        log::info!("AudioEngine: input_source = {:?}, has_sample = {}, player_playing = {}", source, has_sample, player_playing);
    }

    pub fn stop(&self) {
        self.shared.is_playing.store(false, Ordering::SeqCst);
        self.shared.sample_player.write().stop();
        self.shared.signal_generator.write().reset();
    }

    pub fn pause(&self) {
        self.shared.is_playing.store(false, Ordering::SeqCst);
        self.shared.sample_player.write().pause();
    }

    pub fn is_playing(&self) -> bool {
        self.shared.is_playing.load(Ordering::SeqCst)
    }

    pub fn set_input_source(&self, source: InputSource) {
        log::info!("AudioEngine: set_input_source called with {:?}", source);
        match &source {
            InputSource::Signal { config } => {
                log::info!("AudioEngine: Setting signal source");
                self.shared.signal_generator.write().set_config(config.clone());
            }
            InputSource::Sample { path } => {
                log::info!("AudioEngine: Loading sample from path: {}", path);
                match self.load_sample(path) {
                    Ok(()) => {
                        let has_sample = self.shared.sample_player.read().has_sample();
                        log::info!("AudioEngine: Sample loaded successfully, has_sample = {}", has_sample);
                    }
                    Err(e) => {
                        log::error!("AudioEngine: Failed to load sample: {}", e);
                    }
                }
            }
            InputSource::None => {
                log::info!("AudioEngine: Setting input source to None");
                self.shared.sample_player.write().unload();
            }
        }
        *self.shared.input_source.write() = source;
    }

    pub fn set_frequency(&self, frequency: f32) {
        self.shared.signal_generator.write().set_frequency(frequency);
    }

    pub fn set_amplitude(&self, amplitude: f32) {
        self.shared.signal_generator.write().set_amplitude(amplitude);
    }

    pub fn set_gate_pattern(&self, pattern: GatePattern) {
        self.shared.signal_generator.write().set_gate_pattern(pattern);
    }

    pub fn set_gate_rate(&self, rate: f32) {
        self.shared.signal_generator.write().set_gate_rate(rate);
    }

    pub fn set_gate_duty(&self, duty: f32) {
        self.shared.signal_generator.write().set_gate_duty(duty);
    }

    pub fn set_looping(&self, looping: bool) {
        self.shared.is_looping.store(looping, Ordering::SeqCst);
        self.shared.sample_player.write().set_looping(looping);
    }

    pub fn load_sample<P: AsRef<Path>>(&self, path: P) -> Result<(), String> {
        let path_ref = path.as_ref();
        log::info!("Loading sample from: {:?}", path_ref);

        let sample = AudioSample::load(path_ref)?;
        log::info!(
            "Sample loaded: {} samples, {} Hz, {} channels, {:.2}s",
            sample.info.num_samples,
            sample.info.sample_rate,
            sample.info.channels,
            sample.info.duration_secs
        );

        // Calculate speed ratio for resampling if needed
        let speed_ratio = sample.info.sample_rate as f32 / self.sample_rate as f32;
        log::info!("Speed ratio: {} (sample {}Hz -> engine {}Hz)", speed_ratio, sample.info.sample_rate, self.sample_rate);

        let mut player = self.shared.sample_player.write();
        player.load_sample(sample);
        player.set_speed_ratio(speed_ratio);

        Ok(())
    }

    pub fn get_output_levels(&self) -> (f32, f32) {
        let left = u32_to_f32(self.shared.output_level_left.load(Ordering::Relaxed));
        let right = u32_to_f32(self.shared.output_level_right.load(Ordering::Relaxed));
        (left, right)
    }

    pub fn get_state(&self) -> EngineState {
        if self.shared.is_playing.load(Ordering::SeqCst) {
            EngineState::Playing
        } else {
            EngineState::Stopped
        }
    }

    // Plugin methods

    /// Load a CLAP plugin from a .clap bundle path
    pub fn load_plugin(&self, path: &Path) -> Result<(), String> {
        log::info!("Loading plugin from: {:?}", path);

        // Update state to loading
        *self.shared.plugin_state.write() = PluginState::Loading {
            path: path.display().to_string(),
        };

        // Unload existing plugin first
        self.unload_plugin();

        // Load new plugin with sample rate and reasonable max frames
        let max_frames = 4096u32;
        match PluginInstance::load(path, self.sample_rate as f64, max_frames) {
            Ok(mut plugin) => {
                // Start processing
                if let Err(e) = plugin.start_processing() {
                    log::warn!("Plugin start_processing failed: {}", e);
                }

                let name = plugin.name.clone();
                let has_editor = plugin.has_gui();
                let path_str = path.display().to_string();

                *self.shared.plugin_instance.write() = Some(plugin);
                *self.shared.plugin_state.write() = PluginState::Active {
                    name: name.clone(),
                    path: path_str,
                    has_editor,
                };

                log::info!("Plugin loaded: {}", name);
                Ok(())
            }
            Err(e) => {
                *self.shared.plugin_state.write() = PluginState::Error {
                    message: e.clone(),
                };
                Err(e)
            }
        }
    }

    /// Unload the current plugin
    pub fn unload_plugin(&self) {
        let mut plugin_lock = self.shared.plugin_instance.write();
        if let Some(mut plugin) = plugin_lock.take() {
            plugin.stop_processing();
            log::info!("Plugin unloaded");
        }
        *self.shared.plugin_state.write() = PluginState::Unloaded;
    }

    /// Get the current plugin state
    pub fn get_plugin_state(&self) -> PluginState {
        self.shared.plugin_state.read().clone()
    }

    /// Check if a plugin is loaded
    pub fn has_plugin(&self) -> bool {
        self.shared.plugin_instance.read().is_some()
    }

    /// Check if the loaded plugin has a GUI
    pub fn plugin_has_editor(&self) -> bool {
        self.shared
            .plugin_instance
            .read()
            .as_ref()
            .map(|p| p.has_gui())
            .unwrap_or(false)
    }

    /// Open the plugin's editor window
    pub fn open_plugin_editor(&self) -> Result<(), String> {
        log::info!("AudioEngineHandle::open_plugin_editor called");
        let mut plugin_lock = self.shared.plugin_instance.write();
        log::info!("AudioEngineHandle::open_plugin_editor: got plugin lock");
        if let Some(plugin) = plugin_lock.as_mut() {
            log::info!("AudioEngineHandle::open_plugin_editor: calling plugin.open_editor()");
            plugin.open_editor()
        } else {
            log::warn!("AudioEngineHandle::open_plugin_editor: no plugin loaded");
            Err("No plugin loaded".to_string())
        }
    }

    /// Close the plugin's editor window
    pub fn close_plugin_editor(&self) {
        let mut plugin_lock = self.shared.plugin_instance.write();
        if let Some(plugin) = plugin_lock.as_mut() {
            plugin.close_editor();
        }
    }

    /// Check if the plugin editor is open
    pub fn is_plugin_editor_open(&self) -> bool {
        self.shared
            .plugin_instance
            .read()
            .as_ref()
            .map(|p| p.is_editor_open())
            .unwrap_or(false)
    }

    /// Flush plugin parameters and handle callbacks
    /// This should be called periodically when the editor is open to ensure
    /// GUI parameter changes are processed even when audio isn't playing.
    pub fn plugin_idle(&self) {
        use crate::audio::plugin::clap_host::take_callback_request;

        let plugin_lock = self.shared.plugin_instance.read();
        if let Some(plugin) = plugin_lock.as_ref() {
            // Check if the plugin requested a main thread callback
            if take_callback_request() {
                plugin.call_on_main_thread();
            }

            // Flush parameter changes from the GUI
            plugin.flush_params();
        }
    }

    /// Start crossfade out (for hot reload)
    pub fn start_crossfade_out(&self) {
        self.shared.crossfade_position.store(0, Ordering::SeqCst);
        self.shared
            .crossfade_state
            .store(CROSSFADE_OUT, Ordering::SeqCst);
    }

    /// Start crossfade in (for hot reload)
    pub fn start_crossfade_in(&self) {
        self.shared.crossfade_position.store(0, Ordering::SeqCst);
        self.shared
            .crossfade_state
            .store(CROSSFADE_IN, Ordering::SeqCst);
    }

    /// Check if crossfade is complete
    pub fn is_crossfade_complete(&self) -> bool {
        self.shared.crossfade_state.load(Ordering::SeqCst) == CROSSFADE_NONE
    }
}

/// The main audio engine
pub struct AudioEngine {
    _stream: cpal::Stream,
    handle: AudioEngineHandle,
    config: AudioConfig,
}

impl AudioEngine {
    /// Create and start a new audio engine
    pub fn new(device_name: Option<&str>, config: AudioConfig) -> Result<Self, String> {
        let device = get_output_device(device_name)?;
        let stream_config = get_supported_config(&device, &config)?;

        let sample_rate = stream_config.sample_rate.0;
        let channels = stream_config.channels as usize;

        log::info!(
            "Starting audio engine: {} Hz, {} channels",
            sample_rate,
            channels
        );

        // Create shared state
        let shared = Arc::new(SharedState {
            input_source: RwLock::new(InputSource::None),
            signal_generator: RwLock::new(SignalGenerator::new(sample_rate)),
            sample_player: RwLock::new(SamplePlayer::new()),
            is_playing: AtomicBool::new(false),
            is_looping: AtomicBool::new(true),
            output_level_left: AtomicU32::new(f32_to_u32(0.0)),
            output_level_right: AtomicU32::new(f32_to_u32(0.0)),
            plugin_instance: RwLock::new(None),
            plugin_state: RwLock::new(PluginState::Unloaded),
            crossfade_state: AtomicU8::new(CROSSFADE_NONE),
            crossfade_position: AtomicU32::new(0),
        });

        let shared_clone = Arc::clone(&shared);

        // Level smoothing factor
        let level_smoothing = 0.1f32;

        // Pre-allocate buffers for plugin processing (avoid allocation in audio callback)
        // IMPORTANT: This must match the max_frames used in load_plugin (4096)
        // For stereo interleaved, we need max_frames * 2 samples
        let max_frames = 4096usize;
        let max_buffer_size = max_frames * channels; // 8192 for stereo
        let mut input_buffer = vec![0.0f32; max_buffer_size];
        let mut output_buffer = vec![0.0f32; max_buffer_size];

        // Build the output stream
        let stream = device
            .build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let is_playing = shared_clone.is_playing.load(Ordering::SeqCst);

                    if !is_playing {
                        // Fill with silence
                        for sample in data.iter_mut() {
                            *sample = 0.0;
                        }
                        shared_clone.output_level_left.store(f32_to_u32(0.0), Ordering::Relaxed);
                        shared_clone.output_level_right.store(f32_to_u32(0.0), Ordering::Relaxed);
                        return;
                    }

                    let input_source = shared_clone.input_source.read().clone();
                    let has_plugin = shared_clone.plugin_instance.read().is_some();

                    // Generate input samples
                    match input_source {
                        InputSource::Signal { .. } => {
                            let mut generator = shared_clone.signal_generator.write();
                            for chunk in data.chunks_mut(channels) {
                                let sample = generator.next_sample();
                                chunk[0] = sample.left;
                                if channels > 1 {
                                    chunk[1] = sample.right;
                                }
                            }
                        }
                        InputSource::Sample { .. } => {
                            let mut player = shared_clone.sample_player.write();
                            for chunk in data.chunks_mut(channels) {
                                let sample = player.next_sample();
                                chunk[0] = sample.left;
                                if channels > 1 {
                                    chunk[1] = sample.right;
                                }
                            }
                        }
                        InputSource::None => {
                            for sample in data.iter_mut() {
                                *sample = 0.0;
                            }
                        }
                    }

                    // Process through plugin if loaded
                    // Debug: log periodically to check plugin routing
                    static ENGINE_CALL_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                    let engine_count = ENGINE_CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if engine_count % 1000 == 0 {
                        log::info!(
                            "Engine callback #{}: has_plugin={}, data.len()={}, max_buffer_size={}",
                            engine_count, has_plugin, data.len(), max_buffer_size
                        );
                    }

                    // ALWAYS apply pending state when we have a plugin, regardless of buffer size
                    // This is critical for syncing parameter changes from the editor
                    if has_plugin {
                        let mut plugin_lock = shared_clone.plugin_instance.write();
                        if let Some(ref mut plugin) = *plugin_lock {
                            plugin.apply_pending_state();
                        }
                        drop(plugin_lock);
                    }

                    if has_plugin && data.len() <= max_buffer_size {
                        // Copy input to buffer
                        input_buffer[..data.len()].copy_from_slice(data);

                        // Try to process through plugin
                        let mut plugin_lock = shared_clone.plugin_instance.write();
                        if let Some(ref mut plugin) = *plugin_lock {

                            if plugin
                                .process(&input_buffer[..data.len()], &mut output_buffer[..data.len()])
                                .is_ok()
                            {
                                // Apply crossfade if reloading
                                let crossfade_state =
                                    shared_clone.crossfade_state.load(Ordering::SeqCst);

                                if crossfade_state == CROSSFADE_NONE {
                                    // No crossfade, just copy output
                                    data.copy_from_slice(&output_buffer[..data.len()]);

                                    // Debug: verify output buffer has plugin output
                                    if engine_count % 1000 == 0 {
                                        let out_max = output_buffer.iter().take(data.len()).map(|s| s.abs()).fold(0.0f32, f32::max);
                                        log::info!("Engine: copied plugin output to device, out_max={:.4}", out_max);
                                    }
                                } else {
                                    // Apply crossfade
                                    let mut position = shared_clone
                                        .crossfade_position
                                        .load(Ordering::SeqCst);
                                    let samples_per_frame = channels as u32;

                                    for (i, chunk) in data.chunks_mut(channels).enumerate() {
                                        let fade = if crossfade_state == CROSSFADE_OUT {
                                            // Fading out: 1.0 -> 0.0
                                            1.0 - (position as f32 / CROSSFADE_SAMPLES as f32)
                                        } else {
                                            // Fading in: 0.0 -> 1.0
                                            position as f32 / CROSSFADE_SAMPLES as f32
                                        };
                                        let fade = fade.clamp(0.0, 1.0);

                                        // Apply fade to output
                                        let idx = i * channels;
                                        chunk[0] = output_buffer[idx] * fade;
                                        if channels > 1 {
                                            chunk[1] = output_buffer[idx + 1] * fade;
                                        }

                                        position = position.saturating_add(samples_per_frame);
                                    }

                                    // Update position and check if complete
                                    if position >= CROSSFADE_SAMPLES {
                                        shared_clone
                                            .crossfade_state
                                            .store(CROSSFADE_NONE, Ordering::SeqCst);
                                        shared_clone.crossfade_position.store(0, Ordering::SeqCst);
                                    } else {
                                        shared_clone
                                            .crossfade_position
                                            .store(position, Ordering::SeqCst);
                                    }
                                }
                            }
                        }
                    }

                    // Calculate peak levels from final output
                    let mut peak_left = 0.0f32;
                    let mut peak_right = 0.0f32;
                    for chunk in data.chunks(channels) {
                        peak_left = peak_left.max(chunk[0].abs());
                        if channels > 1 {
                            peak_right = peak_right.max(chunk[1].abs());
                        }
                    }

                    // Update output levels with smoothing (lock-free using atomics)
                    {
                        let current = u32_to_f32(shared_clone.output_level_left.load(Ordering::Relaxed));
                        let new_level = current * (1.0 - level_smoothing) + peak_left * level_smoothing;
                        shared_clone.output_level_left.store(f32_to_u32(new_level), Ordering::Relaxed);
                    }
                    {
                        let current = u32_to_f32(shared_clone.output_level_right.load(Ordering::Relaxed));
                        let new_level = current * (1.0 - level_smoothing) + peak_right * level_smoothing;
                        shared_clone.output_level_right.store(f32_to_u32(new_level), Ordering::Relaxed);
                    }
                },
                move |err| {
                    log::error!("Audio stream error: {}", err);
                },
                None, // No timeout
            )
            .map_err(|e| format!("Failed to build output stream: {}", e))?;

        // Start the stream
        stream
            .play()
            .map_err(|e| format!("Failed to start stream: {}", e))?;

        let handle = AudioEngineHandle {
            shared,
            sample_rate,
        };

        Ok(Self {
            _stream: stream,
            handle,
            config,
        })
    }

    /// Get a handle to control the engine
    pub fn handle(&self) -> AudioEngineHandle {
        self.handle.clone()
    }

    /// Get the current audio configuration
    pub fn config(&self) -> &AudioConfig {
        &self.config
    }

    /// Get the sample rate
    pub fn sample_rate(&self) -> u32 {
        self.handle.sample_rate
    }
}

// Global engine handle (cpal::Stream isn't Send/Sync, so we store just the handle)
static ENGINE_HANDLE: once_cell::sync::OnceCell<RwLock<Option<AudioEngineHandle>>> =
    once_cell::sync::OnceCell::new();

/// Initialize the global audio engine
pub fn init_engine(device_name: Option<&str>, config: AudioConfig) -> Result<(), String> {
    // Check if engine is already initialized to prevent double init and memory leaks
    // If we already have an engine, just return Ok - reuse the existing one
    if let Some(cell) = ENGINE_HANDLE.get() {
        if cell.read().is_some() {
            log::debug!("Audio engine already initialized, reusing existing instance");
            return Ok(());
        }
    }

    let engine = AudioEngine::new(device_name, config)?;
    let handle = engine.handle();

    // Store the handle
    let cell = ENGINE_HANDLE.get_or_init(|| RwLock::new(None));
    *cell.write() = Some(handle);

    // The stream needs to stay alive for audio to work.
    // We use mem::forget to leak it - it will live for the app's lifetime.
    // This is intentional: audio streams should not be dropped while the app is running.
    std::mem::forget(engine);

    log::info!("Audio engine initialized successfully");
    Ok(())
}

/// Get the global engine handle
pub fn get_engine_handle() -> Option<AudioEngineHandle> {
    ENGINE_HANDLE
        .get()
        .and_then(|cell| cell.read().clone())
}

/// Shutdown the global engine
pub fn shutdown_engine() {
    if let Some(cell) = ENGINE_HANDLE.get() {
        *cell.write() = None;
    }
    // Note: The stream is leaked and will be cleaned up when the process exits
    // The audio callback will produce silence when the handle is None
}
