//! macOS implementation of plugin editor windows using Cocoa/AppKit via objc2

use std::ffi::c_void;

use super::super::clap_sys::{ClapPlugin, ClapWindow, CLAP_WINDOW_API_COCOA};
use super::{get_gui_extension, get_gui_size};

use objc2::rc::{autoreleasepool, Retained};
use objc2::MainThreadOnly;
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSColor, NSWindow,
    NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSThread};

// FFI bindings for Core Foundation run loop
extern "C" {
    fn CFRunLoopRunInMode(
        mode: *const std::ffi::c_void,
        seconds: f64,
        returnAfterSourceHandled: bool,
    ) -> i32;
    static kCFRunLoopDefaultMode: *const std::ffi::c_void;
}

/// Pump the macOS run loop to process pending events
/// This helps flush deferred WebView callbacks after destroying the GUI
pub fn pump_run_loop_for_cleanup(seconds: f64) {
    unsafe {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, seconds, false);
    }
}

// FFI bindings for Grand Central Dispatch
#[repr(C)]
struct DispatchQueueS {
    _private: [u8; 0],
}
type DispatchQueueT = *mut DispatchQueueS;

#[link(name = "System", kind = "dylib")]
extern "C" {
    static _dispatch_main_q: DispatchQueueS;
    fn dispatch_sync_f(
        queue: DispatchQueueT,
        context: *mut std::ffi::c_void,
        work: extern "C" fn(*mut std::ffi::c_void),
    );
}

/// Get the main dispatch queue
fn main_queue() -> DispatchQueueT {
    unsafe { &_dispatch_main_q as *const _ as DispatchQueueT }
}

/// Check if we're on the main thread
pub fn is_main_thread() -> bool {
    NSThread::isMainThread_class()
}

/// Create a native NSWindow for the plugin editor
pub unsafe fn create_editor_window(
    plugin: *const ClapPlugin,
    title: &str,
) -> Result<(*mut c_void, *mut c_void), String> {
    create_editor_window_at(plugin, title, None)
}

/// Context for main thread dispatch
struct EditorWindowContext {
    plugin: *const ClapPlugin,
    title: String,
    position: Option<(f64, f64)>,
    result: Option<Result<(*mut c_void, *mut c_void), String>>,
}

// Required for passing context to dispatch
unsafe impl Send for EditorWindowContext {}

/// Worker function called on main thread
/// Wrapped in autoreleasepool to ensure Cocoa temporaries are cleaned up
extern "C" fn create_editor_window_on_main(context: *mut std::ffi::c_void) {
    autoreleasepool(|_pool| {
        let ctx = unsafe { &mut *(context as *mut EditorWindowContext) };

        log::info!("create_editor_window_on_main: Running on main thread");

        ctx.result = Some(unsafe { create_editor_window_inner(ctx.plugin, &ctx.title, ctx.position) });

        log::info!(
            "create_editor_window_on_main: Complete (success={})",
            ctx.result.as_ref().map(|r| r.is_ok()).unwrap_or(false)
        );
    });
}

/// Create a native NSWindow for the plugin editor at a specific position
///
/// If position is None, the window will be centered on screen.
/// Position is (x, y) in screen coordinates.
///
/// This function automatically dispatches to the main thread if not already on it,
/// which is required for WebView-based plugins.
pub unsafe fn create_editor_window_at(
    plugin: *const ClapPlugin,
    title: &str,
    position: Option<(f64, f64)>,
) -> Result<(*mut c_void, *mut c_void), String> {
    log::info!("create_editor_window_at called, position: {:?}", position);

    let on_main = is_main_thread();
    log::info!("create_editor_window_at: on_main_thread = {}", on_main);

    if on_main {
        // Already on main thread, run directly
        log::info!("create_editor_window_at: Already on main thread, running directly");
        create_editor_window_inner(plugin, title, position)
    } else {
        // Dispatch to main thread synchronously
        log::info!("create_editor_window_at: Dispatching to main thread via GCD");

        let mut ctx = EditorWindowContext {
            plugin,
            title: title.to_string(),
            position,
            result: None,
        };

        dispatch_sync_f(
            main_queue(),
            &mut ctx as *mut EditorWindowContext as *mut std::ffi::c_void,
            create_editor_window_on_main,
        );

        ctx.result.unwrap_or_else(|| Err("Main thread dispatch failed".to_string()))
    }
}

