---
name: Parameter Smoothing
description: Smooth parameter changes to prevent clicks and zipper noise. Essential for real-time parameter automation without artifacts.
tags: [smoothing, interpolation, parameter, utility, slew, zipper-noise]
source: Classic DSP technique
license: Public Domain
---

# Parameter Smoothing

Smooth value changes to avoid audio artifacts (clicks, zipper noise).

## Source Attribution

```
// Classic DSP smoothing techniques - Public Domain
// Exponential smoothing, linear ramps, slew limiting
// No attribution required
```

## Algorithm Description

Abrupt parameter changes cause audible artifacts:
- **Clicks**: Sudden gain changes create discontinuities
- **Zipper noise**: Stepped filter cutoff creates stair-step modulation

Smoothing interpolates between old and new values over time.

### Smoothing Types

| Type | Character | Use Case |
|------|-----------|----------|
| Exponential | Natural decay curve | General purpose |
| Linear | Constant rate | Click-free fades |
| Logarithmic | Perceptually linear | Gain, frequency |
| Slew limiter | Rate-limited | Extreme changes |

## Pseudocode

### Exponential Smoother (One-Pole)

```
struct ExpSmoother:
    current: float = 0
    target: float = 0
    coef: float = 0        // Smoothing coefficient

function new(time_ms, sampleRate):
    samples = time_ms * 0.001 * sampleRate
    if samples > 0:
        coef = exp(-1.0 / samples)
    else:
        coef = 0

function set_time(time_ms, sampleRate):
    samples = time_ms * 0.001 * sampleRate
    if samples > 0:
        coef = exp(-1.0 / samples)
    else:
        coef = 0

function set_target(new_target):
    target = new_target

function set_immediate(value):
    // Skip smoothing, jump immediately
    current = value
    target = value

function value() -> float:
    return current

function is_settled() -> bool:
    return abs(current - target) < 1e-6

function next() -> float:
    // Exponential approach to target
    current = target + coef * (current - target)
    return current

function process_block(block_size) -> float:
    for i in 0..block_size:
        next()
    return current
```

### Linear Smoother (Constant Rate)

```
struct LinearSmoother:
    current: float = 0
    target: float = 0
    increment: float = 0
    samples_remaining: int = 0
    ramp_samples: int

function new(ramp_time_ms, sampleRate):
    ramp_samples = max(1, ramp_time_ms * 0.001 * sampleRate)

function set_ramp_time(time_ms, sampleRate):
    ramp_samples = max(1, time_ms * 0.001 * sampleRate)

function set_target(new_target):
    if abs(new_target - current) < 1e-10:
        target = new_target
        samples_remaining = 0
        return

    target = new_target
    samples_remaining = ramp_samples
    increment = (target - current) / ramp_samples

function set_immediate(value):
    current = value
    target = value
    samples_remaining = 0

function value() -> float:
    return current

function is_done() -> bool:
    return samples_remaining == 0

function next() -> float:
    if samples_remaining > 0:
        current += increment
        samples_remaining -= 1

        if samples_remaining == 0:
            current = target  // Ensure exact target

    return current
```

### Logarithmic Smoother (for Gain/Frequency)

```
struct LogSmoother:
    current_log: float      // Log of current value
    target_log: float       // Log of target value
    coef: float
    min_value: float        // Minimum value (avoids log(0))

function new(time_ms, sampleRate, min_value):
    samples = time_ms * 0.001 * sampleRate
    coef = samples > 0 ? exp(-1.0 / samples) : 0
    this.min_value = max(min_value, 1e-10)
    current_log = ln(this.min_value)
    target_log = current_log

function set_target(target):
    target_log = ln(max(target, min_value))

function set_immediate(value):
    log_val = ln(max(value, min_value))
    current_log = log_val
    target_log = log_val

function value() -> float:
    return exp(current_log)

function next() -> float:
    current_log = target_log + coef * (current_log - target_log)
    return exp(current_log)
```

