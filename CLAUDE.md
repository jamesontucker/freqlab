# freqlab

A Tauri 2.x desktop app for creating VST/CLAP audio plugins with AI assistance. Users describe what they want in natural language, Claude modifies the plugin code, and the app builds and previews the result in real-time.

> **Note for Claude**: When making major changes to the codebase (new features, new commands, new stores, architectural changes, or significant refactors), update this CLAUDE.md file to keep it accurate for future sessions.

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Framework** | Tauri 2.x | Lightweight desktop app, Rust backend pairs with nih-plug |
| **Frontend** | React 18 + TypeScript | Component-based UI |
| **Styling** | Tailwind CSS | Dark theme, custom color support |
| **State** | Zustand | Persisted stores for settings, projects, UI state |
| **AI** | Claude Code CLI | Non-interactive streaming mode |
| **Audio** | nih-plug (Rust) | VST3/CLAP plugin framework |
| **Preview** | cpal + CLAP hosting | Real-time audio processing with hot reload |

---

## Project Structure

```
src/                          # React frontend
  components/
    About/                    # AboutModal
    Chat/                     # ChatPanel, ChatMessage, ChatInput, AttachmentPreview
    Common/                   # Button, Modal, Spinner, Toast
    Layout/                   # MainLayout, Header, Sidebar, OutputPanel
    Preview/                  # PreviewPanel (audio engine UI)
    Projects/                 # ProjectList, ProjectCard, NewProjectModal
    Publish/                  # PublishModal (copy to DAW folders)
    Settings/                 # SettingsModal, AudioSettings, BrandingSettings, DawPathsSettings, DevSettings, ThemePicker
    Setup/                    # WelcomeWizard, PrerequisitesCheck
    Share/                    # ShareImportModal (zip export/import)
  stores/
    projectStore.ts           # Active project, project list, CRUD
    settingsStore.ts          # App config (persisted), theme, audio, branding, DAW paths
    chatStore.ts              # Queued messages for Claude
    outputStore.ts            # Per-project build output (last 500 lines)
    projectBusyStore.ts       # Tracks Claude/build busy state per project
    layoutStore.ts            # Sidebar collapsed state
    previewStore.ts           # Audio engine state, plugin params, input sources, levels
    toastStore.ts             # Toast notifications
  types/index.ts              # TypeScript interfaces
  api/preview.ts              # Audio preview command wrappers

src-tauri/                    # Rust backend
  src/
    main.rs                   # Entry point
    lib.rs                    # Tauri app setup, command registration
    commands/
      mod.rs                  # Command module exports
      prerequisites.rs        # System requirement checks (Xcode, Rust, Claude CLI)
      projects.rs             # Project CRUD, plugin templates, workspace management
      claude.rs               # Claude CLI integration with streaming
      claude_md.rs            # Per-project CLAUDE.md generation
      build.rs                # cargo xtask bundle execution with streaming
      git.rs                  # Git init, commit, revert operations
      chat.rs                 # Chat history persistence
      files.rs                # Chat attachment storage
      publish.rs              # Copy plugins to DAW folders
      share.rs                # Project zip export/import
      preview.rs              # Audio preview commands
      logging.rs              # File-based logging
    audio/
      mod.rs                  # Public audio module interface
      engine.rs               # Global audio playback engine
      device.rs               # Audio device enumeration (cpal)
      buffer.rs               # Ring buffer for audio data
      signals.rs              # Test signal generation (sine, noise, sweep, etc.)
      samples.rs              # Sample file playback (symphonia)
      plugin/
        mod.rs                # Plugin hosting module
        clap_host.rs          # CLAP host implementation
        clap_sys.rs           # CLAP C FFI bindings
        editor.rs             # Plugin editor window (Objective-C on macOS)
        file_watcher.rs       # Hot reload on file changes
    bin/
      editor_host.rs          # Separate process for plugin editor windows

.docs/                        # Technical documentation
  VST-Workshop-Spec.md        # Full technical specification
  nih-plug-webview-guide.md   # WebView plugin patterns
  nih-plug-egui-guide.md      # egui plugin patterns
  clap-research.md            # CLAP architecture notes
  sonic-analyzer-spec.md      # Audio analysis features (planned)
  vst-preview-system-spec.md  # Audio preview architecture
```

