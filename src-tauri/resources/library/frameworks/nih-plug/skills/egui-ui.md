---
name: egui-ui
description: egui UI patterns for nih-plug-egui. ParamSlider widgets, EguiState, layout patterns. Invoke when working on UI in egui projects.
internal: true
---

# egui UI Framework

## BOTH DSP AND UI ARE IN THE SAME FILE

| Location | Purpose | What to Add |
|----------|---------|-------------|
| `src/lib.rs` - `Params` struct | Parameters | `FloatParam`, `IntParam`, etc. |
| `src/lib.rs` - `process()` | DSP Logic | Use `params.x.smoothed.next()` |
| `src/lib.rs` - `editor()` | **UI Widgets** | `ParamSlider::for_param()` |

**If you only add the parameter and DSP, the feature is INCOMPLETE.** You MUST also add a widget in `editor()`.

## Required Imports for egui

```rust
use nih_plug_egui::{create_egui_editor, egui, widgets, EguiState};
```

## EguiState Setup (Required for Window Persistence)

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

## Complete Editor Pattern

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

## ParamSlider Widget

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

## Peak Meter Pattern (Audio -> GUI Communication)

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

## Layout Patterns

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

## Custom Parameter Controls

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

## Common Pitfalls to Avoid

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Missing `editor_state` | Window size not saved | Add `#[persist = "editor-state"]` field |
| Heavy computation in UI | UI lag, audio glitches | Use `is_open()` check, pre-compute values |
| Not using `ParamSlider` | Missing begin/end calls | Use built-in widget or call manually |
| Forgetting UI for new param | Parameter not controllable | Always add widget in `editor()` |

## Feature Completion Checklist

Before saying a feature is "done", verify ALL boxes are checked:

- [ ] Parameter added to `Params` struct with `#[id = "..."]`
- [ ] DSP code uses the parameter via `.smoothed.next()` or `.value()`
- [ ] **UI WIDGET EXISTS in editor()** - ParamSlider or custom control
- [ ] Widget is wired up to the parameter via setter
