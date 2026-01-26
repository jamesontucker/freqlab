---
name: Stereo Utilities
description: Stereo width, panning laws, M/S processing, and stereo field manipulation. Essential tools for spatial audio processing.
tags: [stereo, pan, width, mid-side, utility, spatial]
source: Classic audio engineering techniques
license: Public Domain
---

# Stereo Utilities

Tools for manipulating the stereo field.

## Source Attribution

```
// Classic stereo processing techniques - Public Domain
// Standard audio engineering formulas
// No attribution required
```

## Algorithm Description

Stereo processing tools control the spatial characteristics of audio:
- **Panning**: Places mono signal in stereo field
- **Width**: Adjusts stereo image from mono to extra-wide
- **M/S Processing**: Separate mid (center) and side (stereo) components
- **Correlation**: Measures phase relationship between channels

### Pan Law Comparison

| Law | Center Level | Use Case |
|-----|--------------|----------|
| Linear | -6dB | Legacy compatibility |
| Constant Power | -3dB | Most common, natural |
| CP -4.5dB | -4.5dB | Compromise |
| CP -6dB | -6dB | Some DAWs |

## Pseudocode

### Pan Laws

```
enum PanLaw:
    Linear              // Simple linear crossfade
    ConstantPower       // -3dB at center (most common)
    ConstantPower4_5    // -4.5dB at center
    ConstantPower6      // -6dB at center
```

### Panner

```
struct Panner:
    pan: float = 0          // -1 (left) to +1 (right)
    law: PanLaw
    left_gain: float = 1
    right_gain: float = 1

function new(law):
    this.law = law
    update_gains()

function set_pan(pan):
    this.pan = clamp(pan, -1, 1)
    update_gains()

function set_law(law):
    this.law = law
    update_gains()

function update_gains():
    normalized = (pan + 1) / 2    // 0 to 1

    switch law:
        Linear:
            left_gain = 1 - normalized
            right_gain = normalized

        ConstantPower:
            // -3dB at center
            angle = normalized * π / 2
            left_gain = cos(angle)
            right_gain = sin(angle)

        ConstantPower4_5:
            // -4.5dB at center (blend linear and CP)
            angle = normalized * π / 2
            linear_l = 1 - normalized
            linear_r = normalized
            cp_l = cos(angle)
            cp_r = sin(angle)
            left_gain = (linear_l + cp_l) / 2
            right_gain = (linear_r + cp_r) / 2

        ConstantPower6:
            // -6dB at center (same as linear)
            left_gain = 1 - normalized
            right_gain = normalized

function process_mono(input) -> (float, float):
    // Pan mono to stereo
    return (input * left_gain, input * right_gain)

function process_stereo(left, right) -> (float, float):
    // Balance control for stereo
    if pan < 0:
        // Panning left: reduce right
        right_atten = 1 + pan
        return (left, right * right_atten)
    else:
        // Panning right: reduce left
        left_atten = 1 - pan
        return (left * left_atten, right)
```

### Mid/Side Encoder/Decoder

```
struct MidSide:

function encode(left, right) -> (float, float):
    // Convert stereo to mid/side
    mid = (left + right) * 0.5
    side = (left - right) * 0.5
    return (mid, side)

function decode(mid, side) -> (float, float):
    // Convert mid/side to stereo
    left = mid + side
    right = mid - side
    return (left, right)
```

### Stereo Width Control

```
struct StereoWidth:
    width: float = 1    // 0 = mono, 1 = normal, 2 = extra wide

function new():
    // Default width = 1

function set_width(width):
    this.width = clamp(width, 0, 2)

function process(left, right) -> (float, float):
    // Convert to M/S
    mid = (left + right) * 0.5
    side = (left - right) * 0.5

    // Adjust width by scaling side channel
    side_scaled = side * width

    // Convert back to L/R
    out_left = mid + side_scaled
    out_right = mid - side_scaled

    return (out_left, out_right)
```

### Stereo Rotator

```
struct StereoRotator:
    angle: float = 0        // Rotation angle in radians
    cos_angle: float = 1
    sin_angle: float = 0

function new():
    // No rotation by default

function set_angle_degrees(degrees):
    angle = clamp(degrees, -180, 180) * π / 180
    cos_angle = cos(angle)
    sin_angle = sin(angle)

function set_angle_radians(radians):
    angle = radians
    cos_angle = cos(angle)
    sin_angle = sin(angle)

function process(left, right) -> (float, float):
    // Rotate stereo field
    out_left = left * cos_angle - right * sin_angle
    out_right = left * sin_angle + right * cos_angle
    return (out_left, out_right)
```

