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
| `synfx-dsp` | Production-ready DSP (Dattorro reverb, PolyBLEP) | Effects that need to sound good |

### FFT & Spectral

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `rustfft` | Pure Rust FFT | Spectral processing, analysis |
| `realfft` | Real-valued FFT (2x faster) | Audio-specific FFT work |
| `spectrum-analyzer` | FFT-to-spectrum with windowing | Visualizers, no_std compatible |

### Synthesis

| Crate | Purpose | When to Use |
|-------|---------|-------------|
| `fundsp` | Oscillators, envelopes, filters | Synth building blocks |
| `synfx-dsp` | PolyBLEP oscillators, envelopes | Anti-aliased waveforms |
| `twang` | Additive, FM, wavetable, Karplus-Strong | Pure Rust synthesis |

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
cargo add biquad        # Filters
cargo add fundsp        # DSP graphs
cargo add synfx-dsp     # Effects
cargo add rustfft       # FFT
cargo add wmidi         # MIDI
cargo add hound         # WAV files
cargo add rubato        # High-quality resampling
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

**synfx-dsp PolyBLEP oscillator:**
```rust
use synfx_dsp::{PolyBlepOscillator, init_cos_tab};

// Call once at plugin initialization:
init_cos_tab();

// Create oscillator with initial phase (0.0 to 1.0)
let mut osc = PolyBlepOscillator::new(0.0);

// In process loop - pass frequency and INVERSE sample rate each call:
let israte = 1.0 / sample_rate;  // Calculate once, reuse
let sample = osc.next_saw(440.0, israte);  // Anti-aliased saw

// Other waveforms:
// osc.next_tri(freq, israte)
// osc.next_pulse(freq, israte, pulse_width)  // 0.0 = square
// osc.next_sin(freq, israte)
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
