//! CLAP (CLever Audio Plugin) FFI structures
//!
//! These structures match the CLAP C API specification.
//! Reference: https://github.com/free-audio/clap

use std::ffi::c_void;
use std::os::raw::c_char;

// =============================================================================
// Version
// =============================================================================

pub const CLAP_VERSION_MAJOR: u32 = 1;
pub const CLAP_VERSION_MINOR: u32 = 2;
pub const CLAP_VERSION_REVISION: u32 = 0;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ClapVersion {
    pub major: u32,
    pub minor: u32,
    pub revision: u32,
}

impl ClapVersion {
    pub const fn new() -> Self {
        Self {
            major: CLAP_VERSION_MAJOR,
            minor: CLAP_VERSION_MINOR,
            revision: CLAP_VERSION_REVISION,
        }
    }
}

impl Default for ClapVersion {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Plugin Entry
// =============================================================================

pub const CLAP_PLUGIN_FACTORY_ID: &[u8] = b"clap.plugin-factory\0";

#[repr(C)]
pub struct ClapPluginEntry {
    pub clap_version: ClapVersion,
    pub init: Option<unsafe extern "C" fn(plugin_path: *const c_char) -> bool>,
    pub deinit: Option<unsafe extern "C" fn()>,
    pub get_factory:
        Option<unsafe extern "C" fn(factory_id: *const c_char) -> *const c_void>,
}

// =============================================================================
// Plugin Factory
// =============================================================================

#[repr(C)]
pub struct ClapPluginFactory {
    pub get_plugin_count: Option<unsafe extern "C" fn(factory: *const ClapPluginFactory) -> u32>,
    pub get_plugin_descriptor: Option<
        unsafe extern "C" fn(
            factory: *const ClapPluginFactory,
            index: u32,
        ) -> *const ClapPluginDescriptor,
    >,
    pub create_plugin: Option<
        unsafe extern "C" fn(
            factory: *const ClapPluginFactory,
            host: *const ClapHost,
            plugin_id: *const c_char,
        ) -> *const ClapPlugin,
    >,
}

// =============================================================================
// Plugin Descriptor
// =============================================================================

#[repr(C)]
pub struct ClapPluginDescriptor {
    pub clap_version: ClapVersion,
    pub id: *const c_char,
    pub name: *const c_char,
    pub vendor: *const c_char,
    pub url: *const c_char,
    pub manual_url: *const c_char,
    pub support_url: *const c_char,
    pub version: *const c_char,
    pub description: *const c_char,
    pub features: *const *const c_char,
}

// =============================================================================
// Host
// =============================================================================

#[repr(C)]
pub struct ClapHost {
    pub clap_version: ClapVersion,
    pub host_data: *mut c_void,
    pub name: *const c_char,
    pub vendor: *const c_char,
    pub url: *const c_char,
    pub version: *const c_char,
    pub get_extension: Option<
        unsafe extern "C" fn(host: *const ClapHost, extension_id: *const c_char) -> *const c_void,
    >,
    pub request_restart: Option<unsafe extern "C" fn(host: *const ClapHost)>,
    pub request_process: Option<unsafe extern "C" fn(host: *const ClapHost)>,
    pub request_callback: Option<unsafe extern "C" fn(host: *const ClapHost)>,
}

// =============================================================================
// Plugin
// =============================================================================

#[repr(C)]
pub struct ClapPlugin {
    pub desc: *const ClapPluginDescriptor,
    pub plugin_data: *mut c_void,
    pub init: Option<unsafe extern "C" fn(plugin: *const ClapPlugin) -> bool>,
    pub destroy: Option<unsafe extern "C" fn(plugin: *const ClapPlugin)>,
    pub activate: Option<
        unsafe extern "C" fn(
            plugin: *const ClapPlugin,
            sample_rate: f64,
            min_frames_count: u32,
            max_frames_count: u32,
        ) -> bool,
    >,
    pub deactivate: Option<unsafe extern "C" fn(plugin: *const ClapPlugin)>,
    pub start_processing: Option<unsafe extern "C" fn(plugin: *const ClapPlugin) -> bool>,
    pub stop_processing: Option<unsafe extern "C" fn(plugin: *const ClapPlugin)>,
    pub reset: Option<unsafe extern "C" fn(plugin: *const ClapPlugin)>,
    pub process:
        Option<unsafe extern "C" fn(plugin: *const ClapPlugin, process: *const ClapProcess) -> i32>,
    pub get_extension: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, id: *const c_char) -> *const c_void,
    >,
    pub on_main_thread: Option<unsafe extern "C" fn(plugin: *const ClapPlugin)>,
}

