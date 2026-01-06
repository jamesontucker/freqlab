use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct AttachmentInput {
    #[serde(rename = "originalName")]
    pub original_name: String,
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct StoredAttachment {
    pub id: String,
    #[serde(rename = "originalName")]
    pub original_name: String,
    pub path: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub size: u64,
}

/// Sanitize filename to prevent path traversal attacks
/// Extracts just the filename component and removes any dangerous characters
fn sanitize_filename(name: &str) -> String {
    // Extract just the filename from any path (handles both / and \)
    let filename = Path::new(name)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("unnamed");

    // Remove any remaining dangerous characters
    let sanitized: String = filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();

    // Ensure we have a valid filename
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "unnamed".to_string()
    } else {
        sanitized
    }
}

/// Store uploaded files in the project's .vstworkshop/uploads directory
#[tauri::command]
pub async fn store_chat_attachments(
    project_path: String,
    attachments: Vec<AttachmentInput>,
) -> Result<Vec<StoredAttachment>, String> {
    let uploads_dir = PathBuf::from(&project_path)
        .join(".vstworkshop")
        .join("uploads");

    let mut stored = Vec::new();

    for attachment in attachments {
        // Validate source file exists
        let source = Path::new(&attachment.source_path);
        if !source.exists() {
            return Err(format!(
                "Source file not found: {}",
                attachment.original_name
            ));
        }
        if !source.is_file() {
            return Err(format!(
                "Source path is not a file: {}",
                attachment.original_name
            ));
        }

        // Sanitize the filename to prevent path traversal
        let safe_filename = sanitize_filename(&attachment.original_name);

        let id = Uuid::new_v4().to_string();
        let target_dir = uploads_dir.join(&id);
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create upload dir: {}", e))?;

        let target_path = target_dir.join(&safe_filename);
        fs::copy(&attachment.source_path, &target_path)
            .map_err(|e| format!("Failed to copy '{}': {}", attachment.original_name, e))?;

        // Get actual file size from the copied file
        let actual_size = fs::metadata(&target_path)
            .map(|m| m.len())
            .unwrap_or(0);

        stored.push(StoredAttachment {
            id,
            original_name: safe_filename,
            path: target_path.to_string_lossy().to_string(),
            mime_type: attachment.mime_type,
            size: actual_size,
        });
    }

    Ok(stored)
}
