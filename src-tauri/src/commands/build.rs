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

/// Get project build formats from metadata
/// Returns None if not set (copy all artifacts for backward compat)
fn get_project_build_formats(project_path: &std::path::Path) -> Option<Vec<String>> {
    let metadata_path = project_path.join(".vstworkshop/metadata.json");
    if metadata_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&metadata_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(formats) = json.get("buildFormats").and_then(|v| v.as_array()) {
                    let mut result: Vec<String> = formats
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                    // Always ensure VST3 and CLAP are included
                    if !result.iter().any(|f| f == "clap") {
                        result.push("clap".to_string());
                    }
                    if !result.iter().any(|f| f == "vst3") {
                        result.push("vst3".to_string());
                    }
                    return Some(result);
                }
            }
        }
    }
    None
}

/// Map file extension to format ID
fn extension_to_format(ext: &str) -> Option<&'static str> {
    match ext {
        "vst3" => Some("vst3"),
        "clap" => Some("clap"),
        "component" => Some("au"),
        "app" => Some("standalone"),
        "appex" => Some("auv3"),
        "aaxplugin" => Some("aax"),
        "lv2" => Some("lv2"),
        _ => None,
    }
}

/// Check if an artifact path should be included based on build format selection
fn should_include_artifact(path: &std::path::Path, build_formats: &Option<Vec<String>>) -> bool {
    let Some(formats) = build_formats else {
        return true; // No filter set = copy everything
    };
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return true; // No extension = include by default
    };
    let Some(format_id) = extension_to_format(ext) else {
        return false; // Unknown extension (e.g. .framework) = exclude when filtering
    };
    formats.iter().any(|f| f == format_id)
}

/// Remove known plugin artifact files/directories from the output directory.
/// This prevents stale artifacts from previous builds (with different format selections)
/// from being picked up by publish/package commands.
fn clean_output_artifacts(output_path: &std::path::Path) {
    let known_extensions = ["vst3", "clap", "component", "app", "appex", "aaxplugin", "lv2", "framework"];
    if let Ok(entries) = std::fs::read_dir(output_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if known_extensions.contains(&ext) {
                    let result = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };
                    if let Err(e) = result {
                        log::warn!("Failed to clean old artifact {:?}: {}", path, e);
                    }
                }
            }
        }
    }
}

/// Build a plugin project - dispatches to cargo or cmake based on framework config
#[tauri::command]
pub async fn build_project(
    app_handle: tauri::AppHandle,
    project_name: String,
    version: u32,
    aax_sdk_path: Option<String>,
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

    // Clean previous plugin artifacts from the output directory so deselected
    // formats don't linger from earlier builds of the same version
    clean_output_artifacts(&output_path);

    // Get framework and build formats from project metadata
    let framework_id = get_project_framework(&project_path).unwrap_or_else(|| "nih-plug".to_string());
    let build_formats = get_project_build_formats(&project_path);

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
                &build_formats,
                &aax_sdk_path,
                &window,
            )
            .await
        }
        _ => {
            // Default to cargo for nih-plug and unknown frameworks
            build_cargo_project(&workspace_path, &output_path, &project_name, &build_formats, &window).await
        }
    }
}

