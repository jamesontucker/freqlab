use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

// Track active child process PIDs for cleanup on exit
static ACTIVE_CHILD_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Register a child process PID for tracking
fn register_child_pid(pid: u32) {
    if let Ok(mut pids) = ACTIVE_CHILD_PIDS.lock() {
        pids.push(pid);
    }
}

/// Unregister a child process PID (called when process completes normally)
fn unregister_child_pid(pid: u32) {
    if let Ok(mut pids) = ACTIVE_CHILD_PIDS.lock() {
        pids.retain(|&p| p != pid);
    }
}

/// Kill all tracked child processes - call this on app exit
pub fn cleanup_child_processes() {
    if let Ok(pids) = ACTIVE_CHILD_PIDS.lock() {
        for &pid in pids.iter() {
            #[cfg(target_os = "macos")]
            {
                // Send SIGTERM first, then SIGKILL
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                // Give it a moment then force kill
                std::thread::sleep(Duration::from_millis(100));
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }

            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output();
            }

            #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
            {
                let _ = pid;
            }
        }
    }
}

/// Events emitted during installation
#[derive(Serialize, Clone)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum InstallEvent {
    #[serde(rename = "start")]
    Start { step: String },
    #[serde(rename = "output")]
    Output { line: String },
    #[serde(rename = "done")]
    Done { success: bool },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "action_required")]
    ActionRequired { action: String, message: String },
}

#[derive(Serialize, Clone)]
pub struct PrerequisiteStatus {
    pub xcode_cli: CheckResult,
    pub rust: CheckResult,
    pub claude_cli: CheckResult,
    pub claude_auth: CheckResult,
    pub codex_cli: CheckResult,
}

#[derive(Serialize, Clone)]
pub struct CheckResult {
    pub status: CheckStatus,
    pub version: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Installed,
    NotInstalled,
    NeedsConfig,
}

// ============================================================================
// Disk Space Types
// ============================================================================

#[derive(Serialize, Clone)]
pub struct DiskSpaceInfo {
    pub available_gb: f64,
    pub required_gb: f64,
    pub sufficient: bool,
    pub breakdown: DiskSpaceBreakdown,
}

#[derive(Serialize, Clone)]
pub struct DiskSpaceBreakdown {
    pub xcode_gb: f64,
    pub rust_gb: f64,
    pub claude_cli_gb: f64,
    pub total_required_gb: f64,
}

fn user_home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

fn run_command_with_timeout(cmd: &str, args: &[&str], timeout_secs: u64) -> Option<std::process::Output> {
    let mut child = Command::new(cmd)
        .args(args)
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    // Simple timeout: wait in a loop
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process finished
                return child.wait_with_output().ok();
            }
            Ok(None) => {
                // Still running
                if start.elapsed() > Duration::from_secs(timeout_secs) {
                    // Timeout - kill the process
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

fn path_lookup_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    }
}

fn lookup_command_path(command: &str) -> Option<String> {
    run_command_with_timeout(path_lookup_command(), &[command], 3).and_then(|output| {
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.lines().next().map(|line| line.trim().to_string()).filter(|p| !p.is_empty())
    })
}

fn command_exists(command: &str) -> bool {
    lookup_command_path(command).is_some()
}

fn check_xcode() -> CheckResult {
    #[cfg(target_os = "macos")]
    {
        match run_command_with_timeout("xcode-select", &["-p"], 5) {
            Some(output) if output.status.success() => CheckResult {
                status: CheckStatus::Installed,
                version: Some("Installed".to_string()),
                message: None,
            },
            _ => CheckResult {
                status: CheckStatus::NotInstalled,
                version: None,
                message: Some("Run: xcode-select --install".to_string()),
            },
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        CheckResult {
            status: CheckStatus::Installed,
            version: Some("N/A".to_string()),
            message: Some("Not required on this platform.".to_string()),
        }
    }
}

fn check_rust() -> CheckResult {
    match run_command_with_timeout("rustc", &["--version"], 5) {
        Some(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            CheckResult {
                status: CheckStatus::Installed,
                version: Some(version),
                message: None,
            }
        }
        _ => CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install from https://rustup.rs".to_string()),
        },
    }
}

fn check_claude_cli() -> CheckResult {
    let install_hint = if cfg!(target_os = "windows") {
        "Install from https://claude.ai/download"
    } else {
        "Run: curl -fsSL https://claude.ai/install.sh | bash"
    };

    if command_exists("claude") {
        CheckResult {
            status: CheckStatus::Installed,
            version: Some("Installed".to_string()),
            message: None,
        }
    } else {
        CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some(install_hint.to_string()),
        }
    }
}

