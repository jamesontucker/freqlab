---
name: Soft Clipping
description: Various soft clipping and saturation functions for gentle limiting and warmth. Essential building block for saturation effects.
tags: [soft-clip, saturation, limiter, warmth, utility]
source: Classic waveshaping techniques
license: Public Domain
---

# Soft Clipping Functions

Various waveshaping curves for saturation and limiting.

## Source Attribution

```
// Classic soft clipping techniques - Public Domain
// Standard waveshaping functions
// No attribution required
```

## Algorithm Description

Soft clipping applies a nonlinear transfer function that gently limits signal peaks, creating harmonic distortion that sounds warmer than hard clipping.

### Clipper Type Comparison

| Type | Character | Harmonics | CPU |
|------|-----------|-----------|-----|
| Tanh | Smooth, warm | Odd, decreasing | Medium |
| Sigmoid | Clean, subtle | Odd | Low |
| Cubic | Soft knee | 3rd only | Low |
| Sine | Rounded | Complex | Low |
| Foldback | Harsh, synth | Many | Low |
| Hard | Digital, harsh | Many (aliased) | Lowest |
| Asymmetric | Tube-like | Even + Odd | Medium |

## Pseudocode

### Clipper Types

```
enum ClipType:
    Tanh           // Smooth, symmetric
    Sigmoid        // S-curve
    Cubic          // Soft knee cubic
    Sine           // Sine-based
    Foldback       // Wraps around
    HardClip       // Straight clipping
    Asymmetric     // Tube-like asymmetry
```

### Basic Soft Clip Functions

```
function soft_clip(input, clip_type) -> float:
    switch clip_type:
        Tanh:
            return tanh(input)

        Sigmoid:
            return input / (1 + abs(input))

        Cubic:
            if abs(input) < 2/3:
                return input - (input^3) / 3
            else:
                return sign(input) * 2/3

        Sine:
            if abs(input) < 1:
                return sin(input * π / 2)
            else:
                return sign(input)

        Foldback:
            // Fold signal back when it exceeds threshold
            x = input
            while abs(x) > 1:
                if x > 1:
                    x = 2 - x
                else if x < -1:
                    x = -2 - x
            return x

        HardClip:
            return clamp(input, -1, 1)

        Asymmetric:
            // Different curves for positive and negative
            if input >= 0:
                return tanh(input)
            else:
                // Softer negative clipping
                x = abs(input)
                return -x / (1 + x * 0.5)
```

### Soft Clipper with Drive and Mix

```
struct SoftClipper:
    clip_type: ClipType
    drive: float = 1           // Input gain (1 = unity)
    output_gain: float = 1     // Output compensation
    mix: float = 1             // Dry/wet (0-1)

function new(clip_type):
    this.clip_type = clip_type

function set_type(clip_type):
    this.clip_type = clip_type

function set_drive(drive):
    this.drive = max(drive, 0.1)
    // Auto-compensate output based on drive
    output_gain = 1 / max(1 + (drive - 1) * 0.3, 0.5)

function set_drive_db(db):
    set_drive(db_to_gain(db))

function set_mix(mix):
    this.mix = clamp(mix, 0, 1)

function process(input) -> float:
    driven = input * drive
    clipped = soft_clip(driven, clip_type) * output_gain

    // Mix dry and wet
    return input * (1 - mix) + clipped * mix
```

### Lookup Table Soft Clipper (Fast)

```
struct LutSoftClipper:
    table: array[float]
    table_size: int
    input_range: float = 4     // Table covers -4 to +4
    drive: float = 1

function new(clip_type, table_size):
    table = new array of table_size floats

    for i in 0..table_size:
        x = (i / (table_size - 1)) * 2 - 1    // -1 to 1
        x = x * input_range
        table[i] = soft_clip(x, clip_type)

function set_drive(drive):
    this.drive = max(drive, 0.1)

function process(input) -> float:
    driven = input * drive

    // Normalize to table range
    normalized = (driven / input_range + 1) * 0.5
    index_f = normalized * (table_size - 1)

    // Linear interpolation
    index = clamp(floor(index_f), 0, table_size - 2)
    frac = index_f - index

    return table[index] * (1 - frac) + table[index + 1] * frac
```

