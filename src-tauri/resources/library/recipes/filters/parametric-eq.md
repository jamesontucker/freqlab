---
name: Parametric EQ
description: Multi-band parametric equalizer with low shelf, high shelf, and parametric peak bands. Building block for channel strips and mastering EQ.
tags: [eq, parametric, filter, mixing, channel-strip]
source: Robert Bristow-Johnson's Audio EQ Cookbook
license: Public Domain
attribution: Based on RBJ Audio EQ Cookbook (optional)
---

# Parametric EQ

Multi-band EQ using cascaded biquad filters.

## Source Attribution

```
// Based on Robert Bristow-Johnson's Audio EQ Cookbook
// https://www.w3.org/2011/audio/audio-eq-cookbook.html
// Public Domain formulas, no attribution required
```

## Algorithm Description

A parametric EQ uses multiple biquad filter bands in series:
- **Low Shelf**: Boost/cut frequencies below cutoff
- **High Shelf**: Boost/cut frequencies above cutoff
- **Peak/Bell**: Boost/cut around center frequency with adjustable Q

### Band Parameters

| Parameter | Description | Typical Range |
|-----------|-------------|---------------|
| Frequency | Center/cutoff frequency | 20-20000 Hz |
| Gain | Boost or cut amount | -24 to +24 dB |
| Q | Bandwidth (peak bands) | 0.1 to 20 |

## Pseudocode

### EQ Band Types

```
enum BandType:
    LowShelf
    HighShelf
    Peak
    LowPass
    HighPass
    Notch
```

### Single EQ Band

```
struct EqBand:
    band_type: BandType
    frequency: float = 1000
    gain_db: float = 0
    q: float = 0.707
    enabled: bool = true

    // Biquad coefficients
    b0, b1, b2: float
    a1, a2: float

    // State (transposed direct form II)
    z1, z2: float = 0

    sampleRate: float

function new(band_type, sampleRate):
    update_coefficients()

function set_frequency(freq):
    frequency = clamp(freq, 20, sampleRate * 0.49)
    update_coefficients()

function set_gain(db):
    gain_db = clamp(db, -24, 24)
    update_coefficients()

function set_q(q_val):
    q = clamp(q_val, 0.1, 20)
    update_coefficients()

function set_enabled(en):
    enabled = en

function update_coefficients():
    omega = 2π * frequency / sampleRate
    sin_omega = sin(omega)
    cos_omega = cos(omega)
    alpha = sin_omega / (2 * q)
    A = 10^(gain_db / 40)    // Note: /40 for peaking, /20 for shelving

    switch band_type:
        LowShelf:
            A_plus_1 = A + 1
            A_minus_1 = A - 1
            sqrt_A = sqrt(A)
            two_sqrt_A_alpha = 2 * sqrt_A * alpha

            b0 = A * (A_plus_1 - A_minus_1 * cos_omega + two_sqrt_A_alpha)
            b1 = 2 * A * (A_minus_1 - A_plus_1 * cos_omega)
            b2 = A * (A_plus_1 - A_minus_1 * cos_omega - two_sqrt_A_alpha)
            a0 = A_plus_1 + A_minus_1 * cos_omega + two_sqrt_A_alpha
            a1 = -2 * (A_minus_1 + A_plus_1 * cos_omega)
            a2 = A_plus_1 + A_minus_1 * cos_omega - two_sqrt_A_alpha

        HighShelf:
            A_plus_1 = A + 1
            A_minus_1 = A - 1
            sqrt_A = sqrt(A)
            two_sqrt_A_alpha = 2 * sqrt_A * alpha

            b0 = A * (A_plus_1 + A_minus_1 * cos_omega + two_sqrt_A_alpha)
            b1 = -2 * A * (A_minus_1 + A_plus_1 * cos_omega)
            b2 = A * (A_plus_1 + A_minus_1 * cos_omega - two_sqrt_A_alpha)
            a0 = A_plus_1 - A_minus_1 * cos_omega + two_sqrt_A_alpha
            a1 = 2 * (A_minus_1 - A_plus_1 * cos_omega)
            a2 = A_plus_1 - A_minus_1 * cos_omega - two_sqrt_A_alpha

        Peak:
            b0 = 1 + alpha * A * A
            b1 = -2 * cos_omega
            b2 = 1 - alpha * A * A
            a0 = 1 + alpha / (A * A)
            a1 = -2 * cos_omega
            a2 = 1 - alpha / (A * A)

        LowPass:
            b1 = 1 - cos_omega
            b0 = b1 / 2
            b2 = b0
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        HighPass:
            b1 = -(1 + cos_omega)
            b0 = -b1 / 2
            b2 = b0
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        Notch:
            b0 = 1
            b1 = -2 * cos_omega
            b2 = 1
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

    // Normalize by a0
    b0 /= a0; b1 /= a0; b2 /= a0
    a1 /= a0; a2 /= a0

function reset():
    z1 = 0
    z2 = 0

function process(input) -> float:
    if not enabled:
        return input

    // Transposed Direct Form II
    output = b0 * input + z1
    z1 = b1 * input - a1 * output + z2
    z2 = b2 * input - a2 * output

    if not is_finite(output):
        reset()
        return input

    return output
```