fn check_codex_cli() -> CheckResult {
    if let Ok(path) = std::env::var("CODEX_CLI_PATH") {
        if !path.trim().is_empty() && Path::new(&path).exists() {
            return CheckResult {
                status: CheckStatus::Installed,
                version: Some("Installed".to_string()),
                message: None,
            };
        }
    }

    let codex_path = lookup_command_path("codex")
        .or_else(|| lookup_command_path("codex.cmd"))
        .or_else(|| lookup_command_path("codex.exe"));

    if codex_path.is_none() {
        return CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install Codex CLI from https://platform.openai.com/docs/codex/codex-cli".to_string()),
        };
    }

    if let Some(output) = run_command_with_timeout("codex", &["--version"], 10) {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return CheckResult {
                status: CheckStatus::Installed,
                version: Some(if version.is_empty() { "Installed".to_string() } else { version }),
                message: None,
            };
        }
    }

    CheckResult {
        status: CheckStatus::Installed,
        version: Some("Installed".to_string()),
        message: None,
    }
}

fn check_claude_auth() -> CheckResult {
    // First check if claude is installed using path lookup
    if !command_exists("claude") {
        return CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install Claude CLI first".to_string()),
        };
    }

    let home = user_home_dir();

    // Primary check: Look for Claude credentials in macOS keychain
    // This is the most reliable indicator since Claude stores OAuth tokens here
    #[cfg(target_os = "macos")]
    {
        if let Some(output) = run_command_with_timeout(
            "security",
            &["find-generic-password", "-s", "Claude Code-credentials"],
            3,
        ) {
            if output.status.success() {
                return CheckResult {
                    status: CheckStatus::Installed,
                    version: None,
                    message: Some("Authenticated".to_string()),
                };
            }
        }
    }

    // Fallback to file-based checks for edge cases
    if check_auth_files(&home) {
        return CheckResult {
            status: CheckStatus::Installed,
            version: None,
            message: Some("Authenticated".to_string()),
        };
    }

    // No auth indicators found
    let claude_dir = std::path::Path::new(&home).join(".claude");
    if claude_dir.exists() {
        CheckResult {
            status: CheckStatus::NeedsConfig,
            version: None,
            message: Some("Sign in to continue".to_string()),
        }
    } else {
        CheckResult {
            status: CheckStatus::NeedsConfig,
            version: None,
            message: Some("Sign in required".to_string()),
        }
    }
}

#[tauri::command]
pub async fn check_prerequisites() -> PrerequisiteStatus {
    // Run checks in a blocking thread pool to not freeze the UI
    tokio::task::spawn_blocking(|| {
        PrerequisiteStatus {
            xcode_cli: check_xcode(),
            rust: check_rust(),
            claude_cli: check_claude_cli(),
            claude_auth: check_claude_auth(),
            codex_cli: check_codex_cli(),
        }
    })
    .await
    .unwrap_or_else(|_| PrerequisiteStatus {
        xcode_cli: CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Check failed".to_string()),
        },
        rust: CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Check failed".to_string()),
        },
        claude_cli: CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Check failed".to_string()),
        },
        claude_auth: CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Check failed".to_string()),
        },
        codex_cli: CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Check failed".to_string()),
        },
    })
}

