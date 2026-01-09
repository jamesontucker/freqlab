use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use super::chat::ChatHistory;
use super::projects::{ensure_workspace, get_workspace_path, ProjectMeta};

/// Get the projects directory path
fn get_projects_path() -> std::path::PathBuf {
    get_workspace_path().join("projects")
}

/// Normalize zip entry path to use forward slashes (zip standard)
/// Some Windows tools create zips with backslashes
fn normalize_zip_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Validate plugin name (same rules as project creation)
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.len() > 50 {
        return Err("Name too long (max 50 chars)".to_string());
    }
    if !name.chars().next().unwrap().is_ascii_lowercase() {
        return Err("Name must start with a lowercase letter".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(
            "Name can only contain lowercase letters, numbers, hyphens, and underscores"
                .to_string(),
        );
    }
    Ok(())
}

/// Convert name to valid Rust identifier (snake_case) for Cargo package names
fn to_snake_case(name: &str) -> String {
    name.replace('-', "_")
}

/// Export a project to a zip file
/// Converts absolute attachment paths to relative paths for portability
#[tauri::command]
pub async fn export_project(project_name: String, destination: String) -> Result<String, String> {
    let project_path = get_projects_path().join(&project_name);

    if !project_path.exists() {
        return Err(format!("Project '{}' not found", project_name));
    }

    // Create zip file path
    let zip_path = if destination.ends_with(".zip") {
        destination.clone()
    } else {
        format!("{}/{}.freqlab.zip", destination, project_name)
    };

    // Prepare portable chat.json with relative paths (if it exists)
    let chat_file_path = project_path.join(".vstworkshop/chat.json");
    let portable_chat_json = if chat_file_path.exists() {
        prepare_portable_chat_json(&project_path)?
    } else {
        None
    };

    let file = File::create(&zip_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    // Walk the project directory and add all files
    for entry in WalkDir::new(&project_path) {
        let entry = entry.map_err(|e| format!("Failed to read directory: {}", e))?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(&project_path)
            .map_err(|e| format!("Failed to get relative path: {}", e))?;

        // Skip empty relative path (the root directory itself)
        if relative_path.as_os_str().is_empty() {
            continue;
        }

        // Create path with project name as root folder in zip
        // Always use forward slashes in zip paths (ZIP spec requirement)
        let relative_str = relative_path.to_string_lossy().replace('\\', "/");
        let zip_path_str = format!("{}/{}", project_name, relative_str);

        if path.is_file() {
            zip.start_file(&zip_path_str, options)
                .map_err(|e| format!("Failed to add file to zip: {}", e))?;

            // For chat.json, use our portable version with relative paths
            // Use path comparison instead of string to handle cross-platform path separators
            let is_chat_file = relative_path == Path::new(".vstworkshop").join("chat.json");
            if is_chat_file {
                if let Some(ref portable_json) = portable_chat_json {
                    zip.write_all(portable_json.as_bytes())
                        .map_err(|e| format!("Failed to write chat.json to zip: {}", e))?;
                    continue;
                }
            }

            let mut file = File::open(path)
                .map_err(|e| format!("Failed to open file: {}", e))?;

            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed to read file: {}", e))?;

            zip.write_all(&buffer)
                .map_err(|e| format!("Failed to write to zip: {}", e))?;
        } else if path.is_dir() {
            zip.add_directory(&zip_path_str, options)
                .map_err(|e| format!("Failed to add directory to zip: {}", e))?;
        }
    }

    zip.finish().map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(zip_path)
}

/// Prepare a portable version of chat.json with relative attachment paths
/// Converts absolute paths like "/Users/.../uploads/uuid/file.pdf"
/// to relative paths like ".vstworkshop/uploads/uuid/file.pdf"
fn prepare_portable_chat_json(project_path: &Path) -> Result<Option<String>, String> {
    let chat_path = project_path.join(".vstworkshop/chat.json");

    if !chat_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&chat_path).map_err(|e| format!("Failed to read chat history: {}", e))?;

    let mut history: ChatHistory = match serde_json::from_str(&content) {
        Ok(h) => h,
        Err(_) => return Ok(Some(content)), // Can't parse, return as-is
    };

    let project_path_str = project_path.to_string_lossy().to_string();

    // Convert absolute paths to relative paths
    for message in &mut history.messages {
        if let Some(ref mut attachments) = message.attachments {
            for attachment in attachments.iter_mut() {
                // If path starts with project path, make it relative
                if attachment.path.starts_with(&project_path_str) {
                    // Convert "/Users/.../projects/my-synth/.vstworkshop/uploads/uuid/file.pdf"
                    // to ".vstworkshop/uploads/uuid/file.pdf"
                    if let Some(relative) = attachment.path.strip_prefix(&project_path_str) {
                        // Trim both forward and back slashes, then normalize to forward slashes
                        let relative = relative
                            .trim_start_matches('/')
                            .trim_start_matches('\\')
                            .replace('\\', "/");
                        attachment.path = relative;
                    }
                } else {
                    // Path doesn't match project - try to extract just the relative part
                    // Look for ".vstworkshop/uploads" or ".vstworkshop\uploads" in the path
                    let normalized = attachment.path.replace('\\', "/");
                    if let Some(idx) = normalized.find(".vstworkshop/uploads") {
                        attachment.path = normalized[idx..].to_string();
                    }
                }
            }
        }
    }

    let portable_json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize chat history: {}", e))?;

    Ok(Some(portable_json))
}

