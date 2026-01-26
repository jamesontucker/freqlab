//! CLAP Plugin Hosting
//!
//! Provides hot-reloadable CLAP plugin hosting for the preview system.
//! - Load .clap bundles and process audio through them
//! - Open plugin's native GUI in a standalone window
//! - Watch for file changes and reload with crossfade

pub mod clap_host;
pub mod clap_sys;
pub mod crash_guard;
pub mod editor;
pub mod file_watcher;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub use clap_host::{cleanup_temp_bundles, PluginInstance, PluginLoadOptions};

/// Plugin type determines audio routing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginType {
    /// Effect plugin - processes incoming audio (signals/samples)
    Effect,
    /// Instrument plugin - generates audio from MIDI input
    Instrument,
}

impl Default for PluginType {
    fn default() -> Self {
        Self::Effect
    }
}

/// Current state of the plugin host
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PluginState {
    /// No plugin loaded
    Unloaded,
    /// Plugin is being loaded
    Loading { path: String },
    /// Plugin is loaded and active
    Active {
        name: String,
        path: String,
        has_editor: bool,
    },
    /// Plugin failed to load
    Error { message: String },
    /// Plugin is being reloaded (hot reload in progress)
    Reloading { path: String },
}

impl Default for PluginState {
    fn default() -> Self {
        Self::Unloaded
    }
}

/// Information about a loaded plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub path: String,
    pub plugin_type: PluginType,
    pub has_editor: bool,
}

/// Shared state for plugin hosting (accessible from audio thread and main thread)
pub struct PluginHostState {
    /// Current plugin state
    pub state: RwLock<PluginState>,
    /// The loaded plugin instance (if any)
    pub plugin: RwLock<Option<PluginInstance>>,
    /// Type of the loaded plugin
    pub plugin_type: RwLock<PluginType>,
    /// Whether auto-reload is enabled
    pub auto_reload: AtomicBool,
    /// Path being watched for changes
    pub watched_path: RwLock<Option<PathBuf>>,
}

impl PluginHostState {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(PluginState::Unloaded),
            plugin: RwLock::new(None),
            plugin_type: RwLock::new(PluginType::Effect),
            auto_reload: AtomicBool::new(false),
            watched_path: RwLock::new(None),
        }
    }
}

impl Default for PluginHostState {
    fn default() -> Self {
        Self::new()
    }
}

/// Global plugin host state
static PLUGIN_HOST_STATE: once_cell::sync::OnceCell<Arc<PluginHostState>> =
    once_cell::sync::OnceCell::new();

/// Initialize the global plugin host state
pub fn init_plugin_host() {
    PLUGIN_HOST_STATE.get_or_init(|| Arc::new(PluginHostState::new()));
}

/// Get the global plugin host state
pub fn get_plugin_host_state() -> Option<Arc<PluginHostState>> {
    PLUGIN_HOST_STATE.get().cloned()
}