/// Check available disk space and calculate requirements
#[tauri::command]
pub async fn check_disk_space() -> Result<DiskSpaceInfo, String> {
    #[cfg(target_os = "macos")]
    {
        return tokio::task::spawn_blocking(|| {
            // Get available disk space using statvfs
            let path = std::ffi::CString::new("/").unwrap();
            let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };

            let result = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
            if result != 0 {
                return Err("Failed to check disk space".to_string());
            }

            let available_bytes = stat.f_bavail as u64 * stat.f_frsize as u64;
            let available_gb = available_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

            // Calculate requirements based on what's missing
            let xcode_needed = check_xcode().status != CheckStatus::Installed;
            let rust_needed = check_rust().status != CheckStatus::Installed;
            let claude_cli_needed = check_claude_cli().status != CheckStatus::Installed;

            // Xcode CLI Tools: ~3-4 GB (not full Xcode which is 10-20 GB)
            let xcode_gb = if xcode_needed { 4.0 } else { 0.0 };
            // Rust toolchain: ~1.5 GB
            let rust_gb = if rust_needed { 1.5 } else { 0.0 };
            // Claude Code native binary: ~100 MB
            let claude_cli_gb = if claude_cli_needed { 0.1 } else { 0.0 };

            let total = xcode_gb + rust_gb + claude_cli_gb;

            // Add 2GB buffer for safety
            let required_with_buffer = total + 2.0;

            Ok(DiskSpaceInfo {
                available_gb,
                required_gb: required_with_buffer,
                sufficient: available_gb >= required_with_buffer,
                breakdown: DiskSpaceBreakdown {
                    xcode_gb,
                    rust_gb,
                    claude_cli_gb,
                    total_required_gb: total,
                },
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let xcode_needed = check_xcode().status != CheckStatus::Installed;
        let rust_needed = check_rust().status != CheckStatus::Installed;
        let claude_cli_needed = check_claude_cli().status != CheckStatus::Installed;

        let xcode_gb = if xcode_needed { 4.0 } else { 0.0 };
        let rust_gb = if rust_needed { 1.5 } else { 0.0 };
        let claude_cli_gb = if claude_cli_needed { 0.1 } else { 0.0 };

        let total = xcode_gb + rust_gb + claude_cli_gb;
        let required_with_buffer = total + 2.0;

        return Ok(DiskSpaceInfo {
            available_gb: required_with_buffer + 1.0,
            required_gb: required_with_buffer,
            sufficient: true,
            breakdown: DiskSpaceBreakdown {
                xcode_gb,
                rust_gb,
                claude_cli_gb,
                total_required_gb: total,
            },
        });
    }
}

// ============================================================================
// Installation Commands
// ============================================================================

/// Install Xcode Command Line Tools silently via softwareupdate
/// Uses the trigger file trick to make CLT appear in softwareupdate list
/// Then installs with admin privileges - user only sees password prompt
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn install_xcode(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "xcode".to_string(),
        },
    );

    // First check if already installed
    if let Some(output) = run_command_with_timeout("xcode-select", &["-p"], 5) {
        if output.status.success() {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Apple Developer Tools already installed.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Preparing to install Apple Developer Tools...".to_string(),
        },
    );

    // Create the trigger file that makes softwareupdate list CLT
    let trigger_file = "/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress";
    if let Err(e) = tokio::fs::write(trigger_file, "").await {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: format!("Warning: Could not create trigger file: {}", e),
            },
        );
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Finding available version...".to_string(),
        },
    );

    // Run softwareupdate -l to find the CLT package name
    let list_output = tokio::process::Command::new("softwareupdate")
        .args(["-l"])
        .output()
        .await
        .map_err(|e| format!("Failed to list software updates: {}", e))?;

    let list_text = String::from_utf8_lossy(&list_output.stdout);
    let stderr_text = String::from_utf8_lossy(&list_output.stderr);
    let combined = format!("{}\n{}", list_text, stderr_text);

    // Parse for Command Line Tools package name
    // Format varies: "* Command Line Tools for Xcode-14.3" or "Label: Command Line Tools..."
    let package_name = combined
        .lines()
        .find(|line| line.contains("Command Line Tools") || line.contains("CommandLineTools"))
        .and_then(|line| {
            // Try to extract the label/package name
            if line.contains("Label:") {
                line.split("Label:").nth(1).map(|s| s.trim().to_string())
            } else if line.starts_with('*') {
                // Format: "* Command Line Tools for Xcode-14.3"
                Some(line.trim_start_matches('*').trim().to_string())
            } else if line.contains("Command Line Tools") {
                // Try to extract just the package name
                let trimmed = line.trim();
                if trimmed.starts_with("Command Line") {
                    Some(trimmed.to_string())
                } else {
                    trimmed.split_whitespace()
                        .skip_while(|w| !w.contains("Command"))
                        .collect::<Vec<_>>()
                        .join(" ")
                        .split(',')
                        .next()
                        .map(|s| s.trim().to_string())
                }
            } else {
                None
            }
        });

    // Clean up trigger file
    let _ = tokio::fs::remove_file(trigger_file).await;

    let package = match package_name {
        Some(p) if !p.is_empty() => p,
        _ => {
            // Fallback to GUI installer if softwareupdate doesn't list CLT
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Could not find package via softwareupdate, using GUI installer...".to_string(),
                },
            );
            return install_xcode_gui_fallback(window).await;
        }
    };

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: format!("Found: {}", package),
        },
    );

    let _ = window.emit(
        "install-stream",
        InstallEvent::ActionRequired {
            action: "password".to_string(),
            message: "Enter your Mac password when prompted".to_string(),
        },
    );

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installing (this may take 5-10 minutes)...".to_string(),
        },
    );

    // Install with admin privileges using osascript
    // This shows the standard macOS password dialog
    let install_script = format!(
        r#"do shell script "softwareupdate -i '{}'" with administrator privileges"#,
        package.replace("'", "'\\''") // Escape single quotes
    );

    let mut child = tokio::process::Command::new("osascript")
        .args(["-e", &install_script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    // Stream output while waiting
    let success = stream_and_wait(&mut child, &window).await;

    if success {
        // Verify installation
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some(output) = run_command_with_timeout("xcode-select", &["-p"], 5) {
            if output.status.success() {
                let _ = window.emit(
                    "install-stream",
                    InstallEvent::Output {
                        line: "Apple Developer Tools installed successfully!".to_string(),
                    },
                );
                let _ = window.emit("install-stream", InstallEvent::Done { success: true });
                return Ok(true);
            }
        }
    }

    // If softwareupdate failed, fall back to GUI
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Silent install failed, trying GUI installer...".to_string(),
        },
    );
    install_xcode_gui_fallback(window).await
}