// =============================================================================
// Audio Processing
// =============================================================================

pub const CLAP_PROCESS_ERROR: i32 = 0;
pub const CLAP_PROCESS_CONTINUE: i32 = 1;
pub const CLAP_PROCESS_CONTINUE_IF_NOT_QUIET: i32 = 2;
pub const CLAP_PROCESS_TAIL: i32 = 3;
pub const CLAP_PROCESS_SLEEP: i32 = 4;

#[repr(C)]
pub struct ClapProcess {
    pub steady_time: i64,
    pub frames_count: u32,
    pub transport: *const ClapEventTransport,
    pub audio_inputs: *const ClapAudioBuffer,
    pub audio_outputs: *mut ClapAudioBuffer,
    pub audio_inputs_count: u32,
    pub audio_outputs_count: u32,
    pub in_events: *const ClapInputEvents,
    pub out_events: *const ClapOutputEvents,
}

#[repr(C)]
pub struct ClapAudioBuffer {
    pub data32: *mut *mut f32,
    pub data64: *mut *mut f64,
    pub channel_count: u32,
    pub latency: u32,
    pub constant_mask: u64,
}

// =============================================================================
// Events
// =============================================================================

#[repr(C)]
pub struct ClapInputEvents {
    pub ctx: *mut c_void,
    pub size: Option<unsafe extern "C" fn(list: *const ClapInputEvents) -> u32>,
    pub get: Option<
        unsafe extern "C" fn(list: *const ClapInputEvents, index: u32) -> *const ClapEventHeader,
    >,
}

#[repr(C)]
pub struct ClapOutputEvents {
    pub ctx: *mut c_void,
    pub try_push:
        Option<unsafe extern "C" fn(list: *const ClapOutputEvents, event: *const ClapEventHeader) -> bool>,
}

#[repr(C)]
pub struct ClapEventHeader {
    pub size: u32,
    pub time: u32,
    pub space_id: u16,
    pub type_: u16,
    pub flags: u32,
}

#[repr(C)]
pub struct ClapEventTransport {
    pub header: ClapEventHeader,
    pub flags: u32,
    pub song_pos_beats: i64,
    pub song_pos_seconds: i64,
    pub tempo: f64,
    pub tempo_inc: f64,
    pub loop_start_beats: i64,
    pub loop_end_beats: i64,
    pub loop_start_seconds: i64,
    pub loop_end_seconds: i64,
    pub bar_start: i64,
    pub bar_number: i32,
    pub tsig_num: u16,
    pub tsig_denom: u16,
}

// =============================================================================
// MIDI Events
// =============================================================================

pub const CLAP_EVENT_NOTE_ON: u16 = 0;
pub const CLAP_EVENT_NOTE_OFF: u16 = 1;
pub const CLAP_EVENT_NOTE_CHOKE: u16 = 2;
pub const CLAP_EVENT_NOTE_END: u16 = 3;
pub const CLAP_EVENT_NOTE_EXPRESSION: u16 = 4;
pub const CLAP_EVENT_PARAM_VALUE: u16 = 5;
pub const CLAP_EVENT_PARAM_MOD: u16 = 6;
pub const CLAP_EVENT_PARAM_GESTURE_BEGIN: u16 = 7;
pub const CLAP_EVENT_PARAM_GESTURE_END: u16 = 8;
pub const CLAP_EVENT_TRANSPORT: u16 = 9;
pub const CLAP_EVENT_MIDI: u16 = 10;
pub const CLAP_EVENT_MIDI_SYSEX: u16 = 11;
pub const CLAP_EVENT_MIDI2: u16 = 12;

#[repr(C)]
pub struct ClapEventNote {
    pub header: ClapEventHeader,
    pub note_id: i32,
    pub port_index: i16,
    pub channel: i16,
    pub key: i16,
    pub velocity: f64,
}

#[repr(C)]
pub struct ClapEventMidi {
    pub header: ClapEventHeader,
    pub port_index: u16,
    pub data: [u8; 3],
}

// =============================================================================
// Null implementations for input/output events (empty event lists)
// =============================================================================

/// Empty input events - returns 0 for size
pub unsafe extern "C" fn empty_input_events_size(_list: *const ClapInputEvents) -> u32 {
    0
}

/// Empty input events - returns null (should never be called if size is 0)
pub unsafe extern "C" fn empty_input_events_get(
    _list: *const ClapInputEvents,
    _index: u32,
) -> *const ClapEventHeader {
    std::ptr::null()
}

