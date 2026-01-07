# nih-plug-webview Development Guide

This guide documents how to develop WebView-based audio plugins using the forked `nih-plug-webview` library. This fork includes patches for Tauri compatibility and hot reload support.

## Key Features

- **Tauri compatibility**: Uses prefixed Objective-C class names to avoid conflicts with Tauri's wry
- **Hot reload support**: Dynamic class name suffix via `WRY_BUILD_SUFFIX` env var enables reloading plugins without restarting the host
- **Cross-platform**: Uses wry for WebView (same as Tauri)

## Project Setup

When creating a WebView plugin in freqlab, the template automatically uses the forked repository.

### Cargo.toml Dependencies

```toml
[dependencies]
nih_plug = { git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }
# Forked nih-plug-webview with Tauri compatibility and hot reload support
nih_plug_webview = { git = "https://github.com/jamesontucker/nih-plug-webview" }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

## Core Concepts

### Library Exports

```rust
use nih_plug_webview::{WebViewEditor, HTMLSource, EventStatus};
```

- `WebViewEditor` - The main editor struct that implements nih-plug's `Editor` trait
- `HTMLSource` - Enum for loading HTML content (`String(&'static str)` or `URL(&'static str)`)
- `EventStatus` - Event handling status (re-exported from baseview)

### Creating an Editor

```rust
fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
    let params = self.params.clone();

    let editor = WebViewEditor::new(HTMLSource::String(include_str!("ui.html")), (400, 300))
        .with_background_color((26, 26, 46, 255))  // RGBA
        .with_developer_mode(true)  // Enable DevTools for debugging
        .with_event_loop(move |ctx, setter, _window| {
            // IPC handling goes here
        });

    Some(Box::new(editor))
}
```

### Builder Methods

| Method | Purpose |
|--------|---------|
| `new(source, (width, height))` | Create editor with HTML source and size |
| `.with_background_color((r, g, b, a))` | Set background color (RGBA u8 tuple) |
| `.with_developer_mode(bool)` | Enable/disable WebKit DevTools |
| `.with_event_loop(closure)` | Set the event loop handler for IPC |
| `.with_keyboard_handler(closure)` | Handle keyboard events |
| `.with_mouse_handler(closure)` | Handle mouse events |

## IPC (Inter-Process Communication)

### Message Protocol

Messages between Rust and JavaScript use JSON with a `type` field for routing.

**JavaScript to Rust**: Define a `UIMessage` enum with serde deserialization:

```rust
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {
    Init,
    SetGain { value: f32 },
    SetFrequency { value: f32 },
    // Add more as needed
}
```

**Rust to JavaScript**: Send JSON using `serde_json::json!`:

```rust
ctx.send_json(json!({
    "type": "param_change",
    "param": "gain",
    "value": 0.5,
    "text": "0.0 dB"
}));
```

### Event Loop Handler

The event loop handler runs on every frame. Use `ctx.next_event()` to receive messages:

```rust
.with_event_loop(move |ctx, setter, _window| {
    // Process all pending messages from JavaScript
    while let Ok(msg) = ctx.next_event() {
        if let Ok(ui_msg) = serde_json::from_value::<UIMessage>(msg) {
            match ui_msg {
                UIMessage::Init => {
                    // Send initial state to UI
                    ctx.send_json(json!({
                        "type": "param_change",
                        "param": "gain",
                        "value": params.gain.unmodulated_normalized_value(),
                        "text": params.gain.to_string()
                    }));
                }
                UIMessage::SetGain { value } => {
                    // Update parameter from UI
                    setter.begin_set_parameter(&params.gain);
                    setter.set_parameter_normalized(&params.gain, value);
                    setter.end_set_parameter(&params.gain);
                }
            }
        }
    }
})
```

### WindowHandler Methods

| Method | Purpose |
|--------|---------|
| `ctx.next_event()` | Get next message from JavaScript (returns `Result<Value, TryRecvError>`) |
| `ctx.send_json(json)` | Send JSON message to JavaScript |
| `ctx.resize(window, width, height)` | Resize the editor window |

## Parameter Synchronization

### UI to Plugin (User Interaction)

When the user moves a slider in the UI:

1. JavaScript sends normalized value (0.0-1.0) to Rust
2. Rust uses `setter.begin_set_parameter()`, `set_parameter_normalized()`, `end_set_parameter()`
3. This notifies the host for automation recording

```rust
UIMessage::SetGain { value } => {
    setter.begin_set_parameter(&params.gain);
    setter.set_parameter_normalized(&params.gain, value);
    setter.end_set_parameter(&params.gain);
}
```

### Plugin to UI (Host Automation)

When the host automates a parameter, the UI must update. Use `AtomicBool` flags with parameter callbacks:

```rust
#[derive(Params)]
struct MyPluginParams {
    #[id = "gain"]
    pub gain: FloatParam,

