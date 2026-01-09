use serde::Serialize;
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
    }
}

/// Events emitted during installation
#[derive(Serialize, Clone)]
#[serde(tag = "type")]
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
}

#[derive(Serialize, Clone)]
pub struct CheckResult {
    pub status: CheckStatus,
    pub version: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Installed,
    NotInstalled,
    NeedsConfig,
}

fn run_command_with_timeout(cmd: &str, args: &[&str], timeout_secs: u64) -> Option<std::process::Output> {
    use std::process::Stdio;

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

fn check_xcode() -> CheckResult {
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
    // Use --help instead of --version as it's faster and doesn't require auth
    match run_command_with_timeout("which", &["claude"], 3) {
        Some(output) if output.status.success() => {
            CheckResult {
                status: CheckStatus::Installed,
                version: Some("Installed".to_string()),
                message: None,
            }
        }
        _ => CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Run: npm install -g @anthropic-ai/claude-code".to_string()),
        },
    }
}

fn check_claude_auth() -> CheckResult {
    // First check if claude is installed using 'which'
    let cli_check = run_command_with_timeout("which", &["claude"], 3);
    if cli_check.is_none() || !cli_check.as_ref().unwrap().status.success() {
        return CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install Claude CLI first".to_string()),
        };
    }

    // Check auth by looking for ~/.claude directory and trying a simple command
    // Claude stores auth in macOS keychain, but the ~/.claude directory indicates
    // the CLI has been configured
    let home = std::env::var("HOME").unwrap_or_default();
    let claude_dir = std::path::Path::new(&home).join(".claude");

    // Multiple indicators that Claude has been set up:
    // 1. ~/.claude directory exists
    // 2. ~/.claude/settings.json exists (created after first run)
    // 3. ~/.claude/projects/ directory exists (created after first use with a project)
    let settings_file = claude_dir.join("settings.json");
    let projects_dir = claude_dir.join("projects");
    let credentials_file = claude_dir.join("credentials.json"); // Some versions use this

    let has_settings = settings_file.exists();
    let has_projects = projects_dir.exists();
    let has_credentials = credentials_file.exists();
    let has_claude_dir = claude_dir.exists();

    if has_settings || has_credentials {
        // Strong indicator: has config files
        CheckResult {
            status: CheckStatus::Installed,
            version: None,
            message: Some("Authenticated".to_string()),
        }
    } else if has_claude_dir && has_projects {
        // Medium indicator: has been used with projects
        CheckResult {
            status: CheckStatus::Installed,
            version: None,
            message: Some("Configured".to_string()),
        }
    } else if has_claude_dir {
        // Weak indicator: directory exists but may not be fully configured
        // This could happen if CLI was installed but never logged in
        CheckResult {
            status: CheckStatus::NeedsConfig,
            version: None,
            message: Some("Sign-in may be required".to_string()),
        }
    } else {
        // No indicators at all
        CheckResult {
            status: CheckStatus::NeedsConfig,
            version: None,
            message: Some("Run: claude login".to_string()),
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
    })
}

// ============================================================================
// Installation Commands
// ============================================================================

