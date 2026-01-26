---
name: effect-patterns
description: Effect plugin implementation patterns. Dry/wet mixing, delay lines, dynamics, distortion, reverb, limiters, mastering. Invoke when implementing audio effects.
---

# Effect Plugin Patterns

## Dry/Wet Mix (Essential for All Effects)

Always implement dry/wet mixing:

```rust
fn process_sample(&mut self, input: f32, mix: f32) -> f32 {
    let dry = input;
    let wet = self.apply_effect(input);
    dry * (1.0 - mix) + wet * mix
}
```

## Stereo Processing

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

## Delay Line (Ring Buffer)

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

## Feedback with Safety Limiting

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

## Distortion/Saturation

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

## Dynamics Processing (Compressor)

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

## Soft Knee Compression

```rust
fn soft_knee_gain(input_db: f32, threshold: f32, ratio: f32, knee_width: f32) -> f32 {
    let half_knee = knee_width / 2.0;

    if input_db < threshold - half_knee {
        // Below knee - no compression
        0.0  // 0 dB gain reduction
    } else if input_db > threshold + half_knee {
        // Above knee - full compression
        (threshold - input_db) * (1.0 - 1.0 / ratio)
    } else {
        // In knee region - smooth transition
        let x = input_db - threshold + half_knee;
        let compression = (1.0 - 1.0 / ratio) * x * x / (2.0 * knee_width);
        -compression
    }
}
```

## Chorus/Flanger (Modulated Delay)

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
}
```

**Key differences:**
| Effect | Delay Time | Feedback | Character |
|--------|-----------|----------|-----------|
| Chorus | 10-30ms | None/low | Thickening, doubling |
| Flanger | 0.5-5ms | High | Jet sweep, resonance |
| Phaser | Allpass filters | High | Similar to flanger, different character |

## Per-Channel State

Effects with memory (filters, delays) need separate state per channel:

```rust
struct StereoFilter {
    left: DirectForm1<f32>,
    right: DirectForm1<f32>,
}

// Initialize both with same coefficients
// Process each channel independently
```

## DC Offset Removal

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

## Reverb

> **Note:** `synfx-dsp` has excellent Dattorro reverb but requires **nightly Rust**.
> For stable Rust, use `fundsp` or implement Freeverb-style reverb.

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

## Lookahead Limiter

**A limiter needs lookahead to prevent overshoot:**

```rust
struct LookaheadLimiter {
    lookahead_buffer: Vec<f32>,  // Circular buffer for audio delay
    envelope_buffer: Vec<f32>,   // For gain calculation
    write_pos: usize,
    lookahead_samples: usize,    // Typically 1-5ms worth
    ceiling: f32,                // Maximum output level (e.g., 0.99)
    release_coeff: f32,
    current_gain: f32,
}

impl LookaheadLimiter {
    fn new(lookahead_ms: f32, sample_rate: f32, ceiling: f32) -> Self {
        let lookahead_samples = (lookahead_ms * sample_rate / 1000.0) as usize;
        Self {
            lookahead_buffer: vec![0.0; lookahead_samples],
            envelope_buffer: vec![0.0; lookahead_samples],
            write_pos: 0,
            lookahead_samples,
            ceiling,
            release_coeff: 1.0 - (-1.0 / (0.1 * sample_rate)).exp(), // 100ms release
            current_gain: 1.0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        // Store input in lookahead buffer
        let read_pos = (self.write_pos + 1) % self.lookahead_samples;
        let delayed_input = self.lookahead_buffer[read_pos];
        self.lookahead_buffer[self.write_pos] = input;

        // Calculate required gain reduction
        let abs_input = input.abs();
        let target_gain = if abs_input > self.ceiling {
            self.ceiling / abs_input
        } else {
            1.0
        };

        self.envelope_buffer[self.write_pos] = target_gain;

        // Find minimum gain in lookahead window
        let mut min_gain = 1.0_f32;
        for i in 0..self.lookahead_samples {
            let idx = (self.write_pos + self.lookahead_samples - i) % self.lookahead_samples;
            min_gain = min_gain.min(self.envelope_buffer[idx]);
        }

        // Smooth gain changes (instant attack, slow release)
        if min_gain < self.current_gain {
            self.current_gain = min_gain;
        } else {
            self.current_gain += self.release_coeff * (min_gain - self.current_gain);
        }

        self.write_pos = (self.write_pos + 1) % self.lookahead_samples;
        (delayed_input * self.current_gain).clamp(-self.ceiling, self.ceiling)
    }
}
```

## Stereo Width Control

```rust
fn adjust_stereo_width(left: f32, right: f32, width: f32) -> (f32, f32) {
    // Convert to mid-side
    let mid = (left + right) * 0.5;
    let side = (left - right) * 0.5;

    // Adjust width (0 = mono, 1 = normal, 2 = extra wide)
    let adjusted_side = side * width;

    // Convert back to left-right
    let new_left = mid + adjusted_side;
    let new_right = mid - adjusted_side;

    (new_left, new_right)
}
```

## RMS and Peak Metering

```rust
struct Meter {
    rms_sum: f32,
    rms_count: usize,
    peak: f32,
    peak_hold: f32,
    peak_hold_samples: usize,
    peak_hold_counter: usize,
}

impl Meter {
    fn process(&mut self, sample: f32) {
        // RMS calculation
        self.rms_sum += sample * sample;
        self.rms_count += 1;

        // Peak with hold
        let abs_sample = sample.abs();
        if abs_sample > self.peak_hold {
            self.peak_hold = abs_sample;
            self.peak_hold_counter = 0;
        } else {
            self.peak_hold_counter += 1;
            if self.peak_hold_counter > self.peak_hold_samples {
                self.peak_hold *= 0.9999;  // Slow decay
            }
        }

        self.peak = self.peak.max(abs_sample);
    }

    fn get_rms_db(&self) -> f32 {
        if self.rms_count == 0 { return -100.0; }
        let rms = (self.rms_sum / self.rms_count as f32).sqrt();
        20.0 * rms.max(1e-10).log10()
    }
}
```

## Feature Completion Checklist (Effects)

Before saying a feature is "done", verify:

- [ ] Dry/wet mix parameter added and working
- [ ] Per-channel state for stereo processing
- [ ] reset() clears all delay buffers and filter state
- [ ] NaN/Inf protection: `if !sample.is_finite() { *sample = 0.0; }`
- [ ] **UI control exists** for each new parameter
