---
name: oversampling
description: Oversampling implementation for nonlinear processing. When to oversample, quality vs performance tradeoffs. Invoke when implementing distortion or saturation effects.
---

# Oversampling

## When to Oversample

| Processing Type | Oversample? | Why |
|----------------|-------------|-----|
| Distortion/Saturation | Yes | Creates harmonics that alias |
| Waveshaping | Yes | Nonlinear = new frequencies |
| Clipping | Yes | Hard edges = infinite harmonics |
| Linear filters | No | No new frequencies created |
| Delay/Reverb | No | Just copying/mixing samples |
| Gain/Pan | No | Linear operations |

## Oversampling Factor Guide

| Factor | Quality | CPU Cost | Use Case |
|--------|---------|----------|----------|
| 2x | Good | 2x | Light saturation |
| 4x | Better | 4x | Moderate distortion |
| 8x | Excellent | 8x | Heavy distortion |
| 16x | Overkill | 16x | Extreme processing |

## Basic Pattern

```rust
use rubato::{FftFixedIn, Resampler};

struct OversampledProcessor {
    upsampler: FftFixedIn<f32>,
    downsampler: FftFixedIn<f32>,
    oversampling_factor: usize,
    upsampled_buffer: Vec<f32>,
}

impl OversampledProcessor {
    fn process(&mut self, input: &[f32], output: &mut [f32]) {
        // 1. Upsample
        let upsampled = self.upsampler.process(&[input], None).unwrap();

        // 2. Process at higher sample rate
        for sample in &mut upsampled[0] {
            *sample = self.apply_distortion(*sample);
        }

        // 3. Downsample (includes anti-aliasing filter)
        let downsampled = self.downsampler.process(&upsampled, None).unwrap();

        output.copy_from_slice(&downsampled[0]);
    }

    fn apply_distortion(&self, x: f32) -> f32 {
        x.tanh()  // Or your distortion function
    }
}
```

## Manual Oversampling (Without External Crate)

For simple 2x oversampling:

```rust
struct Simple2xOversampler {
    // Upsampling filter (interpolation)
    up_filter: [f32; 4],
    up_history: [f32; 4],

    // Downsampling filter (anti-aliasing)
    down_filter: [f32; 4],
    down_history: [f32; 8],
}

impl Simple2xOversampler {
    fn process_sample(&mut self, input: f32) -> f32 {
        // Upsample: insert input and zero
        let up1 = self.upsample_filter(input);
        let up2 = self.upsample_filter(0.0);

        // Process both samples at 2x rate
        let processed1 = self.apply_distortion(up1);
        let processed2 = self.apply_distortion(up2);

        // Downsample: filter and decimate
        self.downsample_filter(processed1);
        self.downsample_filter(processed2)
    }
}
```

## Performance Optimization

Make oversampling quality adjustable:

```rust
#[derive(Enum, PartialEq, Clone)]
pub enum OversampleQuality {
    #[name = "Off (Fastest)"]
    Off,
    #[name = "2x (Good)"]
    X2,
    #[name = "4x (Better)"]
    X4,
    #[name = "8x (Best)"]
    X8,
}

// In params
#[id = "oversample"]
pub oversample: EnumParam<OversampleQuality>,

// In process
let factor = match self.params.oversample.value() {
    OversampleQuality::Off => 1,
    OversampleQuality::X2 => 2,
    OversampleQuality::X4 => 4,
    OversampleQuality::X8 => 8,
};
```

## Latency Reporting

Oversampling adds latency. Report it to the DAW:

```rust
fn latency_samples(&self) -> u32 {
    // FIR filter delay from oversampling
    self.oversampler.latency() as u32
}
```