/// Build a project using cargo xtask bundle (for nih-plug)
async fn build_cargo_project(
    workspace_path: &std::path::Path,
    output_path: &std::path::Path,
    project_name: &str,
    build_formats: &Option<Vec<String>>,
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
        // Copy artifacts to output folder (filtered by build formats)
        let bundled_path = workspace_path.join("target/bundled");
        let copied_files = copy_cargo_artifacts(&bundled_path, output_path, project_name, build_formats)?;

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
    build_formats: &Option<Vec<String>>,
    aax_sdk_path: &Option<String>,
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
    let mut configure_args = build_config
        .and_then(|c| c.configure_arguments.as_ref())
        .map(|args| args.clone())
        .unwrap_or_else(|| vec!["-B".into(), "build".into(), "-S".into(), ".".into(), "-DCMAKE_BUILD_TYPE=Release".into()]);

    // Share FetchContent downloads across all projects to avoid re-downloading
    // large SDKs (JUCE ~500MB, iPlug2, VST3 SDK, etc.) for every project
    let cache_dir = get_workspace_path().join(".cache/cmake-deps");
    configure_args.push(format!("-DFETCHCONTENT_BASE_DIR={}", cache_dir.display()));

    // Inject AAX SDK path if configured
    if let Some(ref aax_path) = aax_sdk_path {
        if !aax_path.is_empty() {
            configure_args.push(format!("-DAAX_SDK_PATH={}", aax_path));
        }
    }

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
            "build/*_artefacts/Release/**/*.appex".to_string(),
            "build/*_artefacts/Release/**/*.aaxplugin".to_string(),
            "build/*_artefacts/Release/**/*.lv2".to_string(),
        ]);

    let copied_files = copy_cmake_artifacts(project_path, output_path, &artifact_patterns, project_name, build_formats)?;

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
    build_formats: &Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let mut copied_files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(bundled_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().unwrap_or_default().to_string_lossy();

            // Check if this is our plugin's bundle
            if file_name.contains(project_name) || file_name.contains(&project_name.replace('-', "_"))
            {
                // Filter by build format selection
                if !should_include_artifact(&path, build_formats) {
                    log::info!("Skipping artifact {:?} (not in selected build formats)", path);
                    continue;
                }
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
    build_formats: &Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let mut copied_files = Vec::new();

    for pattern in patterns {
        let full_pattern = project_path.join(pattern);
        let pattern_str = full_pattern.to_string_lossy();

        if let Ok(paths) = glob::glob(&pattern_str) {
            for path_result in paths {
                if let Ok(path) = path_result {
                    // Filter by build format selection
                    if !should_include_artifact(&path, build_formats) {
                        log::info!("Skipping CMake artifact {:?} (not in selected build formats)", path);
                        continue;
                    }

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

#[derive(Serialize, Clone)]
pub struct AaxSdkStatus {
    pub valid: bool,
    pub message: String,
}

/// Validate an AAX SDK path by checking for expected directory structure
#[tauri::command]
pub async fn validate_aax_sdk_path(path: String) -> Result<AaxSdkStatus, String> {
    let sdk_path = std::path::Path::new(&path);
    if !sdk_path.exists() {
        return Ok(AaxSdkStatus {
            valid: false,
            message: "Path does not exist".into(),
        });
    }
    let has_interfaces = sdk_path.join("Interfaces").exists();
    let has_libs = sdk_path.join("Libs").exists();
    if has_interfaces && has_libs {
        Ok(AaxSdkStatus {
            valid: true,
            message: "AAX SDK found".into(),
        })
    } else {
        Ok(AaxSdkStatus {
            valid: false,
            message: "Missing expected SDK directories (Interfaces/, Libs/)".into(),
        })
    }
}

#[derive(Serialize, Clone)]
pub struct CacheInfo {
    pub size_bytes: u64,
    pub size_display: String,
    pub exists: bool,
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut size = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                size += dir_size(&path);
            } else if let Ok(meta) = path.metadata() {
                size += meta.len();
            }
        }
    }
    size
}

fn format_byte_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

/// Get the size of the shared CMake dependency cache
#[tauri::command]
pub async fn get_build_cache_info() -> Result<CacheInfo, String> {
    let cache_dir = get_workspace_path().join(".cache/cmake-deps");
    if !cache_dir.exists() {
        return Ok(CacheInfo {
            size_bytes: 0,
            size_display: "Empty".into(),
            exists: false,
        });
    }

    let bytes = dir_size(&cache_dir);
    Ok(CacheInfo {
        size_bytes: bytes,
        size_display: format_byte_size(bytes),
        exists: true,
    })
}

/// Clear the shared CMake dependency cache
#[tauri::command]
pub async fn clear_build_cache() -> Result<(), String> {
    let cache_dir = get_workspace_path().join(".cache/cmake-deps");
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to clear cache: {}", e))?;
    }
    Ok(())
}

/// Get the total size of all per-project build/ directories
#[tauri::command]
pub async fn get_project_build_cache_info() -> Result<CacheInfo, String> {
    let projects_dir = get_workspace_path().join("projects");
    if !projects_dir.exists() {
        return Ok(CacheInfo {
            size_bytes: 0,
            size_display: "Empty".into(),
            exists: false,
        });
    }

    let mut total_bytes: u64 = 0;
    let mut any_exist = false;
    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let build_dir = entry.path().join("build");
            if build_dir.is_dir() {
                any_exist = true;
                total_bytes += dir_size(&build_dir);
            }
        }
    }

    Ok(CacheInfo {
        size_bytes: total_bytes,
        size_display: format_byte_size(total_bytes),
        exists: any_exist,
    })
}

/// Clear all per-project build/ directories
#[tauri::command]
pub async fn clear_project_build_cache() -> Result<(), String> {
    let projects_dir = get_workspace_path().join("projects");
    if !projects_dir.exists() {
        return Ok(());
    }

    let mut errors = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let build_dir = entry.path().join("build");
            if build_dir.is_dir() {
                if let Err(e) = std::fs::remove_dir_all(&build_dir) {
                    errors.push(format!(
                        "{}: {}",
                        entry.file_name().to_string_lossy(),
                        e
                    ));
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("Failed to clear some build dirs: {}", errors.join(", ")))
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
