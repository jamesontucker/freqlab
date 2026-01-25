//! Token usage tracking by reading Claude Code's JSONL logs
//!
//! Claude Code stores session logs at ~/.claude/projects/<project-path-hash>/<session-id>.jsonl
//! where the project path hash is the path with / replaced by -

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

/// Token usage statistics for a session
#[derive(Debug, Clone, Serialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    pub context_percent: f32,
    pub message_count: u32,
}

/// Internal struct for parsing JSONL message usage
#[derive(Deserialize, Debug)]
struct JsonlEntry {
    message: Option<MessageData>,
    #[serde(rename = "type")]
    entry_type: Option<String>,
}

#[derive(Deserialize, Debug)]
struct MessageData {
    usage: Option<UsageData>,
}

#[derive(Deserialize, Debug)]
struct UsageData {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

/// Convert a project path to Claude's folder name format
/// /Users/jameson/VSTWorkshop/projects/my_plugin -> -Users-jameson-VSTWorkshop-projects-my_plugin
fn project_path_to_claude_folder(project_path: &str) -> String {
    project_path.replace('/', "-")
}

/// Get the Claude projects directory
fn get_claude_projects_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let claude_dir = PathBuf::from(home).join(".claude").join("projects");
    if claude_dir.exists() {
        Some(claude_dir)
    } else {
        None
    }
}

/// Find the Claude log folder for a given project path
pub fn find_claude_log_folder(project_path: &str) -> Option<PathBuf> {
    let claude_dir = get_claude_projects_dir()?;
    let folder_name = project_path_to_claude_folder(project_path);
    let folder_path = claude_dir.join(&folder_name);

    if folder_path.exists() {
        Some(folder_path)
    } else {
        None
    }
}

/// Parse a single JSONL file and get token usage
/// For context %, we use the MOST RECENT assistant message's usage (not cumulative)
/// because cache_read tokens would be counted multiple times otherwise
fn parse_jsonl_usage(file_path: &PathBuf) -> TokenUsage {
    let mut usage = TokenUsage::default();
    let mut last_context_size: u64 = 0;

    let file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => return usage,
    };

    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        let entry: JsonlEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Count messages (user and assistant turns)
        if let Some(ref t) = entry.entry_type {
            if t == "user" || t == "assistant" {
                usage.message_count += 1;
            }
        }

        // Track usage - we sum output tokens but track latest context size
        if let Some(msg) = entry.message {
            if let Some(u) = msg.usage {
                let input = u.input_tokens.unwrap_or(0);
                let output = u.output_tokens.unwrap_or(0);
                let cache_create = u.cache_creation_input_tokens.unwrap_or(0);
                let cache_read = u.cache_read_input_tokens.unwrap_or(0);

                // Sum totals for display
                usage.input_tokens += input;
                usage.output_tokens += output;
                usage.cache_creation_tokens += cache_create;
                usage.cache_read_tokens += cache_read;

                // The current context size is: input (new tokens) + cache_read (cached tokens)
                // This represents what's actually in the context window for THIS request
                let this_context = input + cache_read + cache_create;
                if this_context > 0 {
                    last_context_size = this_context;
                }
            }
        }
    }

    // Use the most recent context size for percentage calculation
    // This represents the actual current state of the context window
    usage.total_tokens = last_context_size;

    // Calculate context percentage (200K context window)
    const CONTEXT_WINDOW: f32 = 200_000.0;
    usage.context_percent = (last_context_size as f32 / CONTEXT_WINDOW * 100.0).min(100.0);

    usage
}

/// Get token usage for a specific session
#[tauri::command]
pub async fn get_session_usage(project_path: String, session_id: String) -> Result<TokenUsage, String> {
    let claude_folder = find_claude_log_folder(&project_path)
        .ok_or_else(|| "Claude log folder not found for this project".to_string())?;

    let jsonl_path = claude_folder.join(format!("{}.jsonl", session_id));

    if !jsonl_path.exists() {
        return Err(format!("Session log not found: {}", session_id));
    }

    Ok(parse_jsonl_usage(&jsonl_path))
}

