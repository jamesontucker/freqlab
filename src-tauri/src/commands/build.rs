use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::projects::{ensure_workspace, get_output_path, get_workspace_path};

#[derive(Serialize, Clone)]
pub struct BuildResult {
    pub success: bool,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum BuildStreamEvent {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "output")]
    Output { line: String },
    #[serde(rename = "done")]
    Done {
        success: bool,
        output_path: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

/// Convert project name to Cargo package name (snake_case)
fn to_package_name(name: &str) -> String {
    name.replace('-', "_")
}

/// Build a plugin project using cargo xtask bundle
#[tauri::command]
pub async fn build_project(
    project_name: String,
    version: u32,
    window: tauri::Window,
) -> Result<BuildResult, String> {
    // Ensure workspace structure exists (creates shared xtask if needed)
    ensure_workspace()?;

    let workspace_path = get_workspace_path();
    let base_output_path = get_output_path();

    // Create versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", version));

    std::fs::create_dir_all(&output_path)
        .map_err(|e| format!("Failed to create versioned output directory: {}", e))?;

    // Emit start event
    let _ = window.emit("build-stream", BuildStreamEvent::Start);

    // Convert project name (or path) to Cargo package name (hyphens -> underscores)
    let name_hint = Path::new(&project_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&project_name);
    let package_name = to_package_name(name_hint);

    // Generate unique build suffix for wry class names (enables webview plugin hot reload)
    let build_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{}", d.as_millis() % 100_000_000))
        .unwrap_or_else(|_| "0".to_string());

    // Run cargo xtask bundle from workspace root
    let mut child = Command::new("cargo")
        .current_dir(&workspace_path)
        .args(["xtask", "bundle", &package_name, "--release"])
        .env("PATH", super::get_extended_path())
        .env("WRY_BUILD_SUFFIX", &build_suffix)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn cargo: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture stdout")?;

    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture stderr")?;

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    let mut error_output = String::new();

    // Read stdout and stderr concurrently
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        let _ = window.emit("build-stream", BuildStreamEvent::Output {
                            line: text,
                        });
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = window.emit("build-stream", BuildStreamEvent::Error {
                            message: e.to_string(),
                        });
                        break;
                    }
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        error_output.push_str(&text);
                        error_output.push('\n');
                        // Emit stderr as output too (cargo outputs to stderr)
                        let _ = window.emit("build-stream", BuildStreamEvent::Output {
                            line: text,
                        });
                    }
                    Ok(None) => {}
                    Err(_) => {}
                }
            }
        }
    }

    // Wait for process to complete
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for cargo: {}", e))?;

    if status.success() {
        // Copy artifacts to output folder
        let bundled_path = workspace_path.join("target/bundled");

        // Look for .vst3 and .clap bundles
        let mut copied_files = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&bundled_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path.file_name().unwrap_or_default().to_string_lossy();

                // Check if this is our plugin's bundle
                if file_name.contains(&project_name) || file_name.contains(&project_name.replace('-', "_")) {
                    let dest = output_path.join(path.file_name().unwrap());

                    // Remove existing bundle first to ensure clean copy
                    if dest.exists() {
                        if dest.is_dir() {
                            let _ = std::fs::remove_dir_all(&dest);
                        } else {
                            let _ = std::fs::remove_file(&dest);
                        }
                    }

                    // Copy directory (for .vst3/.clap bundles) or file
                    if path.is_dir() {
                        copy_dir_all(&path, &dest).ok();
                    } else {
                        std::fs::copy(&path, &dest).ok();
                    }
                    copied_files.push(dest.to_string_lossy().to_string());
                }
            }
        }

        // Clear macOS quarantine attributes to avoid Gatekeeper issues
        #[cfg(target_os = "macos")]
        for artifact_path in &copied_files {
            let _ = std::process::Command::new("xattr")
                .args(["-cr", artifact_path])
                .output();
        }

        let output_str = output_path.to_string_lossy().to_string();

        let _ = window.emit("build-stream", BuildStreamEvent::Done {
            success: true,
            output_path: Some(output_str.clone()),
        });

        Ok(BuildResult {
            success: true,
            output_path: Some(output_str),
            error: None,
        })
    } else {
        let _ = window.emit("build-stream", BuildStreamEvent::Done {
            success: false,
            output_path: None,
        });

        Ok(BuildResult {
            success: false,
            output_path: None,
            error: Some(error_output),
        })
    }
}

/// Recursively copy a directory
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Open the output folder in Finder
#[tauri::command]
pub async fn open_output_folder() -> Result<(), String> {
    let output_path = get_output_path();

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&output_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&output_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&output_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}
