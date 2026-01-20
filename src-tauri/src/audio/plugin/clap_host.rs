//! CLAP Plugin Host Implementation
//!
//! Loads .clap bundles, creates plugin instances, and processes audio.

use super::clap_sys::*;
#[cfg(target_os = "macos")]
use super::editor;
use crate::audio::midi::{MidiEvent, MidiEventQueue};
use libloading::{Library, Symbol};
use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// Global flag for callback requests from plugins
/// When a plugin calls request_callback(), this is set to true
/// The event loop should check this and call on_main_thread() if set
static CALLBACK_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Check if a callback was requested and clear the flag
pub fn take_callback_request() -> bool {
    CALLBACK_REQUESTED.swap(false, Ordering::SeqCst)
}

/// Host name and version info
const HOST_NAME: &str = "freqlab";
const HOST_VENDOR: &str = "freqlab";
const HOST_URL: &str = "https://freqlab.dev";
const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A loaded CLAP plugin instance
pub struct PluginInstance {
    /// The loaded dynamic library (must be kept alive, Option for explicit drop)
    _library: Option<Library>,
    /// Plugin entry point
    entry: *const ClapPluginEntry,
    /// Plugin factory (kept alive, not directly read)
    _factory: *const ClapPluginFactory,
    /// Plugin instance
    plugin: *const ClapPlugin,
    /// Host structure (must be kept alive for callbacks)
    _host: Box<ClapHost_>,
    /// Host name CString (must be kept alive)
    _host_name: CString,
    /// Host vendor CString (must be kept alive)
    _host_vendor: CString,
    /// Host url CString (must be kept alive)
    _host_url: CString,
    /// Host version CString (must be kept alive)
    _host_version: CString,

    // Plugin info
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub plugin_id: String,

    // Audio state
    sample_rate: f64,
    max_frames: u32,
    is_active: bool,
    is_processing: bool,

    // Audio buffers (pre-allocated)
    input_buffer_ptrs: Vec<*mut f32>,
    output_buffer_ptrs: Vec<*mut f32>,
    input_data: Vec<Vec<f32>>,
    output_data: Vec<Vec<f32>>,

    // Plugin path (kept for potential editor host use)
    _plugin_path: PathBuf,

    // Temp bundle path (if we copied to avoid dylib caching)
    temp_bundle_path: Option<PathBuf>,

    // Editor process state (out-of-process hosting, kept alive)
    _editor_process: Option<Arc<Mutex<Child>>>,
    editor_open: bool,
    // Channel for receiving state updates from editor process
    state_receiver: Option<std::sync::mpsc::Receiver<Vec<u8>>>,
    // Counter for how many states have been applied (for debugging)
    state_apply_count: AtomicU32,

    // Direct editor window state (for in-process hosting by editor_host binary)
    #[cfg(target_os = "macos")]
    editor_window: Option<*mut std::ffi::c_void>,

    // MIDI event handling
    /// Queue for incoming MIDI events (from commands, patterns, devices)
    midi_queue: Arc<MidiEventQueue>,
    /// Context for current process call's MIDI events
    midi_context: MidiEventContext,
    /// Pre-allocated buffer for draining MIDI events (avoids allocation in audio thread)
    midi_drain_buffer: Vec<MidiEvent>,

    // Safety
    /// Set to true if the plugin panics during process - we'll output silence instead of crashing
    crashed: bool,
}

// Host callback structure (renamed to avoid conflict with ClapHost struct)
#[repr(C)]
struct ClapHost_ {
    clap_version: ClapVersion,
    host_data: *mut std::ffi::c_void,
    name: *const std::os::raw::c_char,
    vendor: *const std::os::raw::c_char,
    url: *const std::os::raw::c_char,
    version: *const std::os::raw::c_char,
    get_extension: Option<
        unsafe extern "C" fn(
            host: *const ClapHost_,
            extension_id: *const std::os::raw::c_char,
        ) -> *const std::ffi::c_void,
    >,
    request_restart: Option<unsafe extern "C" fn(host: *const ClapHost_)>,
    request_process: Option<unsafe extern "C" fn(host: *const ClapHost_)>,
    request_callback: Option<unsafe extern "C" fn(host: *const ClapHost_)>,
}

// Safety: PluginInstance contains raw pointers to the plugin and library.
// We mark it as Send+Sync because:
// 1. The plugin is only accessed through RwLock, ensuring exclusive access
// 2. CLAP plugins are designed to be called from any thread (with proper synchronization)
// 3. The pointers themselves don't change after load
unsafe impl Send for PluginInstance {}
unsafe impl Sync for PluginInstance {}

/// Clean up all stale temp plugin bundles
/// Call this on engine initialization to remove orphaned temp bundles from previous sessions
pub fn cleanup_temp_bundles() {
    let temp_dir = std::env::temp_dir().join("freqlab-plugins");
    if !temp_dir.exists() {
        return;
    }

    log::info!("Cleaning up stale temp plugin bundles in {:?}", temp_dir);

    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "clap").unwrap_or(false) {
                log::info!("Removing stale temp bundle: {:?}", path);
                if let Err(e) = std::fs::remove_dir_all(&path) {
                    log::warn!("Failed to remove temp bundle {:?}: {}", path, e);
                }
            }
        }
    }
}

