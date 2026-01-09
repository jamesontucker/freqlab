//! Advanced effect plugin patterns
//!
//! Production-ready patterns for common audio effects.

/// Returns advanced effect patterns for CLAUDE.md
pub fn get_effect_patterns() -> &'static str {
    r#"## Advanced Effect Implementation

These patterns go deeper than the basics above. Copy and adapt as needed.

### Dry/Wet Mix (Function Pattern)

Always implement dry/wet mixing for effects:

```rust
fn process_sample(&mut self, input: f32, mix: f32) -> f32 {
    let dry = input;
    let wet = self.apply_effect(input);
    dry * (1.0 - mix) + wet * mix
}
```

### Stereo Processing

Process channels together for true stereo effects:

```rust
fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
    for mut channel_samples in buffer.iter_samples() {
        let left = channel_samples.get_mut(0).unwrap();
        let right = channel_samples.get_mut(1).unwrap();

        // Process as stereo pair
        let (out_l, out_r) = self.process_stereo(*left, *right);

        *left = out_l;
        *right = out_r;
    }
    ProcessStatus::Normal
}
```

### Delay Line (Ring Buffer)

Pre-allocate in `initialize()`, use modulo indexing:

```rust
struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
}

impl DelayLine {
    fn new(max_samples: usize) -> Self {
        Self {
            buffer: vec![0.0; max_samples],
            write_pos: 0,
        }
    }

    fn read(&self, delay_samples: usize) -> f32 {
        let read_pos = (self.write_pos + self.buffer.len() - delay_samples)
            % self.buffer.len();
        self.buffer[read_pos]
    }

    fn write_and_advance(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
    }

    // Fractional delay with linear interpolation
    fn read_fractional(&self, delay_samples: f32) -> f32 {
        let delay_int = delay_samples as usize;
        let frac = delay_samples - delay_int as f32;

        let s0 = self.read(delay_int);
        let s1 = self.read(delay_int + 1);

        s0 + frac * (s1 - s0)
    }
}
```

### Feedback with Safety Limiting

Prevent runaway feedback:

```rust
fn process_delay_with_feedback(&mut self, input: f32) -> f32 {
    let delayed = self.delay.read(self.delay_samples);

    // Soft-clip feedback to prevent explosion
    let feedback_signal = soft_clip(delayed * self.feedback);

    self.delay.write_and_advance(input + feedback_signal);
    delayed
}

fn soft_clip(x: f32) -> f32 {
    x.tanh()  // Smooth limiting between -1 and 1
}
```

### Distortion/Saturation

**Always oversample** for nonlinear processing to reduce aliasing:

```rust
// Waveshaping without oversampling = aliasing artifacts
// Implement 2x/4x oversampling or use rubato crate for high-quality resampling
// NOTE: synfx-dsp has oversampling but requires nightly Rust

// Common waveshaping functions:
fn soft_clip(x: f32) -> f32 { x.tanh() }
fn hard_clip(x: f32) -> f32 { x.clamp(-1.0, 1.0) }
fn tube_like(x: f32) -> f32 {
    if x >= 0.0 {
        1.0 - (-x).exp()
    } else {
        -1.0 + x.exp()
    }
}
```

### Dynamics Processing (Compressor)

```rust
struct Compressor {
    envelope: f32,
    attack_coeff: f32,
    release_coeff: f32,
    threshold: f32,  // in linear, not dB
    ratio: f32,
}

impl Compressor {
    fn process(&mut self, input: f32) -> f32 {
        let abs_input = input.abs();

        // Envelope follower
        let coeff = if abs_input > self.envelope {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.envelope += coeff * (abs_input - self.envelope);

        // Gain calculation
        let gain = if self.envelope > self.threshold {
            let over = self.envelope / self.threshold;
            let compressed = over.powf(1.0 / self.ratio - 1.0);
            compressed
        } else {
            1.0
        };

        input * gain
    }
}
```

### Per-Channel State

Effects with memory (filters, delays) need separate state per channel:

```rust
struct StereoFilter {
    left: DirectForm1<f32>,
    right: DirectForm1<f32>,
}

// Initialize both with same coefficients
// Process each channel independently
```

### DC Offset Removal

Add a highpass filter to remove DC offset after nonlinear processing:

```rust
// Simple one-pole DC blocker
struct DcBlocker {
    x_prev: f32,
    y_prev: f32,
    r: f32,  // 0.995 typical
}

impl DcBlocker {
    fn process(&mut self, x: f32) -> f32 {
        let y = x - self.x_prev + self.r * self.y_prev;
        self.x_prev = x;
        self.y_prev = y;
        y
    }
}
```

### Chorus/Flanger (Modulated Delay)

These effects use an LFO to modulate delay time:

