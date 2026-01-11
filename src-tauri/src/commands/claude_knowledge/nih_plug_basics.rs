//! Core nih-plug reference for all plugin projects
//!
//! Essential nih-plug patterns that every plugin needs, regardless of type or UI framework.

/// Returns core nih-plug reference for CLAUDE.md
pub fn get_nih_plug_basics() -> &'static str {
    r#"## nih-plug Framework Essentials

This plugin uses [nih-plug](https://github.com/robbert-vdh/nih-plug), a Rust VST3/CLAP plugin framework.

### Plugin Trait Implementation

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

### Parameter Types

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

**⚠️ CRITICAL: Persist Key Rules**
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

#### FloatParam
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
```

#### IntParam
```rust
IntParam::new("Voices", 4, IntRange::Linear { min: 1, max: 16 })
```

#### BoolParam
```rust
BoolParam::new("Bypass", false)
```

#### EnumParam
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

### Buffer Processing

#### Per-Sample Processing (Most Common)
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

#### Per-Channel Processing
```rust
for (channel_idx, channel) in buffer.as_slice().iter_mut().enumerate() {
    for sample in channel.iter_mut() {
        *sample = process_sample(*sample);
    }
}
```

### Getting Context Info

```rust
fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
    let sample_rate = context.transport().sample_rate;
    let tempo = context.transport().tempo;           // BPM (Option<f64>)
    let playing = context.transport().playing;       // Is DAW playing?
    let pos_samples = context.transport().pos_samples(); // Position in samples
    // ...
}
```

### Smoothing Styles

```rust
SmoothingStyle::None              // No smoothing (for discrete values)
SmoothingStyle::Linear(50.0)      // 50ms linear interpolation
SmoothingStyle::Logarithmic(50.0) // 50ms log (better for gain) - CANNOT cross zero!
SmoothingStyle::Exponential(50.0) // 50ms exponential (better for frequencies)
```

**WARNING:** `SmoothingStyle::Logarithmic` cannot handle parameters that cross zero (e.g., pan -1 to +1). Use `Linear` for bipolar parameters.

### Reading Parameter Values

```rust
// In process() - use smoothed values for audio
let gain = self.params.gain.smoothed.next();

// In UI code - use unsmoothed for display
let gain_display = self.params.gain.value();

// Normalized value (0.0 to 1.0)
let normalized = self.params.gain.unmodulated_normalized_value();
```

### Plugin Format Traits

#### CLAP Plugin
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

#### VST3 Plugin
```rust
impl Vst3Plugin for MyPlugin {
    const VST3_CLASS_ID: [u8; 16] = *b"MyPlugin16Chars!";  // Must be exactly 16 bytes
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[
        Vst3SubCategory::Fx,  // or Vst3SubCategory::Synth
    ];
}
```

### Export Macros

At the end of lib.rs:
```rust
nih_export_clap!(MyPlugin);
nih_export_vst3!(MyPlugin);
```

### Lifecycle Methods

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

### Common Imports

```rust
use nih_plug::prelude::*;
use std::sync::Arc;
```

### dB/Gain Conversions

```rust
// Using nih_plug utilities (preferred)
let linear = util::db_to_gain(-6.0);  // 0.5
let db = util::gain_to_db(0.5);       // -6.0

// Manual (if needed)
fn db_to_linear(db: f32) -> f32 { 10.0_f32.powf(db / 20.0) }
fn linear_to_db(linear: f32) -> f32 { 20.0 * linear.log10() }
```

"#
}
