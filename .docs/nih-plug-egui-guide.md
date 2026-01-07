# nih-plug-egui Development Guide

This guide documents how to develop egui-based audio plugins using nih-plug's `nih_plug_egui` crate. egui provides an immediate-mode GUI framework that's cross-platform and integrates seamlessly with nih-plug's parameter system.

## Platform Support

**All platforms** - egui works on macOS, Windows, and Linux.

## Project Setup

### Cargo.toml Dependencies

```toml
[dependencies]
nih_plug = { git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }
nih_plug_egui = { git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }
egui = "0.24"
```

## Core Concepts

### Library Exports

```rust
use nih_plug_egui::{create_egui_editor, egui, widgets, EguiState};
```

- `create_egui_editor` - Main function to create the editor
- `egui` - Re-exported egui crate for UI building
- `widgets` - nih-plug specific widgets (ParamSlider, etc.)
- `EguiState` - Manages GUI size and persistence

### EguiState

The `EguiState` struct manages the editor window size and persistence:

```rust
#[derive(Params)]
struct MyPluginParams {
    #[persist = "editor-state"]
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

**Key points:**
- Use `#[persist = "editor-state"]` to save/restore window size
- Size is in logical pixels (before DPI scaling)
- `EguiState::from_size(width, height)` creates the initial state

### Creating the Editor

```rust
fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
    let params = self.params.clone();
    create_egui_editor(
        self.params.editor_state.clone(),  // Editor state
        (),                                 // User state (optional)
        |_, _| {},                          // Build function (one-time setup)
        move |egui_ctx, setter, _state| {   // Update function (called every frame)
            // UI code goes here
        },
    )
}
```

**Function parameters:**
1. `egui_state` - The `Arc<EguiState>` for window management
2. `user_state` - Custom state for UI-only data (use `()` if not needed)
3. `build` - One-time initialization closure
4. `update` - Main UI drawing closure (called every frame)

## UI Building

### Basic Layout

```rust
move |egui_ctx, setter, _state| {
    egui::CentralPanel::default().show(egui_ctx, |ui| {
        ui.heading("My Plugin");
        ui.add_space(10.0);

        ui.label("Gain");
        ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
    });
}
```

### Panel Types

| Panel | Purpose |
|-------|---------|
| `CentralPanel` | Main content area (takes remaining space) |
| `TopBottomPanel::top()` | Fixed header area |
| `TopBottomPanel::bottom()` | Fixed footer area |
| `SidePanel::left()` | Fixed left sidebar |
| `SidePanel::right()` | Fixed right sidebar |

### Layout Containers

```rust
// Horizontal layout
ui.horizontal(|ui| {
    ui.label("Left");
    ui.label("Right");
});

// Vertical layout (default)
ui.vertical(|ui| {
    ui.label("Top");
    ui.label("Bottom");
});

// Centered
ui.vertical_centered(|ui| {
    ui.label("Centered");
});

// With specific spacing
ui.spacing_mut().item_spacing = egui::vec2(10.0, 10.0);
```

## Widgets

### ParamSlider (nih-plug specific)

The `ParamSlider` widget automatically handles parameter binding:

```rust
ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
```

This handles:
- Displaying the current value
- User interaction (drag, click)
- Proper `begin_set_parameter` / `end_set_parameter` calls
- Value formatting using the parameter's formatters

### Generic egui Widgets

```rust
// Labels
ui.label("Text");
ui.heading("Heading");

// Sliders (raw, not parameter-bound)
ui.add(egui::Slider::new(&mut value, 0.0..=1.0));

// Buttons
if ui.button("Click me").clicked() {
    // Handle click
}

// Checkbox
ui.checkbox(&mut some_bool, "Enable");

// Combo box
egui::ComboBox::from_label("Select")
    .selected_text(&selected)
    .show_ui(ui, |ui| {
        ui.selectable_value(&mut selected, "A", "Option A");
        ui.selectable_value(&mut selected, "B", "Option B");
    });
```

### Custom Parameter Controls

For more control than `ParamSlider`, you can create custom parameter UI:

```rust
// Get current value
let value = params.gain.unmodulated_normalized_value();

// Create a slider
let response = ui.add(egui::Slider::new(&mut normalized_value, 0.0..=1.0));

// Handle interaction
if response.drag_started() {
    setter.begin_set_parameter(&params.gain);
}
if response.changed() {
    setter.set_parameter_normalized(&params.gain, normalized_value);
}
if response.drag_stopped() {
    setter.end_set_parameter(&params.gain);
}
```

## Styling

### Basic Styling

```rust
// Set background color
let frame = egui::Frame::default()
    .fill(egui::Color32::from_rgb(26, 26, 46))
    .inner_margin(egui::Margin::same(20.0));

egui::CentralPanel::default()
    .frame(frame)
    .show(egui_ctx, |ui| {
        // UI content
    });
```

### Custom Visuals

```rust
// In the build closure (runs once)
|ctx, _| {
    let mut style = (*ctx.style()).clone();
    style.visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(40, 40, 60);
    style.visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(60, 60, 80);
    ctx.set_style(style);
}
```

