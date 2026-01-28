pub mod prerequisites;
pub use prerequisites::cleanup_child_processes;
pub mod projects;
pub mod claude;
pub mod claude_md;
pub mod library;
pub mod build;
pub mod git;
pub mod chat;
pub mod publish;
pub mod logging;
pub mod files;
pub mod share;
pub mod preview;
pub mod usage;

/// Get the user's home directory in a cross-platform way.
/// On Unix (macOS/Linux), uses HOME. On Windows, uses USERPROFILE.
pub fn get_home_dir() -> String {
    #[cfg(unix)]
    {
        std::env::var("HOME").unwrap_or_default()
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").unwrap_or_default()
    }
}

/// Get an extended PATH that includes common tool installation directories.
/// Bundled apps don't inherit the user's shell PATH, so we need to
/// explicitly add paths where tools like rustc, cargo, claude, git are installed.
pub fn get_extended_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(unix)]
    {
        let home = get_home_dir();
        let extra_paths = [
            format!("{}/.claude/bin", home),          // Claude CLI (native installer)
            format!("{}/.cargo/bin", home),           // Rust/Cargo
            format!("{}/.local/bin", home),           // Claude CLI alt location, pip, etc.
            "/opt/homebrew/bin".to_string(),          // Homebrew (Apple Silicon)
            "/usr/local/bin".to_string(),             // Homebrew (Intel) / general
            "/opt/local/bin".to_string(),             // MacPorts
            "/Applications/CMake.app/Contents/bin".to_string(), // CMake.app (official installer)
            "/usr/bin".to_string(),                   // System binaries
            "/bin".to_string(),                       // Core binaries
        ];
        format!("{}:{}", extra_paths.join(":"), current_path)
    }

    #[cfg(windows)]
    {
        let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let programfiles = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
        let programfiles_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());

        let extra_paths = [
            format!(r"{}\.cargo\bin", userprofile),                     // Rust/Cargo
            format!(r"{}\.claude\bin", userprofile),                    // Claude CLI
            format!(r"{}\Programs\Claude\bin", localappdata),           // Claude CLI alt
            format!(r"{}\CMake\bin", programfiles),                     // CMake (Program Files)
            format!(r"{}\CMake\bin", programfiles_x86),                 // CMake (x86)
            format!(r"{}\Programs\CMake\bin", localappdata),            // CMake (local install)
            format!(r"{}\Git\cmd", programfiles),                       // Git
            format!(r"{}\Microsoft\WinGet\Links", localappdata),        // WinGet
            r"C:\ProgramData\chocolatey\bin".to_string(),               // Chocolatey
            format!(r"{}\scoop\shims", userprofile),                    // Scoop
        ];
        format!("{};{}", extra_paths.join(";"), current_path)
    }
}
