use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// File attachment stored with a chat message
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileAttachment {
    pub id: String,
    #[serde(rename = "originalName")]
    pub original_name: String,
    pub path: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub id: String,
    pub role: String, // "user" or "assistant"
    pub content: String,
    pub timestamp: String,
    #[serde(rename = "commitHash", skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u32>, // Version number for commits that changed files
    #[serde(default)]
    pub reverted: bool, // Computed from activeVersion, kept for backwards compat
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub attachments: Option<Vec<FileAttachment>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatHistory {
    pub messages: Vec<ChatMessage>,
    #[serde(rename = "lastUpdated")]
    pub last_updated: String,
    #[serde(rename = "activeVersion", skip_serializing_if = "Option::is_none", default)]
    pub active_version: Option<u32>, // Currently checked-out version
}

/// Response when loading chat - includes activeVersion
#[derive(Serialize, Debug)]
pub struct ChatState {
    pub messages: Vec<ChatMessage>,
    #[serde(rename = "activeVersion")]
    pub active_version: Option<u32>,
}

fn get_chat_file_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".vstworkshop")
        .join("chat.json")
}

/// Save chat history with optional explicit activeVersion
/// If activeVersion is provided, it will be used (even if None to clear it)
/// If activeVersion is not provided (undefined in JS), preserves existing value from disk
#[tauri::command]
pub async fn save_chat_history(
    project_path: String,
    messages: Vec<ChatMessage>,
    active_version: Option<Option<u32>>,  // None = preserve existing, Some(x) = use x
) -> Result<(), String> {
    let chat_file = get_chat_file_path(&project_path);

    // Ensure directory exists
    if let Some(parent) = chat_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create chat directory: {}", e))?;
    }

    // Determine activeVersion to use:
    // - If explicitly provided (Some), use that value
    // - If not provided (None), preserve existing from disk
    let final_active_version = match active_version {
        Some(v) => v,  // Explicit value provided (could be Some(n) or None)
        None => {
            // Not provided - preserve existing
            if chat_file.exists() {
                fs::read_to_string(&chat_file)
                    .ok()
                    .and_then(|c| serde_json::from_str::<ChatHistory>(&c).ok())
                    .and_then(|h| h.active_version)
            } else {
                None
            }
        }
    };

    let history = ChatHistory {
        messages,
        last_updated: chrono::Utc::now().to_rfc3339(),
        active_version: final_active_version,
    };

    let json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize chat history: {}", e))?;

    fs::write(&chat_file, json)
        .map_err(|e| format!("Failed to write chat history: {}", e))?;

    Ok(())
}

/// Load chat history with active version info
#[tauri::command]
pub async fn load_chat_history(project_path: String) -> Result<ChatState, String> {
    let chat_file = get_chat_file_path(&project_path);

    if !chat_file.exists() {
        return Ok(ChatState {
            messages: Vec::new(),
            active_version: None,
        });
    }

    let content = fs::read_to_string(&chat_file)
        .map_err(|e| format!("Failed to read chat history: {}", e))?;

    let history: ChatHistory = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse chat history: {}", e))?;

    Ok(ChatState {
        messages: history.messages,
        active_version: history.active_version,
    })
}

/// Update the active version in chat history (without git checkout)
/// Used after creating a new version to persist the activeVersion
#[tauri::command]
pub async fn update_active_version(
    project_path: String,
    version: u32,
) -> Result<(), String> {
    let chat_file = get_chat_file_path(&project_path);

    if !chat_file.exists() {
        return Err("No chat history found".to_string());
    }

    let content = fs::read_to_string(&chat_file)
        .map_err(|e| format!("Failed to read chat history: {}", e))?;

    let mut history: ChatHistory = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse chat history: {}", e))?;

    history.active_version = Some(version);
    history.last_updated = chrono::Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize chat history: {}", e))?;

    fs::write(&chat_file, json)
        .map_err(|e| format!("Failed to write chat history: {}", e))?;

    eprintln!("[DEBUG] Updated activeVersion to {} (no git checkout)", version);

    Ok(())
}

