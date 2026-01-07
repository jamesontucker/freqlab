//! Plugin Editor Host
//!
//! This is a separate process that hosts CLAP plugin editor windows.
//! It runs independently from the main freqlab process to avoid conflicts
//! between the plugin's webview and Tauri's webview.
//!
//! Communication with the parent process:
//! - Receives plugin path as command line argument
//! - Optionally receives window position as second and third arguments: x y
//! - Writes status messages to stdout:
//!   - "ready" - editor is open and ready
//!   - "closed" - editor was closed
//!   - "position:x,y" - current window position
//!   - "state:<base64>" - plugin state (synced periodically for parameter changes)
//!   - "error:message" - an error occurred
//! - Reads commands from stdin: "close", "getpos"
//! - Exits when window is closed or "close" command received

use base64::Engine;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

// Import the library crate
use freqlab_lib::audio::plugin::clap_host::{take_callback_request, PluginInstance};

/// Interval for state sync (in event loop iterations, ~16ms each)
/// 3 iterations = ~50ms between state syncs
const STATE_SYNC_INTERVAL: u32 = 3;
#[cfg(target_os = "macos")]
use freqlab_lib::audio::plugin::editor;

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil, YES};
#[cfg(target_os = "macos")]
use cocoa::foundation::NSAutoreleasePool;
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

fn main() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    log::info!("freqlab-editor-host starting");

    // Parse command line arguments
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: freqlab-editor-host <plugin-path> [x y]");
        println!("error:Missing plugin path argument");
        std::process::exit(1);
    }

    let plugin_path = &args[1];
    log::info!("Plugin path: {}", plugin_path);

    // Parse optional position arguments
    let position: Option<(f64, f64)> = if args.len() >= 4 {
        match (args[2].parse::<f64>(), args[3].parse::<f64>()) {
            (Ok(x), Ok(y)) => {
                log::info!("Initial position: ({}, {})", x, y);
                Some((x, y))
            }
            _ => {
                log::warn!("Invalid position arguments, using default");
                None
            }
        }
    } else {
        None
    };

    // Run the editor
    match run_editor(plugin_path, position) {
        Ok(()) => {
            log::info!("Editor closed normally");
            println!("closed");
        }
        Err(e) => {
            log::error!("Editor error: {}", e);
            println!("error:{}", e);
            std::process::exit(1);
        }
    }
}

