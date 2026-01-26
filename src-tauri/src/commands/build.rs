use serde::Serialize;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::projects::{ensure_workspace, get_output_path, get_workspace_path};
use crate::library;

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

/// Get project metadata to determine framework
fn get_project_framework(project_path: &std::path::Path) -> Option<String> {
    let metadata_path = project_path.join(".vstworkshop/metadata.json");
    if metadata_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&metadata_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                return json
                    .get("frameworkId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }
    None
}

/// Build a plugin project - dispatches to cargo or cmake based on framework config
#[tauri::command]
pub async fn build_project(
    app_handle: tauri::AppHandle,
    project_name: String,
    version: u32,
    window: tauri::Window,
) -> Result<BuildResult, String> {
    // Ensure workspace structure exists (creates shared xtask if needed for cargo builds)
    ensure_workspace()?;

    let workspace_path = get_workspace_path();
    let projects_path = workspace_path.join("projects");
    let project_path = projects_path.join(&project_name);
    let base_output_path = get_output_path();

    // Create versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", version));

    std::fs::create_dir_all(&output_path)
        .map_err(|e| format!("Failed to create versioned output directory: {}", e))?;

    // Get framework from project metadata
    let framework_id = get_project_framework(&project_path).unwrap_or_else(|| "nih-plug".to_string());

    // Load library to get framework config
    let lib = library::loader::load_library(&app_handle);
    let framework = lib
        .frameworks
        .iter()
        .find(|f| f.id == framework_id);

    // Determine build system
    let build_system = framework
        .map(|f| f.build.build_system.as_str())
        .unwrap_or("cargo");

    // Emit start event
    let _ = window.emit("build-stream", BuildStreamEvent::Start);

    match build_system {
        "cmake" => {
            build_cmake_project(
                &project_path,
                &output_path,
                &project_name,
                framework.map(|f| &f.build),
                &window,
            )
            .await
        }
        _ => {
            // Default to cargo for nih-plug and unknown frameworks
            build_cargo_project(&workspace_path, &output_path, &project_name, &window).await
        }
    }
}

/// Build a project using cargo xtask bundle (for nih-plug)
async fn build_cargo_project(
    workspace_path: &std::path::Path,
    output_path: &std::path::Path,
    project_name: &str,
    window: &tauri::Window,
) -> Result<BuildResult, String> {
    // Convert project name to Cargo package name (hyphens -> underscores)
    let package_name = to_package_name(project_name);

    // Generate unique build suffix for wry class names (enables webview plugin hot reload)
    let build_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{}", d.as_millis() % 100_000_000))
        .unwrap_or_else(|_| "0".to_string());

    // Run cargo xtask bundle from workspace root
    let mut child = Command::new("cargo")
        .current_dir(workspace_path)
        .args(["xtask", "bundle", &package_name, "--release"])
        .env("PATH", super::get_extended_path())
        .env("WRY_BUILD_SUFFIX", &build_suffix)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn cargo: {}", e))?;

    let error_output = stream_command_output(&mut child, window).await?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for cargo: {}", e))?;

    if status.success() {
        // Copy artifacts to output folder
        let bundled_path = workspace_path.join("target/bundled");
        let copied_files = copy_cargo_artifacts(&bundled_path, output_path, project_name)?;

        // Clear macOS quarantine attributes
        clear_quarantine_attributes(&copied_files);

        let output_str = output_path.to_string_lossy().to_string();

        let _ = window.emit(
            "build-stream",
            BuildStreamEvent::Done {
                success: true,
                output_path: Some(output_str.clone()),
            },
        );

        Ok(BuildResult {
            success: true,
            output_path: Some(output_str),
            error: None,
        })
    } else {
        let _ = window.emit(
            "build-stream",
            BuildStreamEvent::Done {
                success: false,
                output_path: None,
            },
        );

        Ok(BuildResult {
            success: false,
            output_path: None,
            error: Some(error_output),
        })
    }
}

/// Build a project using CMake (for JUCE, iPlug2, etc.)
async fn build_cmake_project(
    project_path: &std::path::Path,
    output_path: &std::path::Path,
    project_name: &str,
    build_config: Option<&library::types::BuildConfig>,
    window: &tauri::Window,
) -> Result<BuildResult, String> {
    // Generate unique build suffix for Objective-C class names (enables hot reload)
    // This prevents class name conflicts when reloading WebView-based plugins
    let build_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{}", d.as_secs()))
        .unwrap_or_else(|_| "0".to_string());

    // Delete CMakeCache.txt to force reconfigure with new IPLUG_BUILD_SUFFIX
    // This ensures the unique class name suffix is picked up on each build
    let cmake_cache = project_path.join("build/CMakeCache.txt");
    if cmake_cache.exists() {
        let _ = std::fs::remove_file(&cmake_cache);
        log::info!("Removed CMakeCache.txt to force reconfigure for hot reload");
    }

    let _ = window.emit(
        "build-stream",
        BuildStreamEvent::Output {
            line: "=== CMake Configure ===".to_string(),
        },
    );

    // Step 1: Configure (cmake -B build -S . ...)
    let configure_args = build_config
        .and_then(|c| c.configure_arguments.as_ref())
        .map(|args| args.clone())
        .unwrap_or_else(|| vec!["-B".into(), "build".into(), "-S".into(), ".".into(), "-DCMAKE_BUILD_TYPE=Release".into()]);

    let mut configure_child = Command::new("cmake")
        .current_dir(project_path)
        .args(&configure_args)
        .env("PATH", super::get_extended_path())
        .env("IPLUG_BUILD_SUFFIX", &build_suffix)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn cmake configure: {}", e))?;

    let configure_error = stream_command_output(&mut configure_child, window).await?;

    let configure_status = configure_child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for cmake configure: {}", e))?;

    if !configure_status.success() {
        let _ = window.emit(
            "build-stream",
            BuildStreamEvent::Done {
                success: false,
                output_path: None,
            },
        );

        return Ok(BuildResult {
            success: false,
            output_path: None,
            error: Some(format!("CMake configure failed:\n{}", configure_error)),
        });
    }

    let _ = window.emit(
        "build-stream",
        BuildStreamEvent::Output {
            line: "=== CMake Build ===".to_string(),
        },
    );

    // Step 2: Build (cmake --build build --config Release)
    let build_args = build_config
        .map(|c| c.arguments.clone())
        .unwrap_or_else(|| vec!["--build".into(), "build".into(), "--config".into(), "Release".into()]);

    let mut build_child = Command::new("cmake")
        .current_dir(project_path)
        .args(&build_args)
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn cmake build: {}", e))?;

    let build_error = stream_command_output(&mut build_child, window).await?;

    let build_status = build_child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for cmake build: {}", e))?;

    if !build_status.success() {
        let _ = window.emit(
            "build-stream",
            BuildStreamEvent::Done {
                success: false,
                output_path: None,
            },
        );

        return Ok(BuildResult {
            success: false,
            output_path: None,
            error: Some(format!("CMake build failed:\n{}", build_error)),
        });
    }

    // Step 3: Copy artifacts
    let _ = window.emit(
        "build-stream",
        BuildStreamEvent::Output {
            line: "=== Copying artifacts ===".to_string(),
        },
    );

    let artifact_patterns = build_config
        .and_then(|c| c.artifact_patterns.as_ref())
        .map(|p| p.clone())
        .unwrap_or_else(|| vec![
            "build/*_artefacts/Release/**/*.vst3".to_string(),
            "build/*_artefacts/Release/**/*.component".to_string(),
            "build/*_artefacts/Release/**/*.clap".to_string(),
            "build/*_artefacts/Release/**/*.app".to_string(),
        ]);

    let copied_files = copy_cmake_artifacts(project_path, output_path, &artifact_patterns, project_name)?;

    // Clear macOS quarantine attributes
    clear_quarantine_attributes(&copied_files);

    let output_str = output_path.to_string_lossy().to_string();

    let _ = window.emit(
        "build-stream",
        BuildStreamEvent::Done {
            success: true,
            output_path: Some(output_str.clone()),
        },
    );

    Ok(BuildResult {
        success: true,
        output_path: Some(output_str),
        error: None,
    })
}

/// Stream stdout/stderr from a command to the window
async fn stream_command_output(
    child: &mut tokio::process::Child,
    window: &tauri::Window,
) -> Result<String, String> {
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    let mut error_output = String::new();

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
                        // Emit stderr as output too (cmake outputs progress to stderr)
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

    Ok(error_output)
}

/// Copy cargo xtask bundle artifacts to output folder
fn copy_cargo_artifacts(
    bundled_path: &std::path::Path,
    output_path: &std::path::Path,
    project_name: &str,
) -> Result<Vec<String>, String> {
    let mut copied_files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(bundled_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().unwrap_or_default().to_string_lossy();

            // Check if this is our plugin's bundle
            if file_name.contains(project_name) || file_name.contains(&project_name.replace('-', "_"))
            {
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
                    if let Err(e) = copy_dir_all(&path, &dest) {
                        log::warn!("Failed to copy directory {:?}: {}", path, e);
                        continue;
                    }
                } else {
                    if let Err(e) = std::fs::copy(&path, &dest) {
                        log::warn!("Failed to copy file {:?}: {}", path, e);
                        continue;
                    }
                }
                copied_files.push(dest.to_string_lossy().to_string());
            }
        }
    }

    if copied_files.is_empty() {
        log::warn!("No artifacts found for project '{}' in {:?}", project_name, bundled_path);
        return Err(format!(
            "No build artifacts found. Expected bundles in {:?} matching '{}'",
            bundled_path, project_name
        ));
    }

    Ok(copied_files)
}

