//! Plugin editor window management
//!
//! Opens the plugin's native GUI in a standalone window.
//! On macOS, this creates an NSWindow and passes the content view to the plugin.

use std::ffi::c_void;

use super::clap_sys::{ClapPlugin, ClapPluginGui, ClapWindow, CLAP_EXT_GUI};

#[cfg(target_os = "macos")]
use super::clap_sys::CLAP_WINDOW_API_COCOA;

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

/// Check if the plugin supports the platform's GUI API
pub unsafe fn supports_gui(plugin: *const ClapPlugin) -> bool {
    let gui = match get_gui_extension(plugin) {
        Some(g) => g,
        None => return false,
    };

    #[cfg(target_os = "macos")]
    {
        let is_supported = match (*gui).is_api_supported {
            Some(f) => f(plugin, CLAP_WINDOW_API_COCOA.as_ptr() as *const i8, false),
            None => false,
        };
        is_supported
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
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

// =============================================================================
// macOS implementation using Cocoa crate
// =============================================================================

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use cocoa::appkit::{
        NSApp, NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSWindow,
        NSWindowStyleMask,
    };
    use cocoa::base::{id, nil, NO, YES};
    use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize, NSString};
    use objc::{class, msg_send, sel, sel_impl};

    /// Check if we're on the main thread
    pub fn is_main_thread() -> bool {
        unsafe {
            let result: bool = objc::msg_send![objc::class!(NSThread), isMainThread];
            result
        }
    }

    /// Create a native NSWindow for the plugin editor
    ///
    /// Note: This function should ideally be called from the main thread.
    /// On macOS, NSWindow operations are supposed to happen on the main thread,
    /// but Tauri may handle this internally for us.
    pub unsafe fn create_editor_window(
        plugin: *const ClapPlugin,
        title: &str,
    ) -> Result<(*mut c_void, *mut c_void), String> {
        create_editor_window_at(plugin, title, None)
    }

    /// Create a native NSWindow for the plugin editor at a specific position
    ///
    /// If position is None, the window will be centered on screen.
    /// Position is (x, y) in screen coordinates.
    ///
    /// IMPORTANT: On macOS, window operations should be performed on the main thread.
    /// This function will log a warning if called from a background thread.
    /// For reliable GUI hosting, use the freqlab-editor-host binary which runs
    /// its own event loop on the main thread.
    pub unsafe fn create_editor_window_at(
        plugin: *const ClapPlugin,
        title: &str,
        position: Option<(f64, f64)>,
    ) -> Result<(*mut c_void, *mut c_void), String> {
        log::info!("create_editor_window_at called, position: {:?}", position);

        let on_main = is_main_thread();
        log::info!("create_editor_window_at: on_main_thread = {}", on_main);

        // Log a warning if not on main thread
        if !on_main {
            log::warn!("create_editor_window_at: Not on main thread - this may cause issues with some plugins");
        }

        // Create an autorelease pool for this scope
        log::info!("create_editor_window_at: Creating autorelease pool");
        let pool = NSAutoreleasePool::new(nil);

        let result = create_editor_window_inner(plugin, title, position);

        log::info!("create_editor_window_at: Draining autorelease pool");
        let _: () = objc::msg_send![pool, drain];

        log::info!(
            "create_editor_window_at: Returning result (success={})",
            result.is_ok()
        );
        result
    }

    /// Inner implementation of create_editor_window (called within autorelease pool)
    unsafe fn create_editor_window_inner(
        plugin: *const ClapPlugin,
        title: &str,
        position: Option<(f64, f64)>,
    ) -> Result<(*mut c_void, *mut c_void), String> {
        log::info!("create_editor_window_inner: Getting GUI extension");
        let gui = get_gui_extension(plugin)
            .ok_or_else(|| "Plugin does not have GUI extension".to_string())?;

        log::info!("create_editor_window_inner: Checking API support");
        // Check if API is supported
        let is_supported = (*gui)
            .is_api_supported
            .map(|f| f(plugin, CLAP_WINDOW_API_COCOA.as_ptr() as *const i8, false))
            .unwrap_or(false);

        if !is_supported {
            return Err("Plugin does not support Cocoa GUI API".to_string());
        }

        log::info!("create_editor_window_inner: Creating GUI");
        // Create the GUI
        let create = (*gui)
            .create
            .ok_or_else(|| "Plugin GUI create function not available".to_string())?;

        if !create(plugin, CLAP_WINDOW_API_COCOA.as_ptr() as *const i8, false) {
            return Err("Failed to create plugin GUI".to_string());
        }

        log::info!("create_editor_window_inner: Getting GUI size");
        // Get the size
        let (width, height) = get_gui_size(plugin).unwrap_or((800, 600));
        log::info!("create_editor_window_inner: Size = {}x{}", width, height);

        log::info!("create_editor_window_inner: Creating NSWindow using cocoa crate");

        // Create window frame
        let frame = NSRect::new(
            NSPoint::new(100.0, 100.0),
            NSSize::new(width as f64, height as f64),
        );

        // Window style mask: titled | closable | miniaturizable
        let style = NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSMiniaturizableWindowMask;

        // Create the window
        let window: id = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
            frame,
            style,
            NSBackingStoreType::NSBackingStoreBuffered,
            NO,
        );

        if window == nil {
            log::error!("create_editor_window_inner: NSWindow creation returned nil");
            if let Some(destroy) = (*gui).destroy {
                destroy(plugin);
            }
            return Err("Failed to create NSWindow".to_string());
        }
        log::info!("create_editor_window_inner: NSWindow created successfully");

        // CRITICAL: When creating NSWindow programmatically (not via a window controller),
        // we must set releasedWhenClosed to NO to prevent automatic deallocation
        window.setReleasedWhenClosed_(NO);
        log::info!("create_editor_window_inner: setReleasedWhenClosed set to NO");

        // Get content view
        log::info!("create_editor_window_inner: Getting content view");
        let content_view: id = window.contentView();
        if content_view == nil {
            log::error!("create_editor_window_inner: contentView is nil");
            let _: () = objc::msg_send![window, release];
            if let Some(destroy) = (*gui).destroy {
                destroy(plugin);
            }
            return Err("Failed to get content view".to_string());
        }
        log::info!(
            "create_editor_window_inner: Content view obtained: {:p}",
            content_view
        );

        // Set the window to be opaque
        window.setOpaque_(YES);
        log::info!("create_editor_window_inner: Window set to opaque");

        // Set a background color on the window to verify it's visible
        // NSColor.windowBackgroundColor
        let ns_color: id = objc::msg_send![objc::class!(NSColor), windowBackgroundColor];
        if ns_color != nil {
            window.setBackgroundColor_(ns_color);
            log::info!("create_editor_window_inner: Background color set");
        } else {
            log::warn!("create_editor_window_inner: Failed to get windowBackgroundColor");
        }

        // Set window title
        log::info!("create_editor_window_inner: Setting window title: {}", title);
        let ns_title = NSString::alloc(nil).init_str(title);
        window.setTitle_(ns_title);
        // Release the NSString since setTitle_ copies it internally
        let _: () = objc::msg_send![ns_title, release];
        log::info!("create_editor_window_inner: Window title set");

        // Pass the content view to the plugin
        log::info!("create_editor_window_inner: Calling set_parent");
        let clap_window = ClapWindow::cocoa(content_view as *mut c_void);
        let set_parent = (*gui)
            .set_parent
            .ok_or_else(|| "Plugin GUI set_parent not available".to_string())?;

        if !set_parent(plugin, &clap_window) {
            log::error!("create_editor_window_inner: set_parent failed");
            // Close window before releasing (even though it was never shown)
            window.close();
            let _: () = objc::msg_send![window, release];
            // Destroy the plugin GUI since create() succeeded
            if let Some(destroy) = (*gui).destroy {
                destroy(plugin);
            }
            return Err("Failed to set plugin parent window".to_string());
        }
        log::info!("create_editor_window_inner: set_parent successful");

        // Show the GUI
        log::info!("create_editor_window_inner: Showing GUI");
        if let Some(show) = (*gui).show {
            show(plugin);
        }

        // Show the window - order matters here
        log::info!("create_editor_window_inner: Making window visible");

        // Get the shared NSApplication instance and activate it
        let app = NSApp();
        if app == nil {
            log::error!("create_editor_window_inner: NSApp() returned nil");
            // Continue anyway - window may still be visible
        } else {
            log::info!("create_editor_window_inner: Got NSApplication");

            // Set activation policy to Regular (required for unbundled apps)
            app.setActivationPolicy_(NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular);
            log::info!("create_editor_window_inner: Set activation policy to Regular");

            // Activate the application (bring to foreground)
            app.activateIgnoringOtherApps_(YES);
            log::info!("create_editor_window_inner: Activated app");
        }

        // Position the window
        if let Some((x, y)) = position {
            // Set specific position
            let origin = NSPoint::new(x, y);
            window.setFrameOrigin_(origin);
            log::info!("create_editor_window_inner: Window positioned at ({}, {})", x, y);
        } else {
            // Center the window on screen
            window.center();
            log::info!("create_editor_window_inner: Window centered");
        }

        // Make the window visible and bring to front
        window.makeKeyAndOrderFront_(nil);
        log::info!("create_editor_window_inner: makeKeyAndOrderFront called");

        // Set window level to floating to ensure it appears above other windows
        // NSFloatingWindowLevel = 3
        let _: () = objc::msg_send![window, setLevel: 3i64];
        log::info!("create_editor_window_inner: Set window level to floating");

        // Force display update
        let _: () = objc::msg_send![window, display];
        log::info!("create_editor_window_inner: display called");

        // Also try orderFrontRegardless which ignores app activation state
        let _: () = objc::msg_send![window, orderFrontRegardless];
        log::info!("create_editor_window_inner: orderFrontRegardless called");

        // Note: Window already has retain count of 1 from alloc/init, which we own.
        // Do NOT add extra retain here - destroy_editor_window will release once.

        log::info!("create_editor_window_inner: Window creation complete");
        Ok((window as *mut c_void, content_view as *mut c_void))
    }

    /// Close and destroy the editor window
    ///
    /// # Safety
    /// - This function should be called from the main thread on macOS.
    /// - This function should only be called once per window. The caller is
    ///   responsible for tracking whether the window has been destroyed.
    /// - After calling this function, the window pointer is invalid and must
    ///   not be used again.
    pub unsafe fn destroy_editor_window(plugin: *const ClapPlugin, window: *mut c_void) {
        log::info!("destroy_editor_window: Called with window {:p}", window);

        // Check main thread
        let on_main = is_main_thread();
        if !on_main {
            log::warn!("destroy_editor_window: Not on main thread - this may cause issues");
        }

        // Create an autorelease pool for this scope
        let pool = NSAutoreleasePool::new(nil);

        // Properly teardown the plugin GUI:
        // 1. Hide the GUI
        // 2. Unparent the GUI (set_parent with null) - required by CLAP spec before destroy
        // 3. Destroy the GUI
        if let Some(gui) = get_gui_extension(plugin) {
            log::info!("destroy_editor_window: Hiding plugin GUI");
            if let Some(hide) = (*gui).hide {
                hide(plugin);
            }

            // Unparent the plugin GUI before destroying (CLAP spec requirement)
            log::info!("destroy_editor_window: Unparenting plugin GUI");
            if let Some(set_parent) = (*gui).set_parent {
                let null_window = ClapWindow::null();
                let _ = set_parent(plugin, &null_window);
            }

            log::info!("destroy_editor_window: Destroying plugin GUI");
            if let Some(destroy) = (*gui).destroy {
                destroy(plugin);
            }
        }

        // Close and release the window
        if !window.is_null() {
            let window: id = window as id;

            // Check if window is still valid and visible before closing
            let is_visible: bool = objc::msg_send![window, isVisible];
            log::info!("destroy_editor_window: Window visible: {}", is_visible);

            if is_visible {
                window.close();
                log::info!("destroy_editor_window: Window closed");
            }

            // Release our ownership (balances the alloc/init from create)
            let _: () = objc::msg_send![window, release];
            log::info!("destroy_editor_window: Window released");
        } else {
            log::warn!("destroy_editor_window: Window pointer was null");
        }

        // Drain the autorelease pool
        let _: () = objc::msg_send![pool, drain];
        log::info!("destroy_editor_window: Complete");
    }

    /// Get the current position of an editor window
    /// Returns (x, y) in screen coordinates, or None if window is invalid
    pub unsafe fn get_window_position(window: *mut c_void) -> Option<(f64, f64)> {
        if window.is_null() {
            return None;
        }

        let window: id = window as id;
        let frame: NSRect = msg_send![window, frame];
        Some((frame.origin.x, frame.origin.y))
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

// Stub implementations for other platforms
#[cfg(not(target_os = "macos"))]
pub unsafe fn create_editor_window(
    _plugin: *const ClapPlugin,
    _title: &str,
) -> Result<(*mut c_void, *mut c_void), String> {
    Err("GUI not implemented for this platform".to_string())
}

#[cfg(not(target_os = "macos"))]
pub unsafe fn create_editor_window_at(
    _plugin: *const ClapPlugin,
    _title: &str,
    _position: Option<(f64, f64)>,
) -> Result<(*mut c_void, *mut c_void), String> {
    Err("GUI not implemented for this platform".to_string())
}

#[cfg(not(target_os = "macos"))]
pub unsafe fn destroy_editor_window(_plugin: *const ClapPlugin, _window: *mut c_void) {}

#[cfg(not(target_os = "macos"))]
pub unsafe fn get_window_position(_window: *mut c_void) -> Option<(f64, f64)> {
    None
}