/// Fallback to GUI-based Xcode CLT installer
async fn install_xcode_gui_fallback(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Opening system installer dialog...".to_string(),
        },
    );

    // Trigger the install dialog
    let _ = tokio::process::Command::new("xcode-select")
        .args(["--install"])
        .output()
        .await;

    // Try to bring dialog to front
    let bring_to_front = r#"
        delay 1
        tell application "System Events"
            try
                set frontmost of process "Install Command Line Developer Tools" to true
            end try
        end tell
    "#;
    let _ = tokio::process::Command::new("osascript")
        .args(["-e", bring_to_front])
        .output()
        .await;

    let _ = window.emit(
        "install-stream",
        InstallEvent::ActionRequired {
            action: "xcode_dialog".to_string(),
            message: "Click 'Install' in the popup (may be behind this window)".to_string(),
        },
    );

    // Poll for completion
    let max_attempts = 600; // 30 minutes
    for attempt in 0..max_attempts {
        tokio::time::sleep(Duration::from_secs(3)).await;

        let check = tokio::task::spawn_blocking(|| {
            run_command_with_timeout("xcode-select", &["-p"], 5)
        }).await;

        if let Ok(Some(output)) = check {
            if output.status.success() {
                let _ = window.emit(
                    "install-stream",
                    InstallEvent::Output {
                        line: "Installation complete!".to_string(),
                    },
                );
                let _ = window.emit("install-stream", InstallEvent::Done { success: true });
                return Ok(true);
            }
        }

        if attempt > 0 && attempt % 10 == 0 {
            let minutes = (attempt * 3) / 60;
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: format!("Still waiting... ({} min)", minutes),
                },
            );
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installation timed out. Try installing from Software Update in your Mac settings.".to_string(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err("Installation timed out".to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn install_xcode(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "xcode".to_string(),
        },
    );

    let msg = "Xcode is macOS-only. Install Visual Studio Build Tools and the Windows SDK.";
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: msg.to_string(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err(msg.to_string())
}

/// Install Rust via rustup (non-interactive)
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn install_rust(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "rust".to_string(),
        },
    );

    // Check if already installed via rustup
    if let Some(output) = run_command_with_timeout("rustc", &["--version"], 5) {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: format!("{} is already installed.", version),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Downloading Rust installer...".to_string(),
        },
    );

    // Use -y for non-interactive
    let install_script = r#"curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"#;

    let mut child = tokio::process::Command::new("/bin/bash")
        .args(["-c", install_script])
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start Rust installer: {}", e))?;

    let success = stream_and_wait(&mut child, &window).await;

    if success {
        // Verify Rust is actually accessible - source the cargo env first
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Check with the extended PATH that includes ~/.cargo/bin
        if run_command_with_timeout("rustc", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Rust installed successfully!".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            Ok(true)
        } else {
            // Rare edge case - installed but not detected
            // This shouldn't happen since we use extended PATH, but just in case
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Rust installed! Click Recheck to verify.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            Ok(true)
        }
    } else {
        let msg = "Failed to install Rust. Check your internet connection and try again.";
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output { line: msg.to_string() },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err(msg.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn install_rust(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "rust".to_string(),
        },
    );

    let msg = "Install Rust from https://rustup.rs (MSVC toolchain).";
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output { line: msg.to_string() },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err(msg.to_string())
}

/// Install Claude CLI via native installer (no Node.js required!)
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn install_claude_cli(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_cli".to_string(),
        },
    );

    // Check if already installed
    if command_exists("claude") {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Claude Code is already installed.".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        return Ok(true);
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Downloading Claude Code...".to_string(),
        },
    );

    // Use the native installer - no Node.js required!
    // This installs to ~/.claude/bin/claude or ~/.local/bin/claude
    let install_script = "curl -fsSL https://claude.ai/install.sh | bash";

    let mut child = tokio::process::Command::new("/bin/bash")
        .args(["-c", install_script])
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    let success = stream_and_wait(&mut child, &window).await;

    if success {
        // Verify Claude CLI is accessible and actually works
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Check both possible install locations
        let home = user_home_dir();
        let claude_paths = [
            format!("{}/.claude/bin/claude", home),
            format!("{}/.local/bin/claude", home),
        ];

        // Find which path has the binary
        let found_path = claude_paths.iter().find(|p| std::path::Path::new(p).exists());

        // Verify the binary actually runs by checking --version
        let verified = if let Some(path) = found_path {
            // Try to run the binary with --version to verify it works
            run_command_with_timeout(path, &["--version"], 5)
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            // Fallback to PATH lookup + version check
            if let Some(path) = lookup_command_path("claude") {
                run_command_with_timeout(&path, &["--version"], 5)
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            } else {
                false
            }
        };

        if verified {
            // Pre-create config files to skip interactive onboarding wizard
            let home = user_home_dir();
            let claude_dir = std::path::Path::new(&home).join(".claude");

            if !claude_dir.exists() {
                let _ = std::fs::create_dir_all(&claude_dir);
            }

            // Create ~/.claude.json with onboarding flags BEFORE Claude is ever run
            let claude_json = std::path::Path::new(&home).join(".claude.json");
            if !claude_json.exists() {
                let default_config = r#"{
  "hasCompletedOnboarding": true,
  "lastOnboardingVersion": "2.1.5",
  "numStartups": 1,
  "installMethod": "native",
  "autoUpdates": false,
  "hasSeenTasksHint": true
}"#;
                let _ = std::fs::write(&claude_json, default_config);
            }

            // Create ~/.claude/settings.json with default settings (opus model)
            let settings_file = claude_dir.join("settings.json");
            if !settings_file.exists() {
                let default_settings = r#"{"model": "opus"}"#;
                let _ = std::fs::write(&settings_file, default_settings);
            }

            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Claude Code installed successfully!".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            Ok(true)
        } else if found_path.is_some() {
            // Binary exists but didn't run - might be permissions issue
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Claude Code was installed but couldn't be verified.".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "This may be a permissions issue. Try closing and reopening the app.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            Err("Claude installed but verification failed".to_string())
        } else {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Installation completed but Claude not detected.".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Please close and reopen this app, then click Recheck.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            Err("Claude installed but requires app restart to detect".to_string())
        }
    } else {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Installation failed. Please check your internet connection.".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "You can also try installing manually:".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "1. Open Terminal".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "2. Run: curl -fsSL https://claude.ai/install.sh | bash".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "3. Come back here and click Recheck".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err("Failed to install Claude Code".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn install_claude_cli(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_cli".to_string(),
        },
    );

    let msg = "Install Claude Code from https://claude.ai/download and ensure it's in PATH.";
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output { line: msg.to_string() },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err(msg.to_string())
}

