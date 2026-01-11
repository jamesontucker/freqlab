//! Main audio engine using cpal for real-time audio output

use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::{Mutex, RwLock};
use rubato::{FftFixedInOut, Resampler};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;

use super::buffer::StereoSample;
use super::device::{get_output_device, get_supported_config, AudioConfig};
use super::input::{get_input_handle, start_input_capture, stop_input_capture};
use super::midi::MidiEventQueue;
use super::plugin::{PluginInstance, PluginState};
use super::samples::{AudioSample, SamplePlayer};
use super::signals::{GatePattern, SignalConfig, SignalGenerator};
use super::spectrum::{SpectrumAnalyzer, NUM_BANDS};
use super::stereo::{StereoAnalyzer, STEREO_HISTORY_SIZE};

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
    Live { device: Option<String>, chunk_size: Option<usize> },
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

/// Number of samples in waveform display buffer
const WAVEFORM_SAMPLES: usize = 256;

/// Maximum output buffer size to prevent unbounded growth (about 1 second at 48kHz)
const MAX_OUTPUT_BUFFER_SIZE: usize = 48000;

/// Live input resampler for handling sample rate mismatch
struct LiveInputResampler {
    resampler: FftFixedInOut<f32>,
    input_buffer_left: Vec<f32>,
    input_buffer_right: Vec<f32>,
    output_buffer_left: Vec<f32>,
    output_buffer_right: Vec<f32>,
    input_frames_needed: usize,
    #[allow(dead_code)]
    output_frames: usize,
    /// Accumulated input samples (left channel)
    accum_left: Vec<f32>,
    /// Accumulated input samples (right channel)
    accum_right: Vec<f32>,
    /// Accumulated output samples ready to consume (VecDeque for O(1) front removal)
    output_ready_left: VecDeque<f32>,
    output_ready_right: VecDeque<f32>,
}

impl LiveInputResampler {
    fn new(input_rate: u32, output_rate: u32, chunk_size: usize) -> Result<Self, String> {
        // FftFixedInOut needs chunk sizes that work with FFT
        // Use a reasonable chunk size (power of 2 works well)
        let resampler = FftFixedInOut::<f32>::new(
            input_rate as usize,
            output_rate as usize,
            chunk_size,
            2, // 2 channels (stereo)
        ).map_err(|e| format!("Failed to create resampler: {}", e))?;

        let input_frames_needed = resampler.input_frames_next();
        let output_frames = resampler.output_frames_next();

        log::info!(
            "Created resampler: {} Hz -> {} Hz, input frames: {}, output frames: {}",
            input_rate, output_rate, input_frames_needed, output_frames
        );

        Ok(Self {
            resampler,
            input_buffer_left: vec![0.0; input_frames_needed],
            input_buffer_right: vec![0.0; input_frames_needed],
            output_buffer_left: vec![0.0; output_frames],
            output_buffer_right: vec![0.0; output_frames],
            input_frames_needed,
            output_frames,
            accum_left: Vec::with_capacity(input_frames_needed * 2),
            accum_right: Vec::with_capacity(input_frames_needed * 2),
            output_ready_left: VecDeque::with_capacity(output_frames * 2),
            output_ready_right: VecDeque::with_capacity(output_frames * 2),
        })
    }

    /// Add input samples to the accumulator
    fn push_input(&mut self, left: f32, right: f32) {
        self.accum_left.push(left);
        self.accum_right.push(right);
    }

