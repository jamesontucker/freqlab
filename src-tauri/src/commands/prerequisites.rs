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
            #[cfg(unix)]
            {
                // Send SIGTERM first, then SIGKILL
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                std::thread::sleep(Duration::from_millis(100));
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }

            #[cfg(windows)]
            {
                // On Windows, use TerminateProcess via the standard library
                // std::process::Child::kill() uses TerminateProcess internally,
                // but we only have PIDs here, so we use a simple taskkill command
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
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
    pub cmake: CheckResult,
    pub claude_cli: CheckResult,
    pub claude_auth: CheckResult,
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

/// Get the platform-appropriate command for locating binaries on PATH
fn which_cmd() -> &'static str {
    if cfg!(windows) { "where" } else { "which" }
}

/// Check if Visual Studio Build Tools with C++ workload are installed (Windows only).
/// Returns the display name if found, None otherwise.
#[cfg(target_os = "windows")]
fn find_vs_build_tools() -> Option<String> {
    let vswhere_path = format!(
        r"{}\Microsoft Visual Studio\Installer\vswhere.exe",
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string())
    );

    if !std::path::Path::new(&vswhere_path).exists() {
        return None;
    }

    let output = run_command_with_timeout(
        &vswhere_path,
        &["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "displayName"],
        10,
    )?;

    if output.status.success() {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }
    None
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

/// Check for build tools: Xcode CLI on macOS, Visual Studio Build Tools on Windows
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

    #[cfg(target_os = "windows")]
    {
        // Check for Visual Studio Build Tools using vswhere.exe
        if let Some(name) = find_vs_build_tools() {
            return CheckResult {
                status: CheckStatus::Installed,
                version: Some(name),
                message: None,
            };
        }

        // Fallback: check if cl.exe is accessible
        if run_command_with_timeout("where", &["cl.exe"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return CheckResult {
                status: CheckStatus::Installed,
                version: Some("MSVC compiler found".to_string()),
                message: None,
            };
        }

        CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install Visual Studio Build Tools with C++ workload".to_string()),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux: check for gcc or clang
        if run_command_with_timeout("gcc", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return CheckResult {
                status: CheckStatus::Installed,
                version: Some("GCC installed".to_string()),
                message: None,
            };
        }
        if run_command_with_timeout("clang", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return CheckResult {
                status: CheckStatus::Installed,
                version: Some("Clang installed".to_string()),
                message: None,
            };
        }
        CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install build-essential or equivalent".to_string()),
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

fn check_cmake() -> CheckResult {
    match run_command_with_timeout("cmake", &["--version"], 5) {
        Some(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("installed")
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
            message: Some("Required for JUCE/iPlug2 frameworks".to_string()),
        },
    }
}

fn check_claude_cli() -> CheckResult {
    // Use platform-appropriate command to find claude binary
    match run_command_with_timeout(which_cmd(), &["claude"], 3) {
        Some(output) if output.status.success() => {
            CheckResult {
                status: CheckStatus::Installed,
                version: Some("Installed".to_string()),
                message: None,
            }
        }
        _ => {
            let install_hint = if cfg!(windows) {
                "Download from https://claude.ai/download".to_string()
            } else {
                "Run: curl -fsSL https://claude.ai/install.sh | bash".to_string()
            };
            CheckResult {
                status: CheckStatus::NotInstalled,
                version: None,
                message: Some(install_hint),
            }
        }
    }
}

fn check_claude_auth() -> CheckResult {
    // First check if claude is installed
    let cli_check = run_command_with_timeout(which_cmd(), &["claude"], 3);
    if cli_check.is_none() || !cli_check.as_ref().unwrap().status.success() {
        return CheckResult {
            status: CheckStatus::NotInstalled,
            version: None,
            message: Some("Install Claude CLI first".to_string()),
        };
    }

    let home = super::get_home_dir();

    // Platform-specific credential store check
    #[cfg(target_os = "macos")]
    {
        // Primary check: Look for Claude credentials in macOS keychain
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

    // Windows: Claude stores credentials in Windows Credential Manager,
    // but checking it requires the wincred crate or cmdkey.exe.
    // We rely on file-based checks which work cross-platform.
    #[cfg(target_os = "windows")]
    {
        // Try cmdkey to check for Claude credentials
        if let Some(output) = run_command_with_timeout(
            "cmdkey",
            &["/list:Claude*"],
            3,
        ) {
            let text = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && text.contains("Claude") {
                return CheckResult {
                    status: CheckStatus::Installed,
                    version: None,
                    message: Some("Authenticated".to_string()),
                };
            }
        }
    }

    // Fallback to file-based checks (works on all platforms)
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
            cmake: check_cmake(),
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
        cmake: CheckResult {
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

/// Check available disk space and calculate requirements
#[tauri::command]
pub async fn check_disk_space() -> Result<DiskSpaceInfo, String> {
    tokio::task::spawn_blocking(|| {
        let available_gb = get_available_disk_space_gb()?;

        // Calculate requirements based on what's missing
        let build_tools_needed = check_xcode().status != CheckStatus::Installed;
        let rust_needed = check_rust().status != CheckStatus::Installed;
        let claude_cli_needed = check_claude_cli().status != CheckStatus::Installed;

        // Build tools: Xcode CLI ~4GB on macOS, VS Build Tools ~6GB on Windows
        let build_tools_gb = if build_tools_needed {
            if cfg!(target_os = "macos") { 4.0 } else { 6.0 }
        } else {
            0.0
        };
        // Rust toolchain: ~1.5 GB
        let rust_gb = if rust_needed { 1.5 } else { 0.0 };
        // Claude Code native binary: ~100 MB
        let claude_cli_gb = if claude_cli_needed { 0.1 } else { 0.0 };

        let total = build_tools_gb + rust_gb + claude_cli_gb;
        let required_with_buffer = total + 2.0;

        Ok(DiskSpaceInfo {
            available_gb,
            required_gb: required_with_buffer,
            sufficient: available_gb >= required_with_buffer,
            breakdown: DiskSpaceBreakdown {
                xcode_gb: build_tools_gb,
                rust_gb,
                claude_cli_gb,
                total_required_gb: total,
            },
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Get available disk space in GB (platform-specific)
fn get_available_disk_space_gb() -> Result<f64, String> {
    #[cfg(unix)]
    {
        let path = std::ffi::CString::new("/").unwrap();
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let result = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
        if result != 0 {
            return Err("Failed to check disk space".to_string());
        }
        let available_bytes = stat.f_bavail as u64 * stat.f_frsize as u64;
        Ok(available_bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }

    #[cfg(windows)]
    {
        // Use wmic or PowerShell to get free disk space
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", "(Get-PSDrive C).Free"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to check disk space: {}", e))?;

        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Ok(bytes) = text.parse::<u64>() {
                return Ok(bytes as f64 / (1024.0 * 1024.0 * 1024.0));
            }
        }
        Err("Failed to check disk space".to_string())
    }
}

// ============================================================================
// Installation Commands
// ============================================================================

/// Install build tools: Xcode CLI on macOS, Visual Studio Build Tools on Windows
#[tauri::command]
pub async fn install_xcode(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "xcode".to_string(),
        },
    );

    #[cfg(target_os = "windows")]
    {
        return install_build_tools_windows(window).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
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
    } // #[cfg(not(target_os = "windows"))]
}

/// Install Visual Studio Build Tools on Windows (silent/unattended)
#[cfg(target_os = "windows")]
async fn install_build_tools_windows(window: tauri::Window) -> Result<bool, String> {
    // Check if already installed via vswhere
    if let Some(name) = find_vs_build_tools() {
        let _ = window.emit("install-stream", InstallEvent::Output {
            line: format!("Already installed: {}", name),
        });
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        return Ok(true);
    }

    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Downloading Visual Studio Build Tools installer...".to_string(),
    });

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("vs_BuildTools.exe");
    let download_url = "https://aka.ms/vs/17/release/vs_BuildTools.exe";

    // Download the installer using PowerShell
    let download_cmd = format!(
        "Invoke-WebRequest -Uri '{}' -OutFile '{}'",
        download_url,
        installer_path.to_str().unwrap_or_default()
    );

    let mut child = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &download_cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to download installer: {}", e))?;

    if !stream_and_wait(&mut child, &window).await {
        let _ = window.emit("install-stream", InstallEvent::Output {
            line: "Failed to download Build Tools installer.".to_string(),
        });
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        return Err("Download failed".to_string());
    }

    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Installing Visual Studio Build Tools (this may take several minutes)...".to_string(),
    });
    let _ = window.emit("install-stream", InstallEvent::ActionRequired {
        action: "uac".to_string(),
        message: "Click 'Yes' on the Windows security prompt to allow installation".to_string(),
    });

    // Run the installer silently with the C++ workload
    // --quiet: no UI, --wait: block until done, --norestart: don't reboot
    let mut child = tokio::process::Command::new(installer_path.to_str().unwrap_or_default())
        .args([
            "--quiet", "--wait", "--norestart",
            "--add", "Microsoft.VisualStudio.Workload.VCTools",
            "--includeRecommended",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    let success = stream_and_wait(&mut child, &window).await;

    // Clean up installer
    let _ = std::fs::remove_file(&installer_path);

    if success {
        let _ = window.emit("install-stream", InstallEvent::Output {
            line: "Visual Studio Build Tools installed successfully!".to_string(),
        });
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        Ok(true)
    } else {
        let _ = window.emit("install-stream", InstallEvent::Output {
            line: "Build Tools installation failed. You may need to install manually from https://visualstudio.microsoft.com/visual-cpp-build-tools/".to_string(),
        });
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err("Installation failed".to_string())
    }
}

/// Fallback to GUI-based Xcode CLT installer
#[cfg(not(target_os = "windows"))]
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

    #[cfg(unix)]
    let mut child = {
        // Use -y for non-interactive
        let install_script = r#"curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"#;
        tokio::process::Command::new("/bin/bash")
            .args(["-c", install_script])
            .env("PATH", super::get_extended_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start Rust installer: {}", e))?
    };

    #[cfg(windows)]
    let mut child = {
        // Download rustup-init.exe and run it silently
        let temp_dir = std::env::temp_dir();
        let rustup_path = temp_dir.join("rustup-init.exe");
        let download_cmd = format!(
            "Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '{}'",
            rustup_path.to_str().unwrap_or_default()
        );
        // Download first
        let dl = tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &download_cmd])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to download rustup: {}", e))?;
        let mut dl = dl;
        if !stream_and_wait(&mut dl, &window).await {
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            return Err("Failed to download rustup-init.exe".to_string());
        }
        // Run rustup-init.exe silently
        tokio::process::Command::new(rustup_path.to_str().unwrap_or_default())
            .args(["-y", "--default-toolchain", "stable", "--profile", "default"])
            .env("PATH", super::get_extended_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start Rust installer: {}", e))?
    };

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

/// Install Claude CLI via native installer (no Node.js required!)
#[tauri::command]
pub async fn install_claude_cli(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "claude_cli".to_string(),
        },
    );

    // Check if already installed
    if let Some(output) = run_command_with_timeout(which_cmd(), &["claude"], 3) {
        if output.status.success() {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Claude Code is already installed.".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Downloading Claude Code...".to_string(),
        },
    );

    #[cfg(unix)]
    let mut child = {
        // Use the native installer - no Node.js required!
        let install_script = "curl -fsSL https://claude.ai/install.sh | bash";
        tokio::process::Command::new("/bin/bash")
            .args(["-c", install_script])
            .env("PATH", super::get_extended_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?
    };

    #[cfg(windows)]
    let mut child = {
        // Download and run the Windows installer via PowerShell
        let install_script = r#"
            $ErrorActionPreference = 'Stop'
            $installerUrl = 'https://claude.ai/install.ps1'
            try {
                Invoke-Expression (Invoke-WebRequest -Uri $installerUrl -UseBasicParsing).Content
            } catch {
                Write-Error "Failed to install Claude Code: $_"
                exit 1
            }
        "#;
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", install_script])
            .env("PATH", super::get_extended_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?
    };

    let success = stream_and_wait(&mut child, &window).await;

    if success {
        // Verify Claude CLI is accessible and actually works
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Use find_claude_binary() for platform-aware path resolution and verification
        if find_claude_binary().is_some() {
            // Pre-create config files to skip interactive onboarding wizard
            ensure_claude_config(&super::get_home_dir());

            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Claude Code installed successfully!".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            Ok(true)
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
        if cfg!(windows) {
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "1. Visit https://claude.ai/download".to_string(),
            });
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "2. Download and run the Windows installer".to_string(),
            });
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "3. Come back here and click Recheck".to_string(),
            });
        } else {
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "1. Open Terminal".to_string(),
            });
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "2. Run: curl -fsSL https://claude.ai/install.sh | bash".to_string(),
            });
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "3. Come back here and click Recheck".to_string(),
            });
        }
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        Err("Failed to install Claude Code".to_string())
    }
}