/// Empty output events - always succeeds but does nothing
pub unsafe extern "C" fn empty_output_events_push(
    _list: *const ClapOutputEvents,
    _event: *const ClapEventHeader,
) -> bool {
    true
}

// =============================================================================
// MIDI Event Context for Input Events
// =============================================================================

/// Context structure for passing MIDI events to the plugin
/// This is stored and passed via the ClapInputEvents ctx field
pub struct MidiEventContext {
    /// Pre-allocated storage for note events
    pub note_events: Vec<ClapEventNote>,
    /// Pre-allocated storage for raw MIDI events (CC, pitch bend, etc.)
    pub midi_events: Vec<ClapEventMidi>,
}

impl MidiEventContext {
    pub fn new() -> Self {
        Self {
            note_events: Vec::with_capacity(64), // Pre-allocate for typical use
            midi_events: Vec::with_capacity(32), // CC and pitch bend
        }
    }

    /// Clear events for next process cycle
    pub fn clear(&mut self) {
        self.note_events.clear();
        self.midi_events.clear();
    }

    /// Get total event count (for callback)
    pub fn len(&self) -> usize {
        self.note_events.len() + self.midi_events.len()
    }

    /// Add a note on event
    pub fn add_note_on(&mut self, note: u8, velocity: u8, channel: u8, time: u32) {
        self.note_events.push(ClapEventNote {
            header: ClapEventHeader {
                size: std::mem::size_of::<ClapEventNote>() as u32,
                time,
                space_id: 0, // CLAP_CORE_EVENT_SPACE_ID
                type_: CLAP_EVENT_NOTE_ON,
                flags: 0,
            },
            note_id: -1, // No specific note ID
            port_index: 0,
            channel: channel as i16,
            key: note as i16,
            velocity: velocity as f64 / 127.0, // CLAP uses 0.0-1.0
        });
    }

    /// Add a note off event
    pub fn add_note_off(&mut self, note: u8, velocity: u8, channel: u8, time: u32) {
        self.note_events.push(ClapEventNote {
            header: ClapEventHeader {
                size: std::mem::size_of::<ClapEventNote>() as u32,
                time,
                space_id: 0,
                type_: CLAP_EVENT_NOTE_OFF,
                flags: 0,
            },
            note_id: -1,
            port_index: 0,
            channel: channel as i16,
            key: note as i16,
            velocity: velocity as f64 / 127.0,
        });
    }

    /// Add a control change (CC) event as raw MIDI
    pub fn add_control_change(&mut self, controller: u8, value: u8, channel: u8, time: u32) {
        self.midi_events.push(ClapEventMidi {
            header: ClapEventHeader {
                size: std::mem::size_of::<ClapEventMidi>() as u32,
                time,
                space_id: 0,
                type_: CLAP_EVENT_MIDI,
                flags: 0,
            },
            port_index: 0,
            // Raw MIDI: status byte (0xB0 | channel), controller, value
            data: [0xB0 | (channel & 0x0F), controller & 0x7F, value & 0x7F],
        });
    }

    /// Add a pitch bend event as raw MIDI
    pub fn add_pitch_bend(&mut self, value: u16, channel: u8, time: u32) {
        let lsb = (value & 0x7F) as u8;
        let msb = ((value >> 7) & 0x7F) as u8;
        self.midi_events.push(ClapEventMidi {
            header: ClapEventHeader {
                size: std::mem::size_of::<ClapEventMidi>() as u32,
                time,
                space_id: 0,
                type_: CLAP_EVENT_MIDI,
                flags: 0,
            },
            port_index: 0,
            // Raw MIDI: status byte (0xE0 | channel), LSB, MSB
            data: [0xE0 | (channel & 0x0F), lsb, msb],
        });
    }
}

/// Callback: return number of events in the context
pub unsafe extern "C" fn midi_input_events_size(list: *const ClapInputEvents) -> u32 {
    let ctx = (*list).ctx as *const MidiEventContext;
    if ctx.is_null() {
        return 0;
    }
    (*ctx).len() as u32
}

/// Callback: return event at index from the context
/// Events are indexed: note_events first, then midi_events
pub unsafe extern "C" fn midi_input_events_get(
    list: *const ClapInputEvents,
    index: u32,
) -> *const ClapEventHeader {
    let ctx = (*list).ctx as *const MidiEventContext;
    if ctx.is_null() {
        return std::ptr::null();
    }
    let idx = index as usize;
    let note_count = (*ctx).note_events.len();

    if idx < note_count {
        // Return note event
        &(&(*ctx).note_events)[idx].header as *const ClapEventHeader
    } else if idx < note_count + (*ctx).midi_events.len() {
        // Return MIDI event (CC, pitch bend)
        &(&(*ctx).midi_events)[idx - note_count].header as *const ClapEventHeader
    } else {
        std::ptr::null()
    }
}

