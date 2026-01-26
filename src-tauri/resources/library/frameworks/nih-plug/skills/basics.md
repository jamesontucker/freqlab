---
name: nih-plug-basics
description: Core nih-plug framework patterns, parameter setup, plugin lifecycle, and buffer processing. Invoke when setting up plugin structure or working with parameters.
internal: true
---

# nih-plug Framework Essentials

This plugin uses [nih-plug](https://github.com/robbert-vdh/nih-plug), a Rust VST3/CLAP plugin framework.

## Plugin Trait Implementation

Every plugin implements the `Plugin` trait:

```rust
use nih_plug::prelude::*;
use std::sync::Arc;

impl Plugin for MyPlugin {
    const NAME: &'static str = "Plugin Name";
    const VENDOR: &'static str = "Vendor";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[
        AudioIOLayout {
            main_input_channels: NonZeroU32::new(2),
            main_output_channels: NonZeroU32::new(2),
            ..AudioIOLayout::const_default()
        }
    ];

    const MIDI_INPUT: MidiConfig = MidiConfig::None;   // or MidiConfig::Basic for instruments
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        // Audio processing here
        ProcessStatus::Normal
    }
}
```

## Parameter Types

Use the `#[derive(Params)]` macro with parameter fields:

```rust
#[derive(Params)]
struct MyPluginParams {
    #[id = "gain"]  // Stable ID for automation/presets
    pub gain: FloatParam,

    #[id = "bypass"]
    pub bypass: BoolParam,

    #[id = "mode"]
    pub mode: EnumParam<MyMode>,

    // For non-parameter persisted state (e.g., editor state)
    #[persist = "editor-state"]  // MUST be unique, non-empty string
    pub editor_state: Arc<SomeState>,
}
```

**CRITICAL: Persist Key Rules**
- Every `#[persist = "key"]` MUST have a **unique, non-empty key**
- Using `#[persist = ""]` (empty string) for multiple fields causes **compile/runtime errors**
- Keys must be unique across the entire Params struct
- Use descriptive keys: `"editor-state"`, `"gain-changed"`, not empty strings

```rust
// BAD - empty keys cause conflicts:
#[persist = ""]
gain_changed: Arc<AtomicBool>,
#[persist = ""]
filter_changed: Arc<AtomicBool>,  // ERROR: duplicate key!

// GOOD - unique descriptive keys:
#[persist = "gain-dirty"]
gain_changed: Arc<AtomicBool>,
#[persist = "filter-dirty"]
filter_changed: Arc<AtomicBool>,
```

### FloatParam
```rust
FloatParam::new("Gain", 0.0, FloatRange::Linear { min: -30.0, max: 30.0 })
    .with_unit(" dB")
    .with_smoother(SmoothingStyle::Logarithmic(50.0))
    .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
    .with_string_to_value(formatters::s2v_f32_gain_to_db())

// For gain parameters with proper skew:
FloatParam::new("Gain", util::db_to_gain(0.0), FloatRange::Skewed {
    min: util::db_to_gain(-30.0),
    max: util::db_to_gain(30.0),
    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
})

// For bipolar parameters (e.g., pan -1 to +1):
FloatParam::new("Pan", 0.0, FloatRange::SymmetricalSkewed {
    min: -1.0,
    max: 1.0,
    factor: 1.0,
    center: 0.0,  // Where the knob "center" sits
})
```

### Built-in Formatters

nih-plug provides many formatters for common parameter types:

```rust
// Frequency (switches to kHz above 1000)
.with_value_to_string(formatters::v2s_f32_hz_then_khz(2))
.with_string_to_value(formatters::s2v_f32_hz_then_khz())

// Percentage (0.0-1.0 displayed as 0%-100%)
.with_value_to_string(formatters::v2s_f32_percentage(2))
.with_string_to_value(formatters::s2v_f32_percentage())

// Compression ratio (displays as "4.0:1")
.with_value_to_string(formatters::v2s_compression_ratio(2))
.with_string_to_value(formatters::s2v_compression_ratio())

// MIDI note names (displays as "C4", "A#3")
.with_value_to_string(formatters::v2s_i32_note_formatter())
.with_string_to_value(formatters::s2v_i32_note_formatter())

// Gain to dB (linear gain displayed as dB)
.with_value_to_string(formatters::v2s_f32_gain_to_db(2))
.with_string_to_value(formatters::s2v_f32_gain_to_db())
```

### IntParam
```rust
IntParam::new("Voices", 4, IntRange::Linear { min: 1, max: 16 })
```

### BoolParam
```rust
BoolParam::new("Bypass", false)
```

### EnumParam
```rust
#[derive(Enum, PartialEq)]
enum MyMode {
    #[name = "Clean"]
    Clean,
    #[name = "Warm"]
    Warm,
    #[name = "Aggressive"]
    Aggressive,
}

EnumParam::new("Mode", MyMode::Clean)
```

## Buffer Processing

### Per-Sample Processing (Most Common)
```rust
fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
    for channel_samples in buffer.iter_samples() {
        // Get smoothed parameter value (call once per sample)
        let gain = self.params.gain.smoothed.next();

        for sample in channel_samples {
            *sample = process_sample(*sample, gain);
            // Protect against NaN/Inf (crashes DAWs)
            if !sample.is_finite() { *sample = 0.0; }
        }
    }
    ProcessStatus::Normal
}
```

### Per-Channel Processing
```rust
for (channel_idx, channel) in buffer.as_slice().iter_mut().enumerate() {
    for sample in channel.iter_mut() {
        *sample = process_sample(*sample);
    }
}
```

### Sidechain/Auxiliary Buffer Access
```rust
fn process(&mut self, buffer: &mut Buffer, aux: &mut AuxiliaryBuffers, ...) -> ProcessStatus {
    // Access sidechain input (if configured in AUDIO_IO_LAYOUTS)
    if let Some(sidechain) = aux.inputs.first() {
        let sc_channels = sidechain.as_slice();  // Use as_slice(), NOT .get()
        for (sample_idx, channel_samples) in buffer.iter_samples().enumerate() {
            let sc_left = sc_channels.get(0).map(|c| c[sample_idx]).unwrap_or(0.0);
            let sc_right = sc_channels.get(1).map(|c| c[sample_idx]).unwrap_or(sc_left);
            // ... use sidechain signal
        }
    }
    ProcessStatus::Normal
}
```
**Note:** Buffer does NOT have a `.get()` method - use `.as_slice()` to get channel slices first.

### Avoiding Double Mutable Borrow

When processing stereo with sample index access, extract samples first to avoid borrow conflicts:

```rust
// WRONG - double mutable borrow
for channel_samples in buffer.iter_samples() {
    let left = channel_samples[0];   // borrows channel_samples
    let right = channel_samples[1];  // borrows again - might conflict
    channel_samples[0] = process(left);  // mutable borrow - ERROR!
}

// CORRECT - extract samples, then write back
for mut channel_samples in buffer.iter_samples() {
    let mut samples: [f32; 2] = [0.0; 2];
    for (i, sample) in channel_samples.iter_mut().enumerate().take(2) {
        samples[i] = *sample;
    }

    // Process
    let (out_l, out_r) = process_stereo(samples[0], samples[1]);

    // Write back
    for (i, sample) in channel_samples.iter_mut().enumerate().take(2) {
        *sample = if i == 0 { out_l } else { out_r };
    }
}
```

### f32::min/max Method Ambiguity

When using `.min()` or `.max()` on f32, trait conflicts can occur:

```rust
// May cause "multiple applicable items" error
let clamped = value.min(1.0).max(0.0);

// CORRECT - use explicit function calls
let clamped = f32::min(f32::max(value, 0.0), 1.0);

// OR use clamp (cleaner)
let clamped = value.clamp(0.0, 1.0);
```

## Getting Context Info

```rust
fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
    let sample_rate = context.transport().sample_rate;
    let tempo = context.transport().tempo;           // BPM (Option<f64>)
    let playing = context.transport().playing;       // Is DAW playing?
    let pos_samples = context.transport().pos_samples(); // Position in samples
    // ...
}
```

## Smoothing Styles

```rust
SmoothingStyle::None              // No smoothing (for discrete values)
SmoothingStyle::Linear(50.0)      // 50ms linear interpolation
SmoothingStyle::Logarithmic(50.0) // 50ms log (better for gain) - CANNOT cross zero!
SmoothingStyle::Exponential(50.0) // 50ms exponential (better for frequencies)
```

**WARNING:** `SmoothingStyle::Logarithmic` cannot handle parameters that cross zero (e.g., pan -1 to +1). Use `Linear` for bipolar parameters.

### Block-Based Smoothing

For efficiency, get smoothed values for an entire block at once:

```rust
fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
    let num_samples = buffer.samples();
    let mut gain_values = [0.0f32; 128];  // Max expected block size
    self.params.gain.smoothed.next_block(&mut gain_values, num_samples);

    for (sample_idx, channel_samples) in buffer.iter_samples().enumerate() {
        let gain = gain_values[sample_idx];
        for sample in channel_samples {
            *sample *= gain;
        }
    }
    ProcessStatus::Normal
}
```

## Reading Parameter Values

```rust
// In process() - use smoothed values for audio
let gain = self.params.gain.smoothed.next();

// In UI code - use unsmoothed for display
let gain_display = self.params.gain.value();

// Normalized value (0.0 to 1.0)
let normalized = self.params.gain.unmodulated_normalized_value();
```

## Plugin Format Traits

### CLAP Plugin
```rust
impl ClapPlugin for MyPlugin {
    const CLAP_ID: &'static str = "com.vendor.plugin-name";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("My audio plugin");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[
        ClapFeature::AudioEffect,  // or ClapFeature::Instrument
        ClapFeature::Stereo,
    ];
}
```

### VST3 Plugin
```rust
impl Vst3Plugin for MyPlugin {
    const VST3_CLASS_ID: [u8; 16] = *b"MyPlugin16Chars!";  // Must be exactly 16 bytes
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[
        Vst3SubCategory::Fx,  // or Vst3SubCategory::Synth
    ];
}
```

## Export Macros

At the end of lib.rs:
```rust
nih_export_clap!(MyPlugin);
nih_export_vst3!(MyPlugin);
```

## Lifecycle Methods

```rust
impl Plugin for MyPlugin {
    // Called when plugin loads or sample rate changes
    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {
        self.sample_rate = buffer_config.sample_rate;
        // Pre-allocate buffers, recalculate coefficients
        true  // Return false to indicate initialization failure
    }

    // Called when playback stops or plugin is bypassed
    fn reset(&mut self) {
        // Clear delay buffers, reset filters, reset envelopes
        self.delay_buffer.fill(0.0);
    }

    // Called before process() - can update latency
    fn latency_samples(&self) -> u32 {
        // Return latency in samples (for lookahead limiters, etc.)
        0
    }
}
```

## MIDI Handling (Instruments)

For instrument plugins, set `MIDI_INPUT: MidiConfig = MidiConfig::Basic;` and handle events:

```rust
fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers,
           context: &mut impl ProcessContext<Self>) -> ProcessStatus {
    // Process MIDI events
    while let Some(event) = context.next_event() {
        match event {
            NoteEvent::NoteOn { note, velocity, .. } => {
                // note: 0-127 MIDI note number
                // velocity: 0.0-1.0 normalized velocity
                self.trigger_voice(note, velocity);
            }
            NoteEvent::NoteOff { note, .. } => {
                self.release_voice(note);
            }
            NoteEvent::MidiCC { cc, value, .. } => {
                // cc: controller number (1=mod wheel, 64=sustain, etc.)
                // value: 0.0-1.0 normalized
            }
            NoteEvent::MidiPitchBend { value, .. } => {
                // value: -1.0 to 1.0
            }
            _ => {}
        }
    }

    // Then process audio...
    ProcessStatus::Normal
}
```

## Logging and Debugging

nih-plug provides logging macros that work in DAW environments:

```rust
nih_log!("Plugin initialized at {} Hz", sample_rate);
nih_warn!("High CPU usage detected");
nih_error!("Failed to load preset");
nih_dbg!(some_value);  // Debug print with file:line location

// Logs appear in:
// - macOS: Console.app or DAW's log
// - Windows: DebugView or DAW's log
// - Linux: stderr or DAW's log
```

## Common Imports

```rust
use nih_plug::prelude::*;
use std::sync::Arc;
```

## dB/Gain Conversions

```rust
// Using nih_plug utilities (preferred)
let linear = util::db_to_gain(-6.0);  // 0.5
let db = util::gain_to_db(0.5);       // -6.0

// Manual (if needed)
fn db_to_linear(db: f32) -> f32 { 10.0_f32.powf(db / 20.0) }
fn linear_to_db(linear: f32) -> f32 { 20.0 * linear.log10() }
```

## Common Gotchas

### Parameter IDs Are Permanent
Once you ship a plugin, **never change `#[id = "..."]` values**. Changing them breaks:
- Saved presets
- DAW automation lanes
- User projects that reference those parameters

### reset() Is Called on Stop/Bypass
The `reset()` method is called when the DAW stops playback or bypasses your plugin. Always clear delay buffers, filter state, and envelopes here to avoid artifacts when playback resumes.

### Sample Rate Can Change
The sample rate can change between `initialize()` calls without unloading the plugin. Always recalculate filter coefficients and time-based values in `initialize()`, not just in `Default::default()`.

### Avoid Static/Global State
Static variables are shared across all plugin instances. Use `Default::default()` and instance fields instead:
```rust
// BAD - shared across instances
static mut BUFFER: [f32; 1024] = [0.0; 1024];

// GOOD - per-instance
struct MyPlugin {
    buffer: Vec<f32>,
}
```

### GPL Licensing
nih-plug is GPL-licensed. Your plugin must be GPL-compatible (GPL, LGPL, MIT, Apache, etc.). Proprietary code cannot statically link against nih-plug.

### macOS Gatekeeper
For distribution on macOS, plugins must be code-signed and notarized. Unsigned plugins trigger "cannot be opened" warnings.
