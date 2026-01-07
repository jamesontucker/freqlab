//! File watcher for hot reload
//!
//! Watches the plugin .clap bundle for changes and triggers reload.

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::Mutex;

/// Debounce timeout - wait this long after last change before reloading
const DEBOUNCE_MS: u64 = 500;

/// Callback type for reload events
pub type ReloadCallback = Box<dyn Fn(PathBuf) + Send + Sync>;

/// Plugin file watcher state
pub struct PluginWatcher {
    /// The file system watcher
    watcher: Option<RecommendedWatcher>,
    /// Path being watched
    watched_path: Option<PathBuf>,
    /// Callback for reload events
    callback: Option<Arc<ReloadCallback>>,
    /// Debounce state
    last_event_time: Arc<Mutex<Option<Instant>>>,
    /// Sender to shutdown the debounce thread
    shutdown_tx: Option<Sender<()>>,
    /// Path to pass to callback (shared with debounce thread)
    callback_path: Arc<Mutex<Option<PathBuf>>>,
}

impl PluginWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watched_path: None,
            callback: None,
            last_event_time: Arc::new(Mutex::new(None)),
            shutdown_tx: None,
            callback_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Start watching a plugin file/directory for changes
    pub fn watch(
        &mut self,
        path: PathBuf,
        callback: ReloadCallback,
    ) -> Result<(), String> {
        // Stop any existing watch
        self.unwatch();

        log::info!("Starting file watcher for: {:?}", path);

        let callback = Arc::new(callback);
        let callback_clone = callback.clone();
        let last_event_time = self.last_event_time.clone();
        let path_clone = path.clone();

        // Create channel for events
        let (tx, rx) = channel::<PathBuf>();

        // Create the watcher
        let watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    // Only trigger on modify/create events
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) => {
                            // Update last event time for debouncing
                            *last_event_time.lock() = Some(Instant::now());
                            let _ = tx.send(path_clone.clone());
                        }
                        _ => {}
                    }
                }
            },
            Config::default(),
        ).map_err(|e| format!("Failed to create file watcher: {}", e))?;

        // Start the debounce thread
        let (shutdown_tx, shutdown_rx) = channel::<()>();
        let last_event_time_clone = self.last_event_time.clone();
        let callback_path_clone = self.callback_path.clone();

        // Store the path for the callback
        *self.callback_path.lock() = Some(path.clone());

        std::thread::spawn(move || {
            Self::debounce_thread(rx, shutdown_rx, callback_clone, last_event_time_clone, callback_path_clone);
        });

        self.watcher = Some(watcher);
        self.shutdown_tx = Some(shutdown_tx);

        // Start watching
        if let Some(ref mut w) = self.watcher {
            // Watch the parent directory of the .clap bundle for file changes
            let watch_path = if path.is_dir() {
                // For .clap bundles (directories), watch the bundle itself
                &path
            } else {
                // For single files, watch the file
                &path
            };

            w.watch(watch_path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch path: {}", e))?;
        }

        self.watched_path = Some(path);
        self.callback = Some(callback);

        log::info!("File watcher started successfully");
        Ok(())
    }

    /// Stop watching
    pub fn unwatch(&mut self) {
        if let Some(ref mut watcher) = self.watcher {
            if let Some(ref path) = self.watched_path {
                let _ = watcher.unwatch(path);
            }
        }

        // Signal shutdown to debounce thread
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        self.watcher = None;
        self.watched_path = None;
        self.callback = None;
        *self.last_event_time.lock() = None;
        *self.callback_path.lock() = None;

        log::info!("File watcher stopped");
    }

    /// Debounce thread - waits for changes to settle before triggering callback
    fn debounce_thread(
        rx: Receiver<PathBuf>,
        shutdown_rx: Receiver<()>,
        callback: Arc<ReloadCallback>,
        last_event_time: Arc<Mutex<Option<Instant>>>,
        callback_path: Arc<Mutex<Option<PathBuf>>>,
    ) {
        loop {
            // Wait for an event or shutdown signal
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(_path) => {
                    // Event received, start debouncing
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Check if we should trigger a reload
                    let should_reload = {
                        let mut last_time = last_event_time.lock();
                        if let Some(instant) = *last_time {
                            if instant.elapsed() > Duration::from_millis(DEBOUNCE_MS) {
                                *last_time = None; // Clear the event
                                true
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    };

                    if should_reload {
                        log::info!("Debounce complete, triggering reload");
                        // Get the watched path from shared state
                        let path = callback_path.lock().clone().unwrap_or_default();
                        callback(path);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    log::info!("File watcher channel disconnected");
                    break;
                }
            }

            // Check for shutdown signal
            if shutdown_rx.try_recv().is_ok() {
                log::info!("File watcher shutdown signal received");
                break;
            }
        }
    }

    /// Check if currently watching
    pub fn is_watching(&self) -> bool {
        self.watcher.is_some()
    }

    /// Get the path being watched
    pub fn watched_path(&self) -> Option<&PathBuf> {
        self.watched_path.as_ref()
    }
}

impl Drop for PluginWatcher {
    fn drop(&mut self) {
        self.unwatch();
    }
}