    /// Process accumulated input and return resampled output
    /// Returns None if not enough input samples yet
    fn process(&mut self) -> bool {
        // Check if we have enough input samples
        if self.accum_left.len() < self.input_frames_needed {
            return false;
        }

        // Copy input samples to buffers
        self.input_buffer_left[..self.input_frames_needed]
            .copy_from_slice(&self.accum_left[..self.input_frames_needed]);
        self.input_buffer_right[..self.input_frames_needed]
            .copy_from_slice(&self.accum_right[..self.input_frames_needed]);

        // Remove consumed samples from accumulator
        self.accum_left.drain(..self.input_frames_needed);
        self.accum_right.drain(..self.input_frames_needed);

        // Resample
        let input_buffers = vec![&self.input_buffer_left[..], &self.input_buffer_right[..]];
        let mut output_buffers = vec![
            &mut self.output_buffer_left[..],
            &mut self.output_buffer_right[..],
        ];

        match self.resampler.process_into_buffer(&input_buffers, &mut output_buffers, None) {
            Ok((_, output_len)) => {
                // Add resampled output to ready buffer
                self.output_ready_left.extend(self.output_buffer_left[..output_len].iter().copied());
                self.output_ready_right.extend(self.output_buffer_right[..output_len].iter().copied());

                // Prevent unbounded buffer growth - drop oldest samples if buffer exceeds max
                while self.output_ready_left.len() > MAX_OUTPUT_BUFFER_SIZE {
                    self.output_ready_left.pop_front();
                    self.output_ready_right.pop_front();
                }
                true
            }
            Err(e) => {
                log::error!("Resampler error: {}", e);
                false
            }
        }
    }

    /// Get the next resampled sample, or None if buffer is empty
    /// Uses VecDeque::pop_front() for O(1) removal instead of Vec::remove(0) which was O(N)
    fn pop_output(&mut self) -> Option<StereoSample> {
        match (self.output_ready_left.pop_front(), self.output_ready_right.pop_front()) {
            (Some(left), Some(right)) => Some(StereoSample::new(left, right)),
            _ => None,
        }
    }

    /// Check how many output samples are available
    fn available_output(&self) -> usize {
        self.output_ready_left.len()
    }
}

/// Shared state between engine and audio thread
struct SharedState {
    input_source: RwLock<InputSource>,
    signal_generator: RwLock<SignalGenerator>,
    sample_player: RwLock<SamplePlayer>,
    is_playing: AtomicBool,
    is_looping: AtomicBool,
    // Master volume (0.0 - 1.0) stored as u32 bits for lock-free access
    master_volume: AtomicU32,
    // Output levels for metering - using AtomicU32 with f32 bit patterns for lock-free access
    output_level_left: AtomicU32,
    output_level_right: AtomicU32,
    // Input levels for metering (live input only)
    input_level_left: AtomicU32,
    input_level_right: AtomicU32,
    // Live input paused state
    live_paused: AtomicBool,
    // Live input resampler (for sample rate conversion)
    live_resampler: Mutex<Option<LiveInputResampler>>,
    // Clipping indicators (set when limiter engages, cleared after being read)
    clipping_left: AtomicBool,
    clipping_right: AtomicBool,
    // Spectrum analyzer data - stored as AtomicU32 array for lock-free access
    spectrum_bands: [AtomicU32; NUM_BANDS],
    // Waveform display buffer (downsampled stereo samples as mono)
    waveform_buffer: [AtomicU32; WAVEFORM_SAMPLES],
    waveform_write_pos: AtomicU32,
    // Stereo imaging data - positions stored as flat array [angle0, radius0, angle1, radius1, ...]
    stereo_positions: [AtomicU32; STEREO_HISTORY_SIZE * 2],
    stereo_correlation: AtomicU32,
    // Plugin hosting
    plugin_instance: RwLock<Option<PluginInstance>>,
    plugin_state: RwLock<PluginState>,
    // MIDI queue reference (separate from plugin lock for lock-free MIDI access)
    // Updated when plugin is loaded/unloaded
    midi_queue: RwLock<Option<Arc<MidiEventQueue>>>,
    // Whether the loaded plugin is an instrument (needs MIDI processing even when not "playing")
    is_instrument_plugin: AtomicBool,
    // Crossfade for hot reload
    crossfade_state: AtomicU8,
    crossfade_position: AtomicU32,
    // Plugin editor window position (persists across plugin reload for hot reload)
    // This is stored at engine level so it survives plugin unload/reload cycles
    last_editor_position: RwLock<Option<(f64, f64)>>,
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