/// Start Claude authentication - opens Terminal with clear instructions
/// Claude requires a real TTY for /login, so we use Terminal.app
/// We try auto-typing first, fall back to manual instructions if blocked
/// Auto-closes Terminal when auth completes successfully
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn start_claude_auth(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_auth".to_string(),
        },
    );

    // Check if Claude CLI is installed first and get its full path
    let claude_path = match find_claude_binary() {
        Some(path) => path,
        None => {
            let msg = "Claude Code not found. Please install it first.";
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output { line: msg.to_string() },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            return Err(msg.to_string());
        }
    };

    // Ensure config files exist (should already be created during install, but double-check)
    let home = user_home_dir();
    let claude_dir = std::path::Path::new(&home).join(".claude");
    let claude_json = std::path::Path::new(&home).join(".claude.json");

    // If config doesn't exist yet (e.g., Claude was pre-installed), create it now
    if !claude_json.exists() {
        let _ = std::fs::create_dir_all(&claude_dir);
        let default_config = r#"{
  "hasCompletedOnboarding": true,
  "lastOnboardingVersion": "2.1.5",
  "numStartups": 1,
  "installMethod": "native",
  "autoUpdates": false,
  "hasSeenTasksHint": true
}"#;
        let _ = std::fs::write(&claude_json, default_config);
        let settings_file = claude_dir.join("settings.json");
        if !settings_file.exists() {
            let _ = std::fs::write(&settings_file, r#"{"model": "opus"}"#);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Opening Terminal for sign-in...".to_string(),
        },
    );

    // Claude requires a real TTY for /login command, so we must use Terminal
    // We use a unique marker in the tab name so we can close it later
    let tab_marker = format!("FreqLab-Claude-{}", std::process::id());

    // Escape the path for shell use (handle spaces and special chars)
    let escaped_claude_path = claude_path.replace("'", "'\\''");

    // Try to auto-type /login, but this may be blocked by Accessibility permissions
    // The script opens Terminal, sets a custom tab title (for later closing), runs claude, and types /login
    // We use the full path to claude to avoid PATH issues in Terminal
    //
    // IMPORTANT: To avoid the "two terminals" issue when Terminal.app launches from closed state:
    // - Check if Terminal is running BEFORE telling it to do anything
    // - If not running, use `do script` first (which launches Terminal with our command)
    // - Only call `activate` AFTER the script is running
    // This prevents Terminal from creating an extra empty window on launch
    // Terminal banner with step-by-step instructions for non-technical users
    let banner = r#"clear && echo '' && echo '╔═══════════════════════════════════════════════╗' && echo '║         CLAUDE SIGN-IN                        ║' && echo '╠═══════════════════════════════════════════════╣' && echo '║                                               ║' && echo '║  1. Wait for login method prompt             ║' && echo '║  2. Press ENTER (Claude account selected)    ║' && echo '║  3. Sign in and approve in browser           ║' && echo '║  4. This window will close automatically     ║' && echo '║                                               ║' && echo '╚═══════════════════════════════════════════════╝' && echo ''"#;

    let apple_script = format!(r#"
        -- Check if Terminal is already running BEFORE entering tell block
        set terminalWasRunning to application "Terminal" is running

        if terminalWasRunning then
            -- Terminal is already running
            tell application "Terminal"
                activate
                if (count of windows) > 0 then
                    tell front window
                        set newTab to do script "{banner} && '{escaped_claude_path}'"
                    end tell
                else
                    set newTab to do script "{banner} && '{escaped_claude_path}'"
                end if
                set custom title of newTab to "{tab_marker}"
            end tell
        else
            -- Terminal not running - do script first, then activate
            -- This launches Terminal with our command directly, no empty window
            tell application "Terminal"
                set newTab to do script "{banner} && '{escaped_claude_path}'"
                delay 0.5
                activate
                set custom title of newTab to "{tab_marker}"
            end tell
        end if

        delay 4

        tell application "System Events"
            tell process "Terminal"
                keystroke "/login"
                keystroke return
            end tell
        end tell
    "#, banner = banner, escaped_claude_path = escaped_claude_path, tab_marker = tab_marker);

    let result = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new("osascript")
            .args(["-e", &apple_script])
            .output()
    )
    .await;

    let _auto_type_worked = match result {
        Ok(Ok(output)) if output.status.success() => {
            // Auto-type worked
            let _ = window.emit(
                "install-stream",
                InstallEvent::ActionRequired {
                    action: "browser_auth".to_string(),
                    message: "Sign in with your Claude account in the browser".to_string(),
                },
            );
            true
        }
        _ => {
            // Auto-type failed (likely Accessibility permissions)
            // Just open Terminal with Claude started, user needs to type /login manually
            let fallback_banner = r#"clear && echo '' && echo '╔═══════════════════════════════════════════════╗' && echo '║         CLAUDE SIGN-IN                        ║' && echo '╠═══════════════════════════════════════════════╣' && echo '║                                               ║' && echo '║  1. Type /login and press ENTER              ║' && echo '║  2. Press ENTER (Claude account selected)    ║' && echo '║  3. Sign in and approve in browser           ║' && echo '║  4. Close this window when done              ║' && echo '║                                               ║' && echo '╚═══════════════════════════════════════════════╝' && echo ''"#;

            let fallback_script = format!(r#"
                -- Check if Terminal is already running BEFORE entering tell block
                set terminalWasRunning to application "Terminal" is running

                if terminalWasRunning then
                    tell application "Terminal"
                        activate
                        if (count of windows) > 0 then
                            tell front window
                                set newTab to do script "{fallback_banner} && '{escaped_claude_path}'"
                            end tell
                        else
                            set newTab to do script "{fallback_banner} && '{escaped_claude_path}'"
                        end if
                        set custom title of newTab to "{tab_marker}"
                    end tell
                else
                    tell application "Terminal"
                        set newTab to do script "{fallback_banner} && '{escaped_claude_path}'"
                        delay 0.5
                        activate
                        set custom title of newTab to "{tab_marker}"
                    end tell
                end if
            "#, fallback_banner = fallback_banner, escaped_claude_path = escaped_claude_path, tab_marker = tab_marker);
            let _ = tokio::process::Command::new("osascript")
                .args(["-e", &fallback_script])
                .output()
                .await;

            let _ = window.emit(
                "install-stream",
                InstallEvent::ActionRequired {
                    action: "manual_login".to_string(),
                    message: "In Terminal: type /login then press Enter".to_string(),
                },
            );
            false
        }
    };

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Waiting for sign-in to complete...".to_string(),
        },
    );

    // Poll for authentication completion (auto-detect when done)
    let max_attempts = 150; // 5 minutes at 2 seconds each
    for attempt in 0..max_attempts {
        tokio::time::sleep(Duration::from_secs(2)).await;

        if is_claude_authenticated(&home) {
            // Success! Try to close the Terminal tab we opened
            // Strategy: Find our tab by custom title OR by looking for tabs running claude,
            // then gracefully exit Claude and close the tab/window
            let close_script = format!(r#"
                tell application "Terminal"
                    set targetTab to missing value
                    set targetWindow to missing value

                    -- First, try to find by our custom title marker
                    repeat with w in windows
                        repeat with t in tabs of w
                            try
                                if custom title of t is "{tab_marker}" then
                                    set targetTab to t
                                    set targetWindow to w
                                    exit repeat
                                end if
                            end try
                        end repeat
                        if targetTab is not missing value then exit repeat
                    end repeat

                    -- If not found by title, look for any tab with "claude" in history/contents
                    if targetTab is missing value then
                        repeat with w in windows
                            repeat with t in tabs of w
                                try
                                    set tabProcs to processes of t
                                    repeat with p in tabProcs
                                        if p contains "claude" then
                                            set targetTab to t
                                            set targetWindow to w
                                            exit repeat
                                        end if
                                    end repeat
                                end try
                                if targetTab is not missing value then exit repeat
                            end repeat
                            if targetTab is not missing value then exit repeat
                        end repeat
                    end if

                    -- If we found the tab, close it
                    if targetTab is not missing value then
                        -- Type /exit to gracefully quit Claude CLI (works without Accessibility)
                        -- This is more reliable than Ctrl+C which needs System Events permission
                        do script "/exit" in targetTab
                        delay 1.5

                        -- Now close the window (or tab if multiple tabs)
                        -- Use "saving no" to skip the "are you sure?" confirmation dialog
                        set tabCount to count of tabs of targetWindow
                        if tabCount is 1 then
                            close targetWindow saving no
                        else
                            close targetTab saving no
                        end if
                    end if
                end tell
            "#, tab_marker = tab_marker);

            // Try to close Terminal - don't error if it fails (user might have closed it)
            let _ = tokio::process::Command::new("osascript")
                .args(["-e", &close_script])
                .output()
                .await;

            // Small delay to let Terminal close
            tokio::time::sleep(Duration::from_millis(300)).await;

            // Bring our app back to front using bundle identifier (works in dev and prod)
            let activate_script = r#"
                tell application id "com.freqlab.desktop" to activate
            "#;

            let _ = tokio::process::Command::new("osascript")
                .args(["-e", activate_script])
                .output()
                .await;

            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Sign-in successful!".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }

        // Update user periodically
        if attempt > 0 && attempt % 15 == 0 {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Still waiting for sign-in...".to_string(),
                },
            );
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Sign-in timed out. Click Recheck after signing in.".to_string(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err("Sign-in timed out".to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn start_claude_auth(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_auth".to_string(),
        },
    );

    let msg = "Claude auth automation is macOS-only. Run `claude /login` in a terminal.";
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output { line: msg.to_string() },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err(msg.to_string())
}

