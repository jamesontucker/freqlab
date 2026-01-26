---
name: webview-ui
description: WebView UI patterns for nih-plug-webview. IPC messaging, AtomicBool sync, HTML/JS integration. Invoke when working on UI code in webview projects.
internal: true
---

# WebView UI Framework

## TWO FILES MUST BE MODIFIED FOR EVERY FEATURE

| File | Purpose | What to Add |
|------|---------|-------------|
| `src/lib.rs` | Rust DSP + IPC | Parameter, process() logic, UIMessage variant, handler |
| `src/ui.html` | User Interface | HTML control (slider/knob), JS event handlers |

**If you only edit `src/lib.rs`, the feature is INCOMPLETE.** Users need UI to control parameters.

## Required Imports for WebView

```rust
use nih_plug_webview::{WebViewEditor, HTMLSource, EventStatus};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
```

## Message Enum Pattern

Define typed messages for UI -> Plugin communication:

```rust
#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {
    Init,                        // UI requests initial state
    SetGain { value: f32 },      // User adjusted gain slider
    SetFilterCutoff { value: f32 },
    // Add more as needed...
}
```

## AtomicBool Pattern for Host Automation Sync

When the DAW automates a parameter, you need to notify the UI:

```rust
#[derive(Params)]
struct MyParams {
    #[id = "gain"]
    pub gain: FloatParam,

    // For change tracking (must have unique key)
    #[persist = "gain-dirty"]
    gain_changed: Arc<AtomicBool>,
}

// In Default impl, add callback to the parameter:
impl Default for MyParams {
    fn default() -> Self {
        let gain_changed = Arc::new(AtomicBool::new(false));
        let gain_changed_clone = gain_changed.clone();

        Self {
            gain: FloatParam::new("Gain", util::db_to_gain(0.0), FloatRange::Skewed { ... })
                .with_callback(Arc::new(move |_| {
                    gain_changed_clone.store(true, Ordering::Relaxed);
                })),
            gain_changed,
        }
    }
}
```

## Editor Creation Pattern

```rust
fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
    let params = self.params.clone();
    let gain_changed = self.params.gain_changed.clone();

    Some(Box::new(
        WebViewEditor::new(HTMLSource::String(include_str!("ui.html")), (400, 300))
            .with_background_color((26, 26, 46, 255))  // Match your UI background
            .with_developer_mode(cfg!(debug_assertions)) // DevTools in debug builds
            .with_event_loop(move |ctx, setter, _window| {
                // Handle messages from JavaScript
                while let Ok(msg) = ctx.next_event() {
                    match msg {
                        UIMessage::Init => {
                            // Send initial parameter values to UI
                            ctx.send_json(json!({
                                "type": "init",
                                "gain": params.gain.unmodulated_normalized_value(),
                            }));
                        }
                        UIMessage::SetGain { value } => {
                            setter.begin_set_parameter(&params.gain);
                            setter.set_parameter_normalized(&params.gain, value);
                            setter.end_set_parameter(&params.gain);
                        }
                        // Handle other messages...
                    }
                }

                // Check for host automation changes and notify UI
                if gain_changed.swap(false, Ordering::Relaxed) {
                    ctx.send_json(json!({
                        "type": "param_change",
                        "param": "gain",
                        "value": params.gain.unmodulated_normalized_value()
                    }));
                }

                EventStatus::Ignored
            })
    ))
}
```

## JavaScript Side (ui.html)

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body { background: #1a1a2e; color: #eee; font-family: sans-serif; }
        .slider { width: 200px; }
    </style>
</head>
<body>
    <h1>My Plugin</h1>
    <label>Gain: <input type="range" id="gain" class="slider" min="0" max="1" step="0.001"></label>

    <script>
        // Send message to plugin
        function sendToPlugin(msg) {
            window.ipc.postMessage(JSON.stringify(msg));
        }

        // Receive messages from plugin
        window.onPluginMessage = function(msg) {
            if (msg.type === 'init') {
                document.getElementById('gain').value = msg.gain;
            } else if (msg.type === 'param_change') {
                if (msg.param === 'gain') {
                    document.getElementById('gain').value = msg.value;
                }
            }
        };

        // Request initial state when page loads
        window.addEventListener('DOMContentLoaded', () => {
            sendToPlugin({ type: 'Init' });
        });

        // Handle user input
        document.getElementById('gain').addEventListener('input', (e) => {
            sendToPlugin({ type: 'SetGain', value: parseFloat(e.target.value) });
        });
    </script>
</body>
</html>
```

## Common Pitfalls to Avoid

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Missing Init message | UI shows wrong values on open | Always handle `Init` and send current state |
| No AtomicBool callback | UI doesn't update from host automation | Add `.with_callback()` to each parameter |
| Feedback loop | UI -> Plugin -> UI infinite loop | JavaScript should ignore updates while dragging |
| Missing begin/end_set_parameter | Undo/redo doesn't work properly | Always wrap set_parameter_normalized |
| Empty persist keys | Compile errors | Use unique descriptive keys like `"gain-dirty"` |

## Feature Completion Checklist

Before saying a feature is "done", verify ALL boxes are checked:

- [ ] Parameter added to `Params` struct with `#[id = "..."]`
- [ ] DSP code uses the parameter via `.smoothed.next()` or `.value()`
- [ ] **UI CONTROL EXISTS in src/ui.html** - slider/knob/button in the UI
- [ ] UIMessage variant added for this parameter
- [ ] UI sends parameter changes to plugin (IPC)
- [ ] AtomicBool callback notifies UI of host automation changes
