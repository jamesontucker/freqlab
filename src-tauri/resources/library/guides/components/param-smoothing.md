---
name: param-smoothing
description: Advanced parameter smoothing techniques. Smoothing styles, when to smooth, and avoiding artifacts. Invoke when fine-tuning parameter behavior.
---

# Parameter Smoothing

## When to Smooth

| Parameter Type | Smooth? | Style | Time |
|---------------|---------|-------|------|
| Gain/Volume | Yes | Logarithmic | 50ms |
| Filter Cutoff | Yes | Exponential | 50ms |
| Pan | Yes | Linear | 20ms |
| Mix (Dry/Wet) | Yes | Linear | 50ms |
| Waveform Select | No | None | - |
| Bypass Toggle | No | None | - |
| Tempo/BPM | No | None | - |

## Smoothing Styles

```rust
use nih_plug::prelude::*;

// Linear - good for most parameters
FloatParam::new("Gain", 0.5, FloatRange::Linear { min: 0.0, max: 1.0 })
    .with_smoother(SmoothingStyle::Linear(50.0))  // 50ms

// Logarithmic - better for gain (perceptually linear)
// WARNING: Cannot cross zero! Don't use for bipolar params (-1 to +1)
FloatParam::new("Output", util::db_to_gain(0.0), FloatRange::Skewed {
    min: util::db_to_gain(-60.0),
    max: util::db_to_gain(12.0),
    factor: FloatRange::gain_skew_factor(-60.0, 12.0),
})
.with_smoother(SmoothingStyle::Logarithmic(50.0))

// Exponential - better for frequencies
FloatParam::new("Cutoff", 1000.0, FloatRange::Skewed {
    min: 20.0,
    max: 20000.0,
    factor: FloatRange::skew_factor(-2.0),
})
.with_smoother(SmoothingStyle::Exponential(50.0))
```

## Using Smoothed Values

```rust
fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
    for channel_samples in buffer.iter_samples() {
        // Call smoothed.next() ONCE per sample
        let gain = self.params.gain.smoothed.next();
        let cutoff = self.params.cutoff.smoothed.next();

        // Update filter only if cutoff changed significantly
        if self.params.cutoff.smoothed.is_smoothing() {
            self.update_filter_coefficients(cutoff);
        }

        for sample in channel_samples {
            *sample *= gain;
            *sample = self.filter.process(*sample);
        }
    }
    ProcessStatus::Normal
}
```

## Avoiding Clicks (Bipolar Parameters)

For parameters that cross zero (like pan -1 to +1):

```rust
// WRONG - Logarithmic can't cross zero
FloatParam::new("Pan", 0.0, FloatRange::Linear { min: -1.0, max: 1.0 })
    .with_smoother(SmoothingStyle::Logarithmic(50.0))  // BROKEN!

// CORRECT - Use Linear for bipolar
FloatParam::new("Pan", 0.0, FloatRange::Linear { min: -1.0, max: 1.0 })
    .with_smoother(SmoothingStyle::Linear(20.0))  // Works correctly
```

## Manual Smoothing (When Needed)

For special cases where built-in smoothing isn't enough:

```rust
struct ManualSmoother {
    current: f32,
    target: f32,
    coeff: f32,  // Smoothing coefficient
}

impl ManualSmoother {
    fn new(initial: f32, time_ms: f32, sample_rate: f32) -> Self {
        Self {
            current: initial,
            target: initial,
            coeff: 1.0 - (-1.0 / (time_ms * 0.001 * sample_rate)).exp(),
        }
    }

    fn set_target(&mut self, target: f32) {
        self.target = target;
    }

    fn next(&mut self) -> f32 {
        self.current += self.coeff * (self.target - self.current);
        self.current
    }
}
```