    /// Flag to notify UI when gain changes from host automation
    #[persist = ""]
    gain_changed: Arc<AtomicBool>,
}

impl Default for MyPluginParams {
    fn default() -> Self {
        let gain_changed = Arc::new(AtomicBool::new(false));
        let gain_changed_clone = gain_changed.clone();

        Self {
            gain: FloatParam::new(...)
                .with_callback(Arc::new(move |_| {
                    gain_changed_clone.store(true, Ordering::Relaxed);
                })),
            gain_changed,
        }
    }
}
```

Then in the event loop, check and clear the flag:

```rust
// In editor() method
let gain_changed = self.params.gain_changed.clone();

// In event loop
if gain_changed.swap(false, Ordering::Relaxed) {
    ctx.send_json(json!({
        "type": "param_change",
        "param": "gain",
        "value": params.gain.unmodulated_normalized_value(),
        "text": params.gain.to_string()
    }));
}
```

## JavaScript Side

### IPC Bridge

The native library injects this bridge automatically:

```javascript
// Available globally after page load
window.ipc.postMessage(jsonString)  // Send to Rust
window.onPluginMessage = function(msg) { }  // Receive from Rust
```

### Sending Messages

```javascript
function sendToPlugin(msg) {
    if (window.ipc) {
        window.ipc.postMessage(JSON.stringify(msg));
    }
}

// Examples
sendToPlugin({ type: 'Init' });
sendToPlugin({ type: 'SetGain', value: 0.75 });
```

### Receiving Messages

```javascript
window.onPluginMessage = function(msg) {
    if (msg.type === 'param_change') {
        if (msg.param === 'gain') {
            gainSlider.value = msg.value;
            gainLabel.textContent = msg.text;
        }
    }
};
```

### Preventing Feedback Loops

When updating UI from plugin messages, prevent re-sending to plugin:

```javascript
let updatingFromPlugin = false;

slider.addEventListener('input', (e) => {
    if (updatingFromPlugin) return;
    sendToPlugin({ type: 'SetGain', value: parseFloat(e.target.value) });
});

window.onPluginMessage = function(msg) {
    if (msg.type === 'param_change' && msg.param === 'gain') {
        updatingFromPlugin = true;
        slider.value = msg.value;
        label.textContent = msg.text;
        updatingFromPlugin = false;
    }
};
```

### Initialization

Request initial state when the page loads:

```javascript
window.addEventListener('DOMContentLoaded', () => {
    sendToPlugin({ type: 'Init' });
});
```

## Complete Example

### Rust (lib.rs)

```rust
use nih_plug::prelude::*;
use nih_plug_webview::{WebViewEditor, HTMLSource, EventStatus};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {
    Init,
    SetGain { value: f32 },
}

struct MyPlugin {
    params: Arc<MyPluginParams>,
}

#[derive(Params)]
struct MyPluginParams {
    #[id = "gain"]
    pub gain: FloatParam,
    #[persist = ""]
    gain_changed: Arc<AtomicBool>,
}

impl Default for MyPlugin {
    fn default() -> Self {
        Self {
            params: Arc::new(MyPluginParams::default()),
        }
    }
}

impl Default for MyPluginParams {
    fn default() -> Self {
        let gain_changed = Arc::new(AtomicBool::new(false));
        let gain_changed_clone = gain_changed.clone();

        Self {
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(0.0),
                FloatRange::Skewed {
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(30.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
                },
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db())
            .with_callback(Arc::new(move |_| {
                gain_changed_clone.store(true, Ordering::Relaxed);
            })),
            gain_changed,
        }
    }
}

impl Plugin for MyPlugin {
    // ... plugin metadata ...

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        let params = self.params.clone();
        let gain_changed = self.params.gain_changed.clone();

