---
name: DC Blocker
description: Remove DC offset from audio signals. Essential utility for preventing offset accumulation in feedback loops and nonlinear processing.
tags: [dc-blocker, utility, filter, offset, essential]
source: Classic filter design
license: Public Domain
---

# DC Blocker

High-pass filter at very low frequency to remove DC offset.

## Source Attribution

```
// Classic DC blocker design - Public Domain
// Simple one-pole high-pass filter
// No attribution required
```

## Algorithm Description

DC offset is a constant value added to a signal that shifts it away from zero. This can cause:
- Speaker damage (prolonged offset pushes cone off-center)
- Headroom loss
- Compressor/limiter misbehavior
- Accumulation in feedback loops

A DC blocker is simply a high-pass filter with a very low cutoff frequency (5-30 Hz).

### Mathematics

**One-Pole DC Blocker:**
```
y[n] = x[n] - x[n-1] + R * y[n-1]

where R = 1 - (2π * cutoff / sampleRate)
      R ≈ 0.995 for ~7 Hz at 44.1 kHz
```

## Pseudocode

### Simple One-Pole DC Blocker

```
struct DcBlocker:
    x1: float = 0       // Previous input
    y1: float = 0       // Previous output
    R: float = 0.995    // Pole coefficient

function new():
    // Default coefficient ~7 Hz at 44.1 kHz
    R = 0.995

function with_frequency(cutoff_hz, sampleRate):
    // Calculate coefficient from cutoff frequency
    omega = 2π * cutoff_hz / sampleRate
    R = 1 / (1 + omega)
    R = clamp(R, 0.9, 0.9999)

function set_coefficient(coef):
    // Direct coefficient control (0.99-0.9999)
    R = clamp(coef, 0.9, 0.9999)

function reset():
    x1 = 0
    y1 = 0

function process(input) -> float:
    // DC blocking difference equation
    output = input - x1 + R * y1
    x1 = input
    y1 = output

    // Prevent denormals and NaN
    if not is_finite(output) or abs(output) < 1e-20:
        y1 = 0
        return 0

    return output
```

### Stereo DC Blocker

```
struct StereoDcBlocker:
    left: DcBlocker
    right: DcBlocker

function process(left_in, right_in) -> (float, float):
    return (left.process(left_in), right.process(right_in))
```

### DC Detector (Measures Offset)

```
struct DcDetector:
    average: float = 0
    coef: float          // Smoothing coefficient

function new(sampleRate):
    // ~100ms averaging window
    coef = exp(-1 / (0.1 * sampleRate))

function process(input) -> float:
    // Running average (tracks DC component)
    average = input + coef * (average - input)
    return average

function offset() -> float:
    return average
```

### Biquad DC Blocker (Steeper)

```
struct BiquadDcBlocker:
    // 2nd order Butterworth high-pass coefficients
    b0, b1, b2: float
    a1, a2: float
    z1, z2: float = 0    // State

function new(cutoff_hz, sampleRate):
    omega = 2π * cutoff_hz / sampleRate
    cos_omega = cos(omega)
    sin_omega = sin(omega)
    alpha = sin_omega / (2 * sqrt(2))   // Q = 1/sqrt(2) for Butterworth

    b0 = (1 + cos_omega) / 2
    b1 = -(1 + cos_omega)
    b2 = (1 + cos_omega) / 2
    a0 = 1 + alpha
    a1_raw = -2 * cos_omega
    a2_raw = 1 - alpha

    // Normalize by a0
    b0 /= a0; b1 /= a0; b2 /= a0
    a1 = a1_raw / a0
    a2 = a2_raw / a0

function reset():
    z1 = 0
    z2 = 0

function process(input) -> float:
    // Transposed Direct Form II
    output = b0 * input + z1
    z1 = b1 * input - a1 * output + z2
    z2 = b2 * input - a2 * output

    if not is_finite(output):
        reset()
        return 0

    return output
```

### Adaptive DC Blocker

```
struct AdaptiveDcBlocker:
    dc: float = 0
    slow_coef: float     // For when signal is present
    fast_coef: float     // For silence (faster convergence)
    threshold: float

function new(sampleRate):
    slow_coef = exp(-1 / (0.5 * sampleRate))   // 500ms
    fast_coef = exp(-1 / (0.02 * sampleRate))  // 20ms
    threshold = 0.001

function process(input) -> float:
    // Use fast convergence during silence
    coef = fast_coef if abs(input) < threshold else slow_coef

    // Track DC
    dc = input + coef * (dc - input)

    // Remove DC
    return input - dc
```

## Implementation Notes

### When to Use DC Blocking

| Situation | Need DC Blocker? |
|-----------|------------------|
| After saturation/distortion | Yes |
| In feedback loops | Yes |
| After asymmetric waveshaping | Yes |
| After filtering | Usually no |
| After linear processing | No |
| Before level detection | Sometimes |

### Coefficient Guide

| Coefficient (R) | Cutoff (~44.1kHz) | Character |
|-----------------|-------------------|-----------|
| 0.99 | ~35 Hz | More aggressive |
| 0.995 | ~7 Hz | Standard |
| 0.999 | ~1.4 Hz | Very subtle |
| 0.9999 | ~0.14 Hz | Minimal effect |

### One-Pole vs Biquad

| Type | Slope | CPU | Use Case |
|------|-------|-----|----------|
| One-pole | 6 dB/oct | Lower | Most cases |
| Biquad | 12 dB/oct | Higher | When 6 dB isn't enough |

### Placement in Signal Chain

1. Place DC blocker at **end** of processing chain
2. After any nonlinear processing (saturation, compression)
3. Before output stage
4. Essential in feedback paths

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32` for all values
- The simple one-pole is usually sufficient
- Consider `#[inline]` for per-sample processing

**C++ (JUCE/iPlug2):**
- JUCE: Use `dsp::IIR::Filter` with high-pass coefficients
- Can also use `dsp::ProcessorDuplicator` for stereo

**Key Considerations:**
- Default coefficient (0.995) works for most cases
- Higher coefficient = lower cutoff, less bass impact
- Always check for denormals (tiny numbers that slow down CPU)
- Reset state when plugin is bypassed then re-enabled
