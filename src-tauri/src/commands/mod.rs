pub mod prerequisites;
pub use prerequisites::cleanup_child_processes;
pub mod ai_context;
pub mod projects;
pub mod claude;
pub mod codex;
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
#[cfg(target_os = "windows")]
pub fn get_extended_path() -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let pnpm_home = std::env::var("PNPM_HOME").unwrap_or_default();
    let yarn_home = std::env::var("YARN_HOME").unwrap_or_default();
    let bun_install = std::env::var("BUN_INSTALL").unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();

    // Add common tool installation paths that bundled apps don't see
    let mut extra_paths = vec![
        format!("{}\\.claude\\bin", home), // Claude CLI (native installer)
        format!("{}\\.cargo\\bin", home),  // Rust/Cargo
        format!("{}\\.codex\\bin", home),  // Codex CLI (if installed here)
        format!("{}\\AppData\\Roaming\\npm", home),
        format!("{}\\AppData\\Local\\npm", home),
        format!("{}\\AppData\\Roaming\\pnpm", home),
        format!("{}\\AppData\\Local\\Yarn\\bin", home),
        format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home),
        "C:\\Program Files\\nodejs".to_string(),
        "C:\\Program Files\\Git\\bin".to_string(),
    ];

    if !appdata.is_empty() {
        extra_paths.push(format!("{}\\npm", appdata));
        extra_paths.push(format!("{}\\pnpm", appdata));
    }

    if !local_appdata.is_empty() {
        extra_paths.push(format!("{}\\npm", local_appdata));
        extra_paths.push(format!("{}\\Yarn\\bin", local_appdata));
    }

    if !pnpm_home.is_empty() {
        extra_paths.push(pnpm_home);
    }

    if !yarn_home.is_empty() {
        extra_paths.push(yarn_home);
    }

    if !bun_install.is_empty() {
        extra_paths.push(format!("{}\\bin", bun_install));
    }

    format!("{};{}", extra_paths.join(";"), current_path)
}

#[cfg(not(target_os = "windows"))]
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