        let editor = WebViewEditor::new(HTMLSource::String(include_str!("ui.html")), (400, 300))
            .with_background_color((26, 26, 46, 255))
            .with_developer_mode(true)
            .with_event_loop(move |ctx, setter, _window| {
                while let Ok(msg) = ctx.next_event() {
                    if let Ok(ui_msg) = serde_json::from_value::<UIMessage>(msg) {
                        match ui_msg {
                            UIMessage::Init => {
                                ctx.send_json(json!({
                                    "type": "param_change",
                                    "param": "gain",
                                    "value": params.gain.unmodulated_normalized_value(),
                                    "text": params.gain.to_string()
                                }));
                            }
                            UIMessage::SetGain { value } => {
                                setter.begin_set_parameter(&params.gain);
                                setter.set_parameter_normalized(&params.gain, value);
                                setter.end_set_parameter(&params.gain);
                            }
                        }
                    }
                }

                if gain_changed.swap(false, Ordering::Relaxed) {
                    ctx.send_json(json!({
                        "type": "param_change",
                        "param": "gain",
                        "value": params.gain.unmodulated_normalized_value(),
                        "text": params.gain.to_string()
                    }));
                }
            });

        Some(Box::new(editor))
    }

    fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
        for channel_samples in buffer.iter_samples() {
            let gain = self.params.gain.smoothed.next();
            for sample in channel_samples {
                *sample *= gain;
                *sample = sample.clamp(-1.0, 1.0);  // Safety limiter
            }
        }
        ProcessStatus::Normal
    }
}
```

### HTML (ui.html)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My Plugin</title>
    <style>
        body {
            font-family: system-ui, sans-serif;
            background: #1a1a2e;
            color: #e4e4e4;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
        }
        .control {
            width: 100%;
            max-width: 300px;
            margin: 20px;
        }
        input[type="range"] {
            width: 100%;
        }
        .value {
            text-align: center;
            color: #6366f1;
        }
    </style>
</head>
<body>
    <h1>My Plugin</h1>
    <div class="control">
        <label>Gain</label>
        <input type="range" id="gain" min="0" max="1" value="0.5" step="0.001">
        <div class="value" id="gain-value">0.0 dB</div>
    </div>

    <script>
        function sendToPlugin(msg) {
            if (window.ipc) {
                window.ipc.postMessage(JSON.stringify(msg));
            }
        }

        const gainSlider = document.getElementById('gain');
        const gainValue = document.getElementById('gain-value');
        let updatingFromPlugin = false;

        gainSlider.addEventListener('input', (e) => {
            if (updatingFromPlugin) return;
            sendToPlugin({ type: 'SetGain', value: parseFloat(e.target.value) });
        });

        window.onPluginMessage = function(msg) {
            if (msg.type === 'param_change' && msg.param === 'gain') {
                updatingFromPlugin = true;
                gainSlider.value = msg.value;
                gainValue.textContent = msg.text;
                updatingFromPlugin = false;
            }
        };

        window.addEventListener('DOMContentLoaded', () => {
            sendToPlugin({ type: 'Init' });
        });
    </script>
</body>
</html>
```

## Best Practices

1. **Always use normalized values (0.0-1.0)** for parameter communication between UI and Rust
2. **Include Init message** to sync UI state when the editor opens
3. **Use AtomicBool flags** for each parameter that needs host automation sync
4. **Prevent feedback loops** in JavaScript when updating from plugin messages
5. **Always include a safety limiter** in audio processing: `sample.clamp(-1.0, 1.0)`
6. **Enable developer mode** during development for debugging with WebKit Inspector
7. **Use serde's tag attribute** for clean message type routing: `#[serde(tag = "type")]`
8. **Send display text along with values** so the UI shows formatted values (e.g., "0.0 dB")

## Debugging

1. Enable developer mode: `.with_developer_mode(true)`
2. Right-click in the plugin UI and select "Inspect Element" to open WebKit DevTools
3. Use `console.log()` in JavaScript to debug message flow
4. Check the Rust console for `eprintln!()` debug output

## Troubleshooting

### UI not updating from host automation
- Ensure you've added the `AtomicBool` flag for the parameter
- Ensure `.with_callback()` is set on the parameter
- Check that `gain_changed.clone()` is passed to the event loop closure

### Messages not received in JavaScript
- Ensure `window.onPluginMessage` is defined before `Init` is sent
- Check browser console for JSON parsing errors
- Verify message format matches expected structure

### Plugin crashes on load
- Check that all imports are correct
- Verify the HTML file exists at the expected path
- Look for panics in Rust code (check DAW console or system logs)
