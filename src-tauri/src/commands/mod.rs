pub mod prerequisites;
pub use prerequisites::cleanup_child_processes;
pub mod projects;
pub mod claude;
pub mod claude_md;
pub mod claude_skills;
pub mod build;
pub mod git;
pub mod chat;
pub mod publish;
pub mod logging;
pub mod files;
pub mod share;
pub mod preview;

/// Get an extended PATH that includes common tool installation directories.
/// Bundled macOS apps don't inherit the user's shell PATH, so we need to
/// explicitly add paths where tools like rustc, cargo, claude, git are installed.
pub fn get_extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();

    // Add common tool installation paths that bundled apps don't see
    let extra_paths = [
        format!("{}/.claude/bin", home),          // Claude CLI (native installer)
        format!("{}/.cargo/bin", home),           // Rust/Cargo
        format!("{}/.local/bin", home),           // Claude CLI alt location, pip, etc.
        "/opt/homebrew/bin".to_string(),          // Homebrew (Apple Silicon)
        "/usr/local/bin".to_string(),             // Homebrew (Intel) / general
        "/opt/local/bin".to_string(),             // MacPorts
        "/usr/bin".to_string(),                   // System binaries
        "/bin".to_string(),                       // Core binaries
    ];

    format!("{}:{}", extra_paths.join(":"), current_path)
}
