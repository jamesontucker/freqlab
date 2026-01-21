//! Crash Guard - Signal-based crash recovery for plugin processing
//!
//! Uses sigsetjmp/siglongjmp to recover from crashes (SIGABRT, SIGSEGV) that occur
//! during plugin processing. This allows the host to survive plugin crashes and
//! notify the user instead of crashing the entire application.
//!
//! # Safety
//! This module uses unsafe signal handling. It's designed specifically for the
//! audio processing context where a crash would otherwise terminate the app.

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod imp {
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

// sigjmp_buf size varies by platform and architecture
// Using a conservative size that should work on all platforms
// macOS arm64: ~48-50 ints, macOS x86_64: ~37+65 ints, Linux: varies
// We use 256 to be safe (1KB buffer, negligible overhead)
const JMP_BUF_SIZE: usize = 256;

/// Raw jmp_buf type - platform specific
type SigJmpBuf = [libc::c_int; JMP_BUF_SIZE];

// FFI declarations for sigsetjmp/siglongjmp (not always in libc crate)
extern "C" {
    #[cfg(target_os = "macos")]
    fn sigsetjmp(env: *mut SigJmpBuf, savemask: libc::c_int) -> libc::c_int;

    #[cfg(target_os = "macos")]
    fn siglongjmp(env: *mut SigJmpBuf, val: libc::c_int) -> !;

    #[cfg(target_os = "linux")]
    fn __sigsetjmp(env: *mut SigJmpBuf, savemask: libc::c_int) -> libc::c_int;

    #[cfg(target_os = "linux")]
    fn siglongjmp(env: *mut SigJmpBuf, val: libc::c_int) -> !;
}

#[cfg(target_os = "linux")]
unsafe fn sigsetjmp(env: *mut SigJmpBuf, savemask: libc::c_int) -> libc::c_int {
    __sigsetjmp(env, savemask)
}

/// Thread-local jump buffer for crash recovery
struct JumpBuffer {
    buf: UnsafeCell<SigJmpBuf>,
    active: AtomicBool,
}

// SAFETY: JumpBuffer is only accessed from the thread that set it up
unsafe impl Sync for JumpBuffer {}

impl JumpBuffer {
    const fn new() -> Self {
        Self {
            buf: UnsafeCell::new([0; JMP_BUF_SIZE]),
            active: AtomicBool::new(false),
        }
    }
}

/// Global jump buffer - we only process plugins on one audio thread
static JUMP_BUFFER: JumpBuffer = JumpBuffer::new();

/// Flag indicating a crash was caught
static CRASH_CAUGHT: AtomicBool = AtomicBool::new(false);

/// The signal that was caught
static CRASH_SIGNAL: AtomicI32 = AtomicI32::new(0);

/// Previous SIGABRT handler
static mut PREV_SIGABRT: libc::sigaction = unsafe { std::mem::zeroed() };

/// Previous SIGSEGV handler
static mut PREV_SIGSEGV: libc::sigaction = unsafe { std::mem::zeroed() };

/// Previous SIGBUS handler (common on macOS for memory errors)
static mut PREV_SIGBUS: libc::sigaction = unsafe { std::mem::zeroed() };

/// Whether handlers are installed
static HANDLERS_INSTALLED: AtomicBool = AtomicBool::new(false);

/// Signal handler that jumps back to safety
extern "C" fn crash_signal_handler(sig: libc::c_int) {
    // Only jump if we have an active guard
    if JUMP_BUFFER.active.load(Ordering::SeqCst) {
        CRASH_CAUGHT.store(true, Ordering::SeqCst);
        CRASH_SIGNAL.store(sig, Ordering::SeqCst);

        // SAFETY: We're jumping back to a valid setjmp point set up by with_crash_guard
        unsafe {
            siglongjmp(JUMP_BUFFER.buf.get(), 1);
        }
    }

    // If no guard is active, call the previous handler or use default behavior
    unsafe {
        let prev = match sig {
            libc::SIGABRT => &raw const PREV_SIGABRT,
            libc::SIGSEGV => &raw const PREV_SIGSEGV,
            libc::SIGBUS => &raw const PREV_SIGBUS,
            _ => return,
        };

        // Check if previous handler exists and is not SIG_DFL or SIG_IGN
        // The sigaction struct has sa_sigaction which is the handler
        let handler = (*prev).sa_sigaction as usize;

        if handler != libc::SIG_DFL && handler != libc::SIG_IGN {
            // Call the previous handler
            let func: extern "C" fn(libc::c_int) = std::mem::transmute(handler);
            func(sig);
        } else {
            // Re-raise with default handler
            libc::signal(sig, libc::SIG_DFL);
            libc::raise(sig);
        }
    }
}

/// Install signal handlers for crash recovery
fn install_handlers() {
    if HANDLERS_INSTALLED.swap(true, Ordering::SeqCst) {
        return; // Already installed
    }

    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();

        // Set the signal handler
        // We use sa_sigaction field but WITHOUT SA_SIGINFO flag,
        // which means the kernel will call it as a simple 1-arg handler
        action.sa_sigaction = crash_signal_handler as usize;
        action.sa_flags = 0; // No SA_SIGINFO - use simple 1-arg handler
        libc::sigemptyset(&mut action.sa_mask);

        // Install handlers and save previous ones
        libc::sigaction(libc::SIGABRT, &action, &raw mut PREV_SIGABRT);
        libc::sigaction(libc::SIGSEGV, &action, &raw mut PREV_SIGSEGV);
        libc::sigaction(libc::SIGBUS, &action, &raw mut PREV_SIGBUS);
    }

    log::info!("Crash guard signal handlers installed");
}

