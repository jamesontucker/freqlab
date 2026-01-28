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
    pub au_path: String,
    pub auv3_path: String,
    pub aax_path: String,
    pub lv2_path: String,
    pub standalone_path: String,
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
/// Handles both Unix (~/) and Windows (~\) path separators
fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        let home = super::get_home_dir();
        PathBuf::from(home).join(&path[2..])
    } else if path.starts_with("~\\") {
        // Windows users might type ~\ instead of ~/
        let home = super::get_home_dir();
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

/// Find the first file in output_path with the given extension
fn find_artifact_by_extension(output_path: &std::path::Path, ext: &str) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(output_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some(ext) {
                return Some(path);
            }
        }
    }
    None
}

/// Copy a plugin bundle to a target directory
fn publish_bundle(
    bundle: &std::path::Path,
    target_path: &str,
    format_label: &str,
    daw: &str,
    copied: &mut Vec<CopiedFile>,
    errors: &mut Vec<String>,
) {
    if target_path.is_empty() {
        return;
    }

    let dest_dir = expand_tilde(target_path);
    let artifact_name = bundle.file_name().unwrap();
    let dest = dest_dir.join(artifact_name);

    // Remove existing bundle if present
    if dest.exists() {
        log_message("DEBUG", "publish", &format!("Removing existing {} at {:?}", format_label, dest));
        if dest.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&dest) {
                log_message("ERROR", "publish", &format!("Failed to remove existing {}: {}", format_label, e));
                errors.push(format!("Failed to remove existing {} for {}: {}", format_label, daw, e));
                return;
            }
        } else {
            if let Err(e) = std::fs::remove_file(&dest) {
                log_message("ERROR", "publish", &format!("Failed to remove existing {}: {}", format_label, e));
                errors.push(format!("Failed to remove existing {} for {}: {}", format_label, daw, e));
                return;
            }
        }
    }

    // Create parent directory if needed
    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
        log_message("ERROR", "publish", &format!("Failed to create {} dir: {}", format_label, e));
        errors.push(format!("Failed to create {} directory for {}: {}", format_label, daw, e));
        return;
    }

    // Copy the bundle (directories use copy_dir_all, files use std::fs::copy)
    log_message("DEBUG", "publish", &format!("Copying {} from {:?} to {:?}", format_label, bundle, dest));
    let copy_result = if bundle.is_dir() {
        copy_dir_all(bundle, &dest).map_err(|e| e.to_string())
    } else {
        std::fs::copy(bundle, &dest).map(|_| ()).map_err(|e| e.to_string())
    };

    match copy_result {
        Ok(()) => {
            log_message("INFO", "publish", &format!("{} copy succeeded!", format_label));
            let _ = clear_quarantine(&dest);
            copied.push(CopiedFile {
                format: format_label.to_string(),
                daw: daw.to_string(),
                path: dest.to_string_lossy().to_string(),
            });
        }
        Err(e) => {
            log_message("ERROR", "publish", &format!("{} copy failed: {}", format_label, e));
            errors.push(format!("Failed to copy {} to {}: {}", format_label, daw, e));
        }
    }
}

/// Publish plugin to selected DAW folders
#[tauri::command]
pub async fn publish_to_daw(
    project_name: String,
    version: u32,
    targets: Vec<DawPublishTarget>,
    selected_formats: Option<Vec<String>>,
) -> Result<PublishResult, String> {
    let base_output_path = get_output_path();
    let mut copied = Vec::new();
    let mut errors = Vec::new();

    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    let folder_version = version.max(1);

    log_message("INFO", "publish", &format!("Starting publish for {} v{} (folder: v{})", project_name, version, folder_version));

    // Use versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", folder_version));

    if !output_path.exists() {
        return Err("No built plugins found in output folder. Build the project first.".to_string());
    }

    // Find artifacts by extension (supports both snake_case and PascalCase naming)
    let vst3_bundle = find_artifact_by_extension(&output_path, "vst3");
    let clap_bundle = find_artifact_by_extension(&output_path, "clap");
    let au_bundle = find_artifact_by_extension(&output_path, "component");
    let standalone_bundle = find_artifact_by_extension(&output_path, "app");
    let auv3_bundle = find_artifact_by_extension(&output_path, "appex");
    let aax_bundle = find_artifact_by_extension(&output_path, "aaxplugin");
    let lv2_bundle = find_artifact_by_extension(&output_path, "lv2");

    let has_any = vst3_bundle.is_some() || clap_bundle.is_some() || au_bundle.is_some()
        || standalone_bundle.is_some() || auv3_bundle.is_some()
        || aax_bundle.is_some() || lv2_bundle.is_some();

    if !has_any {
        return Err("No built plugins found in output folder. Build the project first.".to_string());
    }

    // Filter by selected formats (if provided, only publish those formats)
    let should_publish = |format_id: &str| -> bool {
        match &selected_formats {
            Some(formats) => formats.iter().any(|f| f == format_id),
            None => true,
        }
    };

    for target in &targets {
        log_message("INFO", "publish", &format!("Processing target: {}", target.daw));

        if should_publish("vst3") {
            if let Some(ref bundle) = vst3_bundle {
                publish_bundle(bundle, &target.vst3_path, "VST3", &target.daw, &mut copied, &mut errors);
            }
        }
        if should_publish("clap") {
            if let Some(ref bundle) = clap_bundle {
                publish_bundle(bundle, &target.clap_path, "CLAP", &target.daw, &mut copied, &mut errors);
            }
        }
        if should_publish("au") {
            if let Some(ref bundle) = au_bundle {
                publish_bundle(bundle, &target.au_path, "AU", &target.daw, &mut copied, &mut errors);
            }
        }
        if should_publish("standalone") {
            if let Some(ref bundle) = standalone_bundle {
                publish_bundle(bundle, &target.standalone_path, "Standalone", &target.daw, &mut copied, &mut errors);
            }
        }
        if should_publish("auv3") {
            if let Some(ref bundle) = auv3_bundle {
                publish_bundle(bundle, &target.auv3_path, "AUv3", &target.daw, &mut copied, &mut errors);
            }
        }
        if should_publish("aax") {
            if let Some(ref bundle) = aax_bundle {
                publish_bundle(bundle, &target.aax_path, "AAX", &target.daw, &mut copied, &mut errors);
            }
        }
        if should_publish("lv2") {
            if let Some(ref bundle) = lv2_bundle {
                publish_bundle(bundle, &target.lv2_path, "LV2", &target.daw, &mut copied, &mut errors);
            }
        }
    }

    log_message("INFO", "publish", &format!("Done. Copied: {}, Errors: {}", copied.len(), errors.len()));
    Ok(PublishResult {
        success: errors.is_empty() && !copied.is_empty(),
        copied,
        errors,
    })
}