/// Check if importing a project would conflict with an existing one
/// Returns the conflicting project name if found, None otherwise
#[tauri::command]
pub async fn check_import_conflict(zip_path: String) -> Result<Option<String>, String> {
    let file = File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    if archive.is_empty() {
        return Err("Zip file is empty".to_string());
    }

    // Get the root folder name from the first entry
    let first_entry = archive.by_index(0)
        .map_err(|e| format!("Failed to read zip entry: {}", e))?;

    // Normalize path separators (Windows tools may use backslashes)
    let name = normalize_zip_path(first_entry.name());
    let project_name = name.split('/').next().unwrap_or(&name);

    if project_name.is_empty() {
        return Err("Could not determine project name from zip".to_string());
    }

    // Validate the project name is valid (catches manually created zips with invalid names)
    validate_name(project_name).map_err(|e| {
        format!(
            "Cannot import: project name '{}' in zip is invalid ({}). \
            This zip may have been created manually. \
            Please rename the root folder in the zip to a valid name \
            (lowercase letters, numbers, hyphens, underscores only).",
            project_name, e
        )
    })?;

    // Check if project exists
    let project_path = get_projects_path().join(project_name);
    if project_path.exists() {
        Ok(Some(project_name.to_string()))
    } else {
        Ok(None)
    }
}