/// Get the current effective version for a project
/// Returns activeVersion if set, otherwise max version from messages, defaulting to 1
#[tauri::command]
pub async fn get_current_version(project_path: String) -> Result<u32, String> {
    let chat_file = get_chat_file_path(&project_path);

    if !chat_file.exists() {
        return Ok(1); // Default to v1 for new projects
    }

    let content = fs::read_to_string(&chat_file)
        .map_err(|e| format!("Failed to read chat history: {}", e))?;

    let history: ChatHistory = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse chat history: {}", e))?;

    // If activeVersion is explicitly set, use it
    if let Some(active) = history.active_version {
        return Ok(active);
    }

    // Otherwise, find the max version from messages
    let max_version = history
        .messages
        .iter()
        .filter_map(|m| m.version)
        .max()
        .unwrap_or(1); // Default to v1 if no versions found

    Ok(max_version)
}

/// Set the active version and checkout that commit
#[tauri::command]
pub async fn set_active_version(
    project_path: String,
    version: u32,
    commit_hash: String,
) -> Result<ChatState, String> {
    eprintln!("[DEBUG] set_active_version called: version={}, commit={}", version, commit_hash);
    eprintln!("[DEBUG] project_path: {}", project_path);

    let chat_file = get_chat_file_path(&project_path);

    // Load existing history
    let mut history = if chat_file.exists() {
        let content = fs::read_to_string(&chat_file)
            .map_err(|e| format!("Failed to read chat history: {}", e))?;
        serde_json::from_str::<ChatHistory>(&content)
            .map_err(|e| format!("Failed to parse chat history: {}", e))?
    } else {
        return Err("No chat history found".to_string());
    };

    // First, verify the commit exists
    let verify_output = std::process::Command::new("git")
        .current_dir(&project_path)
        .args(["cat-file", "-t", &commit_hash])
        .output()
        .map_err(|e| format!("Failed to verify commit: {}", e))?;

    if !verify_output.status.success() {
        return Err(format!("Commit {} does not exist", commit_hash));
    }
    eprintln!("[DEBUG] Commit verified: {}", String::from_utf8_lossy(&verify_output.stdout).trim());

    // Show what files will change
    let diff_output = std::process::Command::new("git")
        .current_dir(&project_path)
        .args(["diff", "--name-only", &commit_hash, "--", "src/"])
        .output();
    if let Ok(diff) = diff_output {
        eprintln!("[DEBUG] Files that differ from target commit:\n{}",
            String::from_utf8_lossy(&diff.stdout));
    }

    // Checkout the files from that version's commit with force flag
    eprintln!("[DEBUG] Running: git checkout -f {} -- src/ Cargo.toml", commit_hash);
    let checkout_output = std::process::Command::new("git")
        .current_dir(&project_path)
        .args([
            "checkout",
            "-f",  // Force checkout, discard local changes
            &commit_hash,
            "--",
            "src/",
            "Cargo.toml",
        ])
        .output()
        .map_err(|e| format!("Failed to run git checkout: {}", e))?;

    eprintln!("[DEBUG] Checkout status: {}", checkout_output.status);
    eprintln!("[DEBUG] Checkout stdout: {}", String::from_utf8_lossy(&checkout_output.stdout));
    eprintln!("[DEBUG] Checkout stderr: {}", String::from_utf8_lossy(&checkout_output.stderr));

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        // Only ignore "pathspec did not match" errors for optional files
        if !stderr.contains("did not match any") {
            return Err(format!("git checkout failed: {}", stderr));
        }
    }

    // Also try Cargo.lock (may not exist)
    let _ = std::process::Command::new("git")
        .current_dir(&project_path)
        .args(["checkout", "-f", &commit_hash, "--", "Cargo.lock"])
        .output();

    // Verify the checkout worked by checking the current state
    let status_output = std::process::Command::new("git")
        .current_dir(&project_path)
        .args(["status", "--short"])
        .output();
    if let Ok(status) = status_output {
        eprintln!("[DEBUG] Git status after checkout:\n{}",
            String::from_utf8_lossy(&status.stdout));
    }

    // Update active version
    history.active_version = Some(version);
    history.last_updated = chrono::Utc::now().to_rfc3339();

    // Save
    let json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize chat history: {}", e))?;
    fs::write(&chat_file, json)
        .map_err(|e| format!("Failed to write chat history: {}", e))?;

    eprintln!("[DEBUG] set_active_version completed successfully");

    Ok(ChatState {
        messages: history.messages,
        active_version: history.active_version,
    })
}