### 4-Band Parametric EQ (Channel Strip)

```
struct ParametricEq4:
    low_shelf: EqBand
    low_mid: EqBand
    high_mid: EqBand
    high_shelf: EqBand

function new(sampleRate):
    low_shelf = EqBand.new(LowShelf, sampleRate)
    low_mid = EqBand.new(Peak, sampleRate)
    high_mid = EqBand.new(Peak, sampleRate)
    high_shelf = EqBand.new(HighShelf, sampleRate)

    // Default frequencies
    low_shelf.set_frequency(100)
    low_mid.set_frequency(400)
    high_mid.set_frequency(2500)
    high_shelf.set_frequency(8000)

function reset():
    low_shelf.reset()
    low_mid.reset()
    high_mid.reset()
    high_shelf.reset()

function process(input) -> float:
    signal = input
    signal = low_shelf.process(signal)
    signal = low_mid.process(signal)
    signal = high_mid.process(signal)
    signal = high_shelf.process(signal)
    return signal
```

### 8-Band Parametric EQ (Mastering)

```
struct ParametricEq8:
    bands: array[8] of EqBand

function new(sampleRate):
    default_freqs = [50, 100, 250, 500, 1000, 2500, 6000, 12000]

    for i in 0..8:
        band_type = LowShelf if i == 0
                    else HighShelf if i == 7
                    else Peak
        bands[i] = EqBand.new(band_type, sampleRate)
        bands[i].set_frequency(default_freqs[i])

function band(index) -> EqBand:
    return bands[index] if index < 8 else null

function reset():
    for band in bands:
        band.reset()

function process(input) -> float:
    signal = input
    for band in bands:
        signal = band.process(signal)
    return signal
```

## Implementation Notes

### Typical EQ Configurations

| Style | Bands | Shelves | Peaks |
|-------|-------|---------|-------|
| Simple | 3 | Low + High | 1 mid |
| Channel Strip | 4 | Low + High | 2 mid |
| Full Parametric | 5-8 | Low + High | 3-6 mid |
| Mastering | 6-8 | Low + High | 4-6 mid |

### Q (Bandwidth) Guide

| Q Value | Bandwidth | Use For |
|---------|-----------|---------|
| 0.5-0.7 | Wide | Broad tonal shaping |
| 1.0-2.0 | Medium | General EQ |
| 3.0-6.0 | Narrow | Surgical cuts |
| 10-20 | Very narrow | Notch filters, resonance |

### Common EQ Moves

| Goal | Band Type | Frequency | Gain | Q |
|------|-----------|-----------|------|---|
| Add warmth | Low shelf | 80-120 Hz | +2-4 dB | - |
| Reduce mud | Peak | 200-400 Hz | -2-4 dB | 1-2 |
| Add presence | Peak | 2-4 kHz | +2-4 dB | 1-2 |
| Add air | High shelf | 10-12 kHz | +2-4 dB | - |
| Remove harshness | Peak | 2-5 kHz | -2-4 dB | 2-4 |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `std::f32::consts::PI` for π
- Store bands in `Vec<EqBand>` for flexible band count
- Consider `#[inline]` on `process()` for per-sample calls

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::IIR::Filter` with coefficients from `dsp::IIR::Coefficients`
- Use `std::array` for fixed band count
- JUCE: `dsp::ProcessorChain` to cascade bands

**Key Considerations:**
- Each band is an independent biquad filter
- Bands are processed in series (cascaded)
- Low/high shelf for broad tonal shaping
- Peak bands for surgical cuts/boosts
- Q controls bandwidth (higher Q = narrower)
- Gain in dB is more intuitive for users
- Reset state when changing sample rate