/// Import a project from a zip file
/// If rename_to is provided, the project will be renamed during import
#[tauri::command]
pub async fn import_project(
    zip_path: String,
    rename_to: Option<String>,
) -> Result<ProjectMeta, String> {
    // Ensure workspace exists (handles fresh install case)
    ensure_workspace()?;

    // Validate rename_to if provided
    if let Some(ref new_name) = rename_to {
        validate_name(new_name)?;
    }

    let file = File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    if archive.is_empty() {
        return Err("Zip file is empty".to_string());
    }

    // Get the original project name from zip structure
    let first_entry = archive
        .by_index(0)
        .map_err(|e| format!("Failed to read zip entry: {}", e))?;

    // Normalize path separators (Windows tools may use backslashes)
    let first_entry_name = normalize_zip_path(first_entry.name());
    let original_name = first_entry_name
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();

    drop(first_entry);

    if original_name.is_empty() {
        return Err("Could not determine project name from zip".to_string());
    }

    // If not renaming, validate the original name from the zip is valid
    // (it might be malformed if someone manually created the zip)
    if rename_to.is_none() {
        validate_name(&original_name).map_err(|e| {
            format!(
                "Cannot import: project name '{}' in zip is invalid ({}). \
                This zip may have been created manually. \
                Please rename the root folder in the zip to a valid name \
                (lowercase letters, numbers, hyphens, underscores only).",
                original_name, e
            )
        })?;
    }

    let target_name = rename_to.as_ref().unwrap_or(&original_name);
    let target_path = get_projects_path().join(target_name);

    // If replacing, delete existing project first
    if target_path.exists() {
        fs::remove_dir_all(&target_path)
            .map_err(|e| format!("Failed to remove existing project: {}", e))?;
    }

    // Extract all files
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        // Normalize path separators (Windows tools may use backslashes)
        let entry_path = normalize_zip_path(entry.name());

        // Replace original name with target name in path
        // Only extract entries that belong to the project folder
        let relative_path =
            if let Some(stripped) = entry_path.strip_prefix(&format!("{}/", original_name)) {
                stripped.to_string()
            } else if entry_path == original_name || entry_path == format!("{}/", original_name) {
                String::new()
            } else {
                // Entry doesn't belong to the expected project folder - skip it
                // This handles malformed zips with extra files at the root
                eprintln!(
                    "[WARN] Skipping unexpected zip entry '{}' (expected prefix '{}')",
                    entry_path, original_name
                );
                continue;
            };

        if relative_path.is_empty() {
            // Create root directory
            fs::create_dir_all(&target_path)
                .map_err(|e| format!("Failed to create project directory: {}", e))?;
            continue;
        }

        let out_path = target_path.join(&relative_path);

        // Security: Validate path doesn't escape project directory (path traversal protection)
        // Check for obvious path traversal attempts first (before any filesystem operations)
        if relative_path.contains("..") {
            return Err(format!(
                "Security error: zip entry '{}' contains path traversal sequence",
                entry_path
            ));
        }

        // Verify the resolved path is under the target directory
        // We use lexical comparison since we haven't created directories yet
        let canonical_target = target_path
            .canonicalize()
            .unwrap_or_else(|_| target_path.clone());

        // Build what the canonical path WOULD be by starting from target and adding components
        // This avoids creating directories before validation
        let mut expected_path = canonical_target.clone();
        for component in Path::new(&relative_path).components() {
            use std::path::Component;
            match component {
                Component::Normal(name) => expected_path.push(name),
                Component::ParentDir => {
                    return Err(format!(
                        "Security error: zip entry '{}' contains parent directory reference",
                        entry_path
                    ));
                }
                Component::CurDir => {} // Skip "." components
                _ => {
                    return Err(format!(
                        "Security error: zip entry '{}' contains invalid path component",
                        entry_path
                    ));
                }
            }
        }

        // Final check: ensure the expected path is under target
        if !expected_path.starts_with(&canonical_target) {
            return Err(format!(
                "Security error: zip entry '{}' would extract outside project directory",
                entry_path
            ));
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            // Ensure parent directory exists
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }

            let mut outfile = File::create(&out_path)
                .map_err(|e| format!("Failed to create file: {}", e))?;

            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Load and update the project metadata
    let metadata_path = target_path.join(".vstworkshop/metadata.json");
    if !metadata_path.exists() {
        return Err("Imported project is missing metadata".to_string());
    }

    let content = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let mut meta: ProjectMeta =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse metadata: {}", e))?;

    // IMPORTANT: Always generate a new UUID to prevent ID collisions
    // This is critical when importing a copy of an existing project
    meta.id = uuid::Uuid::new_v4().to_string();
    meta.path = target_path.to_string_lossy().to_string();
    meta.name = target_name.to_string();
    meta.updated_at = chrono::Utc::now().to_rfc3339();

    // Save updated metadata
    let updated_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&metadata_path, &updated_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    // If renamed, update Cargo.toml package name to avoid workspace conflicts
    if rename_to.is_some() {
        update_cargo_package_name(&target_path, &original_name, target_name)?;
    }

    // Fix chat history attachment paths (they were absolute, need to update to new location)
    fix_chat_attachment_paths(&target_path, &original_name, target_name)?;

    Ok(meta)
}