/// Copy CMake build artifacts to output folder using glob patterns
fn copy_cmake_artifacts(
    project_path: &std::path::Path,
    output_path: &std::path::Path,
    patterns: &[String],
    _project_name: &str,
) -> Result<Vec<String>, String> {
    let mut copied_files = Vec::new();

    for pattern in patterns {
        let full_pattern = project_path.join(pattern);
        let pattern_str = full_pattern.to_string_lossy();

        if let Ok(paths) = glob::glob(&pattern_str) {
            for path_result in paths {
                if let Ok(path) = path_result {
                    // Get just the artifact file/folder name (e.g., "MyPlugin.vst3")
                    if let Some(artifact_name) = path.file_name() {
                        let dest = output_path.join(artifact_name);

                        // Remove existing
                        if dest.exists() {
                            if dest.is_dir() {
                                let _ = std::fs::remove_dir_all(&dest);
                            } else {
                                let _ = std::fs::remove_file(&dest);
                            }
                        }

                        // Copy
                        if path.is_dir() {
                            if let Err(e) = copy_dir_all(&path, &dest) {
                                log::warn!("Failed to copy CMake directory {:?}: {}", path, e);
                                continue;
                            }
                        } else {
                            if let Err(e) = std::fs::copy(&path, &dest) {
                                log::warn!("Failed to copy CMake file {:?}: {}", path, e);
                                continue;
                            }
                        }
                        copied_files.push(dest.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    if copied_files.is_empty() {
        log::warn!("No CMake artifacts found matching patterns: {:?}", patterns);
        return Err(format!(
            "No build artifacts found. Expected files matching patterns: {:?}",
            patterns
        ));
    }

    Ok(copied_files)
}

/// Clear macOS quarantine attributes to avoid Gatekeeper issues
fn clear_quarantine_attributes(paths: &[String]) {
    #[cfg(target_os = "macos")]
    for artifact_path in paths {
        let _ = std::process::Command::new("xattr")
            .args(["-cr", artifact_path])
            .output();
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = paths;
    }
}

/// Recursively copy a directory
/// On macOS, uses `cp -R` to properly handle app bundles and preserve attributes
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        // Ensure paths are valid UTF-8 before passing to shell command
        let src_str = src.to_str().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Source path contains invalid UTF-8",
            )
        })?;
        let dst_str = dst.to_str().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Destination path contains invalid UTF-8",
            )
        })?;

        // Use system cp -R on macOS to properly handle app bundles
        let status = std::process::Command::new("cp")
            .args(["-R", src_str, dst_str])
            .status()?;
        if !status.success() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("cp -R failed with status: {:?}", status.code()),
            ));
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
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
    Ok(())
}
