---
name: One-Pole Filter
description: Simple one-pole low-pass filter for smoothing parameters and DC blocking. Extremely efficient and widely used for parameter smoothing.
tags: [filter, smoothing, dc-block, simple, utility]
source: Classic digital filter design
license: Public Domain
---

# One-Pole Filter

Simple and efficient one-pole filter implementations for smoothing and DC blocking.

## Source Attribution

```
// Classic filter design - Public Domain
// Described in many DSP textbooks and musicdsp.org
// No attribution required
```

## Algorithm Description

The one-pole filter is the simplest IIR (infinite impulse response) filter. It has a single pole in the transfer function, creating a gentle 6 dB/octave slope.

### Mathematics

**Difference Equation:**
```
y[n] = a0 * x[n] + b1 * y[n-1]

where:
  a0 = 1 - b1
  b1 = coefficient (0 to ~0.9999)
```

**Coefficient from Cutoff Frequency:**
```
b1 = exp(-2π * freq / sampleRate)
a0 = 1 - b1
```

**Coefficient from Time Constant:**
```
// Time to reach ~63% of target (tau)
samples = time_ms * 0.001 * sampleRate
b1 = exp(-1 / samples)
a0 = 1 - b1
```

## Pseudocode

### One-Pole Low-Pass Filter

```
struct OnePole:
    z1: float = 0       // Previous output (state)
    a0: float = 1       // Input coefficient
    b1: float = 0       // Feedback coefficient

function set_coefficient(coefficient):
    // coefficient: 0.0 = no filtering, ~0.9999 = heavy filtering
    b1 = clamp(coefficient, 0.0, 0.9999)
    a0 = 1.0 - b1

function set_frequency(freq, sampleRate):
    freq = clamp(freq, 0.1, sampleRate * 0.49)
    b1 = exp(-2π * freq / sampleRate)
    a0 = 1.0 - b1

function set_time_ms(time_ms, sampleRate):
    // Time to reach ~63% of target value
    if time_ms <= 0:
        b1 = 0
        a0 = 1
    else:
        samples = time_ms * 0.001 * sampleRate
        b1 = exp(-1.0 / samples)
        a0 = 1.0 - b1

function reset(value):
    z1 = value

function process(input) -> float:
    z1 = a0 * input + b1 * z1

    // Protect against NaN/Inf
    if not is_finite(z1):
        z1 = 0

    return z1
```

### Parameter Smoother

```
struct Smoother:
    filter: OnePole
    target: float

function new(initial_value):
    filter = OnePole()
    filter.reset(initial_value)
    target = initial_value

function set_smoothing_time(time_ms, sampleRate):
    filter.set_time_ms(time_ms, sampleRate)

function set_target(new_target):
    target = new_target

function next() -> float:
    return filter.process(target)

function is_settled(threshold) -> bool:
    return abs(filter.current() - target) < threshold

function jump_to(value):
    // Skip smoothing, jump immediately
    target = value
    filter.reset(value)
```

### DC Blocker (High-Pass)

```
struct DcBlocker:
    x1: float = 0       // Previous input
    y1: float = 0       // Previous output
    R: float = 0.995    // Pole position (close to 1)

function new(cutoff_hz, sampleRate):
    // Typical cutoff: 5-20 Hz
    R = 1.0 - (2π * cutoff_hz / sampleRate)
    R = clamp(R, 0.9, 0.9999)

function reset():
    x1 = 0
    y1 = 0

function process(input) -> float:
    // DC blocking difference equation
    output = input - x1 + R * y1
    x1 = input
    y1 = output

    // Protect against NaN/Inf
    if not is_finite(output):
        reset()
        return 0

    return output
```

## Implementation Notes

### Coefficient Values

| Coefficient (b1) | Effect |
|------------------|--------|
| 0.0 | No filtering (output = input) |
| 0.9 | Light smoothing (~2ms at 48kHz) |
| 0.99 | Medium smoothing (~20ms at 48kHz) |
| 0.999 | Heavy smoothing (~200ms at 48kHz) |
| 0.9999 | Very heavy smoothing (~2s at 48kHz) |

### Typical Smoothing Times

| Application | Time |
|-------------|------|
| Gain changes | 10-50 ms |
| Filter cutoff | 5-20 ms |
| Pan position | 10-30 ms |
| Mix/blend | 20-50 ms |

### When to Use

- **Parameter smoothing**: Prevent clicks/zipper noise from discontinuous parameter changes
- **DC blocking**: Remove DC offset after waveshapers or other nonlinear processing
- **Simple low-pass**: When you need minimal CPU and don't need steep rolloff
- **Control signals**: Smoothing LFO or envelope outputs

### Alternatives

- For steeper filtering: Use SVF or biquad filters
- For more precise smoothing: Use linear ramp smoother
- For gain smoothing: Consider logarithmic smoother for perceptual linearity

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32` for all values
- The `#[inline]` attribute helps with per-sample performance
- Consider using `Smoother` from nih-plug's built-in parameter system

**C++ (JUCE/iPlug2):**
- Use `float` or `double` as needed
- JUCE provides `SmoothedValue<T>` for similar functionality
- Consider SIMD for processing multiple channels

**Key Considerations:**
- Always protect against NaN/Inf in the process function
- Reset state when sample rate changes
- For parameter smoothing, set target once per block, not per sample
