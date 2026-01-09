//! Rust audio libraries reference
//!
//! Curated list of production-ready crates for audio plugin development.

/// Returns Rust audio libraries reference for CLAUDE.md
pub fn get_rust_audio_libs() -> &'static str {
    r#"## Rust Audio Libraries Reference

Use established crates instead of implementing DSP from scratch. These are battle-tested.

### Filters (USE THESE - don't write your own)

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `biquad` | IIR biquad filters (Audio EQ Cookbook) | LPF, HPF, EQ, shelves - most common |
| `iir_filters` | Butterworth, Chebyshev design | When you need specific filter response |

### DSP Building Blocks

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `dasp` | Sample/frame types, ring buffers, interpolation | Core audio data structures |
| `fundsp` | Composable DSP graph notation | Complex signal chains, rapid prototyping |

> **⚠️ WARNING: `synfx-dsp` requires nightly Rust** due to `portable_simd`. Do NOT use it unless you've switched to nightly with `rustup default nightly`. For stable Rust, use `fundsp` or implement algorithms inline (see examples below).

### FFT & Spectral

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `rustfft` | Pure Rust FFT | Spectral processing, analysis |
| `realfft` | Real-valued FFT (2x faster) | Audio-specific FFT work |
| `spectrum-analyzer` | FFT-to-spectrum with windowing | Visualizers, no_std compatible |

### Synthesis

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `fundsp` | Oscillators, envelopes, filters | Synth building blocks, anti-aliased |
| `twang` | Additive, FM, wavetable, Karplus-Strong | Pure Rust synthesis |

> For anti-aliased oscillators on stable Rust, use `fundsp` or implement PolyBLEP inline (see examples below).

### MIDI

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `wmidi` | Zero-alloc MIDI parsing | Realtime-safe (use in process()) |
| `midly` | MIDI file parsing | Loading .mid files |

### Audio Files

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `hound` | WAV read/write | Sample loading, bouncing |
| `symphonia` | Decode MP3, FLAC, AAC, WAV | Multi-format support |

### Adding Dependencies

**Use `cargo add` to get the latest version automatically:**

```bash
# In your plugin directory, run:
cargo add biquad        # Filters (stable Rust)
cargo add fundsp        # DSP graphs, oscillators (stable Rust)
cargo add rustfft       # FFT (stable Rust)
cargo add wmidi         # MIDI (stable Rust)
cargo add hound         # WAV files (stable Rust)
cargo add rubato        # High-quality resampling (stable Rust)
# cargo add synfx-dsp   # WARNING: Requires nightly Rust!
```

Or manually add to `Cargo.toml` (check crates.io for latest versions):

```toml
[dependencies]
biquad = "*"          # Use latest - check crates.io/crates/biquad
fundsp = "*"          # Use latest - check crates.io/crates/fundsp
```

### Working Code Examples

**Biquad lowpass filter (correct pattern):**
```rust
use biquad::{Biquad, Coefficients, DirectForm1, ToHertz, Type, Q_BUTTERWORTH_F32};

struct MyPlugin {
    filter: DirectForm1<f32>,
    sample_rate: f32,
}

impl MyPlugin {
    fn update_filter(&mut self, cutoff_hz: f32) {
        // Recreate filter with new coefficients (don't try to update in place)
        let coeffs = Coefficients::<f32>::from_params(
            Type::LowPass,
            self.sample_rate.hz(),
            cutoff_hz.hz(),
            Q_BUTTERWORTH_F32,
        ).unwrap();
        self.filter = DirectForm1::<f32>::new(coeffs);
    }

    fn process_sample(&mut self, input: f32) -> f32 {
        self.filter.run(input)
    }
}
```

**Using fundsp for signal chains:**
```rust
use fundsp::prelude::*;

// Create a simple synth voice
fn create_voice(freq: f32) -> impl AudioUnit {
    // Saw oscillator -> lowpass filter -> envelope
    saw_hz(freq) >> lowpass_hz(2000.0, 0.5) >> shape(Shape::Tanh)
}

// Process a block
let mut voice = create_voice(440.0);
voice.set_sample_rate(sample_rate as f64);
for sample in buffer.iter_mut() {
    *sample = voice.get_mono() as f32;
}
```

**Anti-aliased oscillator using fundsp (stable Rust):**
```rust
use fundsp::prelude::*;

// Create an anti-aliased saw oscillator
let mut osc = saw();
osc.set_sample_rate(sample_rate as f64);

// In process loop:
osc.set_hash(fxhash(&freq));  // Set frequency via hash
let sample = osc.get_mono() as f32;

// Or use the simpler function-based approach:
let mut voice = saw_hz(440.0);  // Creates saw at 440Hz
voice.set_sample_rate(sample_rate as f64);
```

**Inline PolyBLEP saw (stable Rust, no dependencies):**
```rust
struct PolyBlepSaw {
    phase: f32,
}

impl PolyBlepSaw {
    fn new() -> Self { Self { phase: 0.0 } }

    // PolyBLEP correction function
    fn polyblep(&self, t: f32, dt: f32) -> f32 {
        if t < dt {
            let t = t / dt;
            2.0 * t - t * t - 1.0
        } else if t > 1.0 - dt {
            let t = (t - 1.0) / dt;
            t * t + 2.0 * t + 1.0
        } else {
            0.0
        }
    }

    fn next(&mut self, freq: f32, sample_rate: f32) -> f32 {
        let dt = freq / sample_rate;  // Phase increment

        // Naive saw: ramps from -1 to 1
        let naive = 2.0 * self.phase - 1.0;

        // Apply PolyBLEP correction at discontinuity
        let sample = naive - self.polyblep(self.phase, dt);

        // Advance phase
        self.phase += dt;
        if self.phase >= 1.0 { self.phase -= 1.0; }

        sample
    }
}
```

**MIDI note handling (nih-plug style):**
```rust
// In process() - nih-plug provides NoteEvent directly
while let Some(event) = context.next_event() {
    match event {
        NoteEvent::NoteOn { note, velocity, .. } => {
            let freq = 440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0);
            let vel = velocity as f32;  // Already 0.0-1.0 in nih-plug
            self.trigger_voice(note, freq, vel);
        }
        NoteEvent::NoteOff { note, .. } => {
            self.release_voice(note);
        }
        _ => {}
    }
}
```

"#
}