/// Find the Claude binary in known locations and verify it works
fn find_claude_binary() -> Option<String> {
    let home = user_home_dir();
    let mut possible_paths = vec![
        format!("{}/.claude/bin/claude", home),
        format!("{}/.local/bin/claude", home),
        "/usr/local/bin/claude".to_string(),
    ];

    #[cfg(target_os = "windows")]
    {
        possible_paths.push(format!("{}\\.claude\\bin\\claude.exe", home));
        possible_paths.push(format!("{}\\.local\\bin\\claude.exe", home));
    }

    for path in possible_paths {
        if std::path::Path::new(&path).exists() {
            // Verify the binary actually runs
            if run_command_with_timeout(&path, &["--version"], 5)
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }

    // Try PATH lookup as fallback
    if let Some(path) = lookup_command_path("claude") {
        if run_command_with_timeout(&path, &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(path);
        }
    }

    None
}

/// Check if Claude is authenticated by looking for keychain credentials
/// Claude stores auth tokens in macOS keychain under "Claude Code-credentials"
fn is_claude_authenticated(home: &str) -> bool {
    // Primary check: Look for Claude credentials in macOS keychain
    // This is the most reliable indicator since Claude stores OAuth tokens here
    if let Some(output) = run_command_with_timeout(
        "security",
        &["find-generic-password", "-s", "Claude Code-credentials"],
        3,
    ) {
        if output.status.success() {
            return true;
        }
    }

    // Fallback to file-based checks for edge cases
    check_auth_files(home)
}

/// Fallback file-based authentication check
fn check_auth_files(home: &str) -> bool {
    let claude_dir = std::path::Path::new(home).join(".claude");

    let credentials_file = claude_dir.join("credentials.json");
    let projects_dir = claude_dir.join("projects");
    let settings_file = claude_dir.join("settings.json");

    // If credentials.json exists, that's definitive
    if credentials_file.exists() {
        return true;
    }

    // If projects/ directory exists, user has used Claude successfully
    if projects_dir.exists() {
        return true;
    }

    // Check if settings has substantial content (not just our bootstrap)
    if settings_file.exists() {
        if let Ok(contents) = std::fs::read_to_string(&settings_file) {
            if contents.len() > 50
                || contents.contains("autoUpdaterStatus")
                || contents.contains("apiKey")
                || contents.contains("theme")
            {
                return true;
            }
        }
    }

    false
}

/// Helper to stream stdout/stderr and wait for process completion
/// Returns true if process succeeded, false otherwise
/// Includes a 10-minute timeout to prevent indefinite hangs
/// Tracks child PID for cleanup on app exit
async fn stream_and_wait(child: &mut tokio::process::Child, window: &tauri::Window) -> bool {
    // Track the child PID for cleanup on app exit
    let pid = child.id();
    if let Some(pid) = pid {
        register_child_pid(pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Spawn tasks to stream output
    let stdout_task = if let Some(stdout) = stdout {
        let mut reader = BufReader::new(stdout).lines();
        let window_clone = window.clone();
        Some(tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = window_clone.emit("install-stream", InstallEvent::Output { line });
            }
        }))
    } else {
        None
    };

    let stderr_task = if let Some(stderr) = stderr {
        let mut reader = BufReader::new(stderr).lines();
        let window_clone = window.clone();
        Some(tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = window_clone.emit("install-stream", InstallEvent::Output { line });
            }
        }))
    } else {
        None
    };

    // Wait for process to complete with 10-minute timeout
    let status = tokio::time::timeout(
        Duration::from_secs(600),
        child.wait()
    ).await;

    // Kill the process if it timed out
    let success = match status {
        Ok(Ok(exit_status)) => exit_status.success(),
        Ok(Err(_)) => false, // wait() failed
        Err(_) => {
            // Timeout - kill the process
            let _ = child.kill().await;
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "Process timed out after 10 minutes".to_string(),
            });
            false
        }
    };

    // Unregister the PID now that process has completed
    if let Some(pid) = pid {
        unregister_child_pid(pid);
    }

    // Wait for streaming tasks to finish (they'll complete when pipes close)
    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    success
}