/// Check what plugin formats are available for a project at a specific version.
/// Scans the output directory for files matching known extensions rather than
/// assuming snake_case names, since JUCE/iPlug2 may use PascalCase.
#[tauri::command]
pub async fn check_available_formats(
    project_name: String,
    version: u32,
) -> Result<AvailableFormats, String> {
    let base_output_path = get_output_path();

    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    let folder_version = version.max(1);

    // Use versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", folder_version));

    let mut formats = AvailableFormats {
        vst3: false,
        clap: false,
        au: false,
        auv3: false,
        aax: false,
        lv2: false,
        standalone: false,
    };

    if let Ok(entries) = std::fs::read_dir(&output_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                match ext {
                    "vst3" => formats.vst3 = true,
                    "clap" => formats.clap = true,
                    "component" => formats.au = true,
                    "appex" => formats.auv3 = true,
                    "aaxplugin" => formats.aax = true,
                    "lv2" => formats.lv2 = true,
                    "app" => formats.standalone = true,
                    _ => {}
                }
            }
        }
    }

    Ok(formats)
}

#[derive(Serialize)]
pub struct AvailableFormats {
    pub vst3: bool,
    pub clap: bool,
    pub au: bool,
    pub auv3: bool,
    pub aax: bool,
    pub lv2: bool,
    pub standalone: bool,
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
    selected_formats: Option<Vec<String>>,
) -> Result<PackageResult, String> {
    let base_output_path = get_output_path();

    // Map version 0 (no Claude commits) to v1 for filesystem lookups
    let folder_version = version.max(1);

    // Use versioned output folder: output/{project_name}/v{version}/
    let output_path = base_output_path
        .join(&project_name)
        .join(format!("v{}", folder_version));

    // Map format IDs to file extensions
    let all_extensions: Vec<(&str, &str)> = vec![
        ("vst3", "vst3"),
        ("clap", "clap"),
        ("au", "component"),
        ("standalone", "app"),
        ("auv3", "appex"),
        ("aax", "aaxplugin"),
        ("lv2", "lv2"),
    ];

    // Filter by selected formats if provided
    let artifact_extensions: Vec<&str> = all_extensions
        .iter()
        .filter(|(format_id, _)| {
            match &selected_formats {
                Some(formats) => formats.iter().any(|f| f == format_id),
                None => true,
            }
        })
        .map(|(_, ext)| *ext)
        .collect();

    let mut bundles: Vec<PathBuf> = Vec::new();

    for ext in &artifact_extensions {
        if let Some(path) = find_artifact_by_extension(&output_path, ext) {
            bundles.push(path);
        }
    }

    if bundles.is_empty() {
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

    for bundle in &bundles {
        let name = bundle.file_name().unwrap().to_string_lossy().to_string();
        if bundle.is_dir() {
            add_directory_to_zip(&mut zip, bundle, &name, options)?;
        } else {
            // For regular files, add directly
            zip.start_file(&name, options)
                .map_err(|e| format!("Failed to add file to zip: {}", e))?;
            let mut f = File::open(bundle)
                .map_err(|e| format!("Failed to open file: {}", e))?;
            let mut buffer = Vec::new();
            f.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            zip.write_all(&buffer)
                .map_err(|e| format!("Failed to write to zip: {}", e))?;
        }
        included.push(name.clone());
        log_message("INFO", "package", &format!("Added {} to package", name));
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
