---
name: dsp-safety
description: Critical DSP safety rules and anti-hallucination guardrails. Invoke when implementing audio processing, filters, effects, or any DSP code.
internal: true
---

# DSP Safety Rules & Anti-Hallucination Guardrails

## Never Invent Filter Coefficients

**DO NOT** generate filter coefficient formulas from memory. Filter math is precise and errors cause broken audio. Always use:

- The `biquad` crate (implements Audio EQ Cookbook correctly)
- The `fundsp` crate for pre-built filters and DSP
- Reference: https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html

> **WARNING:** `synfx-dsp` requires **nightly Rust**. Use `biquad` or `fundsp` for stable Rust builds.

### fundsp Usage (CRITICAL)

**fundsp 0.21+** uses the `AudioUnit` trait, NOT `AudioUnit32` or `AudioUnit64`:

```rust
use fundsp::prelude::*;

// Create audio units
let reverb = reverb_stereo(20.0, 2.0, 1.0);  // Returns impl AudioUnit

// Process audio - use tick() for sample-by-sample
fn process_sample(unit: &mut impl AudioUnit, left: f32, right: f32) -> (f32, f32) {
    let output = unit.tick(&[left, right]);
    (output[0], output[1])
}

// Reset state
unit.reset();
```

**Common fundsp mistakes to AVOID:**
- ❌ `AudioUnit32` - does not exist, use `AudioUnit`
- ❌ `AudioUnit64` - does not exist, use `AudioUnit`
- ❌ `dyn AudioUnit32` - use `dyn AudioUnit` or `impl AudioUnit`
- ❌ `Box<dyn AudioUnit32>` - use `Box<dyn AudioUnit>`

**IMPORTANT: fundsp uses f64 internally!**
All fundsp functions expect `f64` arguments, not `f32`. Cast your parameters:
```rust
// Wrong - f32 parameters cause type errors
let reverb = reverb_stereo(room_size, decay, 0.8);

// Correct - cast to f64
let reverb = reverb_stereo(room_size as f64, decay as f64, 0.8);
```

**fundsp tick() API - requires output buffer parameter:**
```rust
// WRONG - tick() does NOT return output
let output = self.reverb.tick(&input); // ❌ Error!

// CORRECT - tick() writes to an output buffer
let mut output = [0.0f64; 2];
self.reverb.tick(&[left as f64, right as f64], &mut output);
let wet_left = output[0] as f32;
let wet_right = output[1] as f32;
```

**Correct patterns:**
```rust
// Store in struct - use Box<dyn AudioNode> for fundsp units
struct MyPlugin {
    reverb: Box<dyn AudioNode<Inputs = U2, Outputs = U2>>,
}

// Initialize in Default or initialize()
reverb: Box::new(reverb_stereo(20.0, 2.0, 1.0)),
```

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

## Parameter Smoothing (MANDATORY)

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

**Logarithmic Smoothing Limitation:**
`SmoothingStyle::Logarithmic` **cannot handle parameters that cross zero** (e.g., pan -1 to +1, bipolar modulation).
Use `SmoothingStyle::Linear` for bipolar parameters instead.

## Sample Rate Independence

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

    // LFO phase increment
    self.lfo_phase_inc = self.lfo_rate_hz / self.sample_rate;

    // Envelope coefficients
    self.attack_coeff = calc_coeff(self.attack_time, self.sample_rate);
}
```

## Realtime Safety (CRITICAL)

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

## NaN/Inf Protection (MANDATORY)

Every plugin must protect against NaN/Inf values (which crash DAWs):

```rust
// In process() - after all DSP processing:
if !sample.is_finite() {
    *sample = 0.0;
}
```

**Note:** Do NOT use `sample.clamp(-1.0, 1.0)` as a safety limiter - this masks problems and breaks gain staging. The preview engine has its own output limiter for speaker protection. Let plugins output their true levels so users can see accurate metering.

## Anti-Hallucination Checklist

Before generating DSP code, verify:

- [ ] **Am I using a known algorithm?** Don't invent math - use established techniques
- [ ] **Are filter coefficients from a crate or cookbook?** Never calculate biquad coefficients from memory
- [ ] **Is sample rate used in ALL time-based calculations?** Delays, LFOs, envelopes all depend on it
- [ ] **Are parameters being smoothed?** Any audio-rate parameter change needs smoothing
- [ ] **Is NaN/Inf protected?** Output must be finite to prevent DAW crashes

## When Uncertain About DSP Math

If you're unsure about a DSP algorithm:

1. **Say so explicitly** - "I'm not certain about the exact coefficients for..."
2. **Recommend a crate** - `biquad` or `fundsp` handle most cases (stable Rust)
3. **Link to reference** - Audio EQ Cookbook, DAFX book, musicdsp.org
4. **Don't guess** - Wrong DSP math = broken audio or crashes

## Common Pitfalls to Avoid

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Naive waveforms | Aliasing artifacts | Use PolyBLEP or wavetables |
| Instant parameter changes | Clicks and pops | Use smoothing (50ms typical) |
| Hardcoded sample rate | Broken at different rates | Always use `buffer_config.sample_rate` |
| Allocations in process() | Audio glitches | Pre-allocate in initialize() |
| NaN/Inf in output | DAW crash | Check `is_finite()`, set to 0.0 |
| Hand-rolled filter math | Wrong coefficients | Use `biquad` crate |
| Division by zero | NaN/Inf propagation | Guard all divisions |
| Unbounded feedback | Runaway levels | Limit feedback to < 1.0 or use tanh() |

## Implementing reset() (Important!)

The `reset()` method is called when playback stops or the plugin is bypassed. **Always implement this** to clear state:

```rust
fn reset(&mut self) {
    // Clear delay buffers to prevent old audio from playing
    self.delay_buffer.fill(0.0);

    // Reset filter state
    self.filter = DirectForm1::<f32>::new(self.current_coeffs.clone());

    // Reset envelopes to idle
    self.envelope.reset();
}
```

**When to implement reset():**
- Any plugin with delay lines (delay, reverb, chorus)
- Any plugin with filters (they have internal state)
- Instruments with envelopes
- Any effect that accumulates state over time