/// Start Claude authentication - opens a terminal with login instructions
/// macOS: Opens Terminal.app with auto-typed /login command
/// Windows: Opens cmd.exe with claude /login
/// Claude requires a real TTY for /login
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
    let home = super::get_home_dir();
    ensure_claude_config(&home);

    // Platform-specific terminal opening for Claude auth
    #[cfg(target_os = "windows")]
    {
        return start_claude_auth_windows(window, claude_path, home).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
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
    } // #[cfg(not(target_os = "windows"))]
}

/// Windows-specific Claude auth flow: opens cmd.exe with claude login
#[cfg(target_os = "windows")]
async fn start_claude_auth_windows(
    window: tauri::Window,
    claude_path: String,
    home: String,
) -> Result<bool, String> {
    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Opening command prompt for sign-in...".to_string(),
    });

    // Write a temporary batch file to avoid nested cmd.exe quoting issues
    // (paths with spaces in usernames can break inline cmd /K "..." quoting)
    let temp_dir = std::env::temp_dir();
    let bat_path = temp_dir.join("freqlab_claude_signin.bat");
    let bat_content = format!(
        "@echo off\r\necho.\r\necho ======================================\r\necho    CLAUDE SIGN-IN\r\necho ======================================\r\necho.\r\necho  1. Wait for login method prompt\r\necho  2. Press ENTER (Claude account)\r\necho  3. Sign in and approve in browser\r\necho  4. Close this window when done\r\necho.\r\necho ======================================\r\necho.\r\n\"{}\"",
        claude_path
    );
    std::fs::write(&bat_path, &bat_content)
        .map_err(|e| format!("Failed to write temp batch file: {}", e))?;

    let _ = tokio::process::Command::new("cmd")
        .args(["/C", &format!("start \"FreqLab Claude Sign-In\" cmd /K \"{}\"", bat_path.display())])
        .env("PATH", super::get_extended_path())
        .spawn()
        .map_err(|e| format!("Failed to open command prompt: {}", e))?;

    // Brief delay for window to open
    tokio::time::sleep(Duration::from_secs(2)).await;

    let _ = window.emit("install-stream", InstallEvent::ActionRequired {
        action: "browser_auth".to_string(),
        message: "In the command window, type /login and press Enter, then sign in via browser".to_string(),
    });

    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Waiting for sign-in to complete...".to_string(),
    });

    // Poll for authentication completion
    let max_attempts = 150; // 5 minutes at 2 seconds each
    for attempt in 0..max_attempts {
        tokio::time::sleep(Duration::from_secs(2)).await;

        if is_claude_authenticated(&home) {
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "Sign-in successful!".to_string(),
            });
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }

        if attempt > 0 && attempt % 15 == 0 {
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "Still waiting for sign-in...".to_string(),
            });
        }
    }

    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Sign-in timed out. Click Recheck after signing in.".to_string(),
    });
    let _ = window.emit("install-stream", InstallEvent::Done { success: false });
    Err("Sign-in timed out".to_string())
}