impl PluginInstance {
    /// Load a CLAP plugin from a .clap bundle path
    pub fn load(bundle_path: &Path, sample_rate: f64, max_frames: u32) -> Result<Self, String> {
        log::info!("Loading CLAP plugin from: {:?}", bundle_path);

        // Copy the bundle to a temp location to avoid macOS dylib caching
        // This ensures hot reload always loads the fresh version
        let (actual_bundle_path, temp_bundle_path) = Self::copy_to_temp(bundle_path)?;
        log::info!("Using bundle path: {:?}", actual_bundle_path);

        // Resolve the dylib path inside the bundle
        let dylib_path = Self::resolve_dylib_path(&actual_bundle_path)?;
        log::info!("Resolved dylib path: {:?}", dylib_path);

        // Load the library
        let library = unsafe {
            Library::new(&dylib_path).map_err(|e| format!("Failed to load library: {}", e))?
        };

        // Get the clap_entry symbol
        let entry: *const ClapPluginEntry = unsafe {
            let symbol: Symbol<*const ClapPluginEntry> = library
                .get(b"clap_entry\0")
                .map_err(|e| format!("No clap_entry symbol found: {}", e))?;
            *symbol
        };

        if entry.is_null() {
            return Err("clap_entry is null".to_string());
        }

        // Check CLAP version compatibility
        let entry_ref = unsafe { &*entry };
        log::info!(
            "Plugin CLAP version: {}.{}.{}",
            entry_ref.clap_version.major,
            entry_ref.clap_version.minor,
            entry_ref.clap_version.revision
        );

        // Initialize the plugin entry
        let plugin_path_cstr = CString::new(bundle_path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Invalid plugin path: {}", e))?;

        let init_fn = entry_ref.init.ok_or("Plugin has no init function")?;
        let init_result = unsafe { init_fn(plugin_path_cstr.as_ptr()) };
        if !init_result {
            return Err("Plugin init() returned false".to_string());
        }

        // Get the plugin factory
        let get_factory_fn = entry_ref
            .get_factory
            .ok_or("Plugin has no get_factory function")?;
        let factory =
            unsafe { get_factory_fn(CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const _) as *const ClapPluginFactory };

        if factory.is_null() {
            // Deinit before returning error
            if let Some(deinit) = entry_ref.deinit {
                unsafe { deinit() };
            }
            return Err("Failed to get plugin factory".to_string());
        }

        let factory_ref = unsafe { &*factory };

        // Get plugin count
        let get_count_fn = factory_ref
            .get_plugin_count
            .ok_or("Factory has no get_plugin_count")?;
        let plugin_count = unsafe { get_count_fn(factory) };

        if plugin_count == 0 {
            if let Some(deinit) = entry_ref.deinit {
                unsafe { deinit() };
            }
            return Err("No plugins in this bundle".to_string());
        }

        log::info!("Found {} plugin(s) in bundle", plugin_count);

        // Get the first plugin's descriptor
        let get_descriptor_fn = factory_ref
            .get_plugin_descriptor
            .ok_or("Factory has no get_plugin_descriptor")?;
        let descriptor = unsafe { get_descriptor_fn(factory, 0) };

        if descriptor.is_null() {
            if let Some(deinit) = entry_ref.deinit {
                unsafe { deinit() };
            }
            return Err("Failed to get plugin descriptor".to_string());
        }

        let desc_ref = unsafe { &*descriptor };

        // Extract plugin info
        let plugin_id = unsafe {
            if desc_ref.id.is_null() {
                "unknown".to_string()
            } else {
                CStr::from_ptr(desc_ref.id)
                    .to_string_lossy()
                    .into_owned()
            }
        };
        let name = unsafe {
            if desc_ref.name.is_null() {
                "Unknown Plugin".to_string()
            } else {
                CStr::from_ptr(desc_ref.name)
                    .to_string_lossy()
                    .into_owned()
            }
        };
        let vendor = unsafe {
            if desc_ref.vendor.is_null() {
                "Unknown".to_string()
            } else {
                CStr::from_ptr(desc_ref.vendor)
                    .to_string_lossy()
                    .into_owned()
            }
        };
        let version = unsafe {
            if desc_ref.version.is_null() {
                "0.0.0".to_string()
            } else {
                CStr::from_ptr(desc_ref.version)
                    .to_string_lossy()
                    .into_owned()
            }
        };

        log::info!(
            "Loading plugin: {} by {} (id: {}, version: {})",
            name,
            vendor,
            plugin_id,
            version
        );

        // Create host callbacks structure
        let host_name = CString::new(HOST_NAME).unwrap();
        let host_vendor = CString::new(HOST_VENDOR).unwrap();
        let host_url = CString::new(HOST_URL).unwrap();
        let host_version = CString::new(HOST_VERSION).unwrap();

        let host = Box::new(ClapHost_ {
            clap_version: ClapVersion::new(),
            host_data: ptr::null_mut(),
            name: host_name.as_ptr(),
            vendor: host_vendor.as_ptr(),
            url: host_url.as_ptr(),
            version: host_version.as_ptr(),
            get_extension: Some(host_get_extension),
            request_restart: Some(host_request_restart),
            request_process: Some(host_request_process),
            request_callback: Some(host_request_callback),
        });

        // Create the plugin instance
        let create_plugin_fn = factory_ref
            .create_plugin
            .ok_or("Factory has no create_plugin")?;
        let plugin_id_cstr =
            CString::new(plugin_id.as_bytes()).map_err(|e| format!("Invalid plugin ID: {}", e))?;

        let plugin = unsafe {
            create_plugin_fn(
                factory,
                host.as_ref() as *const ClapHost_ as *const ClapHost,
                plugin_id_cstr.as_ptr(),
            )
        };

        if plugin.is_null() {
            if let Some(deinit) = entry_ref.deinit {
                unsafe { deinit() };
            }
            return Err("Failed to create plugin instance".to_string());
        }

        let plugin_ref = unsafe { &*plugin };

        // Initialize the plugin
        let init_plugin_fn = plugin_ref.init.ok_or("Plugin has no init function")?;
        let init_result = unsafe { init_plugin_fn(plugin) };
        if !init_result {
            if let Some(destroy) = plugin_ref.destroy {
                unsafe { destroy(plugin) };
            }
            if let Some(deinit) = entry_ref.deinit {
                unsafe { deinit() };
            }
            return Err("Plugin init() failed".to_string());
        }

        // Pre-allocate audio buffers (stereo)
        let channels = 2usize;
        let mut input_data: Vec<Vec<f32>> = Vec::with_capacity(channels);
        let mut output_data: Vec<Vec<f32>> = Vec::with_capacity(channels);
        for _ in 0..channels {
            input_data.push(vec![0.0f32; max_frames as usize]);
            output_data.push(vec![0.0f32; max_frames as usize]);
        }

        let mut host_instance = Self {
            _library: Some(library),
            entry,
            _factory: factory,
            plugin,
            _host: host,
            _host_name: host_name,
            _host_vendor: host_vendor,
            _host_url: host_url,
            _host_version: host_version,
            name,
            vendor,
            version,
            plugin_id,
            sample_rate,
            max_frames,
            is_active: false,
            is_processing: false,
            input_buffer_ptrs: Vec::new(),
            output_buffer_ptrs: Vec::new(),
            input_data,
            output_data,
            _plugin_path: bundle_path.to_path_buf(),
            temp_bundle_path,
            _editor_process: None,
            editor_open: false,
            state_receiver: None,
            state_apply_count: AtomicU32::new(0),
            #[cfg(target_os = "macos")]
            editor_window: None,
            midi_queue: Arc::new(MidiEventQueue::new(1024)),
            midi_context: MidiEventContext::new(),
            // Pre-allocate buffer for 256 events (covers typical usage without reallocation)
            midi_drain_buffer: Vec::with_capacity(256),
            crashed: false,
        };

        // Activate the plugin
        host_instance.activate(sample_rate, max_frames)?;

        log::info!("Plugin loaded and activated successfully");

        Ok(host_instance)
    }

    /// Copy the .clap bundle to a temp location with a unique suffix
    /// This bypasses macOS's dylib caching which can cause hot reload to show old versions
    fn copy_to_temp(bundle_path: &Path) -> Result<(PathBuf, Option<PathBuf>), String> {
        use std::time::{SystemTime, UNIX_EPOCH};

        // Generate a unique suffix using timestamp
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);

        let bundle_name = bundle_path
            .file_stem()
            .ok_or("Invalid bundle path")?
            .to_string_lossy();

        // Create temp directory for plugin bundles
        let temp_dir = std::env::temp_dir().join("freqlab-plugins");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {}", e))?;

        // Clean up old temp bundles for this plugin (keep only the most recent)
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            let prefix = format!("{}_", bundle_name);
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) && name.ends_with(".clap") {
                    log::info!("Cleaning up old temp bundle: {:?}", entry.path());
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }

