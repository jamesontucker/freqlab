//! Plugin editor window management
//!
//! Opens the plugin's native GUI in a standalone window.
//! Platform-specific implementations:
//! - macOS: NSWindow via Cocoa/AppKit (objc2)
//! - Windows: HWND via Win32 API (windows crate)

use super::clap_sys::{ClapPlugin, ClapPluginGui, CLAP_EXT_GUI};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

// ============================================================================
// Platform-agnostic functions
// ============================================================================

/// Get the GUI extension from a plugin
pub unsafe fn get_gui_extension(plugin: *const ClapPlugin) -> Option<*const ClapPluginGui> {
    let get_extension = (*plugin).get_extension?;
    let gui = get_extension(plugin, CLAP_EXT_GUI.as_ptr() as *const i8);
    if gui.is_null() {
        None
    } else {
        Some(gui as *const ClapPluginGui)
    }
}

/// Get the preferred size of the plugin GUI
pub unsafe fn get_gui_size(plugin: *const ClapPlugin) -> Option<(u32, u32)> {
    let gui = get_gui_extension(plugin)?;
    let get_size = (*gui).get_size?;

    let mut width: u32 = 0;
    let mut height: u32 = 0;

    if get_size(plugin, &mut width, &mut height) {
        Some((width, height))
    } else {
        None
    }
}

// ============================================================================
// Platform re-exports
// ============================================================================

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use self::windows::*;

// Stub implementations for unsupported platforms (Linux, etc.)
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use std::ffi::c_void;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub unsafe fn create_editor_window(
    _plugin: *const ClapPlugin,
    _title: &str,
) -> Result<(*mut c_void, *mut c_void), String> {
    Err("GUI not implemented for this platform".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub unsafe fn create_editor_window_at(
    _plugin: *const ClapPlugin,
    _title: &str,
    _position: Option<(f64, f64)>,
) -> Result<(*mut c_void, *mut c_void), String> {
    Err("GUI not implemented for this platform".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub unsafe fn destroy_editor_window(_plugin: *const ClapPlugin, _window: *mut c_void) {}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub unsafe fn get_window_position(_window: *mut c_void) -> Option<(f64, f64)> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn is_window_visible(_window: *mut c_void) -> bool {
    false
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn restore_window(_window: *mut c_void) {}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn pump_run_loop_for_cleanup(_seconds: f64) {}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub unsafe fn supports_gui(_plugin: *const ClapPlugin) -> bool {
    false
}
