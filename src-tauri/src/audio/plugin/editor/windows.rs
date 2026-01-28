//! Windows implementation of plugin editor windows using Win32 API

use std::ffi::c_void;

use super::super::clap_sys::{ClapPlugin, ClapWindow, CLAP_WINDOW_API_WIN32};
use super::{get_gui_extension, get_gui_size};

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::UpdateWindow;
use windows::Win32::UI::WindowsAndMessaging::*;

/// Window class name for plugin editor windows
const WINDOW_CLASS_NAME: &str = "FreqlabPluginEditor";

/// Registered window class atom (initialized once)
static WINDOW_CLASS_REGISTERED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Window procedure for the editor host window
unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CLOSE => {
            // Hide the window instead of destroying it immediately
            // The plugin host will handle cleanup
            let _ = ShowWindow(hwnd, SW_HIDE);
            LRESULT(0)
        }
        WM_DESTROY => {
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Encode a Rust &str as a null-terminated wide string (UTF-16)
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Register the window class (idempotent)
fn ensure_window_class_registered() -> Result<(), String> {
    use std::sync::atomic::Ordering::SeqCst;

    // Use compare_exchange for atomic check-and-set to avoid TOCTOU race condition.
    // If another thread already set the flag (compare fails), we're done.
    if WINDOW_CLASS_REGISTERED
        .compare_exchange(false, true, SeqCst, SeqCst)
        .is_err()
    {
        return Ok(()); // Already registered by another thread
    }

    // We won the race - proceed with registration
    let class_name = to_wide(WINDOW_CLASS_NAME);

    let wc = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: unsafe { windows::Win32::System::LibraryLoader::GetModuleHandleW(PCWSTR::null()) }
            .map_err(|e| format!("GetModuleHandleW failed: {}", e))?
            .into(),
        hIcon: HICON::default(),
        hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }
            .map_err(|e| format!("LoadCursorW failed: {}", e))?,
        hbrBackground: unsafe { windows::Win32::Graphics::Gdi::GetStockObject(windows::Win32::Graphics::Gdi::BLACK_BRUSH) }
            .into(),
        lpszMenuName: PCWSTR::null(),
        lpszClassName: PCWSTR(class_name.as_ptr()),
        hIconSm: HICON::default(),
    };

    let atom = unsafe { RegisterClassExW(&wc) };
    if atom == 0 {
        // Registration failed - reset the flag so another thread can try
        WINDOW_CLASS_REGISTERED.store(false, SeqCst);
        return Err("Failed to register window class".to_string());
    }

    Ok(())
}

/// No run loop pumping needed on Windows
pub fn pump_run_loop_for_cleanup(_seconds: f64) {}

/// Check if the plugin supports the Win32 GUI API
pub unsafe fn supports_gui(plugin: *const ClapPlugin) -> bool {
    let gui = match get_gui_extension(plugin) {
        Some(g) => g,
        None => return false,
    };

    match (*gui).is_api_supported {
        Some(f) => f(plugin, CLAP_WINDOW_API_WIN32.as_ptr() as *const i8, false),
        None => false,
    }
}

/// Create a Win32 window for the plugin editor
pub unsafe fn create_editor_window(
    plugin: *const ClapPlugin,
    title: &str,
) -> Result<(*mut c_void, *mut c_void), String> {
    create_editor_window_at(plugin, title, None)
}

