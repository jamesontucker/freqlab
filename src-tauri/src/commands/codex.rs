use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

use super::ai_context::{build_context, load_project_metadata};

// Track active Codex processes by project path so we can interrupt them
static ACTIVE_PROCESSES: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn register_process(project_path: &str, pid: u32) {
    let mut guard = ACTIVE_PROCESSES.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    if let Some(ref mut map) = *guard {
        map.insert(project_path.to_string(), pid);
    }
}

fn unregister_process(project_path: &str) {
    let mut guard = ACTIVE_PROCESSES.lock().unwrap();
    if let Some(ref mut map) = *guard {
        map.remove(project_path);
    }
}

fn get_process_pid(project_path: &str) -> Option<u32> {
    let guard = ACTIVE_PROCESSES.lock().unwrap();
    guard.as_ref().and_then(|map| map.get(project_path).copied())
}

#[derive(Serialize, Clone)]
pub struct CodexResponse {
    pub content: String,
    pub session_id: Option<String>,
    pub commit_hash: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum AiStreamEvent {
    #[serde(rename = "start")]
    Start { project_path: String },
    #[serde(rename = "text")]
    Text { project_path: String, content: String },
    #[serde(rename = "error")]
    Error { project_path: String, message: String },
    #[serde(rename = "done")]
    Done { project_path: String, content: String },
}

#[derive(Deserialize, Debug)]
struct CodexEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    item: Option<CodexItem>,
}

#[derive(Deserialize, Debug)]
struct CodexItem {
    #[serde(rename = "type")]
    item_type: String,
    #[serde(default)]
    text: Option<String>,
}

struct ParsedCodexEvent {
    display_text: Option<String>,
    assistant_content: Option<String>,
    error_content: Option<String>,
    session_id: Option<String>,
}

fn parse_codex_event(json_str: &str) -> ParsedCodexEvent {
    let default_event = ParsedCodexEvent {
        display_text: None,
        assistant_content: None,
        error_content: None,
        session_id: None,
    };

    let event: CodexEvent = match serde_json::from_str(json_str) {
        Ok(e) => e,
        Err(_) => return default_event,
    };

    match event.event_type.as_str() {
        "thread.started" => ParsedCodexEvent {
            session_id: event.thread_id,
            ..default_event
        },
        "item.completed" => {
            if let Some(item) = event.item {
                if item.item_type == "agent_message" {
                    let text = item.text.unwrap_or_default();
                    if text.is_empty() {
                        default_event
                    } else {
                        ParsedCodexEvent {
                            display_text: Some(text.clone()),
                            assistant_content: Some(text),
                            error_content: None,
                            session_id: None,
                        }
                    }
                } else {
                    default_event
                }
            } else {
                default_event
            }
        }
        "error" => ParsedCodexEvent {
            error_content: Some("Codex CLI error".to_string()),
            ..default_event
        },
        _ => default_event,
    }
}

fn get_session_file(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".vstworkshop")
        .join("codex_session.txt")
}

fn path_lookup_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    }
}

fn lookup_command_path(command: &str) -> Option<String> {
    let output = StdCommand::new(path_lookup_command())
        .args([command])
        .env("PATH", super::get_extended_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|p| !p.is_empty())
}

