//! CLAUDE.md generation for VST plugin projects
//!
//! Generates project-specific guidance files that Claude reads when helping
//! users develop their plugins. Includes DSP best practices, anti-hallucination
//! guardrails, and plugin-specific patterns.

use super::claude_knowledge::{
    get_dsp_fundamentals, get_effect_patterns, get_instrument_patterns, get_mastering_patterns,
    get_nih_plug_basics, get_rust_audio_libs, get_safety_rails, get_sampler_patterns,
};

/// Generate the complete CLAUDE.md content for a project
pub fn generate_claude_md(
    project_name: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> String {
    let mut content = String::new();

    // Header and config
    content.push_str(&generate_header(project_name, template, ui_framework, components));

    // nih-plug framework essentials (ALWAYS included - every plugin uses nih-plug)
    content.push_str(get_nih_plug_basics());
    content.push('\n');

    // DSP fundamentals and anti-hallucination rules (CRITICAL - always included)
    content.push_str(get_dsp_fundamentals());
    content.push('\n');

    // Safety rails and focus guidelines
    content.push_str(get_safety_rails());
    content.push('\n');

    // Critical guidelines for this UI framework
    content.push_str(&generate_critical_guidelines(ui_framework));

    // UI framework specific section
    content.push_str(&generate_ui_framework_section(ui_framework));

    // Plugin type specific section (basic patterns)
    content.push_str(&generate_plugin_type_section(template));

    // Advanced patterns based on plugin type
    content.push_str(&generate_advanced_patterns_section(template));

    // Component-specific sections
    if let Some(comps) = components {
        content.push_str(&generate_component_sections(comps));
    }

    // Rust audio libraries reference (condensed)
    content.push_str(get_rust_audio_libs());
    content.push('\n');

    // Resources section
    content.push_str(&generate_resources_section());

    content
}

fn generate_header(
    project_name: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> String {
    let components_str = components
        .map(|c| {
            if c.is_empty() {
                "None".to_string()
            } else {
                c.join(", ")
            }
        })
        .unwrap_or_else(|| "None".to_string());

    format!(
        r#"# CLAUDE.md - Project Guidelines for {project_name}

> This file provides Claude with project-specific context and best practices.
> It is read into context when you chat about this project.

## Important: Keep This File Updated

**Claude: You should update this file** as the plugin evolves. When you add significant features, parameters, or architectural changes, update the "Current Implementation" section below. This is critical because:
- Chat context may be compacted over long sessions
- This file persists and is re-read on each message
- It serves as the source of truth for what exists in the plugin

## Project Configuration

- **Type**: {template}
- **UI Framework**: {ui_framework}
- **Components**: {components_str}

## Current Implementation

<!-- Claude: Update this section as you build the plugin -->

**Parameters:**
- *(None yet - add parameters here as you implement them)*

**Key Features:**
- *(None yet - add features here as you implement them)*

**Architecture Notes:**
- *(Add important architectural decisions here)*

"#
    )
}

fn generate_critical_guidelines(ui_framework: &str) -> String {
    let (ui_file, ui_step, ipc_step, ui_reminder) = match ui_framework {
        "headless" => (
            "",
            "3. *(Skip - headless plugin has no custom UI)*",
            "4. *(Skip - no UI to wire up)*",
            "",
        ),
        "webview" => (
            "\n\n**UI File Location:** `src/ui.html`",
            "3. **Add UI control** in `src/ui.html` (slider, knob, button, etc.)",
            "4. **Add IPC handling** - message variant in Rust enum, handler in JavaScript",
            "\n\n> **STOP!** Before finishing, verify you added the UI control in `src/ui.html`",
        ),
        "egui" => (
            "\n\n**UI Location:** `editor()` method in `src/lib.rs`",
            "3. **Add UI widget** in the `editor()` method using `widgets::ParamSlider::for_param()`",
            "4. **Wire up setter** - the ParamSlider handles this automatically",
            "\n\n> **STOP!** Before finishing, verify you added the widget in `editor()`",
        ),
        _ => (
            "",
            "3. **Add UI control** for the parameter",
            "4. **Wire up the UI** to the parameter",
            "",
        ),
    };

    format!(
        r#"## Critical Guidelines

### ⚠️ MANDATORY: Every Feature Needs UI

**This is a {ui_framework} project.** When adding ANY feature with user-controllable parameters, you MUST complete ALL steps - DSP alone is NOT complete.{ui_file}

### Required Steps (DO NOT SKIP ANY):

1. **Add the parameter** to the `Params` struct with `#[id = "param_name"]`
2. **Add DSP logic** in `process()` using `self.params.param_name.smoothed.next()`
{ui_step}
{ipc_step}
5. **Test the complete flow** - parameter should be controllable from UI AND host automation{ui_reminder}

### Feature Completion Checklist

Before saying a feature is "done", verify ALL boxes are checked:

- [ ] Parameter added to `Params` struct with `#[id = "..."]`
- [ ] DSP code uses the parameter via `.smoothed.next()` or `.value()`
- [ ] **UI CONTROL EXISTS** (unless headless) - slider/knob/button in the UI
- [ ] UI sends parameter changes to plugin (IPC for webview, setter for egui)
- [ ] Plugin sends parameter changes to UI (for host automation sync)

**A feature without UI is NOT complete.** Users cannot control parameters they cannot see.

### Parameter Best Practices

- **IDs**: lowercase snake_case - `#[id = "filter_cutoff"]`
- **Names**: Human-readable - `FloatParam::new("Filter Cutoff", ...)`
- **Grouping**: Use prefixes - `osc1_pitch`, `osc2_pitch`, `filter_cutoff`, `env_attack`
- **Smoothing**: Always smooth parameters that directly affect audio to avoid clicks

### Safety Requirements

- **Always limit output**: Use `.clamp(-1.0, 1.0)` or a safety limiter on final output
- **Handle edge cases**: Check for zero/negative values, NaN, Inf
- **Smooth transitions**: Use parameter smoothing for any audio-rate changes

"#
    )
}

fn generate_ui_framework_section(ui_framework: &str) -> String {
    match ui_framework {
        "webview" => generate_webview_section(),
        "egui" => generate_egui_section(),
        "headless" => generate_headless_section(),
        _ => String::new(),
    }
}

fn generate_webview_section() -> String {
    r#"## WebView UI Framework

### ⚠️ TWO FILES MUST BE MODIFIED FOR EVERY FEATURE

| File | Purpose | What to Add |
|------|---------|-------------|
| `src/lib.rs` | Rust DSP + IPC | Parameter, process() logic, UIMessage variant, handler |
| `src/ui.html` | User Interface | HTML control (slider/knob), JS event handlers |

**If you only edit `src/lib.rs`, the feature is INCOMPLETE.** Users need UI to control parameters.

### Required Imports for WebView

```rust
use nih_plug_webview::{WebViewEditor, HTMLSource, EventStatus};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
```

### Message Enum Pattern

Define typed messages for UI → Plugin communication:

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

### AtomicBool Pattern for Host Automation Sync

When the DAW automates a parameter, you need to notify the UI:

```rust
#[derive(Params)]
struct MyParams {
    #[id = "gain"]
    pub gain: FloatParam,

    // NOT persisted - just for change tracking
    #[persist = ""]
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

### Editor Creation Pattern

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

### JavaScript Side (ui.html)

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

### Common Pitfalls to Avoid

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Missing Init message | UI shows wrong values on open | Always handle `Init` and send current state |
| No AtomicBool callback | UI doesn't update from host automation | Add `.with_callback()` to each parameter |
| Feedback loop | UI → Plugin → UI infinite loop | JavaScript should ignore updates while dragging |
| Missing begin/end_set_parameter | Undo/redo doesn't work properly | Always wrap set_parameter_normalized |

"#
    .to_string()
}

fn generate_egui_section() -> String {
    r#"## egui UI Framework

### ⚠️ BOTH DSP AND UI ARE IN THE SAME FILE

| Location | Purpose | What to Add |
|----------|---------|-------------|
| `src/lib.rs` - `Params` struct | Parameters | `FloatParam`, `IntParam`, etc. |
| `src/lib.rs` - `process()` | DSP Logic | Use `params.x.smoothed.next()` |
| `src/lib.rs` - `editor()` | **UI Widgets** | `ParamSlider::for_param()` |

**If you only add the parameter and DSP, the feature is INCOMPLETE.** You MUST also add a widget in `editor()`.

### Required Imports for egui

```rust
use nih_plug_egui::{create_egui_editor, egui, widgets, EguiState};
```

### EguiState Setup (Required for Window Persistence)

```rust
#[derive(Params)]
struct MyPluginParams {
    #[persist = "editor-state"]  // Saves window size with presets
    editor_state: Arc<EguiState>,

    #[id = "gain"]
    pub gain: FloatParam,
}

impl Default for MyPluginParams {
    fn default() -> Self {
        Self {
            editor_state: EguiState::from_size(400, 300),  // Width x Height in logical pixels
            gain: FloatParam::new(...),
        }
    }
}
```

### Complete Editor Pattern

```rust
fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
    let params = self.params.clone();
    let peak_meter = self.peak_meter.clone();  // For visualizations

    create_egui_editor(
        self.params.editor_state.clone(),
        (),                              // User state (use () if not needed)
        |ctx, _| {                       // Build function (one-time setup)
            // Optional: Customize styling
            let mut style = (*ctx.style()).clone();
            style.visuals.window_fill = egui::Color32::from_rgb(26, 26, 46);
            ctx.set_style(style);
        },
        move |egui_ctx, setter, _state| {  // Update function (called every frame)
            egui::CentralPanel::default().show(egui_ctx, |ui| {
                ui.heading("My Plugin");
                ui.add_space(10.0);

                // Parameter slider with label
                ui.horizontal(|ui| {
                    ui.label("Gain:");
                    ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
                });

                ui.add_space(10.0);

                // Peak meter visualization
                let peak = f32::from_bits(peak_meter.load(std::sync::atomic::Ordering::Relaxed));
                ui.add(egui::ProgressBar::new(peak).text(format!("{:.1} dB", util::gain_to_db(peak))));
            });
        },
    )
}
```

### ParamSlider Widget

The built-in `ParamSlider` handles all parameter binding automatically:

```rust
// Basic usage
ui.add(widgets::ParamSlider::for_param(&params.gain, setter));

// With custom width
ui.add(widgets::ParamSlider::for_param(&params.cutoff, setter).with_width(200.0));
```

This automatically handles:
- Displaying current value with proper formatting
- begin_set_parameter / end_set_parameter calls
- Drag interaction
- Value display using parameter's formatters

### Peak Meter Pattern (Audio → GUI Communication)

For real-time visualizations, use `AtomicU32` to safely pass data from audio thread:

```rust
use std::sync::atomic::{AtomicU32, Ordering};

struct MyPlugin {
    params: Arc<MyPluginParams>,
    peak_meter: Arc<AtomicU32>,  // Store peak as bits (f32 -> u32)
}

// In process():
let peak = buffer.iter_samples()
    .map(|s| s.iter().map(|x| x.abs()).fold(0.0f32, f32::max))
    .fold(0.0f32, f32::max);
self.peak_meter.store(peak.to_bits(), Ordering::Relaxed);

// In editor - only compute when UI is visible:
if self.params.editor_state.is_open() {
    // Compute expensive visualizations
}
```

### Layout Patterns

```rust
// Horizontal layout
ui.horizontal(|ui| {
    ui.label("Cutoff:");
    ui.add(widgets::ParamSlider::for_param(&params.cutoff, setter));
});

// Grouped parameters
ui.group(|ui| {
    ui.label("Filter");
    ui.add(widgets::ParamSlider::for_param(&params.cutoff, setter));
    ui.add(widgets::ParamSlider::for_param(&params.resonance, setter));
});

// Sections with separators
ui.separator();
ui.heading("Modulation");

// Vertical centering
ui.vertical_centered(|ui| {
    ui.heading("My Plugin");
});

// Custom spacing
ui.spacing_mut().item_spacing = egui::vec2(10.0, 10.0);
```

### Custom Parameter Controls

For more control than `ParamSlider`:

```rust
// Get current normalized value (0.0 to 1.0)
let mut value = params.cutoff.unmodulated_normalized_value();

let response = ui.add(egui::Slider::new(&mut value, 0.0..=1.0).text("Cutoff"));

if response.drag_started() {
    setter.begin_set_parameter(&params.cutoff);
}
if response.changed() {
    setter.set_parameter_normalized(&params.cutoff, value);
}
if response.drag_stopped() {
    setter.end_set_parameter(&params.cutoff);
}
```

### Common Pitfalls to Avoid

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Missing `editor_state` | Window size not saved | Add `#[persist = "editor-state"]` field |
| Heavy computation in UI | UI lag, audio glitches | Use `is_open()` check, pre-compute values |
| Not using `ParamSlider` | Missing begin/end calls | Use built-in widget or call manually |
| Forgetting UI for new param | Parameter not controllable | Always add widget in `editor()` |

"#
    .to_string()
}

fn generate_headless_section() -> String {
    r#"## Headless Plugin (No Custom UI)

This plugin has no custom graphical interface. Users interact through:
- DAW's generic parameter interface
- Automation lanes
- MIDI CC mapping (if enabled)

### Best Practices for Headless Plugins

1. **Clear parameter names**: Users only see the name in their DAW
2. **Sensible ranges**: Make defaults useful, ranges intuitive
3. **Good presets**: Consider adding factory presets for common use cases
4. **Proper units**: Use `formatters::v2s_f32_hz_then_khz` etc. for display

### Consider Adding

- Preset system for quick configuration
- Parameter groups for organization in DAW

"#
    .to_string()
}

fn generate_plugin_type_section(template: &str) -> String {
    match template {
        "effect" => generate_effect_section(),
        "instrument" => generate_instrument_section(),
        _ => String::new(),
    }
}

fn generate_effect_section() -> String {
    r#"## Effect Plugin Patterns

### Audio Flow
```
Input Buffer → Read Samples → Process/Transform → Safety Limit → Output Buffer
```

### Typical Process Loop

```rust
fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
    for channel_samples in buffer.iter_samples() {
        // Get smoothed parameter values (once per sample)
        let gain = self.params.gain.smoothed.next();
        let mix = self.params.mix.smoothed.next();

        for sample in channel_samples {
            let dry = *sample;
            let wet = self.process_sample(*sample);

            // Mix dry/wet
            *sample = dry * (1.0 - mix) + wet * mix;

            // Apply output gain and safety limit
            *sample *= gain;
            *sample = sample.clamp(-1.0, 1.0);
        }
    }
    ProcessStatus::Normal
}
```

### Common Effect Patterns

- **Filters**: Maintain state (previous samples) per channel
- **Delays**: Use ring buffers, handle sample rate changes
- **Distortion**: Apply nonlinear waveshaping, consider oversampling
- **Dynamics**: Track envelope, apply gain reduction

"#
    .to_string()
}

fn generate_instrument_section() -> String {
    r#"## Instrument Plugin Patterns

### MIDI Note Handling

```rust
fn process(&mut self, buffer: &mut Buffer, ..., context: &mut impl ProcessContext<Self>) -> ProcessStatus {
    // Process MIDI events
    while let Some(event) = context.next_event() {
        match event {
            NoteEvent::NoteOn { note, velocity, timing, .. } => {
                // Start/trigger a voice
                self.trigger_voice(note, velocity, timing);
            }
            NoteEvent::NoteOff { note, timing, .. } => {
                // Release the voice
                self.release_voice(note, timing);
            }
            _ => {}
        }
    }

    // Generate audio from active voices
    for channel_samples in buffer.iter_samples() {
        let output = self.render_voices();
        for sample in channel_samples {
            *sample = output.clamp(-1.0, 1.0);
        }
    }

    ProcessStatus::Normal
}
```

### Voice Management Considerations

- **Polyphony**: Track multiple simultaneous notes
- **Voice stealing**: When max voices reached, steal oldest/quietest
- **Note tracking**: Map note numbers to voice instances
- **Sample-accurate timing**: Use the `timing` field for precise triggering

### Common Instrument Patterns

- **Oscillators**: Phase accumulator, anti-aliasing for non-sine waves
- **Envelopes**: ADSR with configurable curves
- **Filters**: Per-voice or global filtering
- **LFOs**: Free-running or tempo-synced modulation

"#
    .to_string()
}

fn generate_component_sections(components: &[String]) -> String {
    let mut content = String::new();

    for component in components {
        let section = match component.as_str() {
            "preset_system" => generate_preset_system_section(),
            "param_smoothing" => generate_param_smoothing_section(),
            "sidechain_input" => generate_sidechain_section(),
            "oversampling" => generate_oversampling_section(),
            "polyphony" => generate_polyphony_section(),
            "velocity_layers" => generate_velocity_layers_section(),
            "adsr_envelope" => generate_adsr_section(),
            "lfo" => generate_lfo_section(),
            "custom_gui" => String::new(), // Covered by UI framework section
            _ => String::new(),
        };
        content.push_str(&section);
    }

    content
}

fn generate_preset_system_section() -> String {
    r#"## Preset System Guidelines

### State Persistence

Use `#[persist = "key"]` for non-parameter state that should save with presets:
```rust
#[persist = "editor_state"]
editor_state: Arc<EguiState>,
```

### Factory Presets

Embed presets in the binary for instant access:
```rust
const FACTORY_PRESETS: &[(&str, &str)] = &[
    ("Init", include_str!("../presets/init.json")),
    ("Warm", include_str!("../presets/warm.json")),
];
```

### User Presets

- Platform-specific storage: `~/Library/Application Support/` (macOS)
- Use plugin name in path to avoid conflicts
- Handle missing/corrupted preset files gracefully

"#
    .to_string()
}

fn generate_param_smoothing_section() -> String {
    r#"## Parameter Smoothing Guidelines

### When to Smooth

- **Always smooth**: Gain, filter cutoff, any parameter affecting audio directly
- **Don't smooth**: Discrete choices (waveform type), triggers

### Smoothing Styles

```rust
// Linear smoothing (good for most parameters)
FloatParam::new("Gain", 0.5, FloatRange::Linear { min: 0.0, max: 1.0 })
    .with_smoother(SmoothingStyle::Linear(50.0))  // 50ms

// Exponential (better for frequencies)
FloatParam::new("Cutoff", 1000.0, FloatRange::Skewed { min: 20.0, max: 20000.0, factor: 0.3 })
    .with_smoother(SmoothingStyle::Exponential(50.0))
```

### Using Smoothed Values

```rust
// In process() - call once per sample
let gain = self.params.gain.smoothed.next();
```

"#
    .to_string()
}

fn generate_sidechain_section() -> String {
    r#"## Sidechain Input Guidelines

### Configuration

```rust
fn audio_io_layout(&self) -> AudioIOLayout {
    AudioIOLayout {
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        aux_input_ports: &[PortConfig::Stereo],  // Sidechain input
        ..Default::default()
    }
}
```

### Accessing Sidechain

```rust
fn process(&mut self, buffer: &mut Buffer, aux: &mut AuxiliaryBuffers, ...) {
    let sidechain = aux.inputs.first();
    // Use sidechain signal for ducking, gating, etc.
}
```

"#
    .to_string()
}

fn generate_oversampling_section() -> String {
    r#"## Oversampling Guidelines

### When to Oversample

- Distortion/saturation effects (reduces aliasing)
- Nonlinear processing with harmonics above Nyquist
- NOT needed for: linear filters, delays, simple gain

### Implementation Pattern

1. Upsample input (2x, 4x, or 8x)
2. Process at higher sample rate
3. Apply anti-aliasing lowpass filter
4. Downsample back to original rate

### Performance Considerations

- 2x oversampling doubles CPU usage
- Consider making it optional/adjustable
- Quality vs. performance tradeoff

"#
    .to_string()
}

fn generate_polyphony_section() -> String {
    r#"## Polyphony Guidelines

### Voice Structure

```rust
struct Voice {
    note: u8,
    velocity: f32,
    phase: f32,
    envelope: AdsrEnvelope,
    active: bool,
}

struct Synth {
    voices: [Voice; MAX_VOICES],
    // ...
}
```

### Voice Allocation

```rust
fn allocate_voice(&mut self, note: u8) -> Option<&mut Voice> {
    // First try: find free voice
    if let Some(v) = self.voices.iter_mut().find(|v| !v.active) {
        return Some(v);
    }
    // Voice stealing: take oldest/quietest
    self.voices.iter_mut().min_by_key(|v| /* priority */)
}
```

### Voice Rendering

```rust
fn render_voices(&mut self) -> f32 {
    self.voices
        .iter_mut()
        .filter(|v| v.active)
        .map(|v| v.render())
        .sum()
}
```

"#
    .to_string()
}

fn generate_velocity_layers_section() -> String {
    r#"## Velocity Layers Guidelines

### Layer Selection

Map MIDI velocity (0-127) to sample layers:
```rust
fn select_layer(&self, velocity: u8) -> usize {
    match velocity {
        0..=42 => 0,    // Soft
        43..=84 => 1,   // Medium
        85..=127 => 2,  // Hard
    }
}
```

### Crossfading Between Layers

For smoother transitions, crossfade adjacent layers based on velocity.

"#
    .to_string()
}

fn generate_adsr_section() -> String {
    r#"## ADSR Envelope Additional Tips

> See "Advanced Instrument Implementation" section above for complete ADSR code.

### Common ADSR Mistakes to Avoid

| Mistake | Problem | Fix |
|---------|---------|-----|
| Resetting level on retrigger | Click when retriggering | Don't reset `level` in `trigger()` |
| Linear attack | Unnatural sound | Use exponential (`1.0 - e^(-1/time)`) |
| Instant release | Clicks on note-off | Minimum 5-10ms release |
| Not handling sample rate | Wrong envelope times | Recalculate coefficients in `initialize()` |

### Envelope Modulation Targets

Common things to modulate with envelopes:
- **Amplitude envelope**: Essential for note on/off
- **Filter envelope**: Cutoff frequency (use bipolar: -1 to +1)
- **Pitch envelope**: Subtle pitch drift (< 1 semitone usually)

### Per-Voice vs Global Envelopes

- **Per-voice**: Amplitude, filter cutoff - each note has its own
- **Global**: LFO rates, master filter - shared across all voices

"#
    .to_string()
}

fn generate_lfo_section() -> String {
    r#"## LFO Guidelines

### Basic Structure

```rust
struct Lfo {
    phase: f32,
    frequency: f32,
    waveform: LfoWaveform,
}

impl Lfo {
    fn process(&mut self, sample_rate: f32) -> f32 {
        let output = match self.waveform {
            LfoWaveform::Sine => (self.phase * TAU).sin(),
            LfoWaveform::Triangle => 1.0 - 4.0 * (self.phase - 0.5).abs(),
            LfoWaveform::Square => if self.phase < 0.5 { 1.0 } else { -1.0 },
            LfoWaveform::Saw => 2.0 * self.phase - 1.0,
        };

        self.phase += self.frequency / sample_rate;
        if self.phase >= 1.0 { self.phase -= 1.0; }

        output
    }
}
```

### Tempo Sync

Convert BPM to frequency: `frequency = bpm / 60.0 * note_division`

### Modulation Routing

Use LFO output to modulate other parameters (filter cutoff, amplitude, pitch).

"#
    .to_string()
}

/// Generate advanced patterns section based on plugin type
fn generate_advanced_patterns_section(template: &str) -> String {
    let mut content = String::new();

    match template {
        "effect" => {
            content.push_str(get_effect_patterns());
            content.push('\n');
            // Also include mastering patterns for effects (limiters, compressors, etc.)
            content.push_str(get_mastering_patterns());
        }
        "instrument" => {
            content.push_str(get_instrument_patterns());
            content.push('\n');
            // Also include sampler patterns for instruments (sample playback, drum machines)
            content.push_str(get_sampler_patterns());
        }
        _ => {}
    }

    content
}

/// Generate resources section with useful links
fn generate_resources_section() -> String {
    r#"## Resources

Essential references for audio plugin development:

- **Audio EQ Cookbook**: https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html
- **Awesome Audio DSP**: https://github.com/BillyDM/awesome-audio-dsp
- **nih-plug Documentation**: https://nih-plug.robbertvanderhelm.nl/
- **DAFX (Digital Audio Effects)**: Classic DSP textbook
- **musicdsp.org**: Community DSP code archive

"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_section_present(content: &str, section: &str, scenario: &str) {
        assert!(
            content.contains(section),
            "MISSING in {}: '{}'",
            scenario,
            section
        );
    }

    #[test]
    fn test_scenario_1_effect_webview_with_components() {
        let components = vec!["sidechain_input".to_string(), "oversampling".to_string()];
        let content = generate_claude_md("test-effect", "effect", "webview", Some(&components));

        let scenario = "Scenario 1 (effect + webview + sidechain + oversampling)";

        // Check header
        check_section_present(&content, "Type**: effect", scenario);
        check_section_present(&content, "UI Framework**: webview", scenario);
        check_section_present(&content, "sidechain_input, oversampling", scenario);

        // Check nih-plug basics (ALWAYS included)
        check_section_present(&content, "## nih-plug Framework Essentials", scenario);
        check_section_present(&content, "impl Plugin for", scenario);
        check_section_present(&content, "FloatParam", scenario);
        check_section_present(&content, "ClapPlugin", scenario);

        // Check DSP fundamentals
        check_section_present(&content, "## CRITICAL: DSP Anti-Hallucination Rules", scenario);
        check_section_present(&content, "Never Invent Filter Coefficients", scenario);

        // Check safety rails
        check_section_present(&content, "## Plugin Development Focus & Safety", scenario);

        // Check webview-specific guidelines
        check_section_present(&content, "**This is a webview project.**", scenario);
        check_section_present(&content, "**UI File Location:** `src/ui.html`", scenario);
        check_section_present(&content, "## WebView UI Framework", scenario);
        check_section_present(&content, "UIMessage", scenario);

        // Check effect patterns
        check_section_present(&content, "## Effect Plugin Patterns", scenario);
        check_section_present(&content, "## Advanced Effect Implementation", scenario);

        // Check mastering patterns (included for effects)
        check_section_present(&content, "## Mastering Plugin Implementation", scenario);
        check_section_present(&content, "Lookahead Limiter", scenario);

        // Check component sections
        check_section_present(&content, "## Sidechain Input Guidelines", scenario);
        check_section_present(&content, "## Oversampling Guidelines", scenario);

        // Check resources
        check_section_present(&content, "## Rust Audio Libraries Reference", scenario);
        check_section_present(&content, "## Resources", scenario);

        println!("✅ {} PASSED", scenario);
    }

    #[test]
    fn test_scenario_2_instrument_egui_no_components() {
        let content = generate_claude_md("test-synth", "instrument", "egui", None);

        let scenario = "Scenario 2 (instrument + egui + no components)";

        // Check header
        check_section_present(&content, "Type**: instrument", scenario);
        check_section_present(&content, "UI Framework**: egui", scenario);
        check_section_present(&content, "Components**: None", scenario);

        // Check egui-specific guidelines
        check_section_present(&content, "**This is a egui project.**", scenario);
        check_section_present(&content, "**UI Location:** `editor()` method in `src/lib.rs`", scenario);
        check_section_present(&content, "## egui UI Framework", scenario);
        check_section_present(&content, "ParamSlider::for_param", scenario);

        // Check instrument patterns
        check_section_present(&content, "## Instrument Plugin Patterns", scenario);
        check_section_present(&content, "MIDI Note Handling", scenario);

        // Check advanced instrument patterns
        check_section_present(&content, "## Advanced Instrument Implementation", scenario);
        check_section_present(&content, "Complete Voice Structure", scenario);
        check_section_present(&content, "ADSR Envelope (Correct Implementation)", scenario);

        // Check sampler patterns (included for instruments)
        check_section_present(&content, "## Sampler & Drum Machine Implementation", scenario);

        // Should NOT have sidechain (effect component)
        assert!(
            !content.contains("## Sidechain Input Guidelines"),
            "Should NOT have sidechain for instrument"
        );

        println!("✅ {} PASSED", scenario);
    }

    #[test]
    fn test_scenario_3_effect_headless_no_components() {
        let content = generate_claude_md("test-processor", "effect", "headless", None);

        let scenario = "Scenario 3 (effect + headless + no components)";

        // Check header
        check_section_present(&content, "Type**: effect", scenario);
        check_section_present(&content, "UI Framework**: headless", scenario);

        // Check headless-specific guidelines
        check_section_present(&content, "**This is a headless project.**", scenario);
        check_section_present(&content, "*(Skip - headless plugin has no custom UI)*", scenario);
        check_section_present(&content, "## Headless Plugin (No Custom UI)", scenario);

        // Should NOT have webview or egui sections
        assert!(
            !content.contains("## WebView UI Framework"),
            "Should NOT have webview section for headless"
        );
        assert!(
            !content.contains("## egui UI Framework"),
            "Should NOT have egui section for headless"
        );
        assert!(
            !content.contains("src/ui.html"),
            "Should NOT mention ui.html for headless"
        );

        // Check effect patterns still present
        check_section_present(&content, "## Effect Plugin Patterns", scenario);
        check_section_present(&content, "## Advanced Effect Implementation", scenario);

        println!("✅ {} PASSED", scenario);
    }

    #[test]
    fn test_scenario_4_instrument_webview_all_components() {
        let components = vec![
            "preset_system".to_string(),
            "polyphony".to_string(),
            "velocity_layers".to_string(),
            "adsr_envelope".to_string(),
            "lfo".to_string(),
        ];
        let content = generate_claude_md("super-synth", "instrument", "webview", Some(&components));

        let scenario = "Scenario 4 (instrument + webview + ALL components)";

        // Check header includes all components
        check_section_present(&content, "Type**: instrument", scenario);
        check_section_present(&content, "UI Framework**: webview", scenario);
        check_section_present(&content, "preset_system", scenario);
        check_section_present(&content, "polyphony", scenario);
        check_section_present(&content, "velocity_layers", scenario);
        check_section_present(&content, "adsr_envelope", scenario);
        check_section_present(&content, "lfo", scenario);

        // Check webview section (since it's webview)
        check_section_present(&content, "## WebView UI Framework", scenario);
        check_section_present(&content, "src/ui.html", scenario);

        // Check ALL component sections
        check_section_present(&content, "## Preset System Guidelines", scenario);
        check_section_present(&content, "## Polyphony Guidelines", scenario);
        check_section_present(&content, "## Velocity Layers Guidelines", scenario);
        check_section_present(&content, "## ADSR Envelope Additional Tips", scenario);
        check_section_present(&content, "## LFO Guidelines", scenario);

        // Check instrument patterns
        check_section_present(&content, "## Instrument Plugin Patterns", scenario);
        check_section_present(&content, "## Advanced Instrument Implementation", scenario);
        check_section_present(&content, "## Sampler & Drum Machine Implementation", scenario);

        println!("✅ {} PASSED", scenario);
    }

    #[test]
    fn test_ui_enforcement_warnings() {
        // Test that UI enforcement warnings are present for webview and egui
        let webview_content = generate_claude_md("test", "effect", "webview", None);
        let egui_content = generate_claude_md("test", "effect", "egui", None);
        let headless_content = generate_claude_md("test", "effect", "headless", None);

        // WebView should have strong UI warnings
        assert!(
            webview_content.contains("⚠️ MANDATORY: Every Feature Needs UI"),
            "WebView should have UI warning"
        );
        assert!(
            webview_content.contains("STOP!"),
            "WebView should have STOP reminder"
        );

        // egui should have UI warnings
        assert!(
            egui_content.contains("⚠️ MANDATORY: Every Feature Needs UI"),
            "egui should have UI warning"
        );

        // Headless should skip UI steps
        assert!(
            headless_content.contains("Skip - headless plugin has no custom UI"),
            "Headless should skip UI steps"
        );

        println!("✅ UI enforcement warnings PASSED");
    }
}
