use serde::Serialize;
use std::process::Command;
use std::time::Duration;

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

    // Claude stores auth in macOS keychain, not in files
    // Check for presence of ~/.claude/settings.json or history.jsonl as indicators
    // that Claude has been configured and used
    let home = std::env::var("HOME").unwrap_or_default();
    let claude_dir = std::path::Path::new(&home).join(".claude");
    let settings_file = claude_dir.join("settings.json");
    let history_file = claude_dir.join("history.jsonl");

    if settings_file.exists() || history_file.exists() {
        CheckResult {
            status: CheckStatus::Installed,
            version: None,
            message: Some("Configured".to_string()),
        }
    } else {
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