---

## Key Features

### Implemented

1. **Prerequisites Check** - Verifies Xcode CLI, Rust, Claude CLI, Claude auth
2. **Project Management** - Create/list/delete plugins with templates
3. **Plugin Templates** - Effect/Instrument × WebView/egui/Headless
4. **Claude Integration** - Chat interface with streaming output
5. **Build System** - `cargo xtask bundle` with real-time output streaming
6. **Version Control** - Git init, auto-commit after Claude edits, revert to commit
7. **Chat History** - Persistent with version tracking per Claude response
8. **Audio Preview** - CLAP plugin hosting with hot reload
9. **Test Signals** - Sine, noise, sweep, impulse, chirp generators
10. **Sample Playback** - Load audio files as input source
11. **Level Metering** - Real-time output level display
12. **Settings Panel** - Audio device, branding, DAW paths, theme customization
13. **Publish** - Copy built plugins to DAW plugin folders
14. **Share** - Export/import projects as zip archives
15. **Attachments** - Attach files to chat messages

### Data Flow

**Creating a Plugin:**
1. User fills NewProjectModal (name, description, template, UI framework)
2. `create_project` command: creates directory, generates template, inits git
3. Template includes: Cargo.toml, src/lib.rs, ui.html (if webview)
4. Frontend updates projectStore, shows project in sidebar

**Chat with Claude:**
1. User types message → `send_to_claude` command
2. Rust spawns Claude CLI: `claude -p "message" --output-format stream-json ...`
3. Parses JSON events, emits `claude-stream` events to frontend
4. Frontend displays streaming text, tool use indicators
5. Auto-commits changes if files modified (increments version number)
6. Saves chat history to `.vstworkshop/chat.json`

**Building:**
1. User clicks Build → `build_project` command
2. Runs `cargo xtask bundle {package_name}` from workspace root
3. Streams output via `build-stream` events
4. Artifacts placed in `output/{name}/v{version}/`

**Audio Preview:**
1. PreviewPanel initializes audio engine
2. User selects input source (signal/sample)
3. Engine loads CLAP plugin, processes audio in real-time
4. File watcher triggers hot reload on changes

---

## Zustand Stores

| Store | Key State | Persistence |
|-------|-----------|-------------|
| `settingsStore` | workspacePath, theme, customColors, vendorName, dawPaths, audioSettings | localStorage |
| `projectStore` | projects[], activeProject, loading | None |
| `chatStore` | pendingMessage | None |
| `outputStore` | outputs (Map<projectId, lines[]>) | None |
| `projectBusyStore` | claudeProjects (Set), buildingProject | None |
| `layoutStore` | sidebarCollapsed | None |
| `previewStore` | engineInitialized, pluginLoaded, inputSource, outputLevels | None |
| `toastStore` | toasts[] | None |

---

## TypeScript Types

```typescript
// Key interfaces from src/types/index.ts

interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  template?: 'effect' | 'instrument';
  uiFramework?: 'webview' | 'egui' | 'headless';
  components?: string[];  // Starter components
  created_at: string;
  updated_at: string;
  path: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  filesModified?: string[];
  commitHash?: string;
  version?: number;  // Auto-incremented on file changes
  reverted: boolean;
  attachments?: FileAttachment[];
}

interface AudioSettings {
  outputDevice: string | null;  // null = system default
  sampleRate: number;           // Default: 48000
  bufferSize: number;           // Default: 512
}
```

---

## Tauri Commands

### Project Management
- `create_project(input: CreateProjectInput)` → `ProjectMeta`
- `list_projects()` → `Vec<ProjectMeta>`
- `get_project(name: String)` → `ProjectMeta`
- `delete_project(name: String)` → `()`

### Claude Integration
- `send_to_claude(project_path, message, system_prompt, attachments)` → streams `claude-stream` events

### Build System
- `build_project(project_path, project_name, version)` → streams `build-stream` events