/// Create a Win32 window for the plugin editor at a specific position
///
/// Returns (window_handle, content_handle) - on Windows both are the same HWND.
pub unsafe fn create_editor_window_at(
    plugin: *const ClapPlugin,
    title: &str,
    position: Option<(f64, f64)>,
) -> Result<(*mut c_void, *mut c_void), String> {
    log::info!("create_editor_window_at (Win32): position: {:?}", position);

    ensure_window_class_registered()?;

    let gui = get_gui_extension(plugin)
        .ok_or_else(|| "Plugin does not have GUI extension".to_string())?;

    // Check if Win32 API is supported
    let is_supported = (*gui)
        .is_api_supported
        .map(|f| f(plugin, CLAP_WINDOW_API_WIN32.as_ptr() as *const i8, false))
        .unwrap_or(false);

    if !is_supported {
        return Err("Plugin does not support Win32 GUI API".to_string());
    }

    // Create the GUI
    let create = (*gui)
        .create
        .ok_or_else(|| "Plugin GUI create function not available".to_string())?;

    if !create(plugin, CLAP_WINDOW_API_WIN32.as_ptr() as *const i8, false) {
        return Err("Failed to create plugin GUI".to_string());
    }

    // Get the size
    let (width, height) = get_gui_size(plugin).unwrap_or((800, 600));
    log::info!("create_editor_window_at (Win32): Size = {}x{}", width, height);

    // Calculate window rect including non-client area (title bar, borders)
    let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: width as i32,
        bottom: height as i32,
    };
    let _ = AdjustWindowRectEx(&mut rect, style, false, WINDOW_EX_STYLE::default());

    let adjusted_width = rect.right - rect.left;
    let adjusted_height = rect.bottom - rect.top;

    let (x, y) = match position {
        Some((px, py)) => (px as i32, py as i32),
        None => (CW_USEDEFAULT, CW_USEDEFAULT),
    };

    let class_name = to_wide(WINDOW_CLASS_NAME);
    let window_title = to_wide(title);

    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        PCWSTR(class_name.as_ptr()),
        PCWSTR(window_title.as_ptr()),
        style,
        x,
        y,
        adjusted_width,
        adjusted_height,
        None, // no parent
        None, // no menu
        None, // default instance
        None, // no lparam
    )
    .map_err(|e| format!("CreateWindowExW failed: {}", e))?;

    log::info!("create_editor_window_at (Win32): HWND created: {:?}", hwnd);

    let hwnd_ptr = hwnd.0 as *mut c_void;

    // Pass the HWND to the plugin
    let clap_window = ClapWindow::win32(hwnd_ptr);
    let set_parent = (*gui)
        .set_parent
        .ok_or_else(|| "Plugin GUI set_parent not available".to_string())?;

    if !set_parent(plugin, &clap_window) {
        log::error!("create_editor_window_at (Win32): set_parent failed");
        let _ = DestroyWindow(hwnd);
        if let Some(destroy) = (*gui).destroy {
            destroy(plugin);
        }
        return Err("Failed to set plugin parent window".to_string());
    }
    log::info!("create_editor_window_at (Win32): set_parent successful");

    // Show the GUI
    if let Some(show) = (*gui).show {
        show(plugin);
    }

    // Show the window
    let _ = ShowWindow(hwnd, SW_SHOW);
    let _ = UpdateWindow(hwnd);

    // Bring to foreground
    let _ = SetForegroundWindow(hwnd);

    log::info!("create_editor_window_at (Win32): Window creation complete");

    // Return (window_ptr, content_ptr) - on Windows both are the same HWND
    Ok((hwnd_ptr, hwnd_ptr))
}

/// Close and destroy the editor window
pub unsafe fn destroy_editor_window(plugin: *const ClapPlugin, window: *mut c_void) {
    log::info!("destroy_editor_window (Win32): Called with window {:p}", window);

    // Teardown the plugin GUI
    if let Some(gui) = get_gui_extension(plugin) {
        log::info!("destroy_editor_window (Win32): Hiding plugin GUI");
        if let Some(hide) = (*gui).hide {
            hide(plugin);
        }

        // Unparent the plugin GUI before destroying (CLAP spec requirement)
        log::info!("destroy_editor_window (Win32): Unparenting plugin GUI");
        if let Some(set_parent) = (*gui).set_parent {
            let null_window = ClapWindow::null();
            let _ = set_parent(plugin, &null_window);
        }

        log::info!("destroy_editor_window (Win32): Destroying plugin GUI");
        if let Some(destroy) = (*gui).destroy {
            destroy(plugin);
        }
        log::info!("destroy_editor_window (Win32): GUI destroyed");
    }

    // Destroy the Win32 window
    if !window.is_null() {
        let hwnd = HWND(window as *mut _);
        let _ = DestroyWindow(hwnd);
        log::info!("destroy_editor_window (Win32): Window destroyed");
    } else {
        log::warn!("destroy_editor_window (Win32): Window pointer was null");
    }

    log::info!("destroy_editor_window (Win32): Complete");
}

/// Get the current position of an editor window
/// Returns (x, y) in screen coordinates
pub unsafe fn get_window_position(window: *mut c_void) -> Option<(f64, f64)> {
    if window.is_null() {
        return None;
    }

    let hwnd = HWND(window as *mut _);
    if !IsWindow(hwnd).as_bool() {
        return None;
    }

    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_ok() {
        Some((rect.left as f64, rect.top as f64))
    } else {
        None
    }
}

/// Check if an editor window is visible on screen
pub fn is_window_visible(window: *mut c_void) -> bool {
    if window.is_null() {
        return false;
    }

    let hwnd = HWND(window as *mut _);
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return false;
        }
        IsWindowVisible(hwnd).as_bool()
    }
}

/// Restore a minimized window and bring it to front
pub fn restore_window(window: *mut c_void) {
    if window.is_null() {
        return;
    }

    let hwnd = HWND(window as *mut _);
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return;
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
}
