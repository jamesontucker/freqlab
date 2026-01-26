---
name: preset-system
description: Preset system implementation. State persistence, factory presets, user preset management. Invoke when implementing preset save/load functionality.
---

# Preset System Implementation

## State Persistence

Use `#[persist = "key"]` for non-parameter state that should save with presets:

```rust
#[derive(Params)]
struct MyParams {
    #[id = "gain"]
    pub gain: FloatParam,

    // Non-parameter state persisted with presets
    #[persist = "editor-state"]
    editor_state: Arc<EguiState>,

    // For UI change tracking
    #[persist = "gain-dirty"]
    gain_changed: Arc<AtomicBool>,
}
```

**CRITICAL: Persist Key Rules**
- Every `#[persist = "key"]` MUST have a **unique, non-empty key**
- Using `#[persist = ""]` (empty string) for multiple fields causes **compile/runtime errors**
- Keys must be unique across the entire Params struct

## Factory Presets

Embed presets in the binary for instant access:

```rust
const FACTORY_PRESETS: &[(&str, &str)] = &[
    ("Init", include_str!("../presets/init.json")),
    ("Warm", include_str!("../presets/warm.json")),
    ("Aggressive", include_str!("../presets/aggressive.json")),
];

impl Default for MyParams {
    fn default() -> Self {
        // Load init preset or use hardcoded defaults
        Self { /* ... */ }
    }
}
```

## User Presets

### Storage Locations

Platform-specific preset storage:
- **macOS**: `~/Library/Application Support/{PluginName}/Presets/`
- **Windows**: `%APPDATA%/{PluginName}/Presets/`
- **Linux**: `~/.config/{PluginName}/Presets/`

### Preset File Format

Use JSON for human-readable, versionable presets:

```json
{
    "name": "Warm Pad",
    "version": "1.0",
    "parameters": {
        "gain": 0.75,
        "cutoff": 2000.0,
        "resonance": 0.3
    }
}
```

### Error Handling

Handle missing or corrupted preset files gracefully:

```rust
fn load_preset(&mut self, path: &Path) -> Result<(), PresetError> {
    let content = std::fs::read_to_string(path)
        .map_err(|_| PresetError::FileNotFound)?;

    let preset: PresetData = serde_json::from_str(&content)
        .map_err(|_| PresetError::InvalidFormat)?;

    // Validate version compatibility
    if !self.is_compatible_version(&preset.version) {
        return Err(PresetError::IncompatibleVersion);
    }

    self.apply_preset(&preset);
    Ok(())
}
```

## UI Integration

### WebView Presets

```javascript
// Request preset list on init
sendToPlugin({ type: 'GetPresets' });

// Handle preset list response
window.onPluginMessage = function(msg) {
    if (msg.type === 'presets') {
        populatePresetDropdown(msg.factory, msg.user);
    }
};

// Load preset
function loadPreset(name, isFactory) {
    sendToPlugin({ type: 'LoadPreset', name, isFactory });
}
```

### egui Presets

```rust
egui::ComboBox::from_label("Preset")
    .selected_text(&current_preset_name)
    .show_ui(ui, |ui| {
        ui.label("Factory");
        for preset in &factory_presets {
            if ui.selectable_label(false, preset.name).clicked() {
                // Load preset
            }
        }
        ui.separator();
        ui.label("User");
        for preset in &user_presets {
            if ui.selectable_label(false, preset.name).clicked() {
                // Load preset
            }
        }
    });
```