/// Ensure Claude config files exist for non-interactive onboarding.
/// Creates `~/.claude/` dir, `~/.claude.json` with onboarding flags,
/// and `~/.claude/settings.json` with default settings if they don't exist.
fn ensure_claude_config(home: &str) {
    let claude_dir = std::path::Path::new(home).join(".claude");
    let claude_json = std::path::Path::new(home).join(".claude.json");

    if !claude_dir.exists() {
        let _ = std::fs::create_dir_all(&claude_dir);
    }

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

    let settings_file = claude_dir.join("settings.json");
    if !settings_file.exists() {
        let _ = std::fs::write(&settings_file, r#"{"model": "opus"}"#);
    }
}

/// Find the Claude binary in known locations and verify it works
fn find_claude_binary() -> Option<String> {
    let home = super::get_home_dir();

    #[cfg(unix)]
    let possible_paths = vec![
        format!("{}/.claude/bin/claude", home),
        format!("{}/.local/bin/claude", home),
        "/usr/local/bin/claude".to_string(),
    ];

    #[cfg(windows)]
    let possible_paths = vec![
        format!(r"{}\.claude\bin\claude.exe", home),
        format!(r"{}\Programs\Claude\bin\claude.exe",
            std::env::var("LOCALAPPDATA").unwrap_or_default()),
        format!(r"{}\Claude\bin\claude.exe",
            std::env::var("APPDATA").unwrap_or_default()),
    ];

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

    // Try which/where command as fallback
    if let Some(output) = run_command_with_timeout(which_cmd(), &["claude"], 3) {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                // Verify this binary works too
                if run_command_with_timeout(&path, &["--version"], 5)
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Check if Claude is authenticated by looking for credential store entries
fn is_claude_authenticated(home: &str) -> bool {
    // Platform-specific credential store check
    #[cfg(target_os = "macos")]
    {
        // Primary check: macOS keychain under "Claude Code-credentials"
        if let Some(output) = run_command_with_timeout(
            "security",
            &["find-generic-password", "-s", "Claude Code-credentials"],
            3,
        ) {
            if output.status.success() {
                return true;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Check Windows Credential Manager
        if let Some(output) = run_command_with_timeout(
            "cmdkey",
            &["/list:Claude*"],
            3,
        ) {
            let text = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && text.contains("Claude") {
                return true;
            }
        }
    }

    // Fallback to file-based checks (works on all platforms)
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
/// macOS-only: uses AXIsProcessTrusted via FFI
/// Other platforms: accessibility is not gated, so always returns true
#[tauri::command]
pub async fn check_permissions() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(|| {
            #[link(name = "ApplicationServices", kind = "framework")]
            extern "C" {
                fn AXIsProcessTrusted() -> bool;
            }

            let accessibility = unsafe { AXIsProcessTrusted() };

            PermissionStatus {
                accessibility,
                admin_primed: false,
            }
        })
        .await
        .unwrap_or(PermissionStatus {
            accessibility: false,
            admin_primed: false,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Windows and Linux don't have an Accessibility permission gate
        PermissionStatus {
            accessibility: true,
            admin_primed: false,
        }
    }
}

/// Request Accessibility permission using the proper macOS API
/// This triggers the system dialog AND adds the app to the Accessibility list
/// Returns true if permission was already granted, false if user needs to grant it
/// On non-macOS platforms, always returns Ok(true) since there's no equivalent gate.
#[tauri::command]
pub async fn request_accessibility_permission() -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux don't have an Accessibility permission gate
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
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

/// Prime admin privileges by running a simple command with admin rights
/// macOS: caches sudo credentials for ~5 minutes via osascript
/// Windows: UAC handles elevation per-operation, no priming needed
#[tauri::command]
pub async fn prime_admin_privileges(window: tauri::Window) -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        // Windows uses UAC per-operation elevation — no priming needed
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
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
}

/// Install CMake - platform-specific installation
/// macOS: tries Homebrew first, falls back to direct download
/// Windows: downloads MSI installer and runs it silently
#[tauri::command]
pub async fn install_cmake(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit(
        "install-stream",
        InstallEvent::Start {
            step: "cmake".to_string(),
        },
    );

    // Check if already installed
    if let Some(output) = run_command_with_timeout("cmake", &["--version"], 5) {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("installed")
                .to_string();
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: format!("CMake is already installed: {}", version),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    #[cfg(target_os = "windows")]
    {
        return install_cmake_windows(window).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
    // macOS/Linux: Check if Homebrew is available - use it if so (faster, handles updates)
    if run_command_with_timeout("which", &["brew"], 3)
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Installing CMake via Homebrew...".to_string(),
            },
        );

        let mut child = tokio::process::Command::new("brew")
            .args(["install", "cmake"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start Homebrew: {}", e))?;

        let success = stream_and_wait(&mut child, &window).await;

        if success {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if run_command_with_timeout("cmake", &["--version"], 5)
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                let _ = window.emit(
                    "install-stream",
                    InstallEvent::Output {
                        line: "CMake installed successfully!".to_string(),
                    },
                );
                let _ = window.emit("install-stream", InstallEvent::Done { success: true });
                return Ok(true);
            }
        }
    }

    // No Homebrew - download directly from cmake.org
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Downloading CMake from official releases...".to_string(),
        },
    );

    // Use a stable CMake version
    let cmake_version = "3.28.1";
    let download_url = format!(
        "https://github.com/Kitware/CMake/releases/download/v{}/cmake-{}-macos-universal.tar.gz",
        cmake_version, cmake_version
    );

    let temp_dir = std::env::temp_dir();
    let archive_path = temp_dir.join(format!("cmake-{}-macos-universal.tar.gz", cmake_version));
    let extract_dir = temp_dir.join("cmake-extract");

    // Download the archive
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: format!("Downloading CMake {}...", cmake_version),
        },
    );

    let mut child = tokio::process::Command::new("curl")
        .args([
            "-fsSL",
            "-o",
            archive_path.to_str().unwrap(),
            &download_url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to download CMake: {}", e))?;

    if !stream_and_wait(&mut child, &window).await {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Failed to download CMake".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        return Err("Download failed".to_string());
    }

    // Create extract directory
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract directory: {}", e))?;

    // Extract the archive
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Extracting CMake...".to_string(),
        },
    );

    let mut child = tokio::process::Command::new("tar")
        .args([
            "-xzf",
            archive_path.to_str().unwrap(),
            "-C",
            extract_dir.to_str().unwrap(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to extract CMake: {}", e))?;

    if !stream_and_wait(&mut child, &window).await {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Failed to extract CMake".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        return Err("Extraction failed".to_string());
    }

    // Move CMake.app to /Applications
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Installing CMake to /Applications...".to_string(),
        },
    );

    let cmake_app_src = extract_dir.join(format!("cmake-{}-macos-universal", cmake_version))
        .join("CMake.app");
    let cmake_app_dest = std::path::PathBuf::from("/Applications/CMake.app");

    // Remove existing installation if present
    if cmake_app_dest.exists() {
        let _ = std::fs::remove_dir_all(&cmake_app_dest);
    }

    // Copy CMake.app to /Applications (may need admin for /Applications)
    let mut child = tokio::process::Command::new("cp")
        .args([
            "-R",
            cmake_app_src.to_str().unwrap(),
            "/Applications/",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to install CMake: {}", e))?;

    if !stream_and_wait(&mut child, &window).await {
        // Try with sudo via osascript
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "Requesting admin access to install...".to_string(),
            },
        );

        let script = format!(
            r#"do shell script "cp -R '{}' /Applications/" with administrator privileges"#,
            cmake_app_src.to_str().unwrap()
        );

        let result = tokio::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .await;

        if result.is_err() || !result.unwrap().status.success() {
            let _ = window.emit(
                "install-stream",
                InstallEvent::Output {
                    line: "Failed to install to /Applications".to_string(),
                },
            );
            let _ = window.emit("install-stream", InstallEvent::Done { success: false });
            return Err("Installation failed".to_string());
        }
    }

    // Create symlinks in /usr/local/bin
    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "Creating command-line links...".to_string(),
        },
    );

    // Ensure /usr/local/bin exists
    let _ = std::fs::create_dir_all("/usr/local/bin");

    // Run the CMake command-line tools installer
    let cmake_bin = "/Applications/CMake.app/Contents/bin/cmake";
    let link_script = format!(
        r#"do shell script "
            ln -sf /Applications/CMake.app/Contents/bin/cmake /usr/local/bin/cmake
            ln -sf /Applications/CMake.app/Contents/bin/ccmake /usr/local/bin/ccmake
            ln -sf /Applications/CMake.app/Contents/bin/cpack /usr/local/bin/cpack
            ln -sf /Applications/CMake.app/Contents/bin/ctest /usr/local/bin/ctest
        " with administrator privileges"#
    );

    let _result = tokio::process::Command::new("osascript")
        .args(["-e", &link_script])
        .output()
        .await;

    // Clean up temp files
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&extract_dir);

    // Verify installation
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Check using the direct path first, then PATH
    let cmake_works = run_command_with_timeout(cmake_bin, &["--version"], 5)
        .map(|o| o.status.success())
        .unwrap_or(false)
        || run_command_with_timeout("cmake", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false);

    if cmake_works {
        let _ = window.emit(
            "install-stream",
            InstallEvent::Output {
                line: "CMake installed successfully!".to_string(),
            },
        );
        let _ = window.emit("install-stream", InstallEvent::Done { success: true });
        return Ok(true);
    }

    let _ = window.emit(
        "install-stream",
        InstallEvent::Output {
            line: "CMake installed but may need a terminal restart to be in PATH".to_string(),
        },
    );
    let _ = window.emit("install-stream", InstallEvent::Done { success: true });
    Ok(true)
    } // end of #[cfg(not(target_os = "windows"))]
}