fn resolve_codex_command() -> Result<String, String> {
    if let Ok(path) = std::env::var("CODEX_CLI_PATH") {
        if !path.trim().is_empty() && Path::new(&path).exists() {
            return Ok(path);
        }
    }

    if cfg!(target_os = "windows") {
        if let Some(path) = lookup_command_path("codex.cmd")
            .or_else(|| lookup_command_path("codex.ps1"))
            .or_else(|| lookup_command_path("codex.exe"))
            .or_else(|| lookup_command_path("codex"))
        {
            return Ok(path);
        }
    } else if let Some(path) = lookup_command_path("codex") {
        return Ok(path);
    }

    if cfg!(target_os = "windows") {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        if !home.is_empty() {
            let candidates = [
                format!("{}\\AppData\\Roaming\\npm\\codex.cmd", home),
                format!("{}\\AppData\\Local\\npm\\codex.cmd", home),
                format!("{}\\AppData\\Roaming\\npm\\codex.exe", home),
                format!("{}\\AppData\\Local\\npm\\codex.exe", home),
                format!("{}\\AppData\\Roaming\\npm\\codex.ps1", home),
                format!("{}\\AppData\\Local\\npm\\codex.ps1", home),
            ];
            for candidate in candidates {
                if Path::new(&candidate).exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    Err("Codex CLI not found. Ensure codex is on PATH or set CODEX_CLI_PATH to the full executable path.".to_string())
}

fn is_cmd_script(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat")
}

fn is_ps_script(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".ps1")
}

fn build_codex_command(codex_cmd: &str) -> Command {
    if is_cmd_script(codex_cmd) {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(codex_cmd);
        cmd
    } else if is_ps_script(codex_cmd) {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", codex_cmd]);
        cmd
    } else {
        Command::new(codex_cmd)
    }
}

fn load_session_id(project_path: &str) -> Option<String> {
    let session_file = get_session_file(project_path);
    fs::read_to_string(session_file).ok().map(|s| s.trim().to_string())
}

fn save_session_id(project_path: &str, session_id: &str) -> Result<(), String> {
    let session_file = get_session_file(project_path);
    fs::write(&session_file, session_id)
        .map_err(|e| format!("Failed to save session ID: {}", e))
}

#[tauri::command]
pub async fn send_to_codex(
    project_path: String,
    project_name: String,
    description: String,
    message: String,
    _model: Option<String>,
    custom_instructions: Option<String>,
    agent_verbosity: Option<String>,
    window: tauri::Window,
) -> Result<CodexResponse, String> {
    // Ensure git is initialized for this project (handles existing projects)
    if !super::git::is_git_repo(&project_path) {
        super::git::init_repo(&project_path).await?;
        super::git::create_gitignore(&project_path)?;
        super::git::commit_changes(&project_path, "Initialize git for version control").await?;
    }

    // Ensure .vstworkshop/ is not tracked by git (fixes existing projects)
    if let Err(e) = super::git::ensure_vstworkshop_ignored(&project_path) {
        eprintln!("[WARN] Failed to update gitignore: {}", e);
    }

    // Record HEAD commit before Codex runs (to detect if Codex commits changes itself)
    let head_before = super::git::get_head_commit(&project_path).await.ok();
    eprintln!("[DEBUG] HEAD before Codex: {:?}", head_before);

    // Check for existing session to resume
    let existing_session = load_session_id(&project_path);
    let is_first_message = existing_session.is_none();

    // Load project metadata to get components and UI framework
    let metadata = load_project_metadata(&project_path);
    let components = metadata.as_ref().and_then(|m| m.components.as_ref());
    let ui_framework = metadata.as_ref().and_then(|m| m.ui_framework.as_deref());

    // Build context with components info and project-specific CLAUDE.md
    let context = build_context(&project_name, &description, &project_path, components, is_first_message, ui_framework);

    // Get verbosity style (default to balanced)
    let verbosity = agent_verbosity.as_deref().unwrap_or("balanced");

    // Prepend style hint to message
    let styled_message = match verbosity {
        "direct" => format!("[Response Style: Direct - minimal questions, implement immediately, 1-3 sentences max]\n\n{}", message),
        "thorough" => format!("[Response Style: Thorough - ask clarifying questions, explore options before implementing]\n\n{}", message),
        _ => format!("[Response Style: Balanced - ask 1-2 key questions if needed, then implement]\n\n{}", message),
    };

    // Build prompt - include full context on first message
    let prompt = if is_first_message {
        let verbosity_instructions = match verbosity {
            "direct" => r#"
## Response Style: Direct

- DO NOT use the brainstorming skill
- Do NOT ask clarifying questions unless you truly cannot proceed
- Make sensible default choices and implement immediately
- Keep responses to 1-3 sentences max
"#,
            "thorough" => r#"
## Response Style: Thorough

- Use the brainstorming skill for new features
- Ask clarifying questions at each decision point
- Present options and let the user choose
- Explain your reasoning and design decisions
"#,
            _ => r#"
## Response Style: Balanced

- Ask 1-2 key questions to understand intent, then implement
- DO NOT use the brainstorming skill
- Make reasonable default choices, mention what you chose briefly
"#,
        };

        let mut full_context = format!("{}\n{}", context, verbosity_instructions);
        if let Some(ref instructions) = custom_instructions {
            if !instructions.trim().is_empty() {
                full_context.push_str(&format!("\n\n--- USER PREFERENCES ---\n{}", instructions.trim()));
            }
        }

        format!("{}\n\n---\n\n{}", full_context, styled_message)
    } else {
        styled_message
    };

    // Codex exec writes last message to a file for reliable final output
    let last_message_path = PathBuf::from(&project_path)
        .join(".vstworkshop")
        .join("codex_last_message.txt");
    if let Some(parent) = last_message_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Build command args
    let mut args = Vec::new();
    if let Some(ref session_id) = existing_session {
        args.push("exec".to_string());
        args.push("resume".to_string());
        args.push("--json".to_string());
        args.push("--color".to_string());
        args.push("never".to_string());
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        args.push("--output-last-message".to_string());
        args.push(last_message_path.to_string_lossy().to_string());
        args.push(session_id.clone());
        args.push("-".to_string());
        eprintln!("[DEBUG] Resuming Codex session: {}", session_id);
    } else {
        args.push("exec".to_string());
        args.push("--json".to_string());
        args.push("--color".to_string());
        args.push("never".to_string());
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        args.push("--output-last-message".to_string());
        args.push(last_message_path.to_string_lossy().to_string());
        args.push("-".to_string());
        eprintln!("[DEBUG] Starting new Codex session");
    }

    let codex_cmd = resolve_codex_command()?;

    eprintln!("[DEBUG] Codex command: {}", codex_cmd);
    eprintln!(
        "[DEBUG] Codex launcher: {}",
        if is_cmd_script(&codex_cmd) {
            "cmd"
        } else if is_ps_script(&codex_cmd) {
            "powershell"
        } else {
            "direct"
        }
    );

    let mut command = build_codex_command(&codex_cmd);

    // Spawn Codex CLI process with JSON output
    let mut child = command
        .current_dir(&project_path)
        .args(&args)
        .env("PATH", super::get_extended_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Codex CLI: {}", e))?;

    if let Some(pid) = child.id() {
        register_process(&project_path, pid);
    }

    if let Some(mut stdin) = child.stdin.take() {
        let prompt_clone = prompt.clone();
        tokio::spawn(async move {
            let _ = stdin.write_all(prompt_clone.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    let _ = window.emit("ai-stream", AiStreamEvent::Start {
        project_path: project_path.clone(),
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
    let mut last_nonempty_content: Option<String> = None;
    let mut last_substantial_content: Option<String> = None;
    let mut was_interrupted_during_loop = false;

    let read_timeout = Duration::from_secs(5);
    let mut total_idle_seconds: u64 = 0;
    let max_idle_seconds: u64 = 1800;

    loop {
        if get_process_pid(&project_path).is_none() {
            eprintln!("[DEBUG] Codex process was interrupted - breaking loop");
            was_interrupted_during_loop = true;
            break;
        }

        let read_result = timeout(read_timeout, async {
            tokio::select! {
                line = stdout_reader.next_line() => ("stdout", line),
                line = stderr_reader.next_line() => ("stderr", line),
            }
        }).await;

        match read_result {
            Ok(("stdout", line)) => {
                total_idle_seconds = 0;
                match line {
                    Ok(Some(json_line)) => {
                        let parsed = parse_codex_event(&json_line);

                        if let Some(session_id) = parsed.session_id {
                            captured_session_id = Some(session_id);
                        }

                        if let Some(ref content) = parsed.assistant_content {
                            let trimmed = content.trim();
                            if !trimmed.is_empty() {
                                last_nonempty_content = Some(content.clone());
                                if trimmed.len() > 10 {
                                    last_substantial_content = Some(content.clone());
                                }
                            }
                        }

                        if let Some(ref err) = parsed.error_content {
                            error_output.push_str(err);
                            error_output.push('\n');
                        }

                        if let Some(display_text) = parsed.display_text {
                            full_output.push_str(&display_text);
                            full_output.push('\n');
                            let _ = window.emit("ai-stream", AiStreamEvent::Text {
                                project_path: project_path.clone(),
                                content: display_text,
                            });
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = window.emit("ai-stream", AiStreamEvent::Error {
                            project_path: project_path.clone(),
                            message: e.to_string(),
                        });
                        break;
                    }
                }
            }
            Ok(("stderr", line)) => {
                total_idle_seconds = 0;
                match line {
                    Ok(Some(text)) => {
                        error_output.push_str(&text);
                        error_output.push('\n');
                        let _ = window.emit("ai-stream", AiStreamEvent::Text {
                            project_path: project_path.clone(),
                            content: format!("[stderr] {}", text),
                        });
                    }
                    Ok(None) => {}
                    Err(_) => {}
                }
            }
            Ok(_) => {}
            Err(_) => {
                total_idle_seconds += read_timeout.as_secs();

                if get_process_pid(&project_path).is_none() {
                    was_interrupted_during_loop = true;
                    break;
                }

                if total_idle_seconds >= max_idle_seconds {
                    let _ = window.emit("ai-stream", AiStreamEvent::Error {
                        project_path: project_path.clone(),
                        message: "Codex CLI stalled (no output for 30 minutes). Session terminated.".to_string(),
                    });
                    let _ = child.kill().await;
                    break;
                }
            }
        }
    }

    let status = match timeout(Duration::from_secs(10), child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            return Err(format!("Failed to wait for Codex CLI: {}", e));
        }
        Err(_) => {
            let _ = child.kill().await;
            child.wait().await.map_err(|e| format!("Failed to wait after kill: {}", e))?
        }
    };

    let was_interrupted = was_interrupted_during_loop || get_process_pid(&project_path).is_none();
    unregister_process(&project_path);

    if !status.success() {
        if was_interrupted {
            return Err("Session interrupted".to_string());
        } else if !error_output.is_empty() {
            let _ = window.emit("ai-stream", AiStreamEvent::Error {
                project_path: project_path.clone(),
                message: error_output.clone(),
            });
            return Err(format!("Codex CLI failed: {}", error_output));
        } else {
            let _ = window.emit("ai-stream", AiStreamEvent::Error {
                project_path: project_path.clone(),
                message: "Codex CLI terminated unexpectedly".to_string(),
            });
            return Err("Codex CLI terminated unexpectedly".to_string());
        }
    }

    let final_content = if let Ok(text) = fs::read_to_string(&last_message_path) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            last_nonempty_content
                .or(last_substantial_content)
                .unwrap_or_else(|| full_output.clone())
        } else {
            trimmed.to_string()
        }
    } else if let Some(ref last) = last_nonempty_content {
        last.clone()
    } else {
        full_output.clone()
    };

    let _ = window.emit("ai-stream", AiStreamEvent::Done {
        project_path: project_path.clone(),
        content: final_content.clone(),
    });

    if let Some(ref sid) = captured_session_id {
        if let Err(e) = save_session_id(&project_path, sid) {
            eprintln!("[WARN] Failed to save session ID: {}", e);
        }
    }

    let commit_msg = if message.len() > 50 {
        format!("{}...", &message[..47])
    } else {
        message.clone()
    };

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let head_after = super::git::get_head_commit(&project_path).await.ok();
    let codex_committed = match (&head_before, &head_after) {
        (Some(before), Some(after)) if before != after => true,
        _ => false,
    };

    let commit_result = super::git::commit_changes(&project_path, &commit_msg).await;
    let commit_hash = match &commit_result {
        Ok(hash) => Some(hash.clone()),
        Err(e) if e == "no_changes" => {
            if codex_committed {
                head_after.clone()
            } else {
                None
            }
        }
        Err(_) => {
            if codex_committed {
                head_after.clone()
            } else {
                None
            }
        }
    };

    Ok(CodexResponse {
        content: final_content,
        session_id: captured_session_id,
        commit_hash,
    })
}

#[tauri::command]
pub async fn interrupt_codex(project_path: String, window: tauri::Window) -> Result<(), String> {
    if let Some(pid) = get_process_pid(&project_path) {
        eprintln!("[DEBUG] Interrupting Codex process {} for {}", pid, project_path);

        #[cfg(unix)]
        {
            use std::process::Command as StdCommand;
            let _ = StdCommand::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
        }

        #[cfg(windows)]
        {
            use std::process::Command as StdCommand;
            let _ = StdCommand::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .output();
        }

        unregister_process(&project_path);

        let _ = window.emit("ai-stream", AiStreamEvent::Text {
            project_path: project_path.clone(),
            content: "Session stopped. Ready for your next message.".to_string(),
        });

        Ok(())
    } else {
        Err("No active Codex session for this project".to_string())
    }
}

#[tauri::command]
pub async fn test_codex_cli() -> Result<String, String> {
    let codex_cmd = resolve_codex_command()?;
    eprintln!("[DEBUG] Codex command: {}", codex_cmd);
    eprintln!(
        "[DEBUG] Codex launcher: {}",
        if is_cmd_script(&codex_cmd) {
            "cmd"
        } else if is_ps_script(&codex_cmd) {
            "powershell"
        } else {
            "direct"
        }
    );

    let mut command = build_codex_command(&codex_cmd);

    let output = command
        .args(["--version"])
        .env("PATH", super::get_extended_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run Codex CLI: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err("Codex CLI not available".to_string())
    }
}