### Multi-Band Soft Clipper

```
struct MultibandClipper:
    // Simple 2-band crossover
    lp_z1: float = 0
    crossover_freq: float = 200
    sampleRate: float

    low_drive: float = 1
    high_drive: float = 1
    low_clip: ClipType = Tanh
    high_clip: ClipType = Cubic

function new(sampleRate):
    this.sampleRate = sampleRate

function set_crossover(freq):
    crossover_freq = clamp(freq, 50, 2000)

function set_low_drive(drive):
    low_drive = max(drive, 0.1)

function set_high_drive(drive):
    high_drive = max(drive, 0.1)

function reset():
    lp_z1 = 0

function process(input) -> float:
    // Simple one-pole crossover
    omega = 2π * crossover_freq / sampleRate
    coef = 1 - exp(-omega)

    lp_z1 += coef * (input - lp_z1)
    low = lp_z1
    high = input - low

    // Clip each band with different settings
    low_clipped = soft_clip(low * low_drive, low_clip)
    high_clipped = soft_clip(high * high_drive, high_clip)

    return low_clipped + high_clipped
```

### Polynomial Clipper (Customizable Harmonics)

```
struct PolynomialClipper:
    // Chebyshev polynomial coefficients for odd harmonics
    h1: float = 1      // Fundamental
    h3: float = 0      // 3rd harmonic
    h5: float = 0      // 5th harmonic

function new():
    // Default: clean (no harmonics added)

function warm() -> PolynomialClipper:
    return PolynomialClipper with h1=1, h3=0.1, h5=0.02

function tube() -> PolynomialClipper:
    return PolynomialClipper with h1=1, h3=0.15, h5=0.05

function aggressive() -> PolynomialClipper:
    return PolynomialClipper with h1=1, h3=0.25, h5=0.1

function set_harmonics(h3, h5):
    this.h3 = clamp(h3, 0, 0.5)
    this.h5 = clamp(h5, 0, 0.3)

function process(input) -> float:
    x = clamp(input, -1, 1)
    x2 = x * x

    // Chebyshev polynomials for odd harmonics
    t1 = x                                    // Fundamental
    t3 = x * (4 * x2 - 3)                     // 3rd harmonic
    t5 = x * (16 * x2 * x2 - 20 * x2 + 5)    // 5th harmonic

    output = h1 * t1 + h3 * t3 + h5 * t5

    // Soft clip the result
    return tanh(output)
```

## Implementation Notes

### Drive and Output Gain Compensation

| Drive (dB) | Suggested Output Gain |
|------------|----------------------|
| +3 | 0.85 |
| +6 | 0.70 |
| +12 | 0.50 |
| +20 | 0.30 |

### Fast Tanh Approximation

```
function fast_tanh(x) -> float:
    x2 = x * x
    return x * (27 + x2) / (27 + 9 * x2)
```

### Aliasing Considerations

Heavy clipping creates harmonics that can alias. Solutions:
1. **Oversampling**: Process at 2x-4x sample rate, then downsample
2. **Softer curves**: tanh aliases less than hard clip
3. **Lower drive**: Less harmonics = less aliasing

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::tanh()` for standard tanh
- Consider the fast_tanh approximation for performance
- Use `std::f32::consts::PI` for π

**C++ (JUCE/iPlug2):**
- Use `std::tanh` from `<cmath>`
- JUCE: Consider `dsp::WaveShaper` for custom curves
- For authentic analog: see chowdsp_wdf for circuit modeling

**Key Considerations:**
- Always use oversampling for heavy clipping to reduce aliasing
- Tanh is the most commonly used soft clipper
- Asymmetric clipping adds even harmonics (tube character)
- Mix control allows parallel saturation
- Multi-band clipping prevents bass from distorting highs
- LUT version is faster for real-time use
