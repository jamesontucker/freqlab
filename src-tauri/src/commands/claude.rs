use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Serialize, Clone)]
pub struct ClaudeResponse {
    pub content: String,
    pub session_id: Option<String>,
    pub commit_hash: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum ClaudeStreamEvent {
    #[serde(rename = "start")]
    Start { project_path: String },
    #[serde(rename = "text")]
    Text { project_path: String, content: String },
    #[serde(rename = "error")]
    Error { project_path: String, message: String },
    #[serde(rename = "done")]
    Done { project_path: String, content: String },
}

/// Represents a parsed event from Claude CLI stream-json output
#[derive(Deserialize, Debug)]
struct ClaudeJsonEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    message: Option<ClaudeMessage>,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    tool_input: Option<serde_json::Value>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct ClaudeMessage {
    #[serde(default)]
    content: Option<serde_json::Value>,
}

/// Get the session file path for a project
fn get_session_file(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".vstworkshop")
        .join("claude_session.txt")
}

/// Load session ID for a project (if exists)
fn load_session_id(project_path: &str) -> Option<String> {
    let session_file = get_session_file(project_path);
    fs::read_to_string(session_file).ok().map(|s| s.trim().to_string())
}

/// Save session ID for a project
fn save_session_id(project_path: &str, session_id: &str) -> Result<(), String> {
    let session_file = get_session_file(project_path);
    fs::write(&session_file, session_id)
        .map_err(|e| format!("Failed to save session ID: {}", e))
}

/// Extract session_id from a JSON event if present
fn extract_session_id(json_str: &str) -> Option<String> {
    let event: ClaudeJsonEvent = serde_json::from_str(json_str).ok()?;
    event.session_id
}