### Git Operations
- `init_repo(project_path)` → `()`
- `commit_changes(project_path, message)` → `String` (commit hash)
- `revert_to_commit(project_path, commit_hash)` → `()`

### Chat Persistence
- `save_chat_history(project_path, messages, active_version)` → `()`
- `load_chat_history(project_path)` → `ChatState`
- `set_active_version(project_path, version)` → `()`

### Audio Preview (in commands/preview.rs)
- `init_audio_engine(sample_rate, buffer_size, device)` → `()`
- `load_plugin(plugin_path)` → `()`
- `set_signal_type(signal_type, params)` → `()`
- `load_sample(sample_path)` → `()`
- `start_playback()` / `stop_playback()` → `()`
- `get_output_levels()` → `OutputLevels`
- `list_audio_devices()` → `Vec<AudioDevice>`

### Publishing
- `publish_plugin(project_path, version, daw, format)` → copies to DAW folder

### Sharing
- `export_project(project_path)` → zip file path
- `import_project(zip_path)` → `ProjectMeta`

---

## File Locations

| Data | Location |
|------|----------|
| Workspace root | `~/VSTWorkshop/` |
| Projects | `~/VSTWorkshop/projects/{name}/` |
| Built plugins | `~/VSTWorkshop/output/{name}/v{version}/` |
| Chat history | `{project}/.vstworkshop/chat.json` |
| Claude session | `{project}/.vstworkshop/claude_session.txt` |
| Attachments | `{project}/.vstworkshop/attachments/` |
| App config | Browser localStorage (`freqlab-settings`) |

---

## Implementation Phases

### Phase 1: Foundation ✅
- Tauri + React + TypeScript scaffold
- Tailwind CSS with dark theme
- Prerequisites check system
- Welcome wizard flow

### Phase 2: Project Management + Claude Integration ✅
- Project creation with nih-plug templates (effect/instrument × webview/egui/headless)
- Project list in sidebar
- Claude Code CLI integration with streaming
- Chat interface with markdown support

### Phase 3: Build System ✅
- Shared Cargo workspace at `~/VSTWorkshop/`
- `cargo xtask bundle` execution from workspace root
- Build output streaming to output panel
- Toast notifications for success/failure
- "Fix with Claude" sends build errors to chat
- Versioned output folders: `output/{name}/v{version}/`

### Phase 4: Version Control ✅
- Git init on project creation
- Auto-commit after Claude edits
- "Revert to here" on chat messages
- Visual dimming of reverted messages
- Persistent chat history with activeVersion tracking
- Session persistence (one per project)

### Phase 5: Audio Preview ✅
- CLAP plugin hosting with hot reload
- Test signal generators (sine, noise, sweep, impulse, chirp)
- Sample file playback (WAV, MP3, AAC)
- Real-time level metering
- Audio device selection

### Phase 6: Settings & Polish ✅
- Settings panel (audio, branding, DAW paths, theme)
- Custom theme colors
- DAW plugin path configuration
- Vendor branding (name, URL, email)
- Project import/export (zip)
- File attachments in chat
- Markdown rendering in chat

### Phase 7: Future
- Changelog generation from commits
- Version bump modal with release notes
- DAW setup guides
- Keyboard shortcuts (expand)
- FL Studio VST3 compatibility investigation

---

## Useful Commands

```bash
# Development
npm run tauri dev

# Build release
npm run tauri build

# Check Rust code
cd src-tauri && cargo check

# Run Rust tests
cd src-tauri && cargo test

# Format code
cd src-tauri && cargo fmt
npm run lint
```

---

## Plugin Development Best Practices

**IMPORTANT**: When helping users develop audio plugins, always follow these patterns based on the UI framework.

### Documentation References

| Framework | Guide | Platform |
|-----------|-------|----------|
| **WebView (Advanced UI)** | `.docs/nih-plug-webview-guide.md` | macOS only |
| **egui (Standard UI)** | `.docs/nih-plug-egui-guide.md` | All platforms |
| **Headless** | No UI, DAW controls only | All platforms |

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