/// Check if Homebrew is installed
#[tauri::command]
pub async fn check_homebrew() -> bool {
    tokio::task::spawn_blocking(|| {
        run_command_with_timeout("brew", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Check if Node.js is installed
#[tauri::command]
pub async fn check_node() -> bool {
    tokio::task::spawn_blocking(|| {
        run_command_with_timeout("node", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Install Homebrew (may require admin password via native macOS dialog)
#[tauri::command]
pub async fn install_homebrew(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "homebrew".to_string(),
        },
    );

    // Check if already installed
    if let Some(output) = run_command_with_timeout("brew", &["--version"], 5) {
        if output.status.success() {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Homebrew is already installed.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Downloading Homebrew installer...".to_string(),
        },
    );

    // First try non-interactive install (works if /opt/homebrew is writable)
    // NONINTERACTIVE must be set in the script itself for proper propagation
    let install_script = r#"NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)""#;

    let mut child = tokio::process::Command::new("/bin/bash")
        .args(["-c", install_script])
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start Homebrew installer: {}", e))?;

    // Stream and wait for output properly
    let success = stream_and_wait(&mut child, &window).await;

    if success {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Homebrew installed successfully!".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        return Ok(true);
    }

    // If non-interactive failed, try with admin privileges using osascript
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installation requires administrator privileges...".to_string(),
        },
    );

    let _ = window.emit(
        "install-stream",
        InstallEvent::ActionRequired {
            action: "admin_password".to_string(),
            message: "Enter your password in the system dialog to continue".to_string(),
        },
    );

    // NONINTERACTIVE must be inside the shell script for osascript
    // Add timeout to prevent indefinite hang if user doesn't respond to password dialog
    let admin_script = r#"
        do shell script "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" with administrator privileges
    "#;

    let admin_result = tokio::time::timeout(
        Duration::from_secs(600), // 10 minute timeout for password dialog + install
        tokio::process::Command::new("osascript")
            .args(["-e", admin_script])
            .output()
    )
    .await
    .map_err(|_| {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Password dialog timed out. Click Install to try again.".to_string(),
            },
        );
        "Password dialog timed out".to_string()
    })?
    .map_err(|e| format!("Failed to run with admin privileges: {}", e))?;

    let success = admin_result.status.success();

    // Stream any output from admin install
    let stdout = String::from_utf8_lossy(&admin_result.stdout);
    let stderr = String::from_utf8_lossy(&admin_result.stderr);
    for line in stdout.lines().chain(stderr.lines()) {
        if !line.is_empty() {
            let _ = window.emit("install-stream", InstallEvent::Output { line: line.to_string() });
        }
    }

    if success {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Homebrew installed successfully!".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        return Ok(true);
    }

    // Parse error and provide user-friendly message
    let error = stderr.to_string();
    let user_message = if error.contains("User cancelled") || error.contains("user canceled") {
        "Installation cancelled. Click Install again when ready.".to_string()
    } else if error.contains("not authorized") || error.contains("Operation not permitted") {
        "Administrator access denied. Please try again with your admin password.".to_string()
    } else if error.contains("Network") || error.contains("curl") || error.contains("Could not resolve") {
        "Network error. Please check your internet connection and try again.".to_string()
    } else if error.is_empty() {
        "Installation failed. Please try again or use manual installation.".to_string()
    } else {
        format!("Installation failed: {}", error.lines().next().unwrap_or(&error))
    };

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: user_message.clone(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Error {
            message: user_message.clone(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });

    Err(user_message)
}

/// Install Node.js via Homebrew
#[tauri::command]
pub async fn install_node(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "node".to_string(),
        },
    );

    // Check if already installed
    if let Some(output) = run_command_with_timeout("node", &["--version"], 5) {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: format!("Node.js {} is already installed.", version),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installing Node.js via Homebrew...".to_string(),
        },
    );

    let mut child = tokio::process::Command::new("brew")
        .args(["install", "node"])
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start brew install: {}", e))?;

    let success = stream_and_wait(&mut child, &window).await;

    if success {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Node.js installed successfully!".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        Ok(true)
    } else {
        let msg = "Failed to install Node.js. Check your internet connection and try again.";
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output { line: msg.to_string() },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err(msg.to_string())
    }
}

/// Install Xcode Command Line Tools (triggers system dialog)
/// Polls for completion by checking xcode-select -p periodically
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
                    line: "Xcode Command Line Tools already installed.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    // Trigger the install dialog
    let _ = window.emit(
        "install-stream",
        InstallEvent::ActionRequired {
            action: "xcode_dialog".to_string(),
            message: "Click 'Install' in the system dialog (check behind other windows)".to_string(),
        },
    );

    let result = tokio::process::Command::new("xcode-select")
        .args(["--install"])
        .output()
        .await
        .map_err(|e| format!("Failed to trigger Xcode install: {}", e))?;

    // Check if already installed (xcode-select --install returns error if so)
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        if stderr.contains("already installed") {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Xcode Command Line Tools already installed.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Waiting for installation to complete...".to_string(),
        },
    );

    // Poll for completion - check every 3 seconds for up to 30 minutes
    // Xcode CLT installation can take a while on slow connections
    let max_attempts = 600; // 30 minutes at 3 seconds per check
    for attempt in 0..max_attempts {
        tokio::time::sleep(Duration::from_secs(3)).await;

        // Check if xcode-select -p now succeeds
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

        // Emit progress every 30 seconds
        if attempt > 0 && attempt % 10 == 0 {
            let minutes = (attempt * 3) / 60;
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: format!("Still waiting... ({} min elapsed)", minutes),
                },
            );
        }
    }

    // Timeout after 30 minutes - provide helpful fallback
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installation timed out. The system dialog may be stuck.".to_string(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Try these fixes:".to_string(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "1. Check System Settings > Software Update for pending installs".to_string(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "2. Download directly from: https://developer.apple.com/download/more/".to_string(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "   (Search for 'Command Line Tools' and install manually)".to_string(),
        },
    );
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "3. Or run in Terminal: sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install".to_string(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });

    Err("Xcode Command Line Tools installation timed out - see instructions above".to_string())
}

/// Install Rust via rustup (non-interactive)
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
            // Installed but not in PATH - need full computer restart for PATH to update
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "✓ Rust installed! But it's not detected yet.".to_string(),
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
                    line: "To fix, try in order:".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "1. Close and reopen this app, click Recheck".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "2. If still not working, RESTART YOUR COMPUTER".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "   (A simple app restart won't update system paths)".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            Err("Rust installed but requires app/computer restart to be detected".to_string())
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

