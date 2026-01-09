//! DSP fundamentals and anti-hallucination guardrails
//!
//! Critical guidance to prevent Claude from inventing filter coefficients
//! or making common DSP mistakes.

/// Returns DSP fundamentals content for CLAUDE.md
pub fn get_dsp_fundamentals() -> &'static str {
    r#"## CRITICAL: DSP Anti-Hallucination Rules

### Never Invent Filter Coefficients

**DO NOT** generate filter coefficient formulas from memory. Filter math is precise and errors cause broken audio. Always use:

- The `biquad` crate (implements Audio EQ Cookbook correctly)
- The `fundsp` or `synfx-dsp` crates for pre-built filters
- Reference: https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html

**Correct approach - use a crate:**
```rust
use biquad::{Biquad, Coefficients, DirectForm1, ToHertz, Type, Q_BUTTERWORTH_F32};

// Create filter
let coeffs = Coefficients::<f32>::from_params(
    Type::LowPass,
    sample_rate.hz(),
    cutoff_freq.hz(),
    Q_BUTTERWORTH_F32,
).unwrap();
let mut filter = DirectForm1::<f32>::new(coeffs);

// In process loop:
let filtered = filter.run(input_sample);
```

**Available biquad filter types** (use crate, don't calculate):
- `Type::LowPass`, `Type::HighPass`, `Type::BandPass`
- `Type::Notch`, `Type::AllPass`
- `Type::PeakingEQ`, `Type::LowShelf`, `Type::HighShelf`

### Avoiding Clicks and Pops

#### Parameter Smoothing (MANDATORY)

Every parameter that directly affects audio MUST be smoothed:

```rust
// nih-plug built-in smoothing
gain: FloatParam::new("Gain", 0.0, FloatRange::Linear { min: -30.0, max: 6.0 })
    .with_smoother(SmoothingStyle::Logarithmic(50.0))  // 50ms smoothing time
```

**Smoothing style guide:**
- `SmoothingStyle::Linear(ms)` - Good for most parameters
- `SmoothingStyle::Logarithmic(ms)` - Better for gain/volume (**WARNING: cannot cross zero!**)
- `SmoothingStyle::Exponential(ms)` - Better for frequencies

**⚠️ Logarithmic Smoothing Limitation:**
`SmoothingStyle::Logarithmic` **cannot handle parameters that cross zero** (e.g., pan -1 to +1, bipolar modulation).
Use `SmoothingStyle::Linear` for bipolar parameters instead.

#### Filter Coefficient Updates

Never change filter coefficients instantly - this causes clicks. Two approaches:

```rust
// Approach 1: Recreate filter with smoothed cutoff (simple, some artifacts)
fn process(&mut self, buffer: &mut Buffer, ...) {
    for channel_samples in buffer.iter_samples() {
        let cutoff = self.params.cutoff.smoothed.next();

        // Recreate filter - biquad doesn't support in-place coefficient update
        let coeffs = Coefficients::<f32>::from_params(
            Type::LowPass,
            self.sample_rate.hz(),
            cutoff.hz(),
            Q_BUTTERWORTH_F32,
        ).unwrap();
        self.filter = DirectForm1::<f32>::new(coeffs);

        for sample in channel_samples {
            *sample = self.filter.run(*sample);
        }
    }
}

// Approach 2: Update coefficients less frequently (better performance)
// Only recalculate when parameter actually changed
if self.last_cutoff != cutoff {
    self.last_cutoff = cutoff;
    // ... recreate filter
}
```

#### Envelope Discontinuities

Sharp envelope transitions cause clicks. Use exponential curves:

```rust
// Coefficient for exponential approach to target
// Time constant: reaches ~63% in time_seconds, ~99% in 5x time_seconds
fn calc_coeff(time_seconds: f32, sample_rate: f32) -> f32 {
    if time_seconds <= 0.0 { return 1.0; }
    1.0 - (-1.0 / (time_seconds * sample_rate)).exp()
}

// In process - smooth approach to target:
self.level += self.attack_coeff * (target - self.level);
```

### Sample Rate Independence

**ALWAYS recalculate** time-based values when sample rate changes:

```rust
fn initialize(
    &mut self,
    _audio_io: &AudioIOLayout,
    buffer_config: &BufferConfig,
    _context: &mut impl InitContext<Self>
) -> bool {
    self.sample_rate = buffer_config.sample_rate;
    self.recalculate_time_constants();
    true
}

fn recalculate_time_constants(&mut self) {
    // Delay times - convert ms to samples
    self.delay_samples = (self.delay_ms * self.sample_rate / 1000.0) as usize;

    // Filter coefficients - MUST recalculate for new sample rate
    let coeffs = Coefficients::<f32>::from_params(
        Type::LowPass,
        self.sample_rate.hz(),
        self.cutoff_hz.hz(),
        Q_BUTTERWORTH_F32,
    ).unwrap();
    self.filter = DirectForm1::<f32>::new(coeffs);

    // LFO phase increment
    self.lfo_phase_inc = self.lfo_rate_hz / self.sample_rate;

    // Envelope coefficients
    self.attack_coeff = calc_coeff(self.attack_time, self.sample_rate);
    self.release_coeff = calc_coeff(self.release_time, self.sample_rate);
}
```

### Realtime Safety (CRITICAL)

The audio thread (`process()`) must NEVER:

| Forbidden | Why | Alternative |
|-----------|-----|-------------|
| `Vec::push()`, `String::new()` | Memory allocation blocks | Pre-allocate in `initialize()` |
| `Mutex::lock()` | Can block indefinitely | Use `AtomicBool`, lock-free queues |
| File I/O | Blocks for disk | Load in background thread |
| `println!()`, `dbg!()` | I/O and allocation | Use `nih_log!()` sparingly |
| System calls | Unpredictable latency | Avoid entirely |

**Enable allocation detection in development:**
```toml
# Cargo.toml [features]
assert_process_allocs = ["nih_plug/assert_process_allocs"]
```

**Pre-allocate everything in initialize():**
```rust
fn initialize(&mut self, ...) -> bool {
    // Pre-allocate buffers at max expected size
    self.delay_buffer = vec![0.0; MAX_DELAY_SAMPLES];
    self.temp_buffer = vec![0.0; MAX_BLOCK_SIZE];
    true
}
```

### FFT & Spectral Processing

When doing spectral effects (vocoders, phase processing, spectral filters):

```rust
use rustfft::{FftPlanner, num_complex::Complex};

// Setup in initialize():
let mut planner = FftPlanner::<f32>::new();  // Explicit type for clarity
let fft = planner.plan_fft_forward(FFT_SIZE);
let ifft = planner.plan_fft_inverse(FFT_SIZE);

// Pre-allocate buffers
let mut spectrum: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FFT_SIZE];

// Apply window before FFT (Hann is common)
fn hann_window(n: usize, total: usize) -> f32 {
    0.5 * (1.0 - (2.0 * std::f32::consts::PI * n as f32 / total as f32).cos())
}

// IMPORTANT: RustFFT does NOT normalize output
// After inverse FFT, divide by FFT_SIZE: sample /= FFT_SIZE as f32;

// For overlap-add: use 50% or 75% overlap, hop_size = fft_size / 2 or 4
```

**Don't implement your own FFT** - use `rustfft` or `realfft`.

### When Uncertain About DSP Math

If you're unsure about a DSP algorithm:

1. **Say so explicitly** - "I'm not certain about the exact coefficients for..."
2. **Recommend a crate** - fundsp, synfx-dsp, or biquad handle most cases
3. **Link to reference** - Audio EQ Cookbook, DAFX book, musicdsp.org
4. **Don't guess** - Wrong DSP math = broken audio or crashes

"#
}