### Fonts

```rust
|ctx, _| {
    let mut fonts = egui::FontDefinitions::default();
    // Add custom fonts here
    ctx.set_fonts(fonts);
}
```

## Thread-Safe Communication

### Peak Meters and Visualizations

Use `Arc<AtomicF32>` for audio-to-GUI communication:

```rust
use std::sync::atomic::{AtomicU32, Ordering};

struct MyPlugin {
    params: Arc<MyPluginParams>,
    peak_meter: Arc<AtomicU32>,  // Store as bits for atomic ops
}

// In process():
let peak = buffer.iter_samples()
    .map(|s| s.iter().map(|x| x.abs()).fold(0.0, f32::max))
    .fold(0.0, f32::max);
self.peak_meter.store(peak.to_bits(), Ordering::Relaxed);

// In editor:
let peak = f32::from_bits(peak_meter.load(Ordering::Relaxed));
ui.add(egui::ProgressBar::new(peak).text(format!("{:.1} dB", util::gain_to_db(peak))));
```

### Conditional Updates

Only update peak meter when GUI is visible to save CPU:

```rust
// Check if editor is open before computing expensive visualizations
if self.params.editor_state.is_open() {
    // Compute peak meter, spectrum, etc.
}
```

## Complete Example

```rust
use nih_plug::prelude::*;
use nih_plug_egui::{create_egui_editor, egui, widgets, EguiState};
use std::sync::Arc;

struct MyPlugin {
    params: Arc<MyPluginParams>,
}

#[derive(Params)]
struct MyPluginParams {
    #[persist = "editor-state"]
    editor_state: Arc<EguiState>,

    #[id = "gain"]
    pub gain: FloatParam,

    #[id = "mix"]
    pub mix: FloatParam,
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
        Self {
            editor_state: EguiState::from_size(400, 300),
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
            .with_string_to_value(formatters::s2v_f32_gain_to_db()),
            mix: FloatParam::new(
                "Mix",
                1.0,
                FloatRange::Linear { min: 0.0, max: 1.0 },
            )
            .with_unit("%")
            .with_value_to_string(formatters::v2s_f32_percentage(0))
            .with_string_to_value(formatters::s2v_f32_percentage()),
        }
    }
}

impl Plugin for MyPlugin {
    const NAME: &'static str = "My Plugin";
    const VENDOR: &'static str = "My Company";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];

    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        let params = self.params.clone();
        create_egui_editor(
            self.params.editor_state.clone(),
            (),
            |ctx, _| {
                // One-time setup: customize styles
                let mut style = (*ctx.style()).clone();
                style.visuals.window_fill = egui::Color32::from_rgb(26, 26, 46);
                ctx.set_style(style);
            },
            move |egui_ctx, setter, _state| {
                egui::CentralPanel::default().show(egui_ctx, |ui| {
                    ui.heading("My Plugin");
                    ui.add_space(20.0);

                    ui.horizontal(|ui| {
                        ui.label("Gain:");
                        ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
                    });

                    ui.add_space(10.0);

                    ui.horizontal(|ui| {
                        ui.label("Mix:");
                        ui.add(widgets::ParamSlider::for_param(&params.mix, setter));
                    });
                });
            },
        )
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        for channel_samples in buffer.iter_samples() {
            let gain = self.params.gain.smoothed.next();
            let mix = self.params.mix.smoothed.next();
            for sample in channel_samples {
                let processed = *sample * gain;
                *sample = *sample * (1.0 - mix) + processed * mix;
                *sample = sample.clamp(-1.0, 1.0);  // Safety limiter
            }
        }
        ProcessStatus::Normal
    }
}

impl ClapPlugin for MyPlugin {
    const CLAP_ID: &'static str = "com.mycompany.myplugin";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("My audio plugin");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::AudioEffect, ClapFeature::Stereo];
}

impl Vst3Plugin for MyPlugin {
    const VST3_CLASS_ID: [u8; 16] = *b"MyPluginXXXXXXXX";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx];
}

nih_export_clap!(MyPlugin);
nih_export_vst3!(MyPlugin);
```

## Best Practices

1. **Use `widgets::ParamSlider`** for parameters - it handles all the boilerplate
2. **Store `editor_state` with `#[persist]`** to remember window size
3. **Keep UI simple** - egui redraws every frame, so complex UIs can be expensive
4. **Use `is_open()` check** before computing visualizations
5. **Prefer immediate mode** - don't try to cache UI state unnecessarily
6. **Test at different DPI scales** - use logical pixels for sizing
7. **Always include a safety limiter** in audio processing: `sample.clamp(-1.0, 1.0)`

## Resources

- [egui documentation](https://docs.rs/egui)
- [nih-plug egui crate](https://github.com/robbert-vdh/nih-plug/tree/master/nih_plug_egui)
- [egui demo](https://www.egui.rs/) - Interactive demo of all widgets
- [eframe template](https://github.com/emilk/eframe_template) - Reference for egui app structure