/// Parse a JSON event and return a human-readable string
fn parse_claude_event(json_str: &str) -> Option<String> {
    let event: ClaudeJsonEvent = serde_json::from_str(json_str).ok()?;

    match event.event_type.as_str() {
        "assistant" => {
            // Extract text content from assistant message
            if let Some(msg) = &event.message {
                if let Some(content) = &msg.content {
                    // Content can be a string or array of content blocks
                    if let Some(text) = content.as_str() {
                        return Some(text.to_string());
                    } else if let Some(arr) = content.as_array() {
                        let texts: Vec<String> = arr
                            .iter()
                            .filter_map(|item| {
                                if item.get("type")?.as_str()? == "text" {
                                    item.get("text")?.as_str().map(|s| s.to_string())
                                } else {
                                    None
                                }
                            })
                            .collect();
                        if !texts.is_empty() {
                            return Some(texts.join("\n"));
                        }
                    }
                }
            }
            None
        }
        "tool_use" => {
            let tool = event.tool.as_deref().unwrap_or("unknown");
            match tool {
                "Read" => {
                    if let Some(input) = &event.tool_input {
                        let file = input.get("file_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("file");
                        Some(format!("📖 Reading: {}", file))
                    } else {
                        Some("📖 Reading file...".to_string())
                    }
                }
                "Edit" => {
                    if let Some(input) = &event.tool_input {
                        let file = input.get("file_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("file");
                        Some(format!("✏️  Editing: {}", file))
                    } else {
                        Some("✏️  Editing file...".to_string())
                    }
                }
                "Write" => {
                    if let Some(input) = &event.tool_input {
                        let file = input.get("file_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("file");
                        Some(format!("📝 Writing: {}", file))
                    } else {
                        Some("📝 Writing file...".to_string())
                    }
                }
                "Bash" => {
                    if let Some(input) = &event.tool_input {
                        let cmd = input.get("command")
                            .and_then(|v| v.as_str())
                            .unwrap_or("command");
                        // Truncate long commands
                        let display_cmd = if cmd.len() > 60 {
                            format!("{}...", &cmd[..60])
                        } else {
                            cmd.to_string()
                        };
                        Some(format!("💻 Running: {}", display_cmd))
                    } else {
                        Some("💻 Running command...".to_string())
                    }
                }
                _ => Some(format!("🔧 Using tool: {}", tool)),
            }
        }
        "tool_result" => {
            // Tool completed - could show result summary
            Some("   ✓ Done".to_string())
        }
        "result" => {
            // Final result
            if let Some(result) = &event.result {
                Some(format!("\n{}", result))
            } else {
                None
            }
        }
        "error" => {
            if let Some(content) = &event.content {
                Some(format!("❌ Error: {}", content))
            } else {
                Some("❌ An error occurred".to_string())
            }
        }
        _ => None,
    }
}

/// Get human-readable description for a component ID
fn get_component_description(component_id: &str) -> &'static str {
    match component_id {
        // Effect components
        "custom_gui" => "Custom GUI using nih_plug_vizia with knobs, sliders, and visual feedback",
        "preset_system" => "Preset save/load system with factory presets and user preset management",
        "param_smoothing" => "Advanced parameter smoothing with configurable interpolation curves",
        "sidechain_input" => "Sidechain audio input for ducking, keying, or modulation sources",
        "oversampling" => "2x/4x oversampling for reduced aliasing in nonlinear processing",
        // Instrument components
        "polyphony" => "Polyphonic voice architecture with 8 voices and voice stealing",
        "velocity_layers" => "Velocity-sensitive response with multiple sample/synthesis layers",
        "adsr_envelope" => "ADSR amplitude envelope with attack, decay, sustain, release controls",
        "lfo" => "LFO modulation source with multiple waveforms and tempo sync",
        _ => "Additional plugin feature",
    }
}

/// Build the system context for Claude when working on a plugin project
fn build_context(project_name: &str, description: &str, components: Option<&Vec<String>>, is_first_message: bool) -> String {
    let mut context = format!(
        r#"You are helping develop a VST audio plugin using nih-plug (Rust).

Project: {project_name}
Description: {description}

IMPORTANT: For nih-plug API reference, always check the official docs at:
https://nih-plug.robbertvanderhelm.nl/nih_plug/index.html

Key nih-plug conventions:
- Plugin struct holds params as Arc<PluginParams>
- Use #[derive(Params)] for parameter structs
- FloatParam for continuous values, IntParam for integers, BoolParam for toggles
- Process audio in the `process` method, iterate over buffer.iter_samples()
- Use .smoothed.next() for parameter smoothing
- Export with nih_export_vst3! and nih_export_clap! macros

When modifying the plugin:
1. Read src/lib.rs first to understand current state
2. Edit src/lib.rs with your changes
3. Keep code clean and well-commented
4. Use proper DSP practices (avoid denormals, handle edge cases)
5. Briefly summarize what you changed after making edits

The user will describe what they want. Make the changes directly to the code."#,
        project_name = project_name,
        description = description
    );

    // Add component scaffolding instructions for first message of new projects with components
    if is_first_message {
        if let Some(comps) = components {
            if !comps.is_empty() {
                context.push_str("\n\n--- STARTER COMPONENTS ---\n");
                context.push_str("The user selected the following starter components when creating this plugin.\n");
                context.push_str("On the FIRST user message, implement scaffolding for these components:\n\n");

                for comp_id in comps {
                    let desc = get_component_description(comp_id);
                    context.push_str(&format!("- {}: {}\n", comp_id, desc));
                }

                context.push_str("\nGenerate working skeleton code for each component. ");
                context.push_str("Include TODO comments where the user will need to customize behavior. ");
                context.push_str("Make sure the plugin still compiles and runs after adding components.");
            }
        }
    }

    context
}

/// Load project metadata to get components and other info
fn load_project_metadata(project_path: &str) -> Option<super::projects::ProjectMeta> {
    let metadata_path = PathBuf::from(project_path)
        .join(".vstworkshop")
        .join("metadata.json");

    let content = fs::read_to_string(metadata_path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub async fn send_to_claude(
    project_path: String,
    project_name: String,
    description: String,
    message: String,
    window: tauri::Window,
) -> Result<ClaudeResponse, String> {
    // Ensure git is initialized for this project (handles existing projects)
    if !super::git::is_git_repo(&project_path) {
        super::git::init_repo(&project_path)?;
        super::git::create_gitignore(&project_path)?;
        super::git::commit_changes(&project_path, "Initialize git for version control")?;
    }

    // Ensure .vstworkshop/ is not tracked by git (fixes existing projects)
    // This prevents chat.json from being reverted when doing git checkout
    if let Err(e) = super::git::ensure_vstworkshop_ignored(&project_path) {
        eprintln!("[WARN] Failed to update gitignore: {}", e);
    }

    // Check for existing session to resume
    let existing_session = load_session_id(&project_path);
    let is_first_message = existing_session.is_none();

    // Load project metadata to get components
    let metadata = load_project_metadata(&project_path);
    let components = metadata.as_ref().and_then(|m| m.components.as_ref());

    // Build context with components info for first message
    let context = build_context(&project_name, &description, components, is_first_message);

    // Build args - include --resume if we have an existing session
    let mut args = vec![
        "-p".to_string(),
        message.clone(),
        "--verbose".to_string(),
        "--allowedTools".to_string(),
        "Edit,Write,Read".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--max-turns".to_string(),
        "15".to_string(),
    ];

    // Only add system prompt on first message (new session)
    // For resumed sessions, Claude already has the context
    if existing_session.is_none() {
        args.push("--append-system-prompt".to_string());
        args.push(context);
    }

    // Add resume flag if we have an existing session
    if let Some(ref session_id) = existing_session {
        args.push("--resume".to_string());
        args.push(session_id.clone());
        eprintln!("[DEBUG] Resuming Claude session: {}", session_id);
    } else {
        eprintln!("[DEBUG] Starting new Claude session");
    }

    // Spawn Claude CLI process with stream-json for detailed output
    let mut child = Command::new("claude")
        .current_dir(&project_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude CLI: {}", e))?;

    // Emit start event
    let _ = window.emit("claude-stream", ClaudeStreamEvent::Start {
        project_path: project_path.clone()
    });

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

    let mut full_output = String::new();
    let mut error_output = String::new();
    let mut captured_session_id: Option<String> = None;

    // Read stdout and stderr concurrently
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(json_line)) => {
                        // Try to extract session_id if present
                        if let Some(sid) = extract_session_id(&json_line) {
                            captured_session_id = Some(sid);
                        }

                        // Try to parse as JSON event for display
                        if let Some(display_text) = parse_claude_event(&json_line) {
                            full_output.push_str(&display_text);
                            full_output.push('\n');
                            let _ = window.emit("claude-stream", ClaudeStreamEvent::Text {
                                project_path: project_path.clone(),
                                content: display_text,
                            });
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
                            project_path: project_path.clone(),
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
                        // Also emit stderr as it may contain useful info
                        let _ = window.emit("claude-stream", ClaudeStreamEvent::Text {
                            project_path: project_path.clone(),
                            content: format!("[stderr] {}", text),
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
        .map_err(|e| format!("Failed to wait for Claude CLI: {}", e))?;

    if !status.success() && !error_output.is_empty() {
        let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
            project_path: project_path.clone(),
            message: error_output.clone(),
        });
        return Err(format!("Claude CLI failed: {}", error_output));
    }

    // Emit done event
    let _ = window.emit("claude-stream", ClaudeStreamEvent::Done {
        project_path: project_path.clone(),
        content: full_output.clone(),
    });

    // Save session ID for next conversation (if we got one)
    if let Some(ref sid) = captured_session_id {
        if let Err(e) = save_session_id(&project_path, sid) {
            eprintln!("[WARN] Failed to save session ID: {}", e);
        } else {
            eprintln!("[DEBUG] Saved session ID: {}", sid);
        }
    }

    // Commit changes after Claude finishes (truncate message for commit)
    let commit_msg = if message.len() > 50 {
        format!("{}...", &message[..47])
    } else {
        message.clone()
    };
    let commit_hash = super::git::commit_changes(&project_path, &commit_msg).ok();

    Ok(ClaudeResponse {
        content: full_output,
        session_id: captured_session_id,
        commit_hash,
    })
}

/// Simple test to verify Claude CLI is accessible and working
#[tauri::command]
pub async fn test_claude_cli() -> Result<String, String> {
    let output = Command::new("claude")
        .args(["--version"])
        .output()
        .await
        .map_err(|e| format!("Failed to run Claude CLI: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err("Claude CLI not available".to_string())
    }
}