/// Get token usage for the current session of a project
/// Reads session_id from .vstworkshop/claude_session.txt
#[tauri::command]
pub async fn get_project_usage(project_path: String) -> Result<TokenUsage, String> {
    // Read the current session ID
    let session_file = PathBuf::from(&project_path)
        .join(".vstworkshop")
        .join("claude_session.txt");

    let session_id = fs::read_to_string(&session_file)
        .map_err(|_| "No active session found for this project".to_string())?
        .trim()
        .to_string();

    if session_id.is_empty() {
        return Err("No active session found for this project".to_string());
    }

    get_session_usage(project_path, session_id).await
}

/// Get total usage across all sessions for a project
#[tauri::command]
pub async fn get_project_total_usage(project_path: String) -> Result<TokenUsage, String> {
    let claude_folder = find_claude_log_folder(&project_path)
        .ok_or_else(|| "Claude log folder not found for this project".to_string())?;

    let mut total = TokenUsage::default();

    // Read all JSONL files in the folder
    let entries = fs::read_dir(&claude_folder)
        .map_err(|e| format!("Failed to read Claude log folder: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            let session_usage = parse_jsonl_usage(&path);
            total.input_tokens += session_usage.input_tokens;
            total.output_tokens += session_usage.output_tokens;
            total.cache_creation_tokens += session_usage.cache_creation_tokens;
            total.cache_read_tokens += session_usage.cache_read_tokens;
            total.message_count += session_usage.message_count;
        }
    }

    total.total_tokens = total.input_tokens + total.cache_read_tokens;
    const CONTEXT_WINDOW: f32 = 200_000.0;
    total.context_percent = (total.total_tokens as f32 / CONTEXT_WINDOW * 100.0).min(100.0);

    Ok(total)
}

/// Delete Claude log folder for a project
pub fn delete_claude_logs(project_path: &str) -> Result<(), String> {
    if let Some(folder) = find_claude_log_folder(project_path) {
        fs::remove_dir_all(&folder)
            .map_err(|e| format!("Failed to delete Claude logs: {}", e))?;
        eprintln!("[DEBUG] Deleted Claude logs at: {:?}", folder);
    }
    Ok(())
}

/// List orphaned Claude log folders (logs for projects that no longer exist)
#[tauri::command]
pub async fn list_orphaned_claude_logs(workspace_path: String) -> Result<Vec<String>, String> {
    let claude_dir = get_claude_projects_dir()
        .ok_or_else(|| "Claude projects directory not found".to_string())?;

    let mut orphaned = Vec::new();

    // Pattern to match VSTWorkshop project folders
    let workspace_prefix = project_path_to_claude_folder(&workspace_path);

    let entries = fs::read_dir(&claude_dir)
        .map_err(|e| format!("Failed to read Claude projects directory: {}", e))?;

    for entry in entries.flatten() {
        let folder_name = entry.file_name().to_string_lossy().to_string();

        // Only check folders that match our workspace
        if folder_name.starts_with(&workspace_prefix) {
            // Convert back to path format
            let original_path = folder_name.replace('-', "/");

            // Check if the project still exists
            if !PathBuf::from(&original_path).exists() {
                orphaned.push(folder_name);
            }
        }
    }

    Ok(orphaned)
}

/// Clean up orphaned Claude logs
#[tauri::command]
pub async fn cleanup_orphaned_claude_logs(workspace_path: String) -> Result<u32, String> {
    let orphaned = list_orphaned_claude_logs(workspace_path).await?;
    let count = orphaned.len() as u32;

    let claude_dir = get_claude_projects_dir()
        .ok_or_else(|| "Claude projects directory not found".to_string())?;

    for folder_name in orphaned {
        let folder_path = claude_dir.join(&folder_name);
        if let Err(e) = fs::remove_dir_all(&folder_path) {
            eprintln!("[WARN] Failed to delete orphaned Claude logs {}: {}", folder_name, e);
        } else {
            eprintln!("[DEBUG] Deleted orphaned Claude logs: {}", folder_name);
        }
    }

    Ok(count)
}