### Slew Rate Limiter

```
struct SlewLimiter:
    current: float = 0
    rise_rate: float       // Max rise per sample
    fall_rate: float       // Max fall per sample

function new(rise_time_ms, fall_time_ms, sampleRate):
    rise_rate = 1.0 / max(1, rise_time_ms * 0.001 * sampleRate)
    fall_rate = 1.0 / max(1, fall_time_ms * 0.001 * sampleRate)

function symmetric(time_ms, sampleRate):
    // Same rise and fall rate
    return new(time_ms, time_ms, sampleRate)

function set_immediate(value):
    current = value

function value() -> float:
    return current

function process(target) -> float:
    diff = target - current

    if diff > 0:
        // Rising: limit by rise_rate
        current += min(diff, rise_rate)
    else:
        // Falling: limit by fall_rate
        current += max(diff, -fall_rate)

    return current
```

### Block Smoother (Efficient)

```
struct BlockSmoother:
    current: float = 0
    target: float = 0
    step: float = 0
    samples_remaining: int = 0

function set_target_for_block(target, block_size):
    if abs(target - current) < 1e-10 or block_size == 0:
        current = target
        this.target = target
        step = 0
        samples_remaining = 0
        return

    this.target = target
    samples_remaining = block_size
    step = (target - current) / block_size

function is_active() -> bool:
    return samples_remaining > 0

function next() -> float:
    if samples_remaining > 0:
        current += step
        samples_remaining -= 1

        if samples_remaining == 0:
            current = target

    return current

function fill_buffer(buffer: array[float]):
    for i in 0..buffer.length:
        buffer[i] = next()
```

## Implementation Notes

### Typical Smoothing Times

| Parameter | Time | Reason |
|-----------|------|--------|
| Gain/Volume | 10-50ms | Avoid clicks |
| Filter cutoff | 5-20ms | Prevent zipper noise |
| Pan position | 10-30ms | Smooth movement |
| Mix/Blend | 20-50ms | Avoid pumping |
| Delay time | 50-200ms | Prevent pitch artifacts |

### Choosing Smoother Type

| Scenario | Best Choice |
|----------|-------------|
| General automation | Exponential |
| Fade in/out | Linear |
| Gain automation | Logarithmic |
| Modulation wheel | Slew limiter |
| Block processing | Block smoother |

### CPU Optimization

1. **Check `is_done()`** before processing to skip stable parameters
2. **Use block smoother** for per-buffer parameter updates
3. **Process once per block** rather than per-sample when possible
4. **Skip smoothing** when loading presets (use `set_immediate`)

### Exponential vs Linear

```
Exponential: Approaches target asymptotically
             Never quite reaches target (within threshold)
             Natural, musical feel
             Good for continuous parameters

Linear:      Reaches target exactly after N samples
             Predictable timing
             Good for fades and precise automation
             Can sound mechanical
```

### Sample Rate Changes

Always recalculate coefficients when sample rate changes:
- Time-based smoothers depend on sample rate
- Store time in ms, recalculate on rate change

## Adapt to Your Framework

**Rust (nih-plug):**
- nih-plug has built-in `Smoother` types for parameters
- Use `param.smoothed.next()` for automatic smoothing
- For custom smoothing, use `f32::exp()` and `f32::ln()`

**C++ (JUCE/iPlug2):**
- JUCE provides `SmoothedValue<T>` template class
- Supports linear and multiplicative (log) modes
- `SmoothedValue<float, ValueSmoothingTypes::Linear>`
- `SmoothedValue<float, ValueSmoothingTypes::Multiplicative>`

**Key Considerations:**
- Always use `set_immediate()` when initializing or loading presets
- Reset smoothers when plugin is bypassed then re-enabled
- Consider per-parameter smoothing times (fast for filters, slow for mix)
- Log smoothing is perceptually linear for gain (dB) and frequency (Hz)