/// Install CMake on Windows via MSI installer (silent)
#[cfg(target_os = "windows")]
async fn install_cmake_windows(window: tauri::Window) -> Result<bool, String> {
    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Downloading CMake installer for Windows...".to_string(),
    });

    let cmake_version = "3.28.1";
    let temp_dir = std::env::temp_dir();
    let msi_path = temp_dir.join(format!("cmake-{}-windows-x86_64.msi", cmake_version));
    let download_url = format!(
        "https://github.com/Kitware/CMake/releases/download/v{}/cmake-{}-windows-x86_64.msi",
        cmake_version, cmake_version
    );

    // Download the MSI
    let download_cmd = format!(
        "Invoke-WebRequest -Uri '{}' -OutFile '{}'",
        download_url,
        msi_path.to_str().unwrap_or_default()
    );

    let mut child = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &download_cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to download CMake: {}", e))?;

    if !stream_and_wait(&mut child, &window).await {
        let _ = window.emit("install-stream", InstallEvent::Output {
            line: "Failed to download CMake installer.".to_string(),
        });
        let _ = window.emit("install-stream", InstallEvent::Done { success: false });
        return Err("Download failed".to_string());
    }

    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "Installing CMake (may require administrator access)...".to_string(),
    });

    // Install silently with msiexec, add to system PATH
    let install_cmd = format!(
        "msiexec /i \"{}\" /qn ADD_CMAKE_TO_PATH=System ALLUSERS=1 REBOOT=ReallySuppress",
        msi_path.to_str().unwrap_or_default()
    );

    let mut child = tokio::process::Command::new("cmd")
        .args(["/C", &install_cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start CMake installer: {}", e))?;

    let success = stream_and_wait(&mut child, &window).await;

    // Clean up
    let _ = std::fs::remove_file(&msi_path);

    if success {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if run_command_with_timeout("cmake", &["--version"], 5)
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let _ = window.emit("install-stream", InstallEvent::Output {
                line: "CMake installed successfully!".to_string(),
            });
            let _ = window.emit("install-stream", InstallEvent::Done { success: true });
            return Ok(true);
        }
    }

    let _ = window.emit("install-stream", InstallEvent::Output {
        line: "CMake installed but may need a restart to appear in PATH. Click Recheck after restarting.".to_string(),
    });
    let _ = window.emit("install-stream", InstallEvent::Done { success: true });
    Ok(true)
}

/// Check framework-specific prerequisites (for New Project modal)
/// Returns a list of warning messages if prerequisites are missing
#[tauri::command]
pub async fn check_framework_prerequisites(
    app_handle: tauri::AppHandle,
    framework_id: String,
) -> Vec<String> {
    let lib = crate::library::loader::load_library(&app_handle);
    let framework = lib.frameworks.iter().find(|f| f.id == framework_id);

    let Some(fw) = framework else {
        return vec![];
    };

    let mut warnings = Vec::new();
    for prereq in &fw.prerequisites.required {
        // Only check cmake here - core prereqs are handled by main check
        if prereq == "cmake" {
            let prereq_check = check_cmake();
            if prereq_check.status == CheckStatus::NotInstalled {
                warnings.push("CMake required for this framework".to_string());
            }
        }
    }

    warnings
}