### WebView Plugin Pattern (macOS only)

```rust
use nih_plug_webview::{WebViewEditor, HTMLSource, EventStatus};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};

// Define typed messages with serde's tag attribute
#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {
    Init,
    SetGain { value: f32 },
}

// Use AtomicBool flags for parameter sync from host automation
#[derive(Params)]
struct MyParams {
    #[id = "gain"]
    pub gain: FloatParam,
    #[persist = ""]
    gain_changed: Arc<AtomicBool>,
}

// Add callback in Default impl:
.with_callback(Arc::new(move |_| {
    gain_changed_clone.store(true, Ordering::Relaxed);
}))

// Builder pattern for editor:
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

```rust
use nih_plug_egui::{create_egui_editor, egui, widgets, EguiState};

// Store editor state with persistence
#[derive(Params)]
struct MyParams {
    #[persist = "editor-state"]
    editor_state: Arc<EguiState>,
}

// Create editor
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

### Template Location

Plugin templates are generated in `src-tauri/src/commands/projects.rs`:
- `generate_effect_webview_template()` / `generate_instrument_webview_template()`
- `generate_effect_egui_template()` / `generate_instrument_egui_template()`
- `generate_effect_headless_template()` / `generate_instrument_headless_template()`
- `generate_webview_ui_html()`

### WebView Plugin Compatibility

WebView plugins use a forked `nih-plug-webview` ([github.com/jamesontucker/nih-plug-webview](https://github.com/jamesontucker/nih-plug-webview)) that includes:
- Prefixed Objective-C class names to avoid conflicts with Tauri's wry
- Dynamic class suffix via `WRY_BUILD_SUFFIX` env var for hot reload support

---

## Audio Engine Architecture

The audio preview system uses a global singleton engine (`src-tauri/src/audio/engine.rs`) with:

1. **Input Sources**: Test signals (sine, noise, sweep, etc.) or loaded samples
2. **CLAP Host**: Loads and processes CLAP plugins in real-time
3. **Hot Reload**: File watcher triggers plugin reload on changes
4. **Output**: cpal device with configurable sample rate and buffer size

**Key Files:**
- `audio/engine.rs` - Main audio thread, buffer management
- `audio/plugin/clap_host.rs` - CLAP plugin loading and parameter control
- `audio/plugin/editor.rs` - Plugin editor window (Objective-C on macOS)
- `audio/signals.rs` - Test signal generators
- `audio/samples.rs` - Sample file loading (symphonia)

---

## Dependencies (Cargo.toml)

**Core:**
- `tauri 2.9.5` - Desktop framework
- `tokio` - Async runtime
- `serde/serde_json` - Serialization

**Audio:**
- `cpal 0.15` - Audio device access
- `ringbuf` - Lock-free ring buffer
- `symphonia` - Audio format decoding (WAV, MP3, AAC)
- `libloading` - Dynamic library loading (CLAP plugins)
- `notify` - File watching for hot reload

**Plugins:**
- `tauri-plugin-shell` - Shell command execution
- `tauri-plugin-dialog` - File dialogs
- `tauri-plugin-log` - Logging

**macOS:**
- `objc2`, `objc2-foundation`, `objc2-app-kit` - Native plugin editor windows

---

## Common Tasks

### Adding a New Tauri Command

1. Add function in `src-tauri/src/commands/{module}.rs`
2. Export in `src-tauri/src/commands/mod.rs`
3. Register in `src-tauri/src/lib.rs` invoke_handler
4. Call from frontend: `invoke('command_name', { args })`

### Adding a New Store

1. Create `src/stores/{name}Store.ts`
2. Export from store file
3. Use with `const { state } = useNameStore()`

### Modifying Plugin Templates

1. Edit template functions in `src-tauri/src/commands/projects.rs`
2. Templates are string literals with placeholders like `{plugin_name}`

### Adding Settings

1. Add to `AppConfig` interface in `src/types/index.ts`
2. Add to `SettingsState` in `src/stores/settingsStore.ts`
3. Add default value and setter
4. Add UI in appropriate `src/components/Settings/*Settings.tsx`