/// Install Claude CLI via npm
#[tauri::command]
pub async fn install_claude_cli(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_cli".to_string(),
        },
    );

    // Check if already installed
    if let Some(output) = run_command_with_timeout("which", &["claude"], 3) {
        if output.status.success() {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Claude Code CLI is already installed.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    // Check if npm is available
    if !run_command_with_timeout("which", &["npm"], 3)
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        let msg = "npm not found. Please install Node.js first.";
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output { line: msg.to_string() },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        return Err(msg.to_string());
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installing Claude Code CLI via npm...".to_string(),
        },
    );

    let mut child = tokio::process::Command::new("npm")
        .args(["install", "-g", "@anthropic-ai/claude-code"])
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start npm install: {}", e))?;

    let success = stream_and_wait(&mut child, &window).await;

    if success {
        // Verify Claude CLI is actually accessible
        tokio::time::sleep(Duration::from_millis(500)).await;
        if run_command_with_timeout("which", &["claude"], 3)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Claude Code CLI installed successfully!".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            Ok(true)
        } else {
            // Installed but not in PATH - need restart for PATH to update
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "✓ Claude CLI installed! But it's not detected yet.".to_string(),
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
                    line: "To fix, try in order:".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "1. Close and reopen this app, click Recheck".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "2. If still not working, RESTART YOUR COMPUTER".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "   (A simple app restart won't update system paths)".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            Err("Claude CLI installed but requires app/computer restart to be detected".to_string())
        }
    } else {
        // Provide helpful fix for npm permissions without suggesting sudo
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "❌ Installation failed - likely a permissions issue".to_string(),
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
                line: "Option 1 - Fix npm permissions (recommended):".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  Open Terminal and run:".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  mkdir -p ~/.npm-global".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  npm config set prefix ~/.npm-global".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  Then restart this app and try again.".to_string(),
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
                line: "Option 2 - Use Node Version Manager (nvm):".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  This avoids permission issues entirely.".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "  Visit: https://github.com/nvm-sh/nvm".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err("Failed to install Claude CLI - npm permissions issue".to_string())
    }
}

/// Start Claude authentication by opening Terminal
/// Claude Code's auth flow is interactive and requires a proper terminal
#[tauri::command]
pub async fn start_claude_auth(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_auth".to_string(),
        },
    );

    // Check if Claude CLI is installed first
    if !run_command_with_timeout("which", &["claude"], 3)
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        let msg = "Claude CLI not found. Please install it first.";
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output { line: msg.to_string() },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        return Err(msg.to_string());
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Opening Terminal for authentication...".to_string(),
        },
    );

    let _ = window.emit(
        "install-stream",
        InstallEvent::ActionRequired {
            action: "browser_auth".to_string(),
            message: "Complete sign-in in the browser window that opens".to_string(),
        },
    );

    // Open Terminal.app with claude command and auto-type /login after delay
    // Uses AppleScript keystroke to simulate typing - works with interactive programs
    // Note: 8 second delay to allow Claude to fully initialize (especially on first run)
    let apple_script = r#"
        tell application "Terminal"
            activate
            do script "echo '=== Claude Authentication ===' && echo '' && echo 'Starting Claude... login will begin automatically.' && echo 'Complete sign-in in your browser when it opens.' && echo '' && echo 'After signing in, close this window and click Recheck.' && echo '' && claude"
        end tell

        -- Wait for Claude to initialize (longer delay for first run or slower machines)
        delay 8

        -- Auto-type /login and press Enter
        tell application "System Events"
            tell process "Terminal"
                keystroke "/login"
                keystroke return
            end tell
        end tell
    "#;

    // 30 second timeout - script should complete in ~10 seconds normally
    let result = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new("osascript")
            .args(["-e", apple_script])
            .output()
    )
    .await
    .map_err(|_| {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Authentication script timed out. Please try again.".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        "Authentication script timed out".to_string()
    })?
    .map_err(|e| format!("Failed to open Terminal: {}", e))?;

    if result.status.success() {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Browser should open for sign-in. Complete authentication there.".to_string(),
            },
        );
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "After signing in, close Terminal and click Recheck.".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        // Check if it's an accessibility permission issue
        if stderr.contains("not allowed") || stderr.contains("assistive") || stderr.contains("1002") {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "⚠️ Accessibility permission required for auto-login".to_string(),
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
                    line: "To fix: System Settings → Privacy & Security → Accessibility".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Add 'Terminal' to the list (click + button)".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "If already added, try toggling it off then on again".to_string(),
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
                    line: "Alternative: Open Terminal manually and run:".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "  claude".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "  /login".to_string(),
                },
            );
        } else {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Could not auto-start login. Please do it manually:".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "1. Open Terminal app".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "2. Type: claude".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "3. Once Claude starts, type: /login".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "4. Complete sign-in in browser".to_string(),
                },
            );
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "5. Return here and click Recheck".to_string(),
                },
            );
        }
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err("Authentication setup failed - see instructions above".to_string())
    }
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
