//! Mastering plugin patterns
//!
//! Patterns for limiters, multiband processing, and metering.

/// Returns mastering plugin patterns for CLAUDE.md
pub fn get_mastering_patterns() -> &'static str {
    r#"## Mastering Plugin Implementation

### Lookahead Limiter

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

        // Calculate required gain reduction for this sample
        let abs_input = input.abs();
        let target_gain = if abs_input > self.ceiling {
            self.ceiling / abs_input
        } else {
            1.0
        };

        // Store in envelope buffer
        self.envelope_buffer[self.write_pos] = target_gain;

        // Find minimum gain in lookahead window (backwards pass simulation)
        // This is simplified - production code would use more efficient algorithm
        let mut min_gain = 1.0_f32;
        for i in 0..self.lookahead_samples {
            let idx = (self.write_pos + self.lookahead_samples - i) % self.lookahead_samples;
            min_gain = min_gain.min(self.envelope_buffer[idx]);
        }

        // Smooth gain changes (only allow slow release)
        if min_gain < self.current_gain {
            self.current_gain = min_gain;  // Instant attack
        } else {
            self.current_gain += self.release_coeff * (min_gain - self.current_gain);
        }

        self.write_pos = (self.write_pos + 1) % self.lookahead_samples;

        // Apply gain to delayed signal
        (delayed_input * self.current_gain).clamp(-self.ceiling, self.ceiling)
    }
}
```

### True Peak Detection

**Oversample to catch inter-sample peaks:**

```rust
// True peaks can exceed 0dBFS even when all samples are below
// Use 4x oversampling minimum for detection

fn detect_true_peak(samples: &[f32], sample_rate: f32) -> f32 {
    // Simple 4-point interpolation to estimate inter-sample peaks
    let mut max_peak = 0.0_f32;

    for i in 1..samples.len() - 2 {
        // Check actual sample
        max_peak = max_peak.max(samples[i].abs());

        // Estimate peak between samples using Hermite interpolation
        // Check at 0.25, 0.5, 0.75 positions between samples
        for frac in [0.25, 0.5, 0.75] {
            let interpolated = hermite_interpolate(
                samples[i - 1],
                samples[i],
                samples[i + 1],
                samples[i + 2],
                frac,
            );
            max_peak = max_peak.max(interpolated.abs());
        }
    }

    max_peak
}

fn hermite_interpolate(xm1: f32, x0: f32, x1: f32, x2: f32, frac: f32) -> f32 {
    let c0 = x0;
    let c1 = 0.5 * (x1 - xm1);
    let c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
    let c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    ((c3 * frac + c2) * frac + c1) * frac + c0
}
```

### Multiband Compressor

**Use Linkwitz-Riley crossover filters for phase-coherent band splitting:**

```rust
// Linkwitz-Riley = two cascaded Butterworth filters
// LR24 = two cascaded 12dB/oct Butterworth = flat summed response

struct MultibandCompressor {
    // Crossover filters (lowpass + highpass pairs)
    low_band_lp: [DirectForm1<f32>; 2],   // Cascaded for LR
    mid_band_hp: [DirectForm1<f32>; 2],
    mid_band_lp: [DirectForm1<f32>; 2],
    high_band_hp: [DirectForm1<f32>; 2],

    // Per-band compressors
    compressors: [Compressor; 3],  // Low, mid, high
}

impl MultibandCompressor {
    fn process(&mut self, input: f32) -> f32 {
        // Split into bands
        let mut low = input;
        for filter in &mut self.low_band_lp {
            low = filter.run(low);
        }

        let mut mid = input;
        for filter in &mut self.mid_band_hp {
            mid = filter.run(mid);
        }
        for filter in &mut self.mid_band_lp {
            mid = filter.run(mid);
        }

        let mut high = input;
        for filter in &mut self.high_band_hp {
            high = filter.run(high);
        }

        // Compress each band independently
        let low_compressed = self.compressors[0].process(low);
        let mid_compressed = self.compressors[1].process(mid);
        let high_compressed = self.compressors[2].process(high);

        // Sum bands (LR filters ensure flat response when summed)
        low_compressed + mid_compressed + high_compressed
    }

    fn set_crossover_frequencies(&mut self, low_freq: f32, high_freq: f32, sample_rate: f32) {
        // Create Butterworth coefficients for each crossover point
        // Note: Using biquad crate, create two filters per crossover
        // and cascade them for Linkwitz-Riley response
    }
}
```

### RMS and Peak Metering

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

    fn get_peak_db(&self) -> f32 {
        20.0 * self.peak.max(1e-10).log10()
    }

    fn reset_rms(&mut self) {
        self.rms_sum = 0.0;
        self.rms_count = 0;
    }
}
```

### LUFS Metering (Loudness)

```rust
// ITU-R BS.1770 loudness measurement
// Simplified version - full implementation needs K-weighting filter

struct LufsMeter {
    // K-weighting pre-filter (high shelf + highpass)
    k_weight_high_shelf: DirectForm1<f32>,
    k_weight_highpass: DirectForm1<f32>,

    // Gating and integration
    block_samples: Vec<f32>,
    block_size: usize,  // 400ms worth of samples
    momentary_loudness: f32,
}

impl LufsMeter {
    fn process(&mut self, sample: f32) {
        // Apply K-weighting
        let weighted = self.k_weight_highpass.run(
            self.k_weight_high_shelf.run(sample)
        );

        self.block_samples.push(weighted * weighted);

        if self.block_samples.len() >= self.block_size {
            // Calculate mean square for this block
            let mean_square: f32 = self.block_samples.iter().sum::<f32>()
                / self.block_samples.len() as f32;

            // Convert to LUFS
            self.momentary_loudness = -0.691 + 10.0 * mean_square.max(1e-10).log10();

            self.block_samples.clear();
        }
    }
}
```

### Soft Knee Compression

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

### Stereo Width Control

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

"#
}
