---
name: Oversampling
description: 2x and 4x oversampling for reducing aliasing in nonlinear processing. Includes efficient half-band filters based on HIIR principles.
tags: [oversampling, antialiasing, filter, utility, half-band]
source: HIIR principles (Laurent de Soras)
license: Public Domain
attribution: Based on HIIR concepts by Laurent de Soras (optional)
---

# Oversampling

Reduce aliasing in distortion, waveshaping, and nonlinear effects.

## Source Attribution

```
// Based on HIIR principles - Public Domain
// Laurent de Soras - http://ldesoras.free.fr/prod.html
// Half-band IIR filters for efficient oversampling
// Attribution appreciated but not required
```

## Algorithm Description

Nonlinear processing (saturation, waveshaping, compression) creates new harmonics. When these harmonics exceed Nyquist frequency, they alias back as unwanted frequencies.

**Solution**: Process at a higher sample rate, then downsample.

### Process Flow

```
Input → Upsample (2x/4x) → Nonlinear Processing → Downsample → Output
```

### Half-Band Filters

Half-band filters are efficient for 2x rate changes because:
- Every other coefficient is zero
- Cutoff is exactly at Nyquist/2
- Can be implemented with cascaded allpass filters

## Pseudocode

### Half-Band Filter (Allpass-based)

```
struct HalfBandFilter:
    // 4th order elliptic half-band (2 cascaded allpass sections)
    // Coefficients optimized for ~80dB stopband attenuation
    A1: array[2] = [0.07986642623635751, 0.5453536510711322]
    A2: array[2] = [0.28382934487410993, 0.8344118914807379]
    z1: array[4] = [0, 0, 0, 0]

function reset():
    z1 = [0, 0, 0, 0]

function allpass_process(input, section) -> float:
    base = section * 2
    a1 = A1[section]
    a2 = A2[section]

    // First order allpass
    d1 = input - a1 * z1[base]
    y1 = a1 * d1 + z1[base]
    z1[base] = d1

    // Second order allpass
    d2 = y1 - a2 * z1[base + 1]
    y2 = a2 * d2 + z1[base + 1]
    z1[base + 1] = d2

    return y2

function process(input) -> float:
    // Two parallel allpass paths
    y0 = allpass_process(input, 0)
    y1 = allpass_process(input, 1)

    // Combine: half-band = (allpass1 + z^-1 * allpass2) / 2
    output = (y0 + z1[3]) * 0.5
    z1[3] = y1

    return output
```

### 2x Oversampler

```
struct Oversampler2x:
    up_filter: HalfBandFilter
    down_filter: HalfBandFilter

function new():
    up_filter = HalfBandFilter.new()
    down_filter = HalfBandFilter.new()

function reset():
    up_filter.reset()
    down_filter.reset()

function latency() -> int:
    return 4    // Samples at input rate

function upsample(input) -> (float, float):
    // Insert zeros between samples and filter
    s0 = up_filter.process(input * 2)
    s1 = up_filter.process(0)
    return (s0, s1)

function downsample(s0, s1) -> float:
    // Filter and decimate
    down_filter.process(s0)
    return down_filter.process(s1)

function process(input, f) -> float:
    // Process with function f at 2x rate
    (s0, s1) = upsample(input)
    p0 = f(s0)
    p1 = f(s1)
    return downsample(p0, p1)
```

### 4x Oversampler

```
struct Oversampler4x:
    stage1: Oversampler2x
    stage2_up: array[2] of HalfBandFilter
    stage2_down: array[2] of HalfBandFilter

function new():
    stage1 = Oversampler2x.new()
    stage2_up = [HalfBandFilter.new(), HalfBandFilter.new()]
    stage2_down = [HalfBandFilter.new(), HalfBandFilter.new()]

function reset():
    stage1.reset()
    for f in stage2_up: f.reset()
    for f in stage2_down: f.reset()

function latency() -> int:
    return 8    // Samples at input rate

function process(input, f) -> float:
    // Upsample to 2x
    (s0, s1) = stage1.upsample(input)

    // Upsample each to 4x
    s00 = stage2_up[0].process(s0 * 2)
    s01 = stage2_up[0].process(0)
    s10 = stage2_up[1].process(s1 * 2)
    s11 = stage2_up[1].process(0)

    // Process at 4x rate
    p00 = f(s00)
    p01 = f(s01)
    p10 = f(s10)
    p11 = f(s11)

    // Downsample from 4x to 2x
    stage2_down[0].process(p00)
    d0 = stage2_down[0].process(p01)
    stage2_down[1].process(p10)
    d1 = stage2_down[1].process(p11)

    // Downsample from 2x to 1x
    return stage1.downsample(d0, d1)
```

### FIR Oversampler (Higher Quality)

```
struct FirOversampler2x:
    coeffs: array[float]
    history: array[float]
    taps: int

function new(taps):
    taps = taps | 1    // Ensure odd
    coeffs = new array[taps]
    history = new array[taps] of 0
    half = taps / 2

    // Generate windowed sinc coefficients
    for i in 0..taps:
        n = i - half

        // Sinc for half-band
        if n == 0:
            sinc = 0.5
        else if abs(n) mod 2 == 1:
            sinc = 0    // Zero at odd samples
        else:
            sinc = 0.5 * sin(π * n / 2) / (π * n / 2)

        // Blackman window
        w = 0.42 - 0.5 * cos(2π * i / (taps - 1))
             + 0.08 * cos(4π * i / (taps - 1))

        coeffs[i] = sinc * w * 2

function reset():
    fill history with 0

function latency() -> int:
    return taps / 2

function upsample(input) -> (float, float):
    // Shift history
    for i in (taps-1)..1:
        history[i] = history[i-1]
    history[0] = input

    // Compute both phases
    even = 0
    odd = 0

    for i in 0..taps:
        even += history[i] * coeffs[i]
        odd_idx = (i + taps / 2) mod taps
        odd += history[i] * coeffs[odd_idx]

    return (even, odd)
```

## Implementation Notes

### When to Use Oversampling

| Effect Type | Recommended |
|-------------|-------------|
| Light saturation | 2x or none |
| Heavy distortion | 4x |
| Waveshaping | 2x-4x |
| Bit crushing | 2x |
| Compressor | Usually none |
| Filter | Usually none |
| Reverb | Usually none |

### Quality vs CPU Trade-off

| Oversampling | Aliasing Reduction | CPU Cost |
|--------------|-------------------|----------|
| None | 0 dB | 1x |
| 2x | ~40-60 dB | ~2.5x |
| 4x | ~80-100 dB | ~5x |
| 8x | ~100+ dB | ~10x |

### IIR vs FIR Half-Band

| Type | Pros | Cons |
|------|------|------|
| IIR (allpass) | Very efficient, low latency | Some ripple |
| FIR | Linear phase, no ripple | More taps needed |

### Key Points

1. **Only oversample nonlinear processing** - not the whole plugin
2. **Report latency to host** for proper delay compensation
3. **4x is usually sufficient** even for extreme distortion
4. **Higher oversampling = diminishing returns** after 4x-8x

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `Vec<f32>` for FIR history
- Consider `#[inline]` on inner filter process
- Report latency via `latency_samples()` method

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::Oversampling` provides ready-made solution
- Use `std::array` for fixed-size filter state
- Consider SIMD for FIR implementation

**Key Considerations:**
- Only oversample the nonlinear portion, not the whole plugin
- Higher oversampling = better quality but more CPU
- Report latency to host for proper delay compensation
- IIR half-band filters are efficient but have some ripple
- FIR filters have linear phase but need more taps