/// Result of running code with crash protection
pub enum CrashGuardResult<T> {
    /// Code completed successfully
    Ok(T),
    /// A crash was caught (signal number included)
    Crashed(i32),
}

impl<T> CrashGuardResult<T> {
    pub fn is_crashed(&self) -> bool {
        matches!(self, CrashGuardResult::Crashed(_))
    }
}

/// Execute a closure with crash protection.
///
/// If the closure causes a SIGABRT, SIGSEGV, or SIGBUS, this function will
/// catch it and return `CrashGuardResult::Crashed` instead of terminating.
///
/// # Safety
/// This function uses signal handlers and siglongjmp which can leave state
/// inconsistent if a crash occurs. The caller must:
/// - Not rely on any state modified by `f` if a crash occurs
/// - Treat the protected resource as unusable after a crash
/// - Not call this recursively
///
/// # Example
/// ```ignore
/// let result = with_crash_guard(|| {
///     plugin.process(&mut buffer);
/// });
///
/// match result {
///     CrashGuardResult::Ok(()) => { /* success */ }
///     CrashGuardResult::Crashed(sig) => { /* plugin crashed */ }
/// }
/// ```
pub fn with_crash_guard<F, T>(f: F) -> CrashGuardResult<T>
where
    F: FnOnce() -> T,
{
    // Ensure handlers are installed
    install_handlers();

    // Reset crash flag
    CRASH_CAUGHT.store(false, Ordering::SeqCst);

    unsafe {
        // Set up the jump point
        // sigsetjmp returns 0 on initial call, non-zero when jumped to
        let jmp_result = sigsetjmp(JUMP_BUFFER.buf.get(), 1);

        if jmp_result == 0 {
            // Normal path - activate guard and run the closure
            JUMP_BUFFER.active.store(true, Ordering::SeqCst);

            let result = f();

            // Deactivate guard after successful completion
            JUMP_BUFFER.active.store(false, Ordering::SeqCst);

            CrashGuardResult::Ok(result)
        } else {
            // We jumped back here after a crash
            JUMP_BUFFER.active.store(false, Ordering::SeqCst);

            let signal = CRASH_SIGNAL.load(Ordering::SeqCst);
            log::error!(
                "Crash guard caught signal {} ({})",
                signal,
                signal_name(signal)
            );

            CrashGuardResult::Crashed(signal)
        }
    }
}

/// Get a human-readable name for a signal
fn signal_name(sig: i32) -> &'static str {
    match sig {
        libc::SIGABRT => "SIGABRT (abort)",
        libc::SIGSEGV => "SIGSEGV (segmentation fault)",
        libc::SIGBUS => "SIGBUS (bus error)",
        _ => "unknown signal",
    }
}

}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod imp {
    /// Result of running code with crash protection.
    pub enum CrashGuardResult<T> {
        Ok(T),
        Crashed(i32),
    }

    impl<T> CrashGuardResult<T> {
        pub fn is_crashed(&self) -> bool {
            matches!(self, CrashGuardResult::Crashed(_))
        }
    }

    pub fn with_crash_guard<F, T>(f: F) -> CrashGuardResult<T>
    where
        F: FnOnce() -> T,
    {
        CrashGuardResult::Ok(f())
    }
}

pub use imp::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_execution() {
        let result = with_crash_guard(|| {
            42
        });

        match result {
            CrashGuardResult::Ok(v) => assert_eq!(v, 42),
            CrashGuardResult::Crashed(_) => panic!("Should not crash"),
        }
    }

    // Note: Can't easily test actual crashes in unit tests as they would
    // need to be isolated processes
}