/// Update Cargo.toml package name when importing with rename
/// This prevents workspace conflicts when both original and renamed projects exist
fn update_cargo_package_name(
    project_path: &Path,
    original_name: &str,
    new_name: &str,
) -> Result<(), String> {
    let cargo_path = project_path.join("Cargo.toml");

    if !cargo_path.exists() {
        return Err("Imported project is missing Cargo.toml".to_string());
    }

    let content = fs::read_to_string(&cargo_path)
        .map_err(|e| format!("Failed to read Cargo.toml: {}", e))?;

    // Convert names to snake_case for Cargo package names
    let old_package_name = to_snake_case(original_name);
    let new_package_name = to_snake_case(new_name);

    // Replace the package name in the [package] section
    // Match: name = "old_name" (with possible whitespace variations)
    let updated = content.replace(
        &format!("name = \"{}\"", old_package_name),
        &format!("name = \"{}\"", new_package_name),
    );

    // Check if we actually made a replacement
    if updated == content {
        // Try without quotes (some might use single quotes or different formatting)
        eprintln!(
            "[WARN] Could not find package name '{}' in Cargo.toml, skipping rename",
            old_package_name
        );
        // Don't fail - the project might still work if names happen to not conflict
        return Ok(());
    }

    fs::write(&cargo_path, updated)
        .map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;

    eprintln!(
        "[INFO] Updated Cargo.toml package name: {} -> {}",
        old_package_name, new_package_name
    );

    Ok(())
}

/// Fix attachment paths in chat history after import
/// Handles both:
/// 1. Relative paths from new exports (e.g., ".vstworkshop/uploads/uuid/file.pdf")
/// 2. Absolute paths from legacy exports (e.g., "/Users/.../uploads/uuid/file.pdf")
fn fix_chat_attachment_paths(
    project_path: &Path,
    _original_name: &str,
    _new_name: &str,
) -> Result<(), String> {
    let chat_path = project_path.join(".vstworkshop/chat.json");

    if !chat_path.exists() {
        return Ok(()); // No chat history to fix
    }

    let content =
        fs::read_to_string(&chat_path).map_err(|e| format!("Failed to read chat history: {}", e))?;

    let mut history: ChatHistory = match serde_json::from_str(&content) {
        Ok(h) => h,
        Err(_) => return Ok(()), // Can't parse, skip fixing
    };

    let project_path_str = project_path.to_string_lossy().to_string();
    let uploads_dir = project_path.join(".vstworkshop/uploads");
    let mut modified = false;

    // Update attachment paths in all messages
    for message in &mut history.messages {
        if let Some(ref mut attachments) = message.attachments {
            for attachment in attachments.iter_mut() {
                // Normalize path for comparison (handle Windows backslashes)
                let normalized_path = attachment.path.replace('\\', "/");

                // Case 1: Relative path from portable export (new format)
                // e.g., ".vstworkshop/uploads/uuid/file.pdf"
                if normalized_path.starts_with(".vstworkshop/") {
                    // Convert to absolute path for this project
                    let absolute_path = project_path.join(&normalized_path);
                    attachment.path = absolute_path.to_string_lossy().to_string();
                    modified = true;
                    continue;
                }

                // Case 2: Already correct absolute path for this project
                if attachment.path.starts_with(&project_path_str) {
                    // Path is already correct, check if file exists
                    if Path::new(&attachment.path).exists() {
                        continue; // All good
                    }
                }

                // Case 3: Legacy absolute path from different location
                // Try to reconstruct from attachment ID and filename
                let reconstructed = uploads_dir
                    .join(&attachment.id)
                    .join(&attachment.original_name);

                if reconstructed.exists() {
                    attachment.path = reconstructed.to_string_lossy().to_string();
                    modified = true;
                } else {
                    // Last resort: check if path contains .vstworkshop/uploads and extract relative part
                    if let Some(idx) = normalized_path.find(".vstworkshop/uploads") {
                        let relative = &normalized_path[idx..];
                        let absolute_path = project_path.join(relative);
                        if absolute_path.exists() {
                            attachment.path = absolute_path.to_string_lossy().to_string();
                            modified = true;
                        }
                    }
                    // If file still doesn't exist, leave path as-is
                    // Frontend should handle missing attachments gracefully
                }
            }
        }
    }

    if modified {
        let updated_json = serde_json::to_string_pretty(&history)
            .map_err(|e| format!("Failed to serialize chat history: {}", e))?;
        fs::write(&chat_path, updated_json)
            .map_err(|e| format!("Failed to write chat history: {}", e))?;
    }

    Ok(())
}