/// Inner implementation of create_editor_window (called on main thread)
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

    log::info!("create_editor_window_inner: Creating NSWindow using objc2");

    // Get MainThreadMarker - we know we're on main thread here
    let mtm = objc2::MainThreadMarker::new()
        .ok_or_else(|| "Not on main thread".to_string())?;

    // Create window frame
    let frame = NSRect::new(
        NSPoint::new(100.0, 100.0),
        NSSize::new(width as f64, height as f64),
    );

    // Window style mask: titled | closable | miniaturizable
    let style = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Miniaturizable;

    // Create the window
    let window = NSWindow::initWithContentRect_styleMask_backing_defer(
        NSWindow::alloc(mtm),
        frame,
        style,
        NSBackingStoreType::Buffered,
        false,
    );

    log::info!("create_editor_window_inner: NSWindow created successfully");

    // CRITICAL: When creating NSWindow programmatically (not via a window controller),
    // we must set releasedWhenClosed to NO to prevent automatic deallocation
    window.setReleasedWhenClosed(false);
    log::info!("create_editor_window_inner: setReleasedWhenClosed set to false");

    // Get content view
    log::info!("create_editor_window_inner: Getting content view");
    let content_view = window.contentView()
        .ok_or_else(|| "Failed to get content view".to_string())?;

    let content_view_ptr = Retained::as_ptr(&content_view) as *mut c_void;
    log::info!(
        "create_editor_window_inner: Content view obtained: {:p}",
        content_view_ptr
    );

    // Set the window to be opaque
    window.setOpaque(true);
    log::info!("create_editor_window_inner: Window set to opaque");

    // Set a background color on the window to verify it's visible
    let ns_color = NSColor::windowBackgroundColor();
    window.setBackgroundColor(Some(&ns_color));
    log::info!("create_editor_window_inner: Background color set");

    // Set window title
    log::info!("create_editor_window_inner: Setting window title: {}", title);
    let ns_title = objc2_foundation::NSString::from_str(title);
    window.setTitle(&ns_title);
    log::info!("create_editor_window_inner: Window title set");

    // Pass the content view to the plugin
    log::info!("create_editor_window_inner: Calling set_parent");
    let clap_window = ClapWindow::cocoa(content_view_ptr);
    let set_parent = (*gui)
        .set_parent
        .ok_or_else(|| "Plugin GUI set_parent not available".to_string())?;

    if !set_parent(plugin, &clap_window) {
        log::error!("create_editor_window_inner: set_parent failed");
        window.close();
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
    let app = NSApplication::sharedApplication(mtm);
    log::info!("create_editor_window_inner: Got NSApplication");

    // Set activation policy to Regular (required for unbundled apps)
    app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    log::info!("create_editor_window_inner: Set activation policy to Regular");

    // Activate the application (bring to foreground)
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    log::info!("create_editor_window_inner: Activated app");

    // Position the window
    if let Some((x, y)) = position {
        // Set specific position
        let origin = NSPoint::new(x, y);
        window.setFrameOrigin(origin);
        log::info!("create_editor_window_inner: Window positioned at ({}, {})", x, y);
    } else {
        // Center the window on screen
        window.center();
        log::info!("create_editor_window_inner: Window centered");
    }

    // Make the window visible and bring to front
    window.makeKeyAndOrderFront(None);
    log::info!("create_editor_window_inner: makeKeyAndOrderFront called");

    // Set window level to floating to ensure it appears above other windows
    // NSFloatingWindowLevel = 3
    window.setLevel(3);
    log::info!("create_editor_window_inner: Set window level to floating");

    // Force display update
    window.display();
    log::info!("create_editor_window_inner: display called");

    // Also try orderFrontRegardless which ignores app activation state
    window.orderFrontRegardless();
    log::info!("create_editor_window_inner: orderFrontRegardless called");

    // Get window pointer - we need to keep it alive, so use into_raw
    let window_ptr = Retained::into_raw(window) as *mut c_void;

    log::info!("create_editor_window_inner: Window creation complete");
    Ok((window_ptr, content_view_ptr))
}

/// Context for destroy window dispatch
struct DestroyWindowContext {
    plugin: *const ClapPlugin,
    window: *mut c_void,
}

unsafe impl Send for DestroyWindowContext {}

/// Worker function for destroy on main thread
/// Wrapped in autoreleasepool to ensure Cocoa temporaries are cleaned up
extern "C" fn destroy_editor_window_on_main(context: *mut std::ffi::c_void) {
    autoreleasepool(|_pool| {
        let ctx = unsafe { &*(context as *const DestroyWindowContext) };
        unsafe {
            destroy_editor_window_inner(ctx.plugin, ctx.window);
        }
    });
}

/// Close and destroy the editor window
///
/// # Safety
/// - This function should only be called once per window.
/// - After calling this function, the window pointer is invalid.
/// - This function automatically dispatches to the main thread if needed.
pub unsafe fn destroy_editor_window(plugin: *const ClapPlugin, window: *mut c_void) {
    log::info!("destroy_editor_window: Called with window {:p}", window);

    let on_main = is_main_thread();
    log::info!("destroy_editor_window: on_main_thread = {}", on_main);

    if on_main {
        destroy_editor_window_inner(plugin, window);
    } else {
        log::info!("destroy_editor_window: Dispatching to main thread via GCD");

        let ctx = DestroyWindowContext { plugin, window };

        dispatch_sync_f(
            main_queue(),
            &ctx as *const DestroyWindowContext as *mut std::ffi::c_void,
            destroy_editor_window_on_main,
        );
    }
}