### Haas Effect Widener

```
enum HaasSide:
    Left        // Delay left channel
    Right       // Delay right channel

struct HaasWidener:
    delay_buffer: array[float]
    write_pos: int = 0
    delay_samples: int
    wet_gain: float = 0.5
    side: HaasSide = Right

function new(max_delay_ms, sampleRate):
    max_samples = max_delay_ms * 0.001 * sampleRate + 1
    delay_buffer = array of max_samples zeros
    delay_samples = 5 * 0.001 * sampleRate    // 5ms default

function set_delay_ms(ms, sampleRate):
    ms = clamp(ms, 0.1, 30)    // 1-30ms typical for Haas
    delay_samples = min(ms * 0.001 * sampleRate, delay_buffer.length - 1)

function set_wet_gain(gain):
    wet_gain = clamp(gain, 0, 1)

function set_side(side):
    this.side = side

function reset():
    fill delay_buffer with 0
    write_pos = 0

function process(left, right) -> (float, float):
    // Read delayed sample
    read_pos = (write_pos + delay_buffer.length - delay_samples)
               mod delay_buffer.length

    switch side:
        Right:
            delayed = delay_buffer[read_pos]
            delay_buffer[write_pos] = right
            out_left = left
            out_right = right * (1 - wet_gain) + delayed * wet_gain

        Left:
            delayed = delay_buffer[read_pos]
            delay_buffer[write_pos] = left
            out_left = left * (1 - wet_gain) + delayed * wet_gain
            out_right = right

    write_pos = (write_pos + 1) mod delay_buffer.length

    return (out_left, out_right)
```

### Correlation Meter

```
struct CorrelationMeter:
    sum_lr: float = 0
    sum_l2: float = 0
    sum_r2: float = 0
    decay: float

function new(sampleRate):
    // ~50ms averaging
    decay = exp(-1 / (0.05 * sampleRate))

function reset():
    sum_lr = 0
    sum_l2 = 0
    sum_r2 = 0

function process(left, right) -> float:
    // Returns correlation: +1 = mono, 0 = uncorrelated, -1 = out of phase
    sum_lr = left * right + decay * sum_lr
    sum_l2 = left * left + decay * sum_l2
    sum_r2 = right * right + decay * sum_r2

    denominator = sqrt(sum_l2 * sum_r2)
    if denominator > 1e-10:
        return clamp(sum_lr / denominator, -1, 1)
    return 0
```

### Mono Compatibility Checker

```
struct MonoChecker:
    correlation: CorrelationMeter

function new(sampleRate):
    correlation = CorrelationMeter.new(sampleRate)

function has_phase_issues(left, right) -> bool:
    // Returns true if mono summing would cause significant cancellation
    return correlation.process(left, right) < -0.3

function mono_sum_with_warning(left, right) -> (float, float):
    // Returns (mono_sum, warning_level)
    corr = correlation.process(left, right)
    mono = (left + right) * 0.5

    // Warning level based on negative correlation
    warning = -corr if corr < 0 else 0

    return (mono, warning)
```

## Implementation Notes

### Width Values

| Width | Effect |
|-------|--------|
| 0 | Mono (center only) |
| 0.5 | Narrowed |
| 1.0 | Original stereo |
| 1.5 | Widened |
| 2.0 | Maximum width |

### Haas Effect Delays

| Delay | Effect |
|-------|--------|
| 1-5 ms | Subtle widening |
| 5-15 ms | Clear widening |
| 15-30 ms | Distinct echo starts |
| >30 ms | Separate echo |

### Correlation Values

| Value | Meaning |
|-------|---------|
| +1.0 | Mono (identical L/R) |
| +0.5 to +1.0 | Normal stereo |
| 0 | Uncorrelated (wide stereo) |
| -0.5 to 0 | Wide, some cancellation |
| -1.0 | Out of phase (full cancellation in mono) |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::cos()` and `f32::sin()` for panning
- Use `std::f32::consts::PI` for π
- Use `VecDeque` for Haas delay buffer

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::Panner` handles panning
- Use `std::cos` and `std::sin` from `<cmath>`
- JUCE: `AudioBuffer` methods for M/S processing

**Key Considerations:**
- Constant power pan law maintains perceived loudness
- M/S processing enables independent mid/side control
- Width > 1.0 can cause phase issues in mono
- Haas effect creates width via precedence (1-30ms delay)
- Always check mono compatibility when widening
