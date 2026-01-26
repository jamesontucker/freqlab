---
name: Interpolation Methods
description: Various interpolation algorithms for sample-accurate DSP. Linear, cubic, Hermite, and Lagrange interpolation for delay lines, wavetables, and resampling.
tags: [interpolation, utility, resampling, wavetable, delay]
source: Classic numerical methods
license: Public Domain
---

# Interpolation Methods

Essential utilities for fractional sample access.

## Source Attribution

```
// Classic numerical interpolation methods - Public Domain
// Standard polynomial interpolation formulas
// No attribution required
```

## Algorithm Description

Interpolation estimates values between known sample points. Different methods trade off quality, CPU cost, and artifacts.

### When You Need Interpolation

- **Delay lines**: Reading at fractional delay times
- **Wavetables**: Reading at fractional phase positions
- **Pitch shifting**: Resampling at non-integer ratios
- **Chorus/flanger**: Modulated delay with smooth variation

## Pseudocode

### Linear Interpolation (2 points)

```
function lerp(y0, y1, t) -> float:
    // t is fractional position between y0 (t=0) and y1 (t=1)
    return y0 + t * (y1 - y0)
```

Simple, fast, but creates high-frequency artifacts on audio.

### Cubic Interpolation (4 points)

```
function cubic(y_m1, y0, y1, y2, t) -> float:
    // Points: y[-1], y[0], y[1], y[2]
    // t interpolates between y[0] (t=0) and y[1] (t=1)

    a0 = y2 - y1 - y_m1 + y0
    a1 = y_m1 - y0 - a0
    a2 = y1 - y_m1
    a3 = y0

    // Horner's method for polynomial evaluation
    return ((a0 * t + a1) * t + a2) * t + a3
```

Better quality than linear, but can overshoot.

### Hermite Interpolation (4 points, smooth)

```
function hermite(y_m1, y0, y1, y2, t) -> float:
    // Points: y[-1], y[0], y[1], y[2]
    // t interpolates between y[0] (t=0) and y[1] (t=1)

    c0 = y0
    c1 = 0.5 * (y1 - y_m1)
    c2 = y_m1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2
    c3 = 0.5 * (y2 - y_m1) + 1.5 * (y0 - y1)

    return ((c3 * t + c2) * t + c1) * t + c0
```

Smooth (monotonic), no overshoot. Best general-purpose choice.

### Lagrange 4-Point Interpolation

```
function lagrange4(y_m1, y0, y1, y2, t) -> float:
    // Higher quality polynomial interpolation
    t_m1 = t + 1
    t_0 = t
    t_1 = t - 1
    t_2 = t - 2

    l_m1 = (t_0 * t_1 * t_2) / -6
    l_0 = (t_m1 * t_1 * t_2) / 2
    l_1 = (t_m1 * t_0 * t_2) / -2
    l_2 = (t_m1 * t_0 * t_1) / 6

    return y_m1 * l_m1 + y0 * l_0 + y1 * l_1 + y2 * l_2
```

High quality for pitch shifting.

### Lagrange 6-Point Interpolation

```
function lagrange6(y[6], t) -> float:
    // Points: y[-2], y[-1], y[0], y[1], y[2], y[3] (indices 0-5)
    // t interpolates between y[0] and y[1] (indices 2 and 3)

    result = 0

    for i in 0..6:
        xi = i - 2              // Position of point i
        li = 1                  // Lagrange basis polynomial

        for j in 0..6:
            if i != j:
                xj = j - 2
                li *= (t - xj) / (xi - xj)

        result += y[i] * li

    return result
```

Higher quality, more expensive.

### Windowed Sinc Interpolation (Highest Quality)

```
struct SincInterpolator:
    kernel: array[float]
    kernel_size: int
    oversampling: int

function new(kernel_taps, oversampling):
    kernel_size = kernel_taps * oversampling
    kernel = new array[kernel_size]

    half = kernel_taps / 2

    for i in 0..kernel_size:
        x = (i / oversampling) - half

        // Sinc function
        if abs(x) < 1e-6:
            sinc = 1.0
        else:
            sinc = sin(π * x) / (π * x)

        // Blackman window
        n = i / (kernel_size - 1)
        window = 0.42 - 0.5 * cos(2π * n) + 0.08 * cos(4π * n)

        kernel[i] = sinc * window

    // Normalize
    sum = sum of kernel[i] for i in 0, oversampling, 2*oversampling...
    for k in kernel:
        k /= sum

function interpolate(samples[], frac) -> float:
    // samples: input buffer (at least kernel_taps long)
    // frac: fractional position (0.0 to 1.0)

    kernel_idx = floor(frac * oversampling)
    taps = kernel_size / oversampling

    sum = 0
    for i in 0..min(taps, length(samples)):
        k_idx = i * oversampling + kernel_idx
        if k_idx < kernel_size:
            sum += samples[i] * kernel[k_idx]

    return sum
```

### Buffer Reading Helpers

```
function read_linear(buffer[], pos) -> float:
    len = length(buffer)
    if len < 2: return buffer[0] or 0

    idx0 = floor(pos) mod len
    idx1 = (idx0 + 1) mod len
    frac = pos - floor(pos)

    return lerp(buffer[idx0], buffer[idx1], frac)

function read_hermite(buffer[], pos) -> float:
    len = length(buffer)
    if len < 4: return read_linear(buffer, pos)

    idx0 = floor(pos) mod len
    idx_m1 = (idx0 - 1 + len) mod len
    idx1 = (idx0 + 1) mod len
    idx2 = (idx0 + 2) mod len
    frac = pos - floor(pos)

    return hermite(buffer[idx_m1], buffer[idx0], buffer[idx1], buffer[idx2], frac)
```

## Implementation Notes

### Quality Comparison

| Method | Points | Quality | CPU | Best For |
|--------|--------|---------|-----|----------|
| Linear | 2 | Low | Lowest | Parameter smoothing |
| Cubic | 4 | Medium | Low | General purpose |
| Hermite | 4 | Medium-High | Low | Wavetables, chorus |
| Lagrange-4 | 4 | High | Medium | Pitch shifting |
| Lagrange-6 | 6 | Higher | Higher | High-quality resample |
| Sinc | 8-64 | Highest | Highest | Sample rate conversion |

### Characteristics

| Method | Overshoot | Phase | Notes |
|--------|-----------|-------|-------|
| Linear | No | Linear | Creates harmonics |
| Cubic | Yes | Linear | Can ring |
| Hermite | No | Linear | Smooth, monotonic |
| Lagrange | Some | Linear | Ringing at edges |
| Sinc | Minimal | Linear | Best for SRC |

### When to Use Each

- **Linear**: Parameter smoothing, quick prototyping
- **Hermite**: Wavetables, delay lines, chorus/flanger
- **Lagrange-4**: Pitch shifting, high-quality delay
- **Sinc**: Sample rate conversion, offline processing

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::fract()` to get fractional part
- Implement as trait on `[f32]` for ergonomic buffer access
- Consider `#[inline]` on all interpolation functions

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::LagrangeInterpolator` for resampling
- Use `std::fmod` for wrapping positions
- Can use templates for buffer type flexibility

**Key Considerations:**
- Linear interpolation is fine for smoothing parameters
- Hermite is the best balance for most audio applications
- Cubic can overshoot; Hermite is monotonic
- Sinc is overkill for most real-time use cases
- Always ensure enough samples available for the method used
