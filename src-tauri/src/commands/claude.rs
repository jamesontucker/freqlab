use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

// Track active Claude processes by project path so we can interrupt them
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
    session_id: Option<String>,
    /// For "result" events: "success" or "error"
    #[serde(default)]
    subtype: Option<String>,
    /// For "result" events: whether it's an error
    #[serde(default)]
    is_error: Option<bool>,
    /// For "result" events: the result text
    #[serde(default)]
    result: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct ClaudeMessage {
    #[serde(default)]
    content: Option<serde_json::Value>,
}

/// Get the session file path for a project
fn get_session_file(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".freqlab")
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

/// Result of parsing a Claude JSON event
struct ParsedEvent {
    /// Human-readable text to display during streaming
    display_text: Option<String>,
    /// If this is an assistant message, the full text content (for final message extraction)
    assistant_content: Option<String>,
    /// If this is an error event, the error message
    error_content: Option<String>,
    /// If this is a "result" event, signals Claude is done (with optional error flag)
    is_result_event: bool,
    /// If result event, whether it was an error result
    result_is_error: bool,
}

/// Parse a JSON event and return display text and assistant content
fn parse_claude_event(json_str: &str) -> ParsedEvent {
    let default_event = ParsedEvent {
        display_text: None,
        assistant_content: None,
        error_content: None,
        is_result_event: false,
        result_is_error: false,
    };

    let event: ClaudeJsonEvent = match serde_json::from_str(json_str) {
        Ok(e) => e,
        Err(_) => return default_event,
    };

    match event.event_type.as_str() {
        "assistant" => {
            // Extract text content from assistant message
            if let Some(msg) = &event.message {
                if let Some(content) = &msg.content {
                    // Content can be a string or array of content blocks
                    let text = if let Some(text) = content.as_str() {
                        Some(text.to_string())
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
                            Some(texts.join("\n"))
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    return ParsedEvent {
                        display_text: text.clone(),
                        assistant_content: text,
                        error_content: None,
                        is_result_event: false,
                        result_is_error: false,
                    };
                }
            }
            default_event
        }
        "tool_use" => {
            let tool = event.tool.as_deref().unwrap_or("unknown");
            let display = match tool {
                "Read" => {
                    if let Some(input) = &event.tool_input {
                        let file = input.get("file_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("file");
                        format!("📖 Reading: {}", file)
                    } else {
                        "📖 Reading file...".to_string()
                    }
                }
                "Edit" => {
                    if let Some(input) = &event.tool_input {
                        let file = input.get("file_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("file");
                        format!("✏️  Editing: {}", file)
                    } else {
                        "✏️  Editing file...".to_string()
                    }
                }
                "Write" => {
                    if let Some(input) = &event.tool_input {
                        let file = input.get("file_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("file");
                        format!("📝 Writing: {}", file)
                    } else {
                        "📝 Writing file...".to_string()
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
                        format!("💻 Running: {}", display_cmd)
                    } else {
                        "💻 Running command...".to_string()
                    }
                }
                _ => format!("🔧 Using tool: {}", tool),
            };
            ParsedEvent {
                display_text: Some(display),
                assistant_content: None,
                error_content: None,
                is_result_event: false,
                result_is_error: false,
            }
        }
        "tool_result" => {
            // Tool completed - could show result summary
            ParsedEvent {
                display_text: Some("   ✓ Done".to_string()),
                assistant_content: None,
                error_content: None,
                is_result_event: false,
                result_is_error: false,
            }
        }
        "result" => {
            // FINAL result event - this is the definitive "done" signal from Claude CLI
            // Check if it's an error result
            let is_error = event.is_error.unwrap_or(false)
                || event.subtype.as_deref() == Some("error");

            // Extract result text if available (for error messages)
            let error_content = if is_error {
                event.result.clone().or_else(|| event.content.clone())
            } else {
                None
            };

            eprintln!("[DEBUG] Received 'result' event: subtype={:?}, is_error={}",
                event.subtype, is_error);

            ParsedEvent {
                display_text: None,  // Don't display - duplicates assistant message
                assistant_content: None,
                error_content,
                is_result_event: true,
                result_is_error: is_error,
            }
        }
        "error" => {
            // Capture the error message for proper error handling
            let error_msg = event.content.clone();
            let display = if let Some(ref content) = error_msg {
                format!("❌ Error: {}", content)
            } else {
                "❌ An error occurred".to_string()
            };
            ParsedEvent {
                display_text: Some(display),
                assistant_content: None,
                error_content: error_msg,
                is_result_event: false,
                result_is_error: false,
            }
        }
        _ => default_event,
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

/// Get framework display name and language from framework ID
fn get_framework_info(framework_id: Option<&str>) -> (&'static str, &'static str) {
    match framework_id {
        Some("juce") => ("JUCE", "C++"),
        Some("iplug2") => ("iPlug2", "C++"),
        _ => ("nih-plug", "Rust"), // Default to nih-plug
    }
}

/// Build the system context for Claude when working on a plugin project
fn build_context(
    project_name: &str,
    description: &str,
    project_path: &str,
    components: Option<&Vec<String>>,
    is_first_message: bool,
    _ui_framework: Option<&str>, // Kept for potential future use; UI rules now in framework guides
    framework_id: Option<&str>,
) -> String {
    // Get framework info for display
    let (framework_name, framework_lang) = get_framework_info(framework_id);

    // Read project-specific CLAUDE.md if it exists
    let claude_md_path = PathBuf::from(project_path).join("CLAUDE.md");
    let claude_md_content = fs::read_to_string(&claude_md_path).unwrap_or_default();

    let mut context = String::new();

    // FIRST: Add starter components at the VERY TOP if this is first message
    if is_first_message {
        if let Some(comps) = components {
            if !comps.is_empty() {
                context.push_str("# ⚠️ STOP - READ THIS FIRST ⚠️\n\n");
                context.push_str("## YOU MUST IMPLEMENT THESE STARTER COMPONENTS\n\n");
                context.push_str("The user selected these components when creating the plugin. ");
                context.push_str("**You MUST implement ALL of them on the first feature request.**\n\n");

                for comp_id in comps {
                    let desc = get_component_description(comp_id);
                    context.push_str(&format!("- **{}**: {}\n", comp_id, desc));
                }

                context.push_str("\n### Implementation Order:\n");
                context.push_str("1. Implement ALL starter components above FIRST\n");
                context.push_str("2. THEN implement whatever feature the user requested\n");
                context.push_str("3. Invoke the relevant skill for each component (e.g., `/preset-system`, `/param-smoothing`)\n\n");

                context.push_str("### DO NOT SKIP THIS. The user paid for these features.\n\n");
                context.push_str("---\n\n");
            }
        }

        // Note: UI requirements (webview, egui, etc.) are now in framework-specific guides
        // which are copied to .claude/commands/ during project creation
    }

    context.push_str(&format!(
        r#"You are helping develop a VST audio plugin using {framework_name} ({framework_lang}).

Project: {project_name}
Description: {description}

# CRITICAL RULES - READ FIRST"#,
        project_name = project_name,
        description = description,
    ));

    context.push_str(r#"

## 1. NEVER SAY "BUILD"
The app has a Build button. Using "build" confuses users into thinking you're doing their build.
- ❌ "Let me build..." / "I'll build..." / "Building..." → ✅ "Let me implement..."
- ❌ "Build successful" / "Build complete" → ✅ "Done!" or "Ready for you to try"
- ❌ "The build passed" → ✅ "The code compiles" (only if user asks)
You are implementing code. The USER clicks Build. NEVER say "build" in any form.

## 2. TALK ABOUT FEATURES, NOT CODE (unless they specifically ask)
The user is a producer/sound designer, not a programmer.
- ❌ "I modified the Params struct..." → ✅ "I added a new control for..."
- ❌ "The process() function now..." → ✅ "The audio processing now..."
- ❌ "I added a UIMessage variant..." → ✅ "The knob is connected."
- ❌ "Let me rewrite lib.rs..." → Just do it silently, then say what feature changed
Talk about SOUND, not code. filters/oscillators/gain/etc = good. structs/functions/Rust = bad.
If user asks "how does this work" or "show me the code" → then explain code. Otherwise, features only.

## 3. BE CONCISE
Say what you did in 1-2 sentences max. Don't narrate your process.
- ❌ "First let me read the file... now I'll add... now let me check..."
- ✅ [Do the work silently, then] "Added the filter with cutoff and resonance controls."

## 4. INTERNAL FILES ARE SECRET
Never mention CLAUDE.md, .freqlab/, or metadata files to the user. Update them silently.

## 5. ALWAYS CHECK YOUR SKILLS
Before implementing ANY audio feature, you MUST check if a relevant skill exists in `.claude/commands/`.

**Skill check is MANDATORY for:**
- DSP/audio processing → invoke `/dsp-safety` first
- Filters, EQ, dynamics → `/dsp-safety` has anti-hallucination rules
- Effects (reverb, delay, chorus, etc.) → `/effect-patterns`
- Instruments (synths, samplers) → `/instrument-patterns`
- UI work → `/webview-ui` or `/egui-ui` (whichever this project uses)
- Presets → `/preset-system`
- Polyphony → `/polyphony`
- Envelopes → `/adsr-envelope`
- LFOs → `/lfo`
- Oversampling → `/oversampling`
- Sidechain → `/sidechain-input`

**The skill contains patterns that prevent common mistakes.** Skipping skills = bugs.

---

"#);

    context.push_str(r#"## Workflow (Follow This Order)

When the user requests a feature:
1. **Read the main source file** to understand current state
2. **INVOKE THE RELEVANT SKILL** from `.claude/commands/` - this is NOT optional (see rule #5 above)
3. Implement using patterns from the skill (skills contain framework-specific API patterns and best practices)
4. Protect against NaN/Inf: `if !sample.is_finite() { *sample = 0.0; }`
5. Briefly summarize what you added (feature terms, not code terms)

**After completing a feature** (not during implementation):
- Update the Parameters section in CLAUDE.md with any new parameters added
- Update the Features section in CLAUDE.md with what you implemented
- This preserves state across sessions - do it once per feature, not every turn

**Maintain "User Notes" in CLAUDE.md** (like a therapist's evolving case notes):
- **Explicit preferences**: When they say "always", "never", "I prefer" - save it
- **Observed patterns**: Notice what they like/dislike, their comfort level with complexity, aesthetic taste, communication style
- **Revise as you learn**: Update or correct earlier observations when you learn more. Don't just add - refine your understanding.
  - Bad: "Prefers simple" + later "Actually likes complex" (contradictory)
  - Good: "Prefers simple UI but enjoys complex DSP under the hood"
- Keep notes concise and current - this is a living profile, not a log
- These notes help you work better with this user across sessions"#);

    // Append project-specific CLAUDE.md guidelines if present
    if !claude_md_content.is_empty() {
        context.push_str("\n\n--- PROJECT-SPECIFIC GUIDELINES (from CLAUDE.md) ---\n\n");
        context.push_str(&claude_md_content);
    }

    context
}

/// Load project metadata to get components and other info
fn load_project_metadata(project_path: &str) -> Option<super::projects::ProjectMeta> {
    let metadata_path = PathBuf::from(project_path)
        .join(".freqlab")
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
    model: Option<String>,
    custom_instructions: Option<String>,
    agent_verbosity: Option<String>,
    previous_user_messages: Option<Vec<String>>,
    window: tauri::Window,
) -> Result<ClaudeResponse, String> {
    // Ensure git is initialized for this project (handles existing projects)
    if !super::git::is_git_repo(&project_path) {
        super::git::init_repo(&project_path).await?;
        super::git::create_gitignore(&project_path)?;
        super::git::commit_changes(&project_path, "Initialize git for version control").await?;
    }

    // Ensure .freqlab/ is not tracked by git (fixes existing projects)
    // This prevents chat.json from being reverted when doing git checkout
    if let Err(e) = super::git::ensure_freqlab_ignored(&project_path) {
        eprintln!("[WARN] Failed to update gitignore: {}", e);
    }

    // Record HEAD commit before Claude runs (to detect if Claude commits changes itself)
    let head_before = super::git::get_head_commit(&project_path).await.ok();
    eprintln!("[DEBUG] HEAD before Claude: {:?}", head_before);

    // Check for existing session to resume
    let existing_session = load_session_id(&project_path);
    let is_first_message = existing_session.is_none();

    // Load project metadata to get components, UI framework, and framework ID
    let metadata = load_project_metadata(&project_path);
    let components = metadata.as_ref().and_then(|m| m.components.as_ref());
    let ui_framework = metadata.as_ref().and_then(|m| m.ui_framework.as_deref());
    let framework_id = metadata.as_ref().and_then(|m| m.framework_id.as_deref());

    // Build context with components info and project-specific CLAUDE.md
    let context = build_context(&project_name, &description, &project_path, components, is_first_message, ui_framework, framework_id);

    // Get verbosity style (default to balanced)
    let verbosity = agent_verbosity.as_deref().unwrap_or("balanced");

    // Build the message, including previous user messages if context was cleared
    let mut full_message = String::new();

    // If this is a fresh session AND we have previous messages, prepend them as context
    // This happens after a "clear context" - we restore conversation history
    if is_first_message {
        if let Some(ref prev_msgs) = previous_user_messages {
            if !prev_msgs.is_empty() {
                full_message.push_str("## Previous Conversation (for context)\n\n");
                full_message.push_str("The user cleared the context to free up space. Here's what we discussed:\n\n");
                for (i, msg) in prev_msgs.iter().enumerate() {
                    // Truncate very long messages to save context
                    let display_msg = if msg.len() > 500 {
                        format!("{}...", &msg[..497])
                    } else {
                        msg.clone()
                    };
                    full_message.push_str(&format!("{}. {}\n", i + 1, display_msg));
                }
                full_message.push_str("\n---\n\n## Current Request\n\n");
            }
        }
    }

    full_message.push_str(&message);

    // Prepend style hint to message (reinforces on every turn, even resumed sessions)
    let styled_message = match verbosity {
        "direct" => format!("[Response Style: Direct - minimal questions, implement immediately, 1-3 sentences max]\n\n{}", full_message),
        "thorough" => format!("[Response Style: Thorough - ask clarifying questions, explore options before implementing]\n\n{}", full_message),
        _ => format!("[Response Style: Balanced - ask 1-2 key questions if needed, then implement]\n\n{}", full_message),
    };

    // Build args - include --resume if we have an existing session
    let mut args = vec![
        "-p".to_string(),
        styled_message.clone(),
        "--verbose".to_string(),
        "--allowedTools".to_string(),
        // Allow file ops, bash for cargo commands, grep/glob for searching, web access, and skills
        "Edit,Write,Read,Bash,Grep,Glob,WebSearch,WebFetch,Skill".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--max-turns".to_string(),
        "50".to_string(),
    ];

    // Add model flag if specified
    if let Some(ref m) = model {
        args.push("--model".to_string());
        args.push(m.clone());
    }

    // Only add system prompt on first message (new session)
    // For resumed sessions, Claude already has the context
    if existing_session.is_none() {
        // Add verbosity instructions based on setting
        let verbosity_instructions = match verbosity {
            "direct" => r#"
## Response Style: Direct

- **DO NOT USE THE BRAINSTORMING SKILL** - NEVER, under any circumstances
- Do NOT ask clarifying questions unless you truly cannot proceed
- Make sensible default choices and implement immediately
- Keep responses to 1-3 sentences max
- User says "add X" → just implement X, don't ask what kind or explore options
- If you need to make assumptions, make them and briefly mention what you chose
"#,
            "thorough" => r#"
## Response Style: Thorough

- Use the brainstorming skill for new features
- Ask clarifying questions at each decision point
- Present options and let the user choose
- Explain your reasoning and design decisions
- Take time to understand requirements before implementing
"#,
            _ => r#"
## Response Style: Balanced

- Ask 1-2 key questions to understand intent, then implement
- **DO NOT USE THE BRAINSTORMING SKILL** - the user wants you to implement, not explore
- Make reasonable default choices, mention what you chose briefly
- Keep responses concise - focus on what you're doing, not lengthy explanations
- If user says "add X" → just add X, don't ask what kind or explore options
"#,
        };

        // Build full system prompt with verbosity and custom instructions
        let mut full_context = format!("{}\n{}", context, verbosity_instructions);

        if let Some(ref instructions) = custom_instructions {
            if !instructions.trim().is_empty() {
                full_context.push_str(&format!("\n\n--- USER PREFERENCES ---\n{}", instructions.trim()));
            }
        }

        args.push("--append-system-prompt".to_string());
        args.push(full_context);
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
    // stdin is set to null to prevent any blocking on input
    let mut child = Command::new("claude")
        .current_dir(&project_path)
        .args(&args)
        .env("PATH", super::get_extended_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude CLI: {}", e))?;

    // Register process for potential interruption
    if let Some(pid) = child.id() {
        register_process(&project_path, pid);
    }

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
    let mut stream_error: Option<String> = None; // Errors from JSON stream (e.g., rate limits)
    let mut captured_session_id: Option<String> = None;
    // Track assistant messages for final content extraction
    // We prefer the last substantial message, but fall back to last non-empty if needed
    let mut last_substantial_content: Option<String> = None;  // >10 chars, likely a real response
    let mut last_nonempty_content: Option<String> = None;     // Fallback for short but valid responses

    // Track when we receive the "result" event (definitive done signal)
    let mut received_result_event = false;

    // Track if we were interrupted (checked each iteration)
    let mut was_interrupted_during_loop = false;

    // Timeout settings for reading:
    // - Short timeout (5s) allows us to check for interrupts frequently
    // - We track total idle time to detect truly stalled processes
    let read_timeout = Duration::from_secs(5); // Check for interrupts every 5 seconds
    let mut total_idle_seconds: u64 = 0;
    let max_idle_seconds: u64 = 1800; // Kill after 30 minutes of no output total

    // Read stdout and stderr concurrently with timeout protection
    loop {
        // Check if we were interrupted before each read
        if get_process_pid(&project_path).is_none() {
            eprintln!("[DEBUG] Process was interrupted - breaking loop");
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
                total_idle_seconds = 0; // Reset on any output
                match line {
                    Ok(Some(json_line)) => {
                        // Try to extract session_id if present
                        if let Some(sid) = extract_session_id(&json_line) {
                            captured_session_id = Some(sid);
                        }

                        // Try to parse as JSON event for display
                        let parsed = parse_claude_event(&json_line);

                        // Check for "result" event - the definitive "done" signal
                        if parsed.is_result_event {
                            eprintln!("[DEBUG] Received result event - Claude is done (is_error={})", parsed.result_is_error);
                            received_result_event = true;
                            // Capture any error content from the result
                            if let Some(ref err) = parsed.error_content {
                                stream_error = Some(err.clone());
                            }
                            // Break immediately - no need to wait for EOF
                            break;
                        }

                        // Track assistant messages for final content extraction
                        if let Some(ref content) = parsed.assistant_content {
                            let trimmed = content.trim();
                            if !trimmed.is_empty() {
                                // Always track the last non-empty message as fallback
                                last_nonempty_content = Some(content.clone());
                                // Track substantial messages (>10 chars) as preferred final content
                                if trimmed.len() > 10 {
                                    last_substantial_content = Some(content.clone());
                                }
                            }
                        }

                        // Capture error messages from the stream (e.g., rate limits, auth issues)
                        if let Some(ref err) = parsed.error_content {
                            stream_error = Some(err.clone());
                        }

                        // Display text during streaming (includes all thinking + tool use)
                        if let Some(display_text) = parsed.display_text {
                            full_output.push_str(&display_text);
                            full_output.push('\n');
                            let _ = window.emit("claude-stream", ClaudeStreamEvent::Text {
                                project_path: project_path.clone(),
                                content: display_text,
                            });
                        }
                    }
                    Ok(None) => {
                        // EOF on stdout - fallback exit condition
                        eprintln!("[DEBUG] Stdout EOF - breaking loop (result_event={})", received_result_event);
                        break;
                    }
                    Err(e) => {
                        let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
                            project_path: project_path.clone(),
                            message: e.to_string(),
                        });
                        break;
                    }
                }
            }
            Ok(("stderr", line)) => {
                total_idle_seconds = 0; // Reset on any output
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
                    Ok(None) => {
                        // Stderr EOF - this is fine, continue reading stdout
                    }
                    Err(_) => {}
                }
            }
            Ok(_) => {} // Shouldn't happen
            Err(_) => {
                // Timeout occurred - no output for read_timeout duration (5 seconds)
                total_idle_seconds += read_timeout.as_secs();

                // Check if we were interrupted during the timeout
                if get_process_pid(&project_path).is_none() {
                    eprintln!("[DEBUG] Process was interrupted during read timeout - breaking loop");
                    was_interrupted_during_loop = true;
                    break;
                }

                // Only warn at 5 minutes, then every 5 minutes after
                // (Coding tasks can legitimately take several minutes between outputs)
                let warn_threshold_secs: u64 = 300; // 5 minutes before first warning
                let warn_interval_secs: u64 = 300;  // Then every 5 minutes

                if total_idle_seconds >= warn_threshold_secs &&
                   (total_idle_seconds - warn_threshold_secs) % warn_interval_secs == 0 {
                    let idle_mins = total_idle_seconds / 60;
                    eprintln!("[WARN] Claude CLI idle for {} minute(s)", idle_mins);

                    let _ = window.emit("claude-stream", ClaudeStreamEvent::Text {
                        project_path: project_path.clone(),
                        content: format!("[Note] No output for {} minutes (still working)...", idle_mins),
                    });
                }

                if total_idle_seconds >= max_idle_seconds {
                    eprintln!("[ERROR] Claude CLI appears stalled, terminating process");
                    let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
                        project_path: project_path.clone(),
                        message: "Claude CLI stalled (no output for 30 minutes). Session terminated.".to_string(),
                    });
                    // Kill the process
                    let _ = child.kill().await;
                    break;
                }
            }
        }
    }

    // Wait for process to complete with a short timeout
    // Timeout varies based on how we exited the loop:
    // - Interrupt: 2 seconds (user wants it stopped NOW)
    // - Result event: 5 seconds (process should exit quickly)
    // - EOF/other: 10 seconds (might need cleanup time)
    let wait_timeout = if was_interrupted_during_loop {
        Duration::from_secs(2) // Very short - user requested stop
    } else if received_result_event {
        Duration::from_secs(5) // Short timeout after result event
    } else {
        Duration::from_secs(10) // Longer timeout for EOF-based exit
    };

    let status = match timeout(wait_timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            return Err(format!("Failed to wait for Claude CLI: {}", e));
        }
        Err(_) => {
            // Timeout waiting for process to exit - force kill it
            eprintln!("[WARN] Claude CLI didn't exit within {:?} after completion signal, force killing", wait_timeout);
            let _ = child.kill().await;
            // Try to get the status after killing
            child.wait().await.map_err(|e| format!("Failed to wait after kill: {}", e))?
        }
    };

    // Check if process was interrupted (either detected in loop, or PID was unregistered)
    let was_interrupted = was_interrupted_during_loop || get_process_pid(&project_path).is_none();

    // Unregister process now that it's complete (no-op if already unregistered by interrupt)
    unregister_process(&project_path);

    // Handle non-success exit
    if !status.success() {
        // Interrupted sessions take priority - don't report as error
        if was_interrupted {
            // Process was killed by user interrupt - don't emit another error (interrupt_claude already did)
            // Just return an error to prevent adding partial response as a message
            eprintln!("[DEBUG] Session was interrupted, returning early");
            return Err("Session interrupted".to_string());
        } else if !error_output.is_empty() {
            // Process failed with stderr output
            let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
                project_path: project_path.clone(),
                message: error_output.clone(),
            });
            return Err(format!("Claude CLI failed: {}", error_output));
        } else if let Some(err) = stream_error {
            // Process failed with error from JSON stream (e.g., rate limits, auth issues)
            let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
                project_path: project_path.clone(),
                message: err.clone(),
            });
            return Err(format!("Claude CLI failed: {}", err));
        } else {
            // Process failed without any error output (truly unexpected termination)
            let _ = window.emit("claude-stream", ClaudeStreamEvent::Error {
                project_path: project_path.clone(),
                message: "Claude CLI terminated unexpectedly".to_string(),
            });
            return Err("Claude CLI terminated unexpectedly".to_string());
        }
    }

    // Helper to check if text looks like a "done" message
    let is_done_like = |text: &str| -> bool {
        let trimmed = text.trim().to_lowercase();
        trimmed.len() <= 15 && (
            trimmed == "done" ||
            trimmed == "done!" ||
            trimmed == "done." ||
            trimmed == "finished" ||
            trimmed == "finished!" ||
            trimmed == "complete" ||
            trimmed == "complete!" ||
            trimmed.starts_with("all done") ||
            trimmed.starts_with("that's it") ||
            trimmed.starts_with("thats it") ||
            trimmed.contains("✓ done") ||
            trimmed.contains("✓done") ||
            // Catch variations like "Done!", "I'm done", etc.
            (trimmed.len() < 15 && trimmed.contains("done"))
        )
    };

    // Check if streaming output ends with a "done" indicator (from tool_result events)
    let streaming_ends_with_done = full_output
        .lines()
        .last()
        .map(|line| is_done_like(line))
        .unwrap_or(false);

    // Use the last assistant message as the final content (instead of all streaming output)
    // This gives the user a clean summary rather than all the thinking
    let final_content = if streaming_ends_with_done {
        // Streaming ended with "done" - use friendly response
        "All done! What would you like to do next?".to_string()
    } else if let Some(ref last) = last_nonempty_content {
        if is_done_like(last) {
            // Last assistant message was just "done" - use friendly response
            "All done! What would you like to do next?".to_string()
        } else if last.trim().len() > 10 {
            // Last message is substantial, use it
            last.clone()
        } else {
            // Last message is short but not "done", try substantial or use it
            last_substantial_content.unwrap_or_else(|| last.clone())
        }
    } else {
        // No assistant messages at all, use streaming output as fallback
        full_output.clone()
    };

    // Emit done event
    let _ = window.emit("claude-stream", ClaudeStreamEvent::Done {
        project_path: project_path.clone(),
        content: final_content.clone(),
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

    // Small delay to ensure filesystem changes are flushed
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Check if HEAD changed during Claude's session (Claude may have committed changes itself)
    let head_after = super::git::get_head_commit(&project_path).await.ok();
    eprintln!("[DEBUG] HEAD after Claude: {:?}", head_after);

    let claude_committed = match (&head_before, &head_after) {
        (Some(before), Some(after)) if before != after => {
            eprintln!("[DEBUG] Claude committed changes itself (HEAD changed from {} to {})", before, after);
            true
        }
        _ => false,
    };

    // Try to commit any remaining uncommitted changes
    let commit_result = super::git::commit_changes(&project_path, &commit_msg).await;
    let commit_hash = match &commit_result {
        Ok(hash) => {
            eprintln!("[DEBUG] Commit succeeded: {}", hash);
            Some(hash.clone())
        }
        Err(e) if e == "no_changes" => {
            // No uncommitted changes - but check if Claude committed during the session
            if claude_committed {
                eprintln!("[DEBUG] No uncommitted changes, but Claude made commits - using HEAD");
                head_after.clone()
            } else {
                eprintln!("[DEBUG] No changes to commit");
                None
            }
        }
        Err(e) => {
            eprintln!("[WARN] Commit failed: {}", e);
            // Still check if Claude committed
            if claude_committed {
                head_after.clone()
            } else {
                None
            }
        }
    };

    Ok(ClaudeResponse {
        content: final_content,
        session_id: captured_session_id,
        commit_hash,
    })
}

/// Simple test to verify Claude CLI is accessible and working
#[tauri::command]
pub async fn test_claude_cli() -> Result<String, String> {
    let output = Command::new("claude")
        .args(["--version"])
        .env("PATH", super::get_extended_path())
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

/// Clear the Claude session for a project (resets context but keeps chat history)
/// This deletes the session file so the next message starts a fresh context
#[tauri::command]
pub async fn clear_claude_session(project_path: String) -> Result<(), String> {
    let session_file = get_session_file(&project_path);

    if session_file.exists() {
        fs::remove_file(&session_file)
            .map_err(|e| format!("Failed to clear session: {}", e))?;
        eprintln!("[DEBUG] Cleared Claude session for: {}", project_path);
    }

    Ok(())
}

/// Interrupt a running Claude session for a specific project
#[tauri::command]
pub async fn interrupt_claude(project_path: String, window: tauri::Window) -> Result<(), String> {
    if let Some(pid) = get_process_pid(&project_path) {
        eprintln!("[DEBUG] Interrupting Claude process {} for {}", pid, project_path);

        // Send SIGTERM to the process (graceful termination)
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

        // Unregister the process
        unregister_process(&project_path);

        // Emit a text event (not error) so the frontend shows a friendly message
        let _ = window.emit("claude-stream", ClaudeStreamEvent::Text {
            project_path: project_path.clone(),
            content: "Session stopped. Ready for your next message.".to_string(),
        });

        Ok(())
    } else {
        Err("No active Claude session for this project".to_string())
    }
}