// =============================================================================
// GUI Extension
// =============================================================================

/// Extension ID for the GUI extension
pub const CLAP_EXT_GUI: &[u8] = b"clap.gui\0";

/// Window API identifiers
#[cfg(target_os = "macos")]
pub const CLAP_WINDOW_API_COCOA: &[u8] = b"cocoa\0";

#[cfg(target_os = "windows")]
pub const CLAP_WINDOW_API_WIN32: &[u8] = b"win32\0";

#[cfg(target_os = "linux")]
pub const CLAP_WINDOW_API_X11: &[u8] = b"x11\0";

/// Window handle - union type for different platforms
#[repr(C)]
pub union ClapWindowHandle {
    pub cocoa: *mut c_void,  // NSView*
    pub win32: *mut c_void,  // HWND
    pub x11: u64,            // Window (X11 Window ID)
    pub ptr: *mut c_void,    // Generic pointer
}

/// Window descriptor for the plugin GUI
#[repr(C)]
pub struct ClapWindow {
    pub api: *const c_char,
    pub handle: ClapWindowHandle,
}

impl ClapWindow {
    /// Create a null window descriptor for unparenting the plugin GUI
    /// Passing this to set_parent tells the plugin to unparent its GUI
    #[cfg(target_os = "macos")]
    pub fn null() -> Self {
        Self {
            api: CLAP_WINDOW_API_COCOA.as_ptr() as *const c_char,
            handle: ClapWindowHandle { cocoa: std::ptr::null_mut() },
        }
    }

    /// Create a null window descriptor for unparenting on Windows
    #[cfg(target_os = "windows")]
    pub fn null() -> Self {
        Self {
            api: CLAP_WINDOW_API_WIN32.as_ptr() as *const c_char,
            handle: ClapWindowHandle { win32: std::ptr::null_mut() },
        }
    }

    /// Create a window descriptor for macOS (Cocoa)
    #[cfg(target_os = "macos")]
    pub fn cocoa(view: *mut c_void) -> Self {
        Self {
            api: CLAP_WINDOW_API_COCOA.as_ptr() as *const c_char,
            handle: ClapWindowHandle { cocoa: view },
        }
    }

    /// Create a window descriptor for Windows (Win32)
    #[cfg(target_os = "windows")]
    pub fn win32(hwnd: *mut c_void) -> Self {
        Self {
            api: CLAP_WINDOW_API_WIN32.as_ptr() as *const c_char,
            handle: ClapWindowHandle { win32: hwnd },
        }
    }

    /// Create a window descriptor for Linux (X11)
    #[cfg(target_os = "linux")]
    pub fn x11(window_id: u64) -> Self {
        Self {
            api: CLAP_WINDOW_API_X11.as_ptr() as *const c_char,
            handle: ClapWindowHandle { x11: window_id },
        }
    }
}

/// Resize hints for the plugin GUI
#[repr(C)]
pub struct ClapGuiResizeHints {
    pub can_resize_horizontally: bool,
    pub can_resize_vertically: bool,
    pub preserve_aspect_ratio: bool,
    pub aspect_ratio_width: u32,
    pub aspect_ratio_height: u32,
}

/// GUI extension interface
#[repr(C)]
pub struct ClapPluginGui {
    /// Returns true if the specified API is supported
    pub is_api_supported: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, api: *const c_char, is_floating: bool) -> bool,
    >,

    /// Returns true if the plugin has a preferred API (fills api and is_floating)
    pub get_preferred_api: Option<
        unsafe extern "C" fn(
            plugin: *const ClapPlugin,
            api: *mut *const c_char,
            is_floating: *mut bool,
        ) -> bool,
    >,

    /// Create the GUI
    pub create: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, api: *const c_char, is_floating: bool) -> bool,
    >,

    /// Destroy the GUI
    pub destroy: Option<unsafe extern "C" fn(plugin: *const ClapPlugin)>,

    /// Set the scale factor (e.g., 2.0 for retina displays)
    pub set_scale: Option<unsafe extern "C" fn(plugin: *const ClapPlugin, scale: f64) -> bool>,

    /// Get the current size of the GUI
    pub get_size: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, width: *mut u32, height: *mut u32) -> bool,
    >,

    /// Returns true if the GUI can be resized
    pub can_resize: Option<unsafe extern "C" fn(plugin: *const ClapPlugin) -> bool>,

    /// Get resize hints (aspect ratio, etc.)
    pub get_resize_hints: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, hints: *mut ClapGuiResizeHints) -> bool,
    >,

    /// Adjusts the given width/height to make it fit the GUI constraints
    pub adjust_size: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, width: *mut u32, height: *mut u32) -> bool,
    >,

    /// Set the size of the GUI
    pub set_size: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, width: u32, height: u32) -> bool,
    >,

    /// Embed the GUI into the given window
    pub set_parent: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, window: *const ClapWindow) -> bool,
    >,

    /// Set the transient window for floating GUIs
    pub set_transient: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, window: *const ClapWindow) -> bool,
    >,

    /// Suggest a title for the plugin window (for floating windows)
    pub suggest_title: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, title: *const c_char),
    >,

    /// Show the GUI
    pub show: Option<unsafe extern "C" fn(plugin: *const ClapPlugin) -> bool>,

    /// Hide the GUI
    pub hide: Option<unsafe extern "C" fn(plugin: *const ClapPlugin) -> bool>,
}

