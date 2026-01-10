use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use super::logging::log_message;
use super::projects::get_output_path;

#[derive(Deserialize)]
pub struct DawPublishTarget {
    pub daw: String,
    pub vst3_path: String,
    pub clap_path: String,
}

#[derive(Serialize)]
pub struct PublishResult {
    pub success: bool,
    pub copied: Vec<CopiedFile>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct CopiedFile {
    pub format: String,
    pub daw: String,
    pub path: String,
}

/// Expand ~ to home directory
fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join(&path[2..])
    } else {
        PathBuf::from(path)
    }
}

/// Remove macOS quarantine attribute from a file/directory (Gatekeeper bypass for local plugins)
/// This runs `xattr -cr <path>` to clear all extended attributes recursively
#[cfg(target_os = "macos")]
fn clear_quarantine(path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("xattr")
        .args(["-cr", &path.to_string_lossy()])
        .output()
        .map_err(|e| format!("Failed to run xattr: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't fail on xattr errors - it's not critical if it fails
        log_message("WARN", "publish", &format!("xattr -cr failed (non-fatal): {}", stderr));
    } else {
        log_message("DEBUG", "publish", &format!("Cleared quarantine attribute from {:?}", path));
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn clear_quarantine(_path: &std::path::Path) -> Result<(), String> {
    // No-op on non-macOS platforms
    Ok(())
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

/// Publish plugin to selected DAW folders
#[tauri::command]
pub async fn publish_to_daw(
    project_name: String,
    version: u32,
    targets: Vec<DawPublishTarget>,
) -> Result<PublishResult, String> {
    let base_output_path = get_output_path();
    let mut copied = Vec::new();
    let mut errors = Vec::new();

    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    // Fresh projects build to v1, but get_current_version returns 0
    let folder_version = version.max(1);

    log_message("INFO", "publish", &format!("Starting publish for {} v{} (folder: v{})", project_name, version, folder_version));
    log_message("DEBUG", "publish", &format!("Base output path: {:?}", base_output_path));

    // Convert project name to snake_case for matching
    let snake_name = project_name.replace('-', "_");
    log_message("DEBUG", "publish", &format!("Snake name: {}", snake_name));

    // Use versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", folder_version));

    log_message("DEBUG", "publish", &format!("Looking in output path: {:?}", output_path));

    // List what's actually in the output folder
    if output_path.exists() {
        log_message("DEBUG", "publish", "Output folder contents:");
        if let Ok(entries) = std::fs::read_dir(&output_path) {
            for entry in entries.flatten() {
                log_message("DEBUG", "publish", &format!("  - {:?}", entry.file_name()));
            }
        }
    } else {
        log_message("WARN", "publish", "Output folder does not exist!");
    }

    // Find the plugin bundles in versioned output folder
    let vst3_bundle = output_path.join(format!("{}.vst3", snake_name));
    let clap_bundle = output_path.join(format!("{}.clap", snake_name));

    log_message("DEBUG", "publish", &format!("VST3 bundle path: {:?} (exists: {})", vst3_bundle, vst3_bundle.exists()));
    log_message("DEBUG", "publish", &format!("CLAP bundle path: {:?} (exists: {})", clap_bundle, clap_bundle.exists()));

    let has_vst3 = vst3_bundle.exists();
    let has_clap = clap_bundle.exists();

    if !has_vst3 && !has_clap {
        return Err(format!(
            "No built plugins found in output folder. Build the project first."
        ));
    }

    log_message("DEBUG", "publish", &format!("Targets: {:?}", targets.iter().map(|t| (&t.daw, &t.vst3_path, &t.clap_path)).collect::<Vec<_>>()));

    for target in targets {
        log_message("INFO", "publish", &format!("Processing target: {} (vst3: '{}', clap: '{}')", target.daw, target.vst3_path, target.clap_path));

        // Copy VST3 if available and path is specified
        if has_vst3 && !target.vst3_path.is_empty() {
            let dest_dir = expand_tilde(&target.vst3_path);
            let dest = dest_dir.join(format!("{}.vst3", snake_name));
            log_message("DEBUG", "publish", &format!("VST3 dest_dir: {:?}, dest: {:?}", dest_dir, dest));

            // Remove existing bundle if present
            if dest.exists() {
                log_message("DEBUG", "publish", &format!("Removing existing VST3 at {:?}", dest));
                if let Err(e) = std::fs::remove_dir_all(&dest) {
                    log_message("ERROR", "publish", &format!("Failed to remove existing VST3: {}", e));
                    errors.push(format!("Failed to remove existing VST3 for {}: {}", target.daw, e));
                    continue;
                }
            }

            // Create parent directory if needed
            if let Err(e) = std::fs::create_dir_all(&dest_dir) {
                log_message("ERROR", "publish", &format!("Failed to create VST3 dir: {}", e));
                errors.push(format!("Failed to create VST3 directory for {}: {}", target.daw, e));
                continue;
            }

            // Copy the bundle
            log_message("DEBUG", "publish", &format!("Copying VST3 from {:?} to {:?}", vst3_bundle, dest));
            if let Err(e) = copy_dir_all(&vst3_bundle, &dest) {
                log_message("ERROR", "publish", &format!("VST3 copy failed: {}", e));
                errors.push(format!("Failed to copy VST3 to {}: {}", target.daw, e));
            } else {
                // Verify the copy actually worked
                let copy_verified = dest.exists();
                log_message("INFO", "publish", &format!("VST3 copy succeeded! Verified exists: {}", copy_verified));
                if !copy_verified {
                    log_message("WARN", "publish", "dest.exists() returned false after copy!");
                }
                // Clear macOS quarantine attribute so Gatekeeper doesn't block the plugin
                let _ = clear_quarantine(&dest);
                copied.push(CopiedFile {
                    format: "VST3".to_string(),
                    daw: target.daw.clone(),
                    path: dest.to_string_lossy().to_string(),
                });
            }
        } else {
            log_message("DEBUG", "publish", &format!("Skipping VST3: has_vst3={}, path_empty={}", has_vst3, target.vst3_path.is_empty()));
        }

        // Copy CLAP if available and path is specified
        if has_clap && !target.clap_path.is_empty() {
            let dest_dir = expand_tilde(&target.clap_path);
            let dest = dest_dir.join(format!("{}.clap", snake_name));
            log_message("DEBUG", "publish", &format!("CLAP dest_dir: {:?}, dest: {:?}", dest_dir, dest));

            // Remove existing bundle if present
            if dest.exists() {
                log_message("DEBUG", "publish", &format!("Removing existing CLAP at {:?}", dest));
                if let Err(e) = std::fs::remove_dir_all(&dest) {
                    log_message("ERROR", "publish", &format!("Failed to remove existing CLAP: {}", e));
                    errors.push(format!("Failed to remove existing CLAP for {}: {}", target.daw, e));
                    continue;
                }
            }

            // Create parent directory if needed
            if let Err(e) = std::fs::create_dir_all(&dest_dir) {
                log_message("ERROR", "publish", &format!("Failed to create CLAP dir: {}", e));
                errors.push(format!("Failed to create CLAP directory for {}: {}", target.daw, e));
                continue;
            }

            // Copy the bundle
            log_message("DEBUG", "publish", &format!("Copying CLAP from {:?} to {:?}", clap_bundle, dest));
            if let Err(e) = copy_dir_all(&clap_bundle, &dest) {
                log_message("ERROR", "publish", &format!("CLAP copy failed: {}", e));
                errors.push(format!("Failed to copy CLAP to {}: {}", target.daw, e));
            } else {
                // Verify the copy actually worked
                let copy_verified = dest.exists();
                log_message("INFO", "publish", &format!("CLAP copy succeeded! Verified exists: {}", copy_verified));
                if !copy_verified {
                    log_message("WARN", "publish", "dest.exists() returned false after copy!");
                }
                // Clear macOS quarantine attribute so Gatekeeper doesn't block the plugin
                let _ = clear_quarantine(&dest);
                copied.push(CopiedFile {
                    format: "CLAP".to_string(),
                    daw: target.daw.clone(),
                    path: dest.to_string_lossy().to_string(),
                });
            }
        } else {
            log_message("DEBUG", "publish", &format!("Skipping CLAP: has_clap={}, path_empty={}", has_clap, target.clap_path.is_empty()));
        }
    }

    log_message("INFO", "publish", &format!("Done. Copied: {}, Errors: {}", copied.len(), errors.len()));
    Ok(PublishResult {
        success: errors.is_empty() && !copied.is_empty(),
        copied,
        errors,
    })
}

/// Check what plugin formats are available for a project at a specific version
#[tauri::command]
pub async fn check_available_formats(
    project_name: String,
    version: u32,
) -> Result<AvailableFormats, String> {
    let base_output_path = get_output_path();
    let snake_name = project_name.replace('-', "_");

    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    let folder_version = version.max(1);

    // Use versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", folder_version));

    let vst3_bundle = output_path.join(format!("{}.vst3", snake_name));
    let clap_bundle = output_path.join(format!("{}.clap", snake_name));

    Ok(AvailableFormats {
        vst3: vst3_bundle.exists(),
        clap: clap_bundle.exists(),
    })
}

#[derive(Serialize)]
pub struct AvailableFormats {
    pub vst3: bool,
    pub clap: bool,
}

#[derive(Serialize)]
pub struct PackageResult {
    pub success: bool,
    pub zip_path: String,
    pub included: Vec<String>,
}

/// Package plugin files into a zip archive for distribution
#[tauri::command]
pub async fn package_plugins(
    project_name: String,
    version: u32,
    destination: String,
) -> Result<PackageResult, String> {
    let base_output_path = get_output_path();
    let snake_name = project_name.replace('-', "_");

    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    let folder_version = version.max(1);

    // Use versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", folder_version));

    let vst3_bundle = output_path.join(format!("{}.vst3", snake_name));
    let clap_bundle = output_path.join(format!("{}.clap", snake_name));

    let has_vst3 = vst3_bundle.exists();
    let has_clap = clap_bundle.exists();

    if !has_vst3 && !has_clap {
        return Err("No built plugins found. Build the project first.".to_string());
    }

    // Create zip file path (use folder_version for accurate naming)
    let zip_filename = format!("{}_v{}.zip", project_name, folder_version);
    let zip_path = if destination.ends_with(".zip") {
        destination.clone()
    } else {
        format!("{}/{}", destination, zip_filename)
    };

    log_message("INFO", "package", &format!("Creating package at: {}", zip_path));

    let file = File::create(&zip_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let mut included = Vec::new();

    // Add VST3 bundle if exists
    if has_vst3 {
        add_directory_to_zip(&mut zip, &vst3_bundle, &format!("{}.vst3", snake_name), options)?;
        included.push(format!("{}.vst3", snake_name));
        log_message("INFO", "package", &format!("Added {}.vst3 to package", snake_name));
    }

    // Add CLAP bundle if exists
    if has_clap {
        add_directory_to_zip(&mut zip, &clap_bundle, &format!("{}.clap", snake_name), options)?;
        included.push(format!("{}.clap", snake_name));
        log_message("INFO", "package", &format!("Added {}.clap to package", snake_name));
    }

    zip.finish().map_err(|e| format!("Failed to finalize zip: {}", e))?;

    log_message("INFO", "package", &format!("Package created successfully: {}", zip_path));

    Ok(PackageResult {
        success: true,
        zip_path,
        included,
    })
}

/// Add a directory recursively to a zip archive
fn add_directory_to_zip(
    zip: &mut ZipWriter<File>,
    source: &std::path::Path,
    prefix: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in WalkDir::new(source) {
        let entry = entry.map_err(|e| format!("Failed to read directory: {}", e))?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(source)
            .map_err(|e| format!("Failed to get relative path: {}", e))?;

        // Create path with prefix (bundle name) as root folder
        let relative_str = relative_path.to_string_lossy().replace('\\', "/");
        let zip_path_str = if relative_str.is_empty() {
            prefix.to_string()
        } else {
            format!("{}/{}", prefix, relative_str)
        };

        if path.is_file() {
            zip.start_file(&zip_path_str, options)
                .map_err(|e| format!("Failed to add file to zip: {}", e))?;

            let mut file = File::open(path)
                .map_err(|e| format!("Failed to open file: {}", e))?;

            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed to read file: {}", e))?;

            zip.write_all(&buffer)
                .map_err(|e| format!("Failed to write to zip: {}", e))?;
        } else if path.is_dir() && !relative_str.is_empty() {
            zip.add_directory(&zip_path_str, options)
                .map_err(|e| format!("Failed to add directory to zip: {}", e))?;
        }
    }

    Ok(())
}