// ============================================================================
// Permission Management
// ============================================================================

/// Status of system permissions needed for installation
#[derive(Serialize, Clone)]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub admin_primed: bool,
}

/// Check if we have Accessibility permission
/// Uses AXIsProcessTrusted via FFI
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn check_permissions() -> PermissionStatus {
    tokio::task::spawn_blocking(|| {
        // Check accessibility using macOS API
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }

        let accessibility = unsafe { AXIsProcessTrusted() };

        PermissionStatus {
            accessibility,
            admin_primed: false, // Can't check this - it's session-based
        }
    })
    .await
    .unwrap_or(PermissionStatus {
        accessibility: false,
        admin_primed: false,
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn check_permissions() -> PermissionStatus {
    PermissionStatus {
        accessibility: true,
        admin_primed: false,
    }
}

/// Request Accessibility permission using the proper macOS API
/// This triggers the system dialog AND adds the app to the Accessibility list
/// Returns true if permission was already granted, false if user needs to grant it
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn request_accessibility_permission() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        // Use AXIsProcessTrustedWithOptions with prompt flag
        // This is the CORRECT way to request accessibility - it:
        // 1. Shows a system dialog explaining the app needs accessibility
        // 2. Adds the app to the Accessibility list in System Settings
        // 3. Opens System Settings to the right place if user clicks the button

        // Opaque type for CFDictionary
        #[repr(C)]
        struct __CFDictionary {
            _private: [u8; 0],
        }
        type CFDictionaryRef = *const __CFDictionary;

        // Opaque type for CFString
        #[repr(C)]
        struct __CFString {
            _private: [u8; 0],
        }
        type CFStringRef = *const __CFString;
        type CFTypeRef = *const std::ffi::c_void;

        // CFDictionaryKeyCallBacks and CFDictionaryValueCallBacks structs
        #[repr(C)]
        struct CFDictionaryKeyCallBacks {
            version: isize,
            retain: *const std::ffi::c_void,
            release: *const std::ffi::c_void,
            copy_description: *const std::ffi::c_void,
            equal: *const std::ffi::c_void,
            hash: *const std::ffi::c_void,
        }

        #[repr(C)]
        struct CFDictionaryValueCallBacks {
            version: isize,
            retain: *const std::ffi::c_void,
            release: *const std::ffi::c_void,
            copy_description: *const std::ffi::c_void,
            equal: *const std::ffi::c_void,
        }

        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
            fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        }

        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CFDictionaryCreate(
                allocator: CFTypeRef,
                keys: *const CFTypeRef,
                values: *const CFTypeRef,
                num_values: isize,
                key_callbacks: *const CFDictionaryKeyCallBacks,
                value_callbacks: *const CFDictionaryValueCallBacks,
            ) -> CFDictionaryRef;
            fn CFRelease(cf: CFTypeRef);
            fn CFStringCreateWithCString(
                allocator: CFTypeRef,
                c_str: *const i8,
                encoding: u32,
            ) -> CFStringRef;

            static kCFBooleanTrue: CFTypeRef;
            static kCFTypeDictionaryKeyCallBacks: CFDictionaryKeyCallBacks;
            static kCFTypeDictionaryValueCallBacks: CFDictionaryValueCallBacks;
        }

        // kAXTrustedCheckOptionPrompt key - this triggers the system dialog
        const KAXTRUSTEDCHECKOPTIONPROMPT: &[u8] = b"AXTrustedCheckOptionPrompt\0";

        unsafe {
            let key = CFStringCreateWithCString(
                std::ptr::null(),
                KAXTRUSTEDCHECKOPTIONPROMPT.as_ptr() as *const i8,
                0x08000100, // kCFStringEncodingUTF8
            );

            if key.is_null() {
                // Fallback: just check without prompt
                return AXIsProcessTrusted();
            }

            let key_as_type: CFTypeRef = key as CFTypeRef;
            let keys = [key_as_type];
            let values = [kCFBooleanTrue];

            let options = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );

            let result = if !options.is_null() {
                let granted = AXIsProcessTrustedWithOptions(options);
                CFRelease(options as CFTypeRef);
                granted
            } else {
                // Fallback: just check without prompt
                AXIsProcessTrusted()
            };

            CFRelease(key as CFTypeRef);
            result
        }
    })
    .await
    .map_err(|e| format!("Failed to request accessibility: {}", e))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn request_accessibility_permission() -> Result<bool, String> {
    Ok(true)
}

/// Prime admin privileges by running a simple command with admin rights
/// This caches credentials for ~5 minutes, so subsequent admin operations won't prompt
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn prime_admin_privileges(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "admin_prime".to_string(),
        },
    );

    let _ = window.emit(
        "install-stream",
        InstallEvent::ActionRequired {
            action: "password".to_string(),
            message: "Enter your Mac password to authorize installations".to_string(),
        },
    );

    // Run a simple command with admin privileges to cache credentials
    let script = r#"do shell script "echo 'FreqLab authorized'" with administrator privileges"#;

    let result = tokio::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .await
        .map_err(|e| format!("Failed to request admin privileges: {}", e))?;

    if result.status.success() {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Admin access granted! Password cached for this session.".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        Ok(true)
    } else {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Admin access not granted. You may be prompted again during installation.".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Ok(false)
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn prime_admin_privileges(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "admin_prime".to_string(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Admin priming is not required on this platform.".to_string(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: true });
    Ok(true)
}