        // Create unique temp bundle name
        let temp_bundle_name = format!("{}_{}.clap", bundle_name, timestamp);
        let temp_bundle_path = temp_dir.join(&temp_bundle_name);

        log::info!(
            "Copying plugin bundle to temp: {:?} -> {:?}",
            bundle_path,
            temp_bundle_path
        );

        // Copy the entire bundle directory
        Self::copy_dir_all(bundle_path, &temp_bundle_path)?;

        Ok((temp_bundle_path.clone(), Some(temp_bundle_path)))
    }

    /// Recursively copy a directory
    fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
        std::fs::create_dir_all(dst)
            .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;

        for entry in std::fs::read_dir(src)
            .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let ty = entry
                .file_type()
                .map_err(|e| format!("Failed to get file type: {}", e))?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if ty.is_dir() {
                Self::copy_dir_all(&src_path, &dst_path)?;
            } else {
                std::fs::copy(&src_path, &dst_path)
                    .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
            }
        }

        Ok(())
    }

    /// Resolve the dylib path inside a .clap bundle
    fn resolve_dylib_path(bundle_path: &Path) -> Result<std::path::PathBuf, String> {
        // On macOS, .clap bundles are like .app bundles:
        // MyPlugin.clap/Contents/MacOS/MyPlugin

        let macos_dir = bundle_path.join("Contents").join("MacOS");

        // First try: use the bundle name (standard case)
        let bundle_name = bundle_path
            .file_stem()
            .ok_or("Invalid bundle path")?
            .to_string_lossy();

        let dylib_path = macos_dir.join(bundle_name.as_ref());
        if dylib_path.exists() {
            return Ok(dylib_path);
        }

        // Second try: scan the MacOS directory for any executable
        // This handles temp bundles where the bundle name differs from the dylib name
        if macos_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&macos_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    // Skip obvious non-executables
                    if path.extension().is_some() {
                        continue; // executables typically have no extension on macOS
                    }
                    if path.is_file() {
                        log::info!("Found dylib via scan: {:?}", path);
                        return Ok(path);
                    }
                }
            }
        }

        // Fallback: try the bundle path directly (for non-bundle dylibs)
        if bundle_path.is_file() {
            return Ok(bundle_path.to_path_buf());
        }

        Err(format!(
            "Could not find plugin binary in bundle: {:?}",
            bundle_path
        ))
    }

    /// Activate the plugin for audio processing
    fn activate(&mut self, sample_rate: f64, max_frames: u32) -> Result<(), String> {
        if self.is_active {
            return Ok(());
        }

        let plugin_ref = unsafe { &*self.plugin };
        let activate_fn = plugin_ref.activate.ok_or("Plugin has no activate function")?;

        let result = unsafe { activate_fn(self.plugin, sample_rate, 1, max_frames) };
        if !result {
            return Err("Plugin activate() failed".to_string());
        }

        self.sample_rate = sample_rate;
        self.max_frames = max_frames;
        self.is_active = true;

        log::info!(
            "Plugin activated: {}Hz, max {} frames",
            sample_rate,
            max_frames
        );

        Ok(())
    }

    /// Start audio processing
    pub fn start_processing(&mut self) -> Result<(), String> {
        if !self.is_active {
            return Err("Plugin not active".to_string());
        }
        if self.is_processing {
            return Ok(());
        }

        let plugin_ref = unsafe { &*self.plugin };
        if let Some(start_fn) = plugin_ref.start_processing {
            let result = unsafe { start_fn(self.plugin) };
            if !result {
                return Err("Plugin start_processing() failed".to_string());
            }
        }

        self.is_processing = true;
        log::info!("Plugin processing started");
        Ok(())
    }

    /// Stop audio processing
    pub fn stop_processing(&mut self) {
        if !self.is_processing {
            return;
        }

        let plugin_ref = unsafe { &*self.plugin };
        if let Some(stop_fn) = plugin_ref.stop_processing {
            unsafe { stop_fn(self.plugin) };
        }

        self.is_processing = false;
        log::info!("Plugin processing stopped");
    }

    /// Process audio through the plugin
    ///
    /// Takes stereo input samples and returns stereo output samples.
    /// Input/output are interleaved: [L, R, L, R, ...]
    pub fn process(&mut self, input: &[f32], output: &mut [f32]) -> Result<(), String> {
        // If plugin has crashed, output silence to prevent repeated crashes
        if self.crashed {
            output.fill(0.0);
            return Ok(());
        }

        if !self.is_active {
            return Err("Plugin not active".to_string());
        }

        // Start processing if not already
        if !self.is_processing {
            self.start_processing()?;
        }

        let frames = input.len() / 2;
        if frames == 0 {
            return Ok(());
        }

        // Check buffer bounds to prevent panic in audio callback
        if frames > self.max_frames as usize {
            // Silently truncate rather than error - audio callbacks must not fail
            log::warn!("Buffer size {} exceeds max_frames {}, truncating", frames, self.max_frames);
            return self.process(&input[..self.max_frames as usize * 2], &mut output[..self.max_frames as usize * 2]);
        }

        // Deinterleave input into channel buffers
        for i in 0..frames {
            self.input_data[0][i] = input[i * 2];     // Left
            self.input_data[1][i] = input[i * 2 + 1]; // Right
        }

        // Clear output buffers
        for ch in &mut self.output_data {
            for sample in ch.iter_mut().take(frames) {
                *sample = 0.0;
            }
        }

        // Set up buffer pointers
        self.input_buffer_ptrs.clear();
        self.output_buffer_ptrs.clear();
        for ch in &mut self.input_data {
            self.input_buffer_ptrs.push(ch.as_mut_ptr());
        }
        for ch in &mut self.output_data {
            self.output_buffer_ptrs.push(ch.as_mut_ptr());
        }

        // Create audio buffers
        let input_buffer = ClapAudioBuffer {
            data32: self.input_buffer_ptrs.as_mut_ptr(),
            data64: ptr::null_mut(),
            channel_count: 2,
            latency: 0,
            constant_mask: 0,
        };

        let mut output_buffer = ClapAudioBuffer {
            data32: self.output_buffer_ptrs.as_mut_ptr(),
            data64: ptr::null_mut(),
            channel_count: 2,
            latency: 0,
            constant_mask: 0,
        };

        // Drain MIDI queue into pre-allocated buffer (avoids allocation in audio thread)
        self.midi_queue.drain_into(&mut self.midi_drain_buffer);

        // Convert MIDI events to CLAP format
        self.midi_context.clear();
        for event in self.midi_drain_buffer.iter() {
            match event {
                MidiEvent::NoteOn { note, velocity, channel } => {
                    self.midi_context.add_note_on(*note, *velocity, *channel, 0);
                }
                MidiEvent::NoteOff { note, velocity, channel } => {
                    self.midi_context.add_note_off(*note, *velocity, *channel, 0);
                }
                MidiEvent::ControlChange { controller, value, channel } => {
                    self.midi_context.add_control_change(*controller, *value, *channel, 0);
                }
                MidiEvent::PitchBend { value, channel } => {
                    self.midi_context.add_pitch_bend(*value, *channel, 0);
                }
                MidiEvent::AllNotesOff => {
                    // Send note off for all 128 notes
                    for note in 0..128u8 {
                        self.midi_context.add_note_off(note, 0, 0, 0);
                    }
                }
            }
        }

        // Create input events with MIDI context
        let input_events = ClapInputEvents {
            ctx: &self.midi_context as *const MidiEventContext as *mut std::ffi::c_void,
            size: Some(midi_input_events_size),
            get: Some(midi_input_events_get),
        };

        let output_events = ClapOutputEvents {
            ctx: ptr::null_mut(),
            try_push: Some(empty_output_events_push),
        };

        // Create process structure
        let process = ClapProcess {
            steady_time: -1, // Unknown
            frames_count: frames as u32,
            transport: ptr::null(),
            audio_inputs: &input_buffer,
            audio_outputs: &mut output_buffer,
            audio_inputs_count: 1,
            audio_outputs_count: 1,
            in_events: &input_events,
            out_events: &output_events,
        };

        // Call plugin's process function with crash protection (signal-based)
        let plugin_ref = unsafe { &*self.plugin };
        let process_fn = plugin_ref.process.ok_or("Plugin has no process function")?;

        // Use signal-based crash guard to catch crashes from dynamic libraries
        // (catch_unwind doesn't work across FFI boundaries)
        let plugin_ptr = self.plugin;
        let process_ptr = &process as *const ClapProcess;
        let guard_result = super::crash_guard::with_crash_guard(|| {
            unsafe { process_fn(plugin_ptr, process_ptr) }
        });

        let result = match guard_result {
            super::crash_guard::CrashGuardResult::Ok(r) => r,
            super::crash_guard::CrashGuardResult::Crashed(signal) => {
                // Plugin crashed - mark as crashed and output silence
                self.crashed = true;

                let signal_name = match signal {
                    libc::SIGABRT => "SIGABRT (abort/panic)",
                    libc::SIGSEGV => "SIGSEGV (segmentation fault)",
                    libc::SIGBUS => "SIGBUS (bus error)",
                    _ => "unknown signal",
                };

                log::error!(
                    "Plugin '{}' crashed during process! Signal: {} ({}). Plugin has been disabled - reload to retry.",
                    self.name,
                    signal,
                    signal_name
                );
                // Fill output with silence
                output.fill(0.0);
                return Ok(());
            }
        };

        // Log process result periodically (every ~1000 calls to avoid spam)
        static CALL_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let count = CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if count % 1000 == 0 {
            // Check if input had signal
            let input_max = input.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
            // Check if output has signal
            let output_max_l = self.output_data[0].iter().take(frames).map(|s| s.abs()).fold(0.0f32, f32::max);
            let output_max_r = self.output_data[1].iter().take(frames).map(|s| s.abs()).fold(0.0f32, f32::max);
            log::info!(
                "Plugin process #{}: frames={}, result={}, input_max={:.4}, output_max_l={:.4}, output_max_r={:.4}",
                count, frames, result, input_max, output_max_l, output_max_r
            );
        }

        // Interleave output from channel buffers
        for i in 0..frames {
            output[i * 2] = self.output_data[0][i];     // Left
            output[i * 2 + 1] = self.output_data[1][i]; // Right
        }

        Ok(())
    }

    /// Check if the plugin has crashed during processing
    /// If true, the plugin will output silence until reloaded
    pub fn has_crashed(&self) -> bool {
        self.crashed
    }

    /// Check if the plugin has a GUI
    pub fn has_gui(&self) -> bool {
        let plugin_ref = unsafe { &*self.plugin };
        if let Some(get_ext) = plugin_ref.get_extension {
            let gui_ext_id = b"clap.gui\0";
            let ext = unsafe { get_ext(self.plugin, gui_ext_id.as_ptr() as *const _) };
            return !ext.is_null();
        }
        false
    }

    /// Get a reference to the MIDI event queue for sending events
    pub fn midi_queue(&self) -> Arc<MidiEventQueue> {
        Arc::clone(&self.midi_queue)
    }

    /// Send a note on event to the plugin
    pub fn send_note_on(&self, note: u8, velocity: u8) {
        self.midi_queue.note_on(note, velocity);
    }

    /// Send a note off event to the plugin
    pub fn send_note_off(&self, note: u8) {
        self.midi_queue.note_off(note);
    }

    /// Send all notes off to prevent stuck notes
    pub fn send_all_notes_off(&self) {
        self.midi_queue.all_notes_off();
    }

    /// Check if the plugin supports state save/load
    pub fn has_state(&self) -> bool {
        let plugin_ref = unsafe { &*self.plugin };
        if let Some(get_ext) = plugin_ref.get_extension {
            let ext = unsafe { get_ext(self.plugin, CLAP_EXT_STATE.as_ptr() as *const _) };
            return !ext.is_null();
        }
        false
    }

    /// Check if the plugin supports the params extension
    pub fn has_params(&self) -> bool {
        let plugin_ref = unsafe { &*self.plugin };
        if let Some(get_ext) = plugin_ref.get_extension {
            let ext = unsafe { get_ext(self.plugin, CLAP_EXT_PARAMS.as_ptr() as *const _) };
            return !ext.is_null();
        }
        false
    }

    /// Flush parameter changes without processing audio
    /// This is needed for the editor host where we don't call process()
    /// When the plugin's GUI changes a parameter, it calls host->request_flush()
    /// and expects the host to call plugin_params->flush() to commit the changes
    pub fn flush_params(&self) {
        let plugin_ref = unsafe { &*self.plugin };
        let get_ext = match plugin_ref.get_extension {
            Some(f) => f,
            None => return,
        };

        let params_ext = unsafe { get_ext(self.plugin, CLAP_EXT_PARAMS.as_ptr() as *const _) };
        if params_ext.is_null() {
            return;
        }
        let params_ext = params_ext as *const ClapPluginParams;

        let flush_fn = match unsafe { (*params_ext).flush } {
            Some(f) => f,
            None => return,
        };

        // Create empty event lists - we're not sending any events,
        // just letting the plugin process its internal parameter queue
        let empty_in_events = ClapInputEvents {
            ctx: ptr::null_mut(),
            size: Some(empty_input_events_size),
            get: Some(empty_input_events_get),
        };

        let empty_out_events = ClapOutputEvents {
            ctx: ptr::null_mut(),
            try_push: Some(empty_output_events_push),
        };

        unsafe {
            flush_fn(self.plugin, &empty_in_events, &empty_out_events);
        }
    }

    /// Call the plugin's on_main_thread() callback if it has one
    /// This should be called from the main thread when the plugin has requested it
    pub fn call_on_main_thread(&self) {
        let plugin_ref = unsafe { &*self.plugin };
        if let Some(on_main_thread_fn) = plugin_ref.on_main_thread {
            unsafe {
                on_main_thread_fn(self.plugin);
            }
        }
    }

    /// Save plugin state to a byte vector
    pub fn save_state(&self) -> Result<Vec<u8>, String> {
        let plugin_ref = unsafe { &*self.plugin };
        let get_ext = plugin_ref
            .get_extension
            .ok_or("Plugin has no get_extension")?;

        let state_ext =
            unsafe { get_ext(self.plugin, CLAP_EXT_STATE.as_ptr() as *const _) };
        if state_ext.is_null() {
            return Err("Plugin does not support state extension".to_string());
        }
        let state_ext = state_ext as *const ClapPluginState;

        let save_fn = unsafe { (*state_ext).save }
            .ok_or("Plugin state extension has no save function")?;

        // Create a buffer to collect the state data
        let mut buffer: Vec<u8> = Vec::new();

        // Create output stream that writes to our buffer
        struct WriteContext {
            buffer: *mut Vec<u8>,
        }

        unsafe extern "C" fn write_fn(
            stream: *const ClapOutputStream,
            data: *const std::ffi::c_void,
            size: u64,
        ) -> i64 {
            if stream.is_null() || data.is_null() {
                return -1;
            }
            let ctx = (*stream).ctx as *mut WriteContext;
            if ctx.is_null() {
                return -1;
            }
            let buffer = &mut *(*ctx).buffer;
            let slice = std::slice::from_raw_parts(data as *const u8, size as usize);
            buffer.extend_from_slice(slice);
            size as i64
        }

        let mut ctx = WriteContext {
            buffer: &mut buffer as *mut Vec<u8>,
        };

        let stream = ClapOutputStream {
            ctx: &mut ctx as *mut WriteContext as *mut std::ffi::c_void,
            write: Some(write_fn),
        };

        let success = unsafe { save_fn(self.plugin, &stream) };
        if success {
            log::info!("Saved plugin state: {} bytes", buffer.len());
            Ok(buffer)
        } else {
            Err("Plugin state save failed".to_string())
        }
    }

    /// Load plugin state from a byte slice
    pub fn load_state(&mut self, data: &[u8]) -> Result<(), String> {
        let plugin_ref = unsafe { &*self.plugin };
        let get_ext = plugin_ref
            .get_extension
            .ok_or("Plugin has no get_extension")?;

        let state_ext =
            unsafe { get_ext(self.plugin, CLAP_EXT_STATE.as_ptr() as *const _) };
        if state_ext.is_null() {
            return Err("Plugin does not support state extension".to_string());
        }
        let state_ext = state_ext as *const ClapPluginState;

        let load_fn = unsafe { (*state_ext).load }
            .ok_or("Plugin state extension has no load function")?;

        // Create input stream that reads from our data
        struct ReadContext {
            data: *const u8,
            len: usize,
            pos: usize,
        }

        unsafe extern "C" fn read_fn(
            stream: *const ClapInputStream,
            buffer: *mut std::ffi::c_void,
            size: u64,
        ) -> i64 {
            if stream.is_null() || buffer.is_null() {
                return -1;
            }
            let ctx = (*stream).ctx as *mut ReadContext;
            if ctx.is_null() {
                return -1;
            }
            let remaining = (*ctx).len - (*ctx).pos;
            let to_read = std::cmp::min(size as usize, remaining);
            if to_read == 0 {
                return 0; // EOF
            }
            std::ptr::copy_nonoverlapping(
                (*ctx).data.add((*ctx).pos),
                buffer as *mut u8,
                to_read,
            );
            (*ctx).pos += to_read;
            to_read as i64
        }

        let mut ctx = ReadContext {
            data: data.as_ptr(),
            len: data.len(),
            pos: 0,
        };

        let stream = ClapInputStream {
            ctx: &mut ctx as *mut ReadContext as *mut std::ffi::c_void,
            read: Some(read_fn),
        };

        let success = unsafe { load_fn(self.plugin, &stream) };
        if success {
            // Note: Use trace level to avoid audio glitches when called from audio thread
            log::trace!("Loaded plugin state: {} bytes", data.len());
            Ok(())
        } else {
            Err("Plugin state load failed".to_string())
        }
    }

    /// Poll for and apply any pending state updates from the editor
    /// Call this periodically (e.g., in the audio callback) to sync editor changes
    ///
    /// Note: This is called from the audio thread, so we avoid logging to prevent glitches.
    pub fn apply_pending_state(&mut self) {
        if let Some(ref receiver) = self.state_receiver {
            // Drain all pending state updates, applying only the latest
            let mut latest_state: Option<Vec<u8>> = None;
            while let Ok(state) = receiver.try_recv() {
                latest_state = Some(state);
            }

            if let Some(state) = latest_state {
                // Note: Errors are silently ignored in audio thread to avoid glitches
                // In a production DAW, you'd queue these for the main thread to log
                if self.load_state(&state).is_ok() {
                    self.state_apply_count.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    /// Get the number of state updates applied from the editor
    pub fn get_state_apply_count(&self) -> u32 {
        self.state_apply_count.load(Ordering::Relaxed)
    }

    /// Check if the editor window is currently open
    pub fn is_editor_open(&self) -> bool {
        self.editor_open
    }

    /// Open the plugin's editor window at a specific position (IN-PROCESS)
    ///
    /// This is the correct architecture: the plugin's GUI runs in the same process as audio,
    /// sharing the same atomic parameters. No IPC or state sync needed.
    ///
    /// Position is (x, y) in macOS screen coordinates. Pass None to center the window.
    #[cfg(target_os = "macos")]
    pub fn open_editor_at(&mut self, position: Option<(f64, f64)>) -> Result<(), String> {
        log::info!("open_editor_at: Called, editor_open={}, position={:?}", self.editor_open, position);

        // Check if editor is already open
        if self.editor_open {
            // Check if the window is still visible or minimized
            if self.is_editor_window_visible() {
                log::info!("open_editor_at: Editor window already open, restoring/bringing to front");
                // Restore if minimized, bring to front
                if let Some(window) = self.editor_window {
                    editor::restore_window(window);
                }
                return Ok(());
            } else {
                // Window was closed by user (clicked X), clean up
                log::info!("open_editor_at: Editor window was closed, cleaning up");
                self.close_editor_window();
                self.editor_open = false;
            }
        }

        log::info!("open_editor_at: Checking has_gui");
        if !self.has_gui() {
            log::warn!("open_editor_at: Plugin does not have a GUI");
            return Err("Plugin does not have a GUI".to_string());
        }

        // Open the editor window in-process (same plugin instance as audio)
        // This means GUI parameter changes directly affect audio via shared atomics
        log::info!("open_editor_at: Opening editor window in-process at position {:?}", position);
        self.open_editor_window_at(position)?;

        self.editor_open = true;
        log::info!("open_editor_at: Editor opened successfully (in-process, shared atomics)");

        Ok(())
    }

    /// Open the plugin's editor window centered (IN-PROCESS)
    #[cfg(target_os = "macos")]
    pub fn open_editor(&mut self) -> Result<(), String> {
        self.open_editor_at(None)
    }

    /// Open the plugin's editor window (stub for non-macOS)
    #[cfg(not(target_os = "macos"))]
    pub fn open_editor_at(&mut self, _position: Option<(f64, f64)>) -> Result<(), String> {
        Err("Plugin editor not supported on this platform".to_string())
    }

    /// Open the plugin's editor window (stub for non-macOS)
    #[cfg(not(target_os = "macos"))]
    pub fn open_editor(&mut self) -> Result<(), String> {
        Err("Plugin editor not supported on this platform".to_string())
    }

    /// Get the current position of the editor window
    /// Returns (x, y) in screen coordinates, or None if no window
    pub fn get_editor_position(&self) -> Option<(f64, f64)> {
        self.get_editor_window_position()
    }

    /// Close the plugin's editor window (IN-PROCESS)
    /// Note: Position is NOT saved here - caller (AudioEngineHandle) should save it
    #[cfg(target_os = "macos")]
    pub fn close_editor(&mut self) {
        if !self.editor_open {
            return;
        }

        log::info!("close_editor: Closing in-process editor window");

        // Close the window (in-process)
        // Note: Position saving is handled by AudioEngineHandle to survive plugin reload
        self.close_editor_window();

        self.editor_open = false;
        log::info!("close_editor: Editor closed");
    }

    /// Close the plugin's editor window (stub for non-macOS)
    #[cfg(not(target_os = "macos"))]
    pub fn close_editor(&mut self) {
        self.editor_open = false;
    }

    // =========================================================================
    // Direct Editor Window Methods (for editor_host binary - in-process hosting)
    // =========================================================================

    /// Open the plugin's editor window directly (in-process, for editor_host binary only)
    ///
    /// This creates the window in the current process instead of spawning a child process.
    /// Should only be called from the freqlab-editor-host binary.
    #[cfg(target_os = "macos")]
    pub fn open_editor_window(&mut self) -> Result<(), String> {
        self.open_editor_window_at(None)
    }

    /// Open the plugin's editor window at a specific position
    ///
    /// If position is None, the window will be centered on screen.
    #[cfg(target_os = "macos")]
    pub fn open_editor_window_at(&mut self, position: Option<(f64, f64)>) -> Result<(), String> {
        log::info!("open_editor_window_at: Called with position {:?}", position);

        if self.editor_window.is_some() {
            log::info!("open_editor_window_at: Window already exists");
            return Ok(());
        }

        if !self.has_gui() {
            return Err("Plugin does not have a GUI".to_string());
        }

        // Create the editor window directly using the editor module
        let (window, _content_view) = unsafe {
            editor::create_editor_window_at(self.plugin, &self.name, position)?
        };

        self.editor_window = Some(window);
        log::info!("open_editor_window_at: Window created successfully");
        Ok(())
    }

    /// Get the current position of the editor window
    #[cfg(target_os = "macos")]
    pub fn get_editor_window_position(&self) -> Option<(f64, f64)> {
        self.editor_window.and_then(|window| unsafe {
            editor::get_window_position(window)
        })
    }

    /// Close the plugin's editor window directly (in-process, for editor_host binary only)
    #[cfg(target_os = "macos")]
    pub fn close_editor_window(&mut self) {
        log::info!("close_editor_window: Called (direct/in-process)");

        if let Some(window) = self.editor_window.take() {
            unsafe {
                editor::destroy_editor_window(self.plugin, window);
            }
            log::info!("close_editor_window: Window destroyed");
        }
    }

    /// Check if the editor window is still visible (for editor_host event loop)
    /// Uses main thread dispatch for reliable NSWindow property access
    #[cfg(target_os = "macos")]
    pub fn is_editor_window_visible(&self) -> bool {
        if let Some(window) = self.editor_window {
            // Use the main-thread-safe visibility check from editor module
            editor::is_window_visible(window)
        } else {
            false
        }
    }

    /// Stub for non-macOS platforms
    #[cfg(not(target_os = "macos"))]
    pub fn open_editor_window(&mut self) -> Result<(), String> {
        Err("GUI not supported on this platform".to_string())
    }

    /// Stub for non-macOS platforms
    #[cfg(not(target_os = "macos"))]
    pub fn open_editor_window_at(&mut self, _position: Option<(f64, f64)>) -> Result<(), String> {
        Err("GUI not supported on this platform".to_string())
    }

    /// Stub for non-macOS platforms
    #[cfg(not(target_os = "macos"))]
    pub fn get_editor_window_position(&self) -> Option<(f64, f64)> {
        None
    }

    /// Stub for non-macOS platforms
    #[cfg(not(target_os = "macos"))]
    pub fn close_editor_window(&mut self) {}

    /// Stub for non-macOS platforms
    #[cfg(not(target_os = "macos"))]
    pub fn is_editor_window_visible(&self) -> bool {
        false
    }
}

impl Drop for PluginInstance {
    fn drop(&mut self) {
        log::info!("Unloading plugin: {}", self.name);

        // Close direct editor window first (if in editor_host process)
        self.close_editor_window();

        // Close out-of-process editor (if in main process)
        self.close_editor();

        // Stop processing
        self.stop_processing();

        // Deactivate
        if self.is_active {
            let plugin_ref = unsafe { &*self.plugin };
            if let Some(deactivate) = plugin_ref.deactivate {
                unsafe { deactivate(self.plugin) };
            }
            self.is_active = false;
        }

        // Destroy plugin instance
        let plugin_ref = unsafe { &*self.plugin };
        if let Some(destroy) = plugin_ref.destroy {
            unsafe { destroy(self.plugin) };
        }

        // Deinit entry
        let entry_ref = unsafe { &*self.entry };
        if let Some(deinit) = entry_ref.deinit {
            unsafe { deinit() };
        }

        // Explicitly drop the library BEFORE deleting temp bundle
        // This ensures the dylib is fully unloaded and file handles are released
        if let Some(library) = self._library.take() {
            log::info!("Dropping library handle...");
            drop(library);
            // Small delay to ensure OS releases file handles
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // Now delete the temp bundle immediately
        if let Some(temp_path) = self.temp_bundle_path.take() {
            log::info!("Deleting temp bundle: {:?}", temp_path);
            match std::fs::remove_dir_all(&temp_path) {
                Ok(_) => log::info!("Temp bundle deleted successfully"),
                Err(e) => log::warn!("Failed to delete temp bundle {:?}: {}", temp_path, e),
            }
        }

        log::info!("Plugin unloaded");
    }
}

// =============================================================================
// Host Callbacks
// =============================================================================

unsafe extern "C" fn host_get_extension(
    _host: *const ClapHost_,
    extension_id: *const std::os::raw::c_char,
) -> *const std::ffi::c_void {
    if extension_id.is_null() {
        return ptr::null();
    }

    let ext_id = CStr::from_ptr(extension_id);

    // Provide the params extension so plugins can notify us of parameter changes
    if ext_id.to_bytes_with_nul() == CLAP_EXT_PARAMS {
        return &HOST_PARAMS as *const ClapHostParams as *const std::ffi::c_void;
    }

    ptr::null()
}

// Static host params extension instance
static HOST_PARAMS: ClapHostParams = ClapHostParams {
    rescan: Some(host_params_rescan),
    clear: Some(host_params_clear),
    request_flush: Some(host_params_request_flush),
};

unsafe extern "C" fn host_params_rescan(_host: *const ClapHost, _flags: u32) {
    log::debug!("Plugin requested param rescan");
    // In a full DAW, we'd rebuild our parameter list
    // For now, we just acknowledge the request
}

unsafe extern "C" fn host_params_clear(_host: *const ClapHost, _param_id: u32, _flags: u32) {
    log::debug!("Plugin requested param clear");
    // In a full DAW, we'd clear references to this parameter
}

unsafe extern "C" fn host_params_request_flush(_host: *const ClapHost) {
    log::debug!("Plugin requested param flush");
    // The plugin's GUI changed parameters and wants us to flush them
    // Since we're already calling process() regularly, this is a no-op
    // The parameters will be picked up on the next process() call
}

unsafe extern "C" fn host_request_restart(_host: *const ClapHost_) {
    log::debug!("Plugin requested restart");
    // TODO: Handle restart request
}

unsafe extern "C" fn host_request_process(_host: *const ClapHost_) {
    log::debug!("Plugin requested process");
    // TODO: Handle process request
}

unsafe extern "C" fn host_request_callback(_host: *const ClapHost_) {
    log::debug!("Plugin requested callback");
    CALLBACK_REQUESTED.store(true, Ordering::SeqCst);
}

