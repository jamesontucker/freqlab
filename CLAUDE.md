# freqlab

A Tauri 2.x desktop app for creating VST audio plugins with AI assistance.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Zustand
- **Backend**: Tauri 2.x (Rust)
- **AI**: Claude Code CLI integration
- **Audio**: nih-plug (Rust VST/CLAP framework)

## Project Structure

```
src/                     # React frontend
  components/
    Chat/               # ChatPanel, ChatMessage, ChatInput
    Common/             # Button, Modal, Spinner
    Layout/             # Header, Sidebar, OutputPanel, MainLayout
    Projects/           # ProjectList, ProjectCard, NewProjectModal
    Setup/              # WelcomeWizard, PrerequisitesCheck
  stores/               # Zustand stores (settings, project, output)
  types/                # TypeScript interfaces

src-tauri/              # Rust backend
  src/
    commands/
      prerequisites.rs  # System requirement checks
      projects.rs       # Project CRUD operations
      claude.rs         # Claude Code CLI integration
    lib.rs              # Tauri app setup
```

## Key Features

1. **Prerequisites Check**: Verifies Xcode CLI, Rust, Claude CLI are installed
2. **Project Management**: Create/list/delete VST plugin projects
3. **Claude Integration**: Chat with Claude to build/modify plugins
4. **Output Panel**: Streams Claude's work in real-time

## How It Works

1. User creates a new plugin (name + description)
2. App generates nih-plug project skeleton at `~/VSTWorkshop/projects/{name}/`
3. User chats with Claude to describe features
4. Claude modifies `src/lib.rs` directly
5. User builds with `cargo xtask bundle` (Phase 4)

## Claude CLI Integration

Uses non-interactive mode with streaming:
```bash
claude -p "message" \
  --output-format stream-json \
  --allowedTools "Edit,Write,Read" \
  --append-system-prompt "..." \
  --max-turns 15
```

## Implementation Phases

### Phase 1: Foundation ✅
- Tauri + React + TypeScript scaffold
- Tailwind CSS with dark theme
- Prerequisites check system
- Welcome wizard flow

### Phase 2: Project Management + Claude Integration ✅
- Project creation with nih-plug templates
- Project list in sidebar
- Claude Code CLI integration
- Chat interface with streaming output

### Phase 3: Build System ✅
- Shared Cargo workspace at `~/VSTWorkshop/` for fast incremental builds
- `cargo xtask bundle` execution from workspace root
- Build output streaming to output panel
- Toast notifications for success/failure
- "Fix with Claude" button sends build errors to chat
- Copy artifacts to `~/VSTWorkshop/output/`

### Phase 4: Version Control (Next)
- Git safety net (auto-init, auto-commit after Claude edits)
- "Revert to here" on each Claude response (non-destructive)
- Visual dimming of reverted messages
- Persistent chat history in `.vstworkshop/chat.json`

### Phase 5: Polish
- Version bump modal
- Changelog generation from commits
- DAW setup guides
- Settings panel with configurable options:
  - Custom output folder path
  - Auto-copy to standard plugin locations:
    - `~/Library/Audio/Plug-Ins/VST3/`
    - `~/Library/Audio/Plug-Ins/CLAP/`
- Keyboard shortcuts
- Error handling improvements

### Phase 6: FL Studio VST3 Compatibility
- Investigate VST3 crash in FL Studio (CLAP works fine)
- Debug with LLDB attached to FL Studio to find root cause
- Check nih-plug GitHub issues for similar reports
- Test VST3 subcategories, class ID formats
- Ensure broad DAW compatibility for generated plugins

## Useful Commands

```bash
# Development
npm run tauri dev

# Build
npm run tauri build

# Check Rust code
cd src-tauri && cargo check
```

## File Locations

- Projects: `~/VSTWorkshop/projects/{name}/`
- Built plugins: `~/VSTWorkshop/output/`
- App config: Zustand persisted to localStorage

---

## Plugin Development Best Practices

**IMPORTANT**: When helping users develop audio plugins, always follow these patterns based on the UI framework.

### Documentation References

| Framework | Guide | Platform |
|-----------|-------|----------|
| **WebView (Advanced UI)** | `.docs/nih-plug-webview-guide.md` | macOS only |
| **egui (Standard UI)** | `.docs/nih-plug-egui-guide.md` | All platforms |
| **Headless** | No UI, DAW controls only | All platforms |

### WebView Plugin Pattern (macOS only)

**Always use these imports and patterns:**

```rust
use nih_plug_webview::{WebViewEditor, HTMLSource, EventStatus};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
```

**Define typed messages with serde's tag attribute:**
```rust
#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {
    Init,
    SetGain { value: f32 },
}
```

**Use AtomicBool flags for parameter sync from host automation:**
```rust
#[derive(Params)]
struct MyParams {
    #[id = "gain"]
    pub gain: FloatParam,
    #[persist = ""]
    gain_changed: Arc<AtomicBool>,
}

// In Default, add callback to parameter:
.with_callback(Arc::new(move |_| {
    gain_changed_clone.store(true, Ordering::Relaxed);
}))
```

**Use builder pattern for editor:**
```rust
WebViewEditor::new(HTMLSource::String(include_str!("ui.html")), (400, 300))
    .with_background_color((26, 26, 46, 255))
    .with_developer_mode(true)
    .with_event_loop(move |ctx, setter, _window| {
        while let Ok(msg) = ctx.next_event() {
            // Handle UIMessage
        }
        if gain_changed.swap(false, Ordering::Relaxed) {
            ctx.send_json(json!({ "type": "param_change", ... }));
        }
    })
```

**JavaScript IPC:**
```javascript
// Send to plugin
window.ipc.postMessage(JSON.stringify({ type: 'SetGain', value: 0.5 }));

// Receive from plugin
window.onPluginMessage = function(msg) { /* handle msg.type */ };

// Init on load
window.addEventListener('DOMContentLoaded', () => {
    window.ipc.postMessage(JSON.stringify({ type: 'Init' }));
});
```

### egui Plugin Pattern (Cross-platform)

**Always use these imports:**
```rust
use nih_plug_egui::{create_egui_editor, egui, widgets, EguiState};
```

**Store editor state with persistence:**
```rust
#[derive(Params)]
struct MyParams {
    #[persist = "editor-state"]
    editor_state: Arc<EguiState>,
}
```

**Create editor with create_egui_editor:**
```rust
create_egui_editor(
    self.params.editor_state.clone(),
    (),
    |_, _| {},
    move |egui_ctx, setter, _| {
        egui::CentralPanel::default().show(egui_ctx, |ui| {
            ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
        });
    },
)
```

### Safety Requirement (ALL plugins)

**ALWAYS include a safety limiter:**
```rust
#[inline]
fn safety_limit(sample: f32) -> f32 {
    sample.clamp(-1.0, 1.0)
}

// In process():
*sample = safety_limit(*sample);
```

### Template Location

Plugin templates are in `src-tauri/src/commands/projects.rs`:
- `generate_effect_webview_template()` / `generate_instrument_webview_template()`
- `generate_effect_egui_template()` / `generate_instrument_egui_template()`
- `generate_effect_headless_template()` / `generate_instrument_headless_template()`
- `generate_webview_ui_html()`

### WebView Plugin Compatibility

WebView plugins use a forked `nih-plug-webview` (github.com/jamesontucker/nih-plug-webview) that includes:
- Prefixed Objective-C class names to avoid conflicts with Tauri's wry
- Dynamic class suffix via `WRY_BUILD_SUFFIX` env var for hot reload support

The fork is used automatically when creating WebView plugins via the template system.