fn run_editor(plugin_path: &str, position: Option<(f64, f64)>) -> Result<(), String> {
    let path = Path::new(plugin_path);
    if !path.exists() {
        return Err(format!("Plugin not found: {}", plugin_path));
    }

    // Load the plugin (minimal - just for GUI)
    // We use a dummy sample rate and buffer size since we're not processing audio
    log::info!("Loading plugin...");
    let mut plugin = PluginInstance::load(path, 48000.0, 512)?;

    // Check if plugin has GUI
    if !plugin.has_gui() {
        return Err("Plugin does not have a GUI".to_string());
    }

    // Open the editor window directly (in-process, not spawning another process)
    log::info!("Opening editor window...");
    plugin.open_editor_window_at(position)?;

    // Signal to parent that we're ready
    // Explicit flush ensures the message is sent immediately over the pipe
    println!("ready");
    let _ = std::io::stdout().flush();
    log::info!("Editor ready, entering event loop");

    // Set up flags for stdin monitoring
    let should_close = Arc::new(AtomicBool::new(false));
    let should_close_clone = should_close.clone();
    let request_position = Arc::new(AtomicBool::new(false));
    let request_position_clone = request_position.clone();

    // Spawn thread to monitor stdin for commands or parent death
    thread::spawn(move || {
        let stdin = std::io::stdin();
        let reader = BufReader::new(stdin);
        for line in reader.lines() {
            match line {
                Ok(cmd) => {
                    let cmd = cmd.trim();
                    log::info!("Received command: {}", cmd);
                    if cmd == "close" {
                        should_close_clone.store(true, Ordering::SeqCst);
                        break;
                    } else if cmd == "getpos" {
                        request_position_clone.store(true, Ordering::SeqCst);
                        // Don't break - continue listening for more commands
                    }
                }
                Err(e) => {
                    // Stdin error likely means parent process died
                    log::warn!("Error reading stdin (parent may have died): {}", e);
                    should_close_clone.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
        // EOF reached - parent process closed stdin (likely terminated)
        log::info!("stdin EOF - parent process likely terminated");
        should_close_clone.store(true, Ordering::SeqCst);
    });

    // Run the event loop
    #[cfg(target_os = "macos")]
    run_macos_event_loop(&mut plugin, should_close, request_position)?;

    #[cfg(not(target_os = "macos"))]
    {
        // On other platforms, just wait for close signal
        while !should_close.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(100));
        }
    }

    // Close the editor window directly
    log::info!("Closing editor window...");
    plugin.close_editor_window();

    Ok(())
}

#[cfg(target_os = "macos")]
fn run_macos_event_loop(
    plugin: &mut PluginInstance,
    should_close: Arc<AtomicBool>,
    request_position: Arc<AtomicBool>,
) -> Result<(), String> {
    unsafe {
        // Get the NSApplication
        let app = NSApp();
        if app == nil {
            return Err("Failed to get NSApplication".to_string());
        }

        // Set activation policy
        app.setActivationPolicy_(NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular);
        app.activateIgnoringOtherApps_(YES);

        // Run a polling event loop
        // We check both for events and for the close signal
        let mut iteration_count: u32 = 0;
        let mut last_state: Option<Vec<u8>> = None;

        // Force stderr flush to ensure this message appears
        eprintln!("[editor_host] ENTERING EVENT LOOP");
        let _ = std::io::stderr().flush();

        log::info!("Entering macOS event loop, will sync state every {} iterations (~{}ms)",
                   STATE_SYNC_INTERVAL, STATE_SYNC_INTERVAL * 16);

        // Send diagnostic to parent so we know event loop started (visible in main app logs)
        println!("info:event_loop_started");
        let _ = std::io::stdout().flush();

        // Also log has_state for debugging
        eprintln!("[editor_host] Plugin has_state: {}", plugin.has_state());
        let _ = std::io::stderr().flush();

        loop {
            // Create autorelease pool for this iteration to prevent memory leaks
            // Cocoa autoreleases objects during event processing
            let pool = NSAutoreleasePool::new(nil);

            // Check if position was requested
            if request_position.swap(false, Ordering::SeqCst) {
                // Get and output window position
                if let Some((x, y)) = plugin.get_editor_window_position() {
                    println!("position:{},{}", x, y);
                    let _ = std::io::stdout().flush();
                    log::info!("Reported window position: ({}, {})", x, y);
                }
            }

            // Check if we should close
            if should_close.load(Ordering::SeqCst) {
                log::info!("Close signal received");
                let _: () = msg_send![pool, drain];
                break;
            }

            // Check if the editor window is still visible (user may have closed it)
            if !plugin.is_editor_window_visible() {
                log::info!("Editor window was closed by user");
                let _: () = msg_send![pool, drain];
                break;
            }

            // Process ALL pending events (non-blocking)
            // NSDate.distantPast gives us immediate return
            // We loop to drain the event queue - critical for smooth slider dragging
            // where many mouse move events can queue up between iterations
            let distant_past: id = msg_send![class!(NSDate), distantPast];
            loop {
                let event: id = msg_send![
                    app,
                    nextEventMatchingMask: 0xFFFFFFFFu64  // NSEventMaskAny
                    untilDate: distant_past
                    inMode: cocoa::foundation::NSDefaultRunLoopMode
                    dequeue: YES
                ];

                if event == nil {
                    break;
                }

                let _: () = msg_send![app, sendEvent: event];
            }

            // Update windows once after processing all events
            let _: () = msg_send![app, updateWindows];

            // Check if the plugin requested a main thread callback
            // This is used by plugins (e.g., nih-plug) for deferred GUI operations
            if take_callback_request() {
                plugin.call_on_main_thread();
            }

            // Flush parameter changes from the GUI AFTER processing events
            // This is CRITICAL for egui-based plugins (like nih-plug) which rely on
            // the host calling flush() after the plugin calls request_flush()
            // Without this, parameter changes from the GUI would reset immediately
            plugin.flush_params();

            // Periodically sync plugin state to parent process
            // IMPORTANT: This MUST happen AFTER flush_params() so we capture
            // the updated parameter values, not the stale pre-event state
            iteration_count += 1;
            if iteration_count >= STATE_SYNC_INTERVAL {
                iteration_count = 0;

                // Save current state (now contains updated parameters from this frame)
                match plugin.save_state() {
                    Ok(state) => {
                        // Log first state save for debugging (via stdout so parent sees it)
                        static FIRST_SAVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
                        if FIRST_SAVE.swap(false, std::sync::atomic::Ordering::Relaxed) {
                            println!("info:first_state_save_ok_{}bytes", state.len());
                            let _ = std::io::stdout().flush();
                            log::info!("First state save succeeded: {} bytes", state.len());
                        }

                        // Only send if state changed
                        let should_send = match &last_state {
                            Some(prev) => prev != &state,
                            None => true,
                        };

                        if should_send {
                            // Encode as base64 and send to parent
                            let encoded = base64::engine::general_purpose::STANDARD.encode(&state);
                            println!("state:{}", encoded);
                            let _ = std::io::stdout().flush();
                            log::info!("Sent state update to parent: {} bytes", state.len());
                            last_state = Some(state);
                        }
                    }
                    Err(e) => {
                        // Log only once to avoid spam (via stdout so parent sees it)
                        static LOGGED_ERROR: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
                        if !LOGGED_ERROR.swap(true, std::sync::atomic::Ordering::Relaxed) {
                            println!("info:state_save_error:{}", e);
                            let _ = std::io::stdout().flush();
                            log::error!("Failed to save plugin state: {}", e);
                        }
                    }
                }
            }

            // Drain the autorelease pool for this iteration
            let _: () = msg_send![pool, drain];

            // Small sleep to prevent busy waiting
            thread::sleep(Duration::from_millis(16)); // ~60fps
        }
    }

    Ok(())
}
