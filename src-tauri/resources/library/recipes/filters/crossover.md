---
name: Crossover Filters
description: Multi-band crossover for splitting audio into frequency bands. Linkwitz-Riley filters for phase-coherent reconstruction. Essential for multi-band processing.
tags: [crossover, multiband, filter, linkwitz-riley, mastering]
source: Classic filter design
license: Public Domain
---

# Crossover Filters

Multi-band crossover for splitting audio into frequency bands with perfect reconstruction.

## Source Attribution

```
// Classic Linkwitz-Riley crossover design - Public Domain
// Standard audio engineering technique
// No attribution required
```

## Algorithm Description

Crossovers split audio into frequency bands for independent processing. Linkwitz-Riley (LR) crossovers sum to flat response when bands are recombined.

### Why Linkwitz-Riley?

| Property | LR4 (4th order) | Butterworth |
|----------|-----------------|-------------|
| Slope | 24dB/octave | 12dB/octave (2nd order) |
| Phase at crossover | 0° | 90° |
| Sum of bands | Flat | +3dB bump |
| Reconstruction | Perfect | Phase issues |

### How LR4 Works

LR4 = two cascaded 2nd-order Butterworth filters with Q = 0.7071 (1/√2).

## Pseudocode

### Biquad Filter (Building Block)

```
struct Biquad:
    b0, b1, b2: float    // Feedforward coefficients
    a1, a2: float        // Feedback coefficients
    z1, z2: float = 0    // State variables

function set_lowpass(freq, q, sampleRate):
    omega = 2π * freq / sampleRate
    sin_omega = sin(omega)
    cos_omega = cos(omega)
    alpha = sin_omega / (2 * q)

    b1 = 1 - cos_omega
    b0 = b1 / 2
    b2 = b0
    a0 = 1 + alpha
    a1_raw = -2 * cos_omega
    a2_raw = 1 - alpha

    // Normalize
    b0 /= a0; b1 /= a0; b2 /= a0
    a1 = a1_raw / a0
    a2 = a2_raw / a0

function set_highpass(freq, q, sampleRate):
    omega = 2π * freq / sampleRate
    sin_omega = sin(omega)
    cos_omega = cos(omega)
    alpha = sin_omega / (2 * q)

    b1 = -(1 + cos_omega)
    b0 = -b1 / 2
    b2 = b0
    a0 = 1 + alpha
    a1_raw = -2 * cos_omega
    a2_raw = 1 - alpha

    // Normalize
    b0 /= a0; b1 /= a0; b2 /= a0
    a1 = a1_raw / a0
    a2 = a2_raw / a0

function reset():
    z1 = 0
    z2 = 0

function process(input) -> float:
    output = b0 * input + z1
    z1 = b1 * input - a1 * output + z2
    z2 = b2 * input - a2 * output
    return output
```

### 2-Band Linkwitz-Riley Crossover (LR4)

```
struct CrossoverLR4:
    // Two cascaded biquads per output
    lp1, lp2: Biquad
    hp1, hp2: Biquad
    frequency: float
    sampleRate: float

function new(frequency, sampleRate):
    set_frequency(frequency)

function set_frequency(frequency):
    frequency = clamp(frequency, 20, sampleRate * 0.49)

    // LR4 uses Q = 1/sqrt(2) cascaded twice
    q = 0.7071067811865476

    lp1.set_lowpass(frequency, q, sampleRate)
    lp2.set_lowpass(frequency, q, sampleRate)
    hp1.set_highpass(frequency, q, sampleRate)
    hp2.set_highpass(frequency, q, sampleRate)

function reset():
    lp1.reset(); lp2.reset()
    hp1.reset(); hp2.reset()

function process(input) -> (float, float):
    // Cascade two 2nd-order filters for 4th-order LR
    low = lp2.process(lp1.process(input))
    high = hp2.process(hp1.process(input))
    return (low, high)
```

### 3-Band Crossover

```
struct Crossover3Band:
    low_mid: CrossoverLR4
    mid_high: CrossoverLR4

function new(low_freq, high_freq, sampleRate):
    low_mid = CrossoverLR4.new(low_freq, sampleRate)
    mid_high = CrossoverLR4.new(high_freq, sampleRate)

function set_frequencies(low_freq, high_freq):
    low_mid.set_frequency(low_freq)
    mid_high.set_frequency(high_freq)

function reset():
    low_mid.reset()
    mid_high.reset()

function process(input) -> (float, float, float):
    (low, rest) = low_mid.process(input)
    (mid, high) = mid_high.process(rest)
    return (low, mid, high)
```

### 4-Band Crossover

```
struct Crossover4Band:
    split1: CrossoverLR4    // Low vs rest
    split2: CrossoverLR4    // Low-mid vs rest
    split3: CrossoverLR4    // High-mid vs high

function new(freq1, freq2, freq3, sampleRate):
    split1 = CrossoverLR4.new(freq1, sampleRate)
    split2 = CrossoverLR4.new(freq2, sampleRate)
    split3 = CrossoverLR4.new(freq3, sampleRate)

function set_frequencies(freq1, freq2, freq3):
    split1.set_frequency(freq1)
    split2.set_frequency(freq2)
    split3.set_frequency(freq3)

function reset():
    split1.reset()
    split2.reset()
    split3.reset()

function process(input) -> (float, float, float, float):
    (low, rest1) = split1.process(input)
    (low_mid, rest2) = split2.process(rest1)
    (high_mid, high) = split3.process(rest2)
    return (low, low_mid, high_mid, high)
```

### Multiband Processing Helper

```
function sum_bands(bands: array[float]) -> float:
    return sum of all bands

function apply_gains(bands: array[float], gains: array[float]):
    for i in 0..bands.length:
        bands[i] *= gains[i]
```

## Implementation Notes

### Common Crossover Frequencies

| Application | 2-Band | 3-Band | 4-Band |
|-------------|--------|--------|--------|
| General | 2kHz | 200Hz, 2kHz | 100Hz, 500Hz, 2kHz |
| Mastering | 500Hz | 100Hz, 4kHz | 100Hz, 500Hz, 2kHz, 8kHz |
| PA Systems | 800Hz | 200Hz, 1.2kHz | 80Hz, 300Hz, 1.2kHz |

### Design Guidelines

- Crossover frequencies should be at least 1 octave apart
- Bands sum perfectly flat when no processing is applied
- Higher-order crossovers (LR4, LR8) have steeper slopes
- LR4 (24dB/octave) is most common for audio

### Multi-Band Compressor Example

```
// Split into 3 bands
(low, mid, high) = crossover.process(input)

// Process each band independently
low_comp = compressor_low.process(low)
mid_comp = compressor_mid.process(mid)
high_comp = compressor_high.process(high)

// Recombine
output = low_comp + mid_comp + high_comp
```

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::consts::PI` for π
- Consider SIMD for parallel band processing
- Store biquad state in struct fields

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::LinkwitzRileyFilter` handles LR crossovers
- Use `std::array` for fixed band counts
- Consider `dsp::ProcessorChain` for cascading

**Key Considerations:**
- Always use Linkwitz-Riley for phase-coherent multiband processing
- Test with pink noise to verify flat frequency response
- Reset filter state on plugin bypass/re-enable