// =============================================================================
// State Extension (for saving/loading plugin state)
// =============================================================================

pub const CLAP_EXT_STATE: &[u8] = b"clap.state\0";

/// Input stream for loading plugin state
#[repr(C)]
pub struct ClapInputStream {
    /// Context pointer passed to read function
    pub ctx: *mut c_void,
    /// Read bytes from stream. Returns number of bytes read, or -1 on error.
    pub read: Option<
        unsafe extern "C" fn(stream: *const ClapInputStream, buffer: *mut c_void, size: u64) -> i64,
    >,
}

/// Output stream for saving plugin state
#[repr(C)]
pub struct ClapOutputStream {
    /// Context pointer passed to write function
    pub ctx: *mut c_void,
    /// Write bytes to stream. Returns number of bytes written, or -1 on error.
    pub write: Option<
        unsafe extern "C" fn(stream: *const ClapOutputStream, buffer: *const c_void, size: u64) -> i64,
    >,
}

/// Plugin state extension
#[repr(C)]
pub struct ClapPluginState {
    /// Save plugin state to stream. Returns true on success.
    pub save: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, stream: *const ClapOutputStream) -> bool,
    >,
    /// Load plugin state from stream. Returns true on success.
    pub load: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, stream: *const ClapInputStream) -> bool,
    >,
}

// =============================================================================
// Host Params Extension (for parameter change notifications)
// =============================================================================

pub const CLAP_EXT_PARAMS: &[u8] = b"clap.params\0";

/// Host-side params extension - called by plugin when parameters change
#[repr(C)]
pub struct ClapHostParams {
    /// Rescan the full list of parameters.
    pub rescan: Option<
        unsafe extern "C" fn(host: *const ClapHost, flags: u32),
    >,
    /// Clears references to a parameter.
    pub clear: Option<
        unsafe extern "C" fn(host: *const ClapHost, param_id: u32, flags: u32),
    >,
    /// Request a parameter flush.
    /// The host will schedule a call to clap_plugin.process() or clap_plugin_params.flush()
    pub request_flush: Option<
        unsafe extern "C" fn(host: *const ClapHost),
    >,
}

/// Plugin-side params extension - called by host to interact with parameters
#[repr(C)]
pub struct ClapPluginParams {
    /// Returns the number of parameters.
    pub count: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin) -> u32,
    >,
    /// Gets information about a parameter by index.
    pub get_info: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, param_index: u32, param_info: *mut ClapParamInfo) -> bool,
    >,
    /// Gets the current value of a parameter.
    pub get_value: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, param_id: u32, out_value: *mut f64) -> bool,
    >,
    /// Converts a value to text for display.
    pub value_to_text: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, param_id: u32, value: f64, out_buffer: *mut c_char, out_buffer_capacity: u32) -> bool,
    >,
    /// Converts text to a value.
    pub text_to_value: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, param_id: u32, param_value_text: *const c_char, out_value: *mut f64) -> bool,
    >,
    /// Flushes parameter changes without processing audio.
    /// Called by host when plugin requests a flush or to sync parameters.
    pub flush: Option<
        unsafe extern "C" fn(plugin: *const ClapPlugin, in_events: *const ClapInputEvents, out_events: *const ClapOutputEvents),
    >,
}

/// Parameter information structure
#[repr(C)]
pub struct ClapParamInfo {
    pub id: u32,
    pub flags: u32,
    pub cookie: *mut c_void,
    pub name: [c_char; 256],
    pub module: [c_char; 1024],
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
}