        // Stop any existing live input capture when switching away from Live
        let current_source = self.shared.input_source.read().clone();
        if matches!(current_source, InputSource::Live { .. }) && !matches!(source, InputSource::Live { .. }) {
            log::info!("AudioEngine: Stopping live input capture");
            stop_input_capture();
            // Clear resampler
            *self.shared.live_resampler.lock() = None;
        }

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
            InputSource::Live { device, chunk_size } => {
                log::info!("AudioEngine: Starting live input capture, device: {:?}, chunk_size: {:?}", device, chunk_size);
                // Start the input capture using the device's native sample rate
                // This avoids CoreAudio conflicts - resampling is done in the engine if needed
                match start_input_capture(device.as_deref()) {
                    Ok(handle) => {
                        // Clear buffer to avoid stale data
                        handle.clear_buffer();
                        // Reset paused state
                        self.shared.live_paused.store(false, Ordering::SeqCst);

                        // Check if input device's native rate differs from output rate
                        // We always use the input's native rate to avoid CoreAudio conflicts
                        let input_rate = handle.sample_rate();
                        log::info!("AudioEngine: Input device native sample rate: {} Hz, output: {} Hz", input_rate, self.sample_rate);

                        if input_rate != self.sample_rate {
                            // Use provided chunk size or default to 256 (good balance of latency vs efficiency)
                            // Smaller values (64, 128) = lower latency but more CPU
                            // Larger values (512, 1024) = higher latency but more efficient
                            let resampler_chunk_size = chunk_size.unwrap_or(256);
                            log::info!(
                                "AudioEngine: Sample rate mismatch detected. Input: {} Hz, Output: {} Hz. Creating resampler with chunk size {}.",
                                input_rate, self.sample_rate, resampler_chunk_size
                            );
                            match LiveInputResampler::new(input_rate, self.sample_rate, resampler_chunk_size) {
                                Ok(resampler) => {
                                    *self.shared.live_resampler.lock() = Some(resampler);
                                    log::info!("AudioEngine: Resampler created successfully");
                                }
                                Err(e) => {
                                    log::error!("AudioEngine: Failed to create resampler: {}. Audio will be distorted!", e);
                                    *self.shared.live_resampler.lock() = None;
                                }
                            }
                        } else {
                            // Same sample rate - no resampling needed
                            log::info!("AudioEngine: Sample rates match ({}Hz), no resampling needed", input_rate);
                            *self.shared.live_resampler.lock() = None;
                        }

                        log::info!("AudioEngine: Live input capture started successfully");
                    }
                    Err(e) => {
                        log::error!("AudioEngine: Failed to start live input capture: {}", e);
                        *self.shared.live_resampler.lock() = None;
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

    /// Get input levels (for live input metering)
    pub fn get_input_levels(&self) -> (f32, f32) {
        let left = u32_to_f32(self.shared.input_level_left.load(Ordering::Relaxed));
        let right = u32_to_f32(self.shared.input_level_right.load(Ordering::Relaxed));
        (left, right)
    }

    /// Set live input paused state
    pub fn set_live_paused(&self, paused: bool) {
        self.shared.live_paused.store(paused, Ordering::SeqCst);
        // Clear input levels when pausing
        if paused {
            self.shared.input_level_left.store(f32_to_u32(0.0), Ordering::Relaxed);
            self.shared.input_level_right.store(f32_to_u32(0.0), Ordering::Relaxed);
        } else {
            // Clear input buffer when unpausing to avoid stale audio
            if let Some(handle) = get_input_handle() {
                handle.clear_buffer();
            }
        }
    }

    /// Check if live input is paused
    pub fn is_live_paused(&self) -> bool {
        self.shared.live_paused.load(Ordering::SeqCst)
    }

    /// Set master volume (0.0 - 1.0)
    pub fn set_master_volume(&self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.0);
        self.shared.master_volume.store(f32_to_u32(clamped), Ordering::SeqCst);
    }

    /// Get master volume (0.0 - 1.0)
    pub fn get_master_volume(&self) -> f32 {
        u32_to_f32(self.shared.master_volume.load(Ordering::SeqCst))
    }

    /// Get spectrum analyzer band magnitudes (0.0 - 1.0)
    pub fn get_spectrum_data(&self) -> [f32; NUM_BANDS] {
        let mut bands = [0.0f32; NUM_BANDS];
        for (i, band) in self.shared.spectrum_bands.iter().enumerate() {
            bands[i] = u32_to_f32(band.load(Ordering::Relaxed));
        }
        bands
    }

    /// Get and clear clipping indicators (returns true if clipping occurred since last check)
    pub fn get_clipping(&self) -> (bool, bool) {
        let left = self.shared.clipping_left.swap(false, Ordering::Relaxed);
        let right = self.shared.clipping_right.swap(false, Ordering::Relaxed);
        (left, right)
    }

    /// Get waveform display buffer (circular buffer of recent samples)
    pub fn get_waveform_data(&self) -> Vec<f32> {
        let write_pos = self.shared.waveform_write_pos.load(Ordering::Relaxed) as usize;
        let mut waveform = Vec::with_capacity(WAVEFORM_SAMPLES);

        // Read from write_pos to end, then from start to write_pos (circular buffer order)
        for i in 0..WAVEFORM_SAMPLES {
            let idx = (write_pos + i) % WAVEFORM_SAMPLES;
            waveform.push(u32_to_f32(self.shared.waveform_buffer[idx].load(Ordering::Relaxed)));
        }
        waveform
    }

    /// Get stereo imaging positions for visualization
    /// Returns Vec of (angle, radius) pairs where:
    /// - angle: 0 = full left, PI/2 = center, PI = full right
    /// - radius: 0-1 based on amplitude
    pub fn get_stereo_positions(&self) -> Vec<(f32, f32)> {
        let mut positions = Vec::with_capacity(STEREO_HISTORY_SIZE);
        for i in 0..STEREO_HISTORY_SIZE {
            let angle = u32_to_f32(self.shared.stereo_positions[i * 2].load(Ordering::Relaxed));
            let radius = u32_to_f32(self.shared.stereo_positions[i * 2 + 1].load(Ordering::Relaxed));
            positions.push((angle, radius));
        }
        positions
    }

    /// Get stereo correlation coefficient
    /// Returns value from -1.0 (out of phase) to +1.0 (mono/in-phase)
    pub fn get_stereo_correlation(&self) -> f32 {
        u32_to_f32(self.shared.stereo_correlation.load(Ordering::Relaxed))
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

                // Get MIDI queue reference before storing plugin
                let midi_queue = plugin.midi_queue();

                *self.shared.plugin_instance.write() = Some(plugin);
                // Store MIDI queue reference separately for lock-free access
                *self.shared.midi_queue.write() = Some(midi_queue);
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
        // Clear MIDI queue reference first (allows immediate MIDI rejection)
        *self.shared.midi_queue.write() = None;

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
    ///
    /// Uses stored position if available, otherwise centers the window.
    pub fn open_plugin_editor(&self) -> Result<(), String> {
        log::info!("AudioEngineHandle::open_plugin_editor called");

        // First, check if user manually closed the window (clicked X) and save position
        // This handles the edge case where window was closed without calling close_plugin_editor
        {
            let plugin_lock = self.shared.plugin_instance.read();
            if let Some(plugin) = plugin_lock.as_ref() {
                // If editor is marked as open but window is not visible, user closed it manually
                if plugin.is_editor_open() && !plugin.is_editor_window_visible() {
                    if let Some(position) = plugin.get_editor_position() {
                        log::info!("open_plugin_editor: saving position from manually closed window {:?}", position);
                        *self.shared.last_editor_position.write() = Some(position);
                    }
                }
            }
        }

        // Get stored position from engine level (survives plugin reload)
        let position = self.shared.last_editor_position.read().clone();
        log::info!("AudioEngineHandle::open_plugin_editor: position={:?}", position);

        let mut plugin_lock = self.shared.plugin_instance.write();
        log::info!("AudioEngineHandle::open_plugin_editor: got plugin lock");
        if let Some(plugin) = plugin_lock.as_mut() {
            log::info!("AudioEngineHandle::open_plugin_editor: calling plugin.open_editor_at()");
            plugin.open_editor_at(position)
        } else {
            log::warn!("AudioEngineHandle::open_plugin_editor: no plugin loaded");
            Err("No plugin loaded".to_string())
        }
    }

    /// Close the plugin's editor window and save its position
    pub fn close_plugin_editor(&self) {
        let mut plugin_lock = self.shared.plugin_instance.write();
        if let Some(plugin) = plugin_lock.as_mut() {
            // Save window position before closing (survives plugin reload)
            if let Some(position) = plugin.get_editor_position() {
                log::info!("AudioEngineHandle::close_plugin_editor: saving position {:?}", position);
                *self.shared.last_editor_position.write() = Some(position);
            }
            plugin.close_editor();
        }
    }

    /// Get the stored editor window position
    pub fn get_editor_position(&self) -> Option<(f64, f64)> {
        self.shared.last_editor_position.read().clone()
    }

    /// Set the stored editor window position
    pub fn set_editor_position(&self, position: Option<(f64, f64)>) {
        *self.shared.last_editor_position.write() = position;
    }

    /// Check if the plugin editor is open AND visible
    /// Returns true only if the editor window exists and is actually visible on screen
    /// (handles the case where user manually closed the window with X button)
    pub fn is_plugin_editor_open(&self) -> bool {
        let result = self.shared
            .plugin_instance
            .read()
            .as_ref()
            .map(|p| {
                let editor_open = p.is_editor_open();
                let window_visible = p.is_editor_window_visible();
                log::debug!(
                    "is_plugin_editor_open: editor_open={}, window_visible={}",
                    editor_open,
                    window_visible
                );
                editor_open && window_visible
            })
            .unwrap_or(false);
        result
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

    // MIDI methods (for instrument plugins)
    // These use a separate midi_queue reference to avoid plugin lock contention

    /// Send a MIDI note on event to the loaded plugin
    /// Uses lock-free queue access - never blocks the audio thread
    #[inline]
    pub fn midi_note_on(&self, note: u8, velocity: u8) {
        // Use the separate midi_queue reference to avoid plugin lock
        if let Some(queue) = self.shared.midi_queue.read().as_ref() {
            queue.note_on(note, velocity);
        }
    }

    /// Send a MIDI note off event to the loaded plugin
    /// Uses lock-free queue access - never blocks the audio thread
    #[inline]
    pub fn midi_note_off(&self, note: u8) {
        if let Some(queue) = self.shared.midi_queue.read().as_ref() {
            queue.note_off(note);
        }
    }

    /// Send all notes off to the loaded plugin
    #[inline]
    pub fn midi_all_notes_off(&self) {
        if let Some(queue) = self.shared.midi_queue.read().as_ref() {
            queue.all_notes_off();
        }
    }

    /// Set whether the loaded plugin is an instrument (vs effect)
    /// Instrument plugins are processed even when not "playing" for MIDI input
    pub fn set_is_instrument(&self, is_instrument: bool) {
        self.shared.is_instrument_plugin.store(is_instrument, Ordering::SeqCst);
    }

    /// Get the current plugin's MIDI queue (for pattern player)
    /// Uses the separate midi_queue reference to avoid plugin lock
    pub fn get_plugin_midi_queue(&self) -> Option<Arc<MidiEventQueue>> {
        self.shared.midi_queue.read().clone()
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
        // Initialize spectrum bands, waveform, and stereo arrays with zeros
        const INIT_BAND: AtomicU32 = AtomicU32::new(0);
        const INIT_WAVEFORM: AtomicU32 = AtomicU32::new(0);
        const INIT_STEREO: AtomicU32 = AtomicU32::new(0);
        let shared = Arc::new(SharedState {
            input_source: RwLock::new(InputSource::None),
            signal_generator: RwLock::new(SignalGenerator::new(sample_rate)),
            sample_player: RwLock::new(SamplePlayer::new()),
            is_playing: AtomicBool::new(false),
            is_looping: AtomicBool::new(true),
            master_volume: AtomicU32::new(f32_to_u32(0.75)), // Default 75% volume
            output_level_left: AtomicU32::new(f32_to_u32(0.0)),
            output_level_right: AtomicU32::new(f32_to_u32(0.0)),
            input_level_left: AtomicU32::new(f32_to_u32(0.0)),
            input_level_right: AtomicU32::new(f32_to_u32(0.0)),
            live_paused: AtomicBool::new(false),
            live_resampler: Mutex::new(None),
            clipping_left: AtomicBool::new(false),
            clipping_right: AtomicBool::new(false),
            spectrum_bands: [INIT_BAND; NUM_BANDS],
            waveform_buffer: [INIT_WAVEFORM; WAVEFORM_SAMPLES],
            waveform_write_pos: AtomicU32::new(0),
            stereo_positions: [INIT_STEREO; STEREO_HISTORY_SIZE * 2],
            stereo_correlation: AtomicU32::new(f32_to_u32(1.0)), // Start at mono
            plugin_instance: RwLock::new(None),
            plugin_state: RwLock::new(PluginState::Unloaded),
            midi_queue: RwLock::new(None),
            is_instrument_plugin: AtomicBool::new(false),
            crossfade_state: AtomicU8::new(CROSSFADE_NONE),
            crossfade_position: AtomicU32::new(0),
            last_editor_position: RwLock::new(None),
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

        // Create spectrum analyzer for visualization
        let mut spectrum_analyzer = SpectrumAnalyzer::new(sample_rate);
        // Counter for throttling spectrum updates (every N callbacks)
        let mut spectrum_update_counter = 0u32;

        // Create stereo analyzer for stereo imaging visualization
        let mut stereo_analyzer = StereoAnalyzer::new();

        // Build the output stream
        let stream = device
            .build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let is_playing = shared_clone.is_playing.load(Ordering::SeqCst);
                    // Use try_read to avoid blocking audio thread if main thread holds write lock
                    // during plugin load/unload. If we can't read, assume no plugin.
                    let has_plugin = shared_clone.plugin_instance
                        .try_read()
                        .map(|guard| guard.is_some())
                        .unwrap_or(false);
                    let is_instrument = shared_clone.is_instrument_plugin.load(Ordering::SeqCst);

                    // For instrument plugins, we need to process even when not "playing"
                    // because they generate sound from MIDI input, not audio input.
                    // For effect plugins, respect the is_playing flag normally.
                    if !is_playing && !(has_plugin && is_instrument) {
                        // Not playing, and either no plugin or plugin is an effect - output silence
                        for sample in data.iter_mut() {
                            *sample = 0.0;
                        }
                        shared_clone.output_level_left.store(f32_to_u32(0.0), Ordering::Relaxed);
                        shared_clone.output_level_right.store(f32_to_u32(0.0), Ordering::Relaxed);
                        return;
                    }

                    // Use try_read for input_source to avoid blocking during source changes
                    // If we can't read, use None which outputs silence for this callback
                    let input_source = shared_clone.input_source
                        .try_read()
                        .map(|guard| guard.clone())
                        .unwrap_or(InputSource::None);

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
                        InputSource::Live { .. } => {
                            // Check if paused - if so, output silence
                            let is_paused = shared_clone.live_paused.load(Ordering::SeqCst);
                            if is_paused {
                                for sample in data.iter_mut() {
                                    *sample = 0.0;
                                }
                            } else if let Some(input_handle) = crate::audio::input::get_input_handle() {
                                let mut peak_left = 0.0f32;
                                let mut peak_right = 0.0f32;

                                // Check if we need to resample
                                let mut resampler_guard = shared_clone.live_resampler.lock();

                                if let Some(ref mut resampler) = *resampler_guard {
                                    // Resampling mode: read input samples, resample, then output
                                    let frames_needed = data.len() / channels;

                                    // Read enough input samples and feed to resampler
                                    // We may need to read more samples than output frames due to rate difference
                                    let available = input_handle.available_samples();
                                    for _ in 0..available.min(frames_needed * 2) {
                                        let sample = input_handle.read_sample();
                                        resampler.push_input(sample.left, sample.right);
                                        // Track input levels from raw input
                                        peak_left = peak_left.max(sample.left.abs());
                                        peak_right = peak_right.max(sample.right.abs());
                                    }

                                    // Process resampler to generate output
                                    while resampler.available_output() < frames_needed {
                                        if !resampler.process() {
                                            break; // Not enough input yet
                                        }
                                    }

                                    // Read resampled output
                                    for chunk in data.chunks_mut(channels) {
                                        if let Some(sample) = resampler.pop_output() {
                                            chunk[0] = sample.left;
                                            if channels > 1 {
                                                chunk[1] = sample.right;
                                            }
                                        } else {
                                            // No resampled data available yet, output silence
                                            chunk[0] = 0.0;
                                            if channels > 1 {
                                                chunk[1] = 0.0;
                                            }
                                        }
                                    }
                                } else {
                                    // No resampling needed - direct passthrough
                                    for chunk in data.chunks_mut(channels) {
                                        let sample = input_handle.read_sample();
                                        chunk[0] = sample.left;
                                        if channels > 1 {
                                            chunk[1] = sample.right;
                                        }
                                        // Track input levels
                                        peak_left = peak_left.max(sample.left.abs());
                                        peak_right = peak_right.max(sample.right.abs());
                                    }
                                }

                                drop(resampler_guard); // Release lock before updating levels

                                // Update input levels with smoothing
                                let input_smoothing = 0.15f32;
                                {
                                    let current = u32_to_f32(shared_clone.input_level_left.load(Ordering::Relaxed));
                                    let new_level = current * (1.0 - input_smoothing) + peak_left * input_smoothing;
                                    shared_clone.input_level_left.store(f32_to_u32(new_level), Ordering::Relaxed);
                                }
                                {
                                    let current = u32_to_f32(shared_clone.input_level_right.load(Ordering::Relaxed));
                                    let new_level = current * (1.0 - input_smoothing) + peak_right * input_smoothing;
                                    shared_clone.input_level_right.store(f32_to_u32(new_level), Ordering::Relaxed);
                                }
                            } else {
                                // No input handle available, output silence
                                for sample in data.iter_mut() {
                                    *sample = 0.0;
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
                    // Use try_write to avoid blocking audio thread if main thread holds the lock
                    if has_plugin {
                        if let Some(mut plugin_lock) = shared_clone.plugin_instance.try_write() {
                            if let Some(ref mut plugin) = *plugin_lock {
                                plugin.apply_pending_state();
                            }
                        }
                        // If we can't get the lock, skip this cycle - parameter sync can wait
                    }

                    if has_plugin && data.len() <= max_buffer_size {
                        // Copy input to buffer
                        input_buffer[..data.len()].copy_from_slice(data);

                        // Try to process through plugin using try_write to avoid blocking
                        // If main thread holds the lock (during reload/param update), pass through input unchanged
                        let plugin_processed = if let Some(mut plugin_lock) = shared_clone.plugin_instance.try_write() {
                            if let Some(ref mut plugin) = *plugin_lock {
                                plugin
                                    .process(&input_buffer[..data.len()], &mut output_buffer[..data.len()])
                                    .is_ok()
                            } else {
                                false
                            }
                        } else {
                            // Couldn't get lock - main thread is busy with plugin
                            // For effects: pass through input unchanged (no glitch)
                            // For instruments: the input_buffer already has generated audio
                            false
                        };

                        if plugin_processed {
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
                        // If plugin_processed is false (couldn't get lock), data already has input audio
                        // which passes through unchanged - this avoids audio glitches during hot reload
                    }

                    // Apply master volume before limiting
                    let master_vol = u32_to_f32(shared_clone.master_volume.load(Ordering::Relaxed));
                    for sample in data.iter_mut() {
                        *sample *= master_vol;
                    }

                    // SAFETY LIMITER: Clamp all output to prevent speaker/ear damage
                    // This protects against poorly written plugins that output >0dB
                    // Also handles NaN/infinity from buggy plugins
                    // Also detect clipping for visual indicator
                    let mut clipped_left = false;
                    let mut clipped_right = false;
                    for (i, sample) in data.iter_mut().enumerate() {
                        // Check for NaN or infinity first (buggy plugins can output these)
                        if !sample.is_finite() {
                            *sample = 0.0; // Replace invalid values with silence
                            // Mark as clipped since this is a plugin error
                            if channels > 1 {
                                if i % 2 == 0 { clipped_left = true; } else { clipped_right = true; }
                            } else {
                                clipped_left = true;
                                clipped_right = true;
                            }
                        } else if *sample > 1.0 || *sample < -1.0 {
                            // Determine which channel clipped
                            if channels > 1 {
                                if i % 2 == 0 {
                                    clipped_left = true;
                                } else {
                                    clipped_right = true;
                                }
                            } else {
                                clipped_left = true;
                                clipped_right = true;
                            }
                            *sample = sample.clamp(-1.0, 1.0);
                        }
                    }
                    // Set clipping flags (will stay true until read and cleared)
                    if clipped_left {
                        shared_clone.clipping_left.store(true, Ordering::Relaxed);
                    }
                    if clipped_right {
                        shared_clone.clipping_right.store(true, Ordering::Relaxed);
                    }

                    // Calculate peak levels from final output (after limiting)
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

                    // Update waveform display buffer (downsample to fit display)
                    // Take every Nth frame to capture a longer time window
                    let frames = data.len() / channels;
                    let downsample_factor = (frames / 8).max(1); // Capture ~8 samples per callback
                    let mut write_pos = shared_clone.waveform_write_pos.load(Ordering::Relaxed) as usize;

                    for (i, chunk) in data.chunks(channels).enumerate() {
                        if i % downsample_factor == 0 {
                            // Store mono mix of L/R
                            let mono = if channels > 1 {
                                (chunk[0] + chunk[1]) * 0.5
                            } else {
                                chunk[0]
                            };
                            shared_clone.waveform_buffer[write_pos].store(f32_to_u32(mono), Ordering::Relaxed);
                            write_pos = (write_pos + 1) % WAVEFORM_SAMPLES;
                        }
                    }
                    shared_clone.waveform_write_pos.store(write_pos as u32, Ordering::Relaxed);

                    // Update spectrum analyzer (mono mix of L/R for analysis)
                    // Update every 2 callbacks for smoother visuals (~6ms at 44.1kHz/512)
                    spectrum_update_counter += 1;
                    if spectrum_update_counter >= 2 {
                        spectrum_update_counter = 0;

                        // Create mono mix for analysis
                        let mono_samples: Vec<f32> = if channels > 1 {
                            data.chunks(2)
                                .map(|chunk| (chunk[0] + chunk[1]) * 0.5)
                                .collect()
                        } else {
                            data.to_vec()
                        };

                        // Push samples and compute FFT
                        spectrum_analyzer.push_samples(&mono_samples);
                        spectrum_analyzer.analyze();

                        // Store spectrum data to shared state (lock-free)
                        let magnitudes = spectrum_analyzer.get_magnitudes();
                        for (i, &mag) in magnitudes.iter().enumerate() {
                            shared_clone.spectrum_bands[i].store(f32_to_u32(mag), Ordering::Relaxed);
                        }

                        // Stereo analysis - push stereo samples (not mono)
                        if channels > 1 {
                            stereo_analyzer.push_samples(data);

                            // Store stereo positions to shared state (lock-free)
                            let positions = stereo_analyzer.get_positions();
                            for (i, &(angle, radius)) in positions.iter().enumerate() {
                                shared_clone.stereo_positions[i * 2].store(f32_to_u32(angle), Ordering::Relaxed);
                                shared_clone.stereo_positions[i * 2 + 1].store(f32_to_u32(radius), Ordering::Relaxed);
                            }

                            // Store correlation
                            let correlation = stereo_analyzer.get_correlation();
                            shared_clone.stereo_correlation.store(f32_to_u32(correlation), Ordering::Relaxed);
                        }
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

    // Clean up any stale temp plugin bundles from previous sessions
    super::plugin::cleanup_temp_bundles();

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

/// Reinitialize the audio engine with new settings
/// This will shutdown the existing engine and create a new one
pub fn reinit_engine(device_name: Option<&str>, config: AudioConfig) -> Result<(), String> {
    log::info!(
        "Reinitializing audio engine: device={:?}, sample_rate={}, buffer_size={}",
        device_name,
        config.sample_rate,
        config.buffer_size
    );

    // Shutdown existing engine
    shutdown_engine();

    // Small delay to ensure resources are released
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Force reinitialize by clearing the OnceCell check
    // We need to create a new engine regardless of the OnceCell state
    super::plugin::cleanup_temp_bundles();

    let engine = AudioEngine::new(device_name, config)?;
    let handle = engine.handle();

    // Store the handle
    let cell = ENGINE_HANDLE.get_or_init(|| RwLock::new(None));
    *cell.write() = Some(handle);

    // Leak the stream to keep it alive
    std::mem::forget(engine);

    log::info!("Audio engine reinitialized successfully");
    Ok(())
}

/// Get the current audio engine sample rate
pub fn get_engine_sample_rate() -> Option<u32> {
    get_engine_handle().map(|h| h.sample_rate)
}