/// Inner implementation of destroy_editor_window
unsafe fn destroy_editor_window_inner(plugin: *const ClapPlugin, window: *mut c_void) {
    log::info!("destroy_editor_window_inner: Starting teardown");

    if let Some(gui) = get_gui_extension(plugin) {
        log::info!("destroy_editor_window_inner: Hiding plugin GUI");
        if let Some(hide) = (*gui).hide {
            hide(plugin);
        }

        // Unparent the plugin GUI before destroying (CLAP spec requirement)
        log::info!("destroy_editor_window_inner: Unparenting plugin GUI");
        if let Some(set_parent) = (*gui).set_parent {
            let null_window = ClapWindow::null();
            let _ = set_parent(plugin, &null_window);
        }

        log::info!("destroy_editor_window_inner: Destroying plugin GUI");
        if let Some(destroy) = (*gui).destroy {
            destroy(plugin);
        }
        log::info!("destroy_editor_window_inner: GUI destroyed");

        // Brief delay for iPlug2 WebView to complete synchronous cleanup
        log::info!("destroy_editor_window_inner: Brief delay for WebView sync cleanup");
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // Close and release the window
    if !window.is_null() {
        let window: Retained<NSWindow> = Retained::from_raw(window as *mut NSWindow)
            .expect("Invalid window pointer");

        let is_visible = window.isVisible();
        log::info!("destroy_editor_window_inner: Window visible: {}", is_visible);

        if is_visible {
            window.close();
            log::info!("destroy_editor_window_inner: Window closed");
        }

        log::info!("destroy_editor_window_inner: Window released");
    } else {
        log::warn!("destroy_editor_window_inner: Window pointer was null");
    }

    log::info!("destroy_editor_window_inner: Complete");
}

/// Get the current position of an editor window
/// Returns (x, y) in screen coordinates, or None if window is invalid
pub unsafe fn get_window_position(window: *mut c_void) -> Option<(f64, f64)> {
    if window.is_null() {
        return None;
    }

    let window_ref = &*(window as *const NSWindow);
    let frame = window_ref.frame();
    Some((frame.origin.x, frame.origin.y))
}

/// Context for main thread window visibility check
struct WindowVisibleContext {
    window: *mut c_void,
    result: bool,
}

/// Callback for checking window visibility on main thread
/// Returns true if window is visible OR miniaturized (in dock)
extern "C" fn check_window_visible_on_main(ctx: *mut std::ffi::c_void) {
    let ctx = unsafe { &mut *(ctx as *mut WindowVisibleContext) };
    if ctx.window.is_null() {
        ctx.result = false;
        return;
    }
    unsafe {
        let window_ref = &*(ctx.window as *const NSWindow);
        ctx.result = window_ref.isVisible() || window_ref.isMiniaturized();
    }
}

/// Check if an editor window is visible on screen or minimized to dock
/// Returns true if window is visible OR miniaturized (user hasn't closed it with X)
pub fn is_window_visible(window: *mut c_void) -> bool {
    if window.is_null() {
        return false;
    }

    let on_main = is_main_thread();
    if on_main {
        unsafe {
            let window_ref = &*(window as *const NSWindow);
            window_ref.isVisible() || window_ref.isMiniaturized()
        }
    } else {
        let mut ctx = WindowVisibleContext {
            window,
            result: false,
        };

        unsafe {
            dispatch_sync_f(
                main_queue(),
                &mut ctx as *mut WindowVisibleContext as *mut std::ffi::c_void,
                check_window_visible_on_main,
            );
        }

        ctx.result
    }
}

/// Context for deminiaturizing a window
struct DeminiaturizeContext {
    window: *mut c_void,
}

/// Callback for deminiaturizing window on main thread
extern "C" fn deminiaturize_window_on_main(ctx: *mut std::ffi::c_void) {
    let ctx = unsafe { &*(ctx as *mut DeminiaturizeContext) };
    if ctx.window.is_null() {
        return;
    }
    unsafe {
        let window_ref = &*(ctx.window as *const NSWindow);
        if window_ref.isMiniaturized() {
            window_ref.deminiaturize(None);
        }
        window_ref.makeKeyAndOrderFront(None);
    }
}

/// Restore a minimized window and bring it to front
pub fn restore_window(window: *mut c_void) {
    if window.is_null() {
        return;
    }

    let on_main = is_main_thread();
    if on_main {
        unsafe {
            let window_ref = &*(window as *const NSWindow);
            if window_ref.isMiniaturized() {
                window_ref.deminiaturize(None);
            }
            window_ref.makeKeyAndOrderFront(None);
        }
    } else {
        let mut ctx = DeminiaturizeContext { window };
        unsafe {
            dispatch_sync_f(
                main_queue(),
                &mut ctx as *mut DeminiaturizeContext as *mut std::ffi::c_void,
                deminiaturize_window_on_main,
            );
        }
    }
}

/// Check if the plugin supports the Cocoa GUI API
pub unsafe fn supports_gui(plugin: *const ClapPlugin) -> bool {
    let gui = match get_gui_extension(plugin) {
        Some(g) => g,
        None => return false,
    };

    let is_supported = match (*gui).is_api_supported {
        Some(f) => f(plugin, CLAP_WINDOW_API_COCOA.as_ptr() as *const i8, false),
        None => false,
    };
    is_supported
}