```rust
struct ModulatedDelay {
    buffer: Vec<f32>,
    write_pos: usize,
    lfo_phase: f32,
    sample_rate: f32,
}

impl ModulatedDelay {
    fn process_chorus(
        &mut self,
        input: f32,
        base_delay_ms: f32,  // 10-30ms for chorus
        depth_ms: f32,       // 1-5ms modulation depth
        rate_hz: f32,        // 0.1-5 Hz LFO rate
    ) -> f32 {
        // LFO modulates delay time
        let lfo = (self.lfo_phase * std::f32::consts::TAU).sin();
        self.lfo_phase += rate_hz / self.sample_rate;
        if self.lfo_phase >= 1.0 { self.lfo_phase -= 1.0; }

        // Calculate modulated delay in samples
        let delay_ms = base_delay_ms + depth_ms * lfo;
        let delay_samples = delay_ms * self.sample_rate / 1000.0;

        // Read with interpolation (crucial for smooth modulation)
        let delayed = self.read_interpolated(delay_samples);

        // Write to buffer
        self.buffer[self.write_pos] = input;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();

        delayed
    }

    fn process_flanger(
        &mut self,
        input: f32,
        base_delay_ms: f32,  // 0.5-5ms for flanger (shorter than chorus)
        depth_ms: f32,       // 0.5-2ms
        rate_hz: f32,        // 0.1-2 Hz
        feedback: f32,       // 0.0-0.95 (creates resonance)
    ) -> f32 {
        let lfo = (self.lfo_phase * std::f32::consts::TAU).sin();
        self.lfo_phase += rate_hz / self.sample_rate;
        if self.lfo_phase >= 1.0 { self.lfo_phase -= 1.0; }

        let delay_ms = base_delay_ms + depth_ms * lfo;
        let delay_samples = delay_ms * self.sample_rate / 1000.0;

        let delayed = self.read_interpolated(delay_samples);

        // Feedback creates the characteristic flanger resonance
        let feedback_clamped = feedback.clamp(-0.95, 0.95);
        self.buffer[self.write_pos] = input + delayed * feedback_clamped;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();

        delayed
    }

    fn read_interpolated(&self, delay_samples: f32) -> f32 {
        let delay_int = delay_samples as usize;
        let frac = delay_samples - delay_int as f32;

        let len = self.buffer.len();
        let idx0 = (self.write_pos + len - delay_int) % len;
        let idx1 = (self.write_pos + len - delay_int - 1) % len;

        self.buffer[idx0] * (1.0 - frac) + self.buffer[idx1] * frac
    }
}
```

**Key differences:**
| Effect | Delay Time | Feedback | Character |
|--------|-----------|----------|-----------|
| Chorus | 10-30ms | None/low | Thickening, doubling |
| Flanger | 0.5-5ms | High | Jet sweep, resonance |
| Phaser | Allpass filters | High | Similar to flanger, different character |

### Reverb

> **⚠️ NOTE:** `synfx-dsp` has excellent Dattorro reverb but requires **nightly Rust**.
> For stable Rust, use `fundsp` or implement Freeverb-style reverb inline.

**Using fundsp reverb (stable Rust):**
```rust
use fundsp::prelude::*;

// Create a simple reverb (stereo in/out)
let mut reverb = reverb_stereo(40.0, 5.0, 0.5);  // room_size, time, diffusion
reverb.set_sample_rate(sample_rate as f64);

// In process loop (f64):
let (out_l, out_r) = reverb.get_stereo();
reverb.set_stereo(input_l as f64, input_r as f64);
```

**Simple comb filter reverb (stable Rust, inline):**
```rust
struct SimpleReverb {
    comb_filters: Vec<CombFilter>,
    allpass_filters: Vec<AllpassFilter>,
}

struct CombFilter {
    buffer: Vec<f32>,
    index: usize,
    feedback: f32,
    damping: f32,
    filter_state: f32,
}

impl CombFilter {
    fn new(delay_samples: usize, feedback: f32, damping: f32) -> Self {
        Self {
            buffer: vec![0.0; delay_samples],
            index: 0,
            feedback,
            damping,
            filter_state: 0.0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.index];
        // Lowpass in feedback path for damping
        self.filter_state = output * (1.0 - self.damping) + self.filter_state * self.damping;
        self.buffer[self.index] = input + self.filter_state * self.feedback;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

struct AllpassFilter {
    buffer: Vec<f32>,
    index: usize,
    feedback: f32,
}

impl AllpassFilter {
    fn new(delay_samples: usize, feedback: f32) -> Self {
        Self { buffer: vec![0.0; delay_samples], index: 0, feedback }
    }

    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.index];
        let output = -input + delayed;
        self.buffer[self.index] = input + delayed * self.feedback;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

// Initialize with prime-number delay times for natural sound
// Typical Freeverb delays (in samples at 44100Hz):
// Combs: 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617
// Allpasses: 556, 441, 341, 225
```

"#
}
