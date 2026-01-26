---
name: dB & Gain Utilities
description: Decibel to linear conversion, level calculations, and gain staging utilities. Essential math functions for audio processing.
tags: [db, gain, level, utility, math, conversion]
source: Standard audio engineering formulas
license: Public Domain
---

# dB & Gain Utilities

Essential audio math functions for level calculations and metering.

## Source Attribution

```
// Standard audio engineering formulas - Public Domain
// dB conversion, level metering, loudness calculation
// No attribution required
```

## Algorithm Description

Audio levels are measured in decibels (dB), a logarithmic scale that matches human perception. Internal processing uses linear gain values.

### Core Conversions

**Amplitude (voltage) dB:**
```
dB = 20 * log10(gain)
gain = 10^(dB / 20)
```

**Power (energy) dB:**
```
dB = 10 * log10(power)
power = 10^(dB / 10)
```

## Pseudocode

### Basic Conversions

```
function db_to_gain(db) -> float:
    return 10^(db / 20)

function gain_to_db(gain) -> float:
    if gain > 1e-10:
        return 20 * log10(gain)
    else:
        return -200    // Floor value for silence

function db_to_power(db) -> float:
    return 10^(db / 10)

function power_to_db(power) -> float:
    if power > 1e-10:
        return 10 * log10(power)
    else:
        return -200
```

### Common Constants

```
// dB values
const UNITY_DB = 0.0
const MINUS_3_DB = -3.0       // Half power
const MINUS_6_DB = -6.0       // Half amplitude
const MINUS_12_DB = -12.0
const MINUS_20_DB = -20.0
const MINUS_60_DB = -60.0     // 1/1000 amplitude
const FLOOR_DB = -120.0

// Linear gain equivalents
const UNITY_GAIN = 1.0
const MINUS_3_DB_GAIN = 0.7071  // 1/sqrt(2)
const MINUS_6_DB_GAIN = 0.5
const MINUS_12_DB_GAIN = 0.25
const MINUS_20_DB_GAIN = 0.1
```

### Level Meter

```
struct LevelMeter:
    peak: float = 0
    peak_hold: float = 0
    peak_hold_counter: int = 0
    peak_fall_rate: float
    rms_sum: float = 0
    rms_coef: float
    sampleRate: float

function new(sampleRate):
    peak_fall_rate = 1 / (sampleRate * 1.5)    // ~1.5 sec fall
    rms_coef = exp(-1 / (0.3 * sampleRate))    // 300ms window

function process(input):
    abs_input = abs(input)

    // Peak detection (instant attack, slow release)
    if abs_input > peak:
        peak = abs_input
    else:
        peak = max(0, peak - peak_fall_rate)

    // Peak hold
    if abs_input > peak_hold:
        peak_hold = abs_input
        peak_hold_counter = sampleRate * 2     // 2 second hold
    else if peak_hold_counter > 0:
        peak_hold_counter -= 1
    else:
        peak_hold = max(0, peak_hold - peak_fall_rate)

    // RMS (running average of squared values)
    squared = input * input
    rms_sum = squared + rms_coef * (rms_sum - squared)

function peak_db() -> float:
    return gain_to_db(peak)

function peak_hold_db() -> float:
    return gain_to_db(peak_hold)

function rms_db() -> float:
    return gain_to_db(sqrt(rms_sum))

function rms() -> float:
    return sqrt(rms_sum)
```

### True Peak Meter

```
struct TruePeakMeter:
    history: array[float, 12]    // For interpolation
    history_pos: int = 0
    peak: float = 0

function process(input):
    // Store input
    history[history_pos] = input

    // Check sample peak
    if abs(input) > peak:
        peak = abs(input)

    // Check 4 interpolated positions between samples
    for phase in 1..4:
        t = phase / 4.0
        interpolated = hermite_interpolate(t)
        if abs(interpolated) > peak:
            peak = abs(interpolated)

    history_pos = (history_pos + 1) mod 12

function hermite_interpolate(t) -> float:
    // Get 4 samples from history for cubic interpolation
    // ... standard Hermite interpolation ...

function peak_db() -> float:
    return gain_to_db(peak)

function reset_peak():
    peak = 0
```

### Simplified LUFS Meter

```
struct LoudnessMeter:
    // K-weighting filter state (simplified)
    hp_z1: float = 0
    hs_z1: float = 0

    // Integration
    sum: float = 0
    count: int = 0
    gate_threshold: float

function new(sampleRate):
    gate_threshold = db_to_power(-70)    // -70 LUFS gate

function process(left, right):
    // Simplified K-weighting
    // High-shelf boost around 1500 Hz
    input = (left + right) * 0.5
    hs_out = input * 1.5 - hs_z1 * 0.5
    hs_z1 = input

    // High-pass around 60 Hz
    hp_out = hs_out - hp_z1
    hp_z1 = hs_out * 0.995 + hp_z1 * 0.005

    // Integrate (with gating)
    squared = hp_out * hp_out
    if squared > gate_threshold:
        sum += squared
        count += 1

function lufs() -> float:
    if count > 0:
        mean_square = sum / count
        return -0.691 + 10 * log10(mean_square)
    else:
        return -70
```

### Gain Staging Helpers

```
function compression_makeup(threshold_db, ratio, knee_db) -> float:
    // Estimate makeup gain for compression
    avg_reduction = (threshold_db / ratio - threshold_db) * 0.5
    return -avg_reduction

function gain_to_target_rms(current_rms_db, target_rms_db) -> float:
    return db_to_gain(target_rms_db - current_rms_db)

function headroom_db(peak_db) -> float:
    return -max(peak_db, -60)
```

## Implementation Notes

### Common Conversions Table

| dB | Linear Gain | Description |
|----|-------------|-------------|
| +6 | 2.0 | Double amplitude |
| +3 | ~1.41 | Double power |
| 0 | 1.0 | Unity |
| -3 | ~0.71 | Half power |
| -6 | 0.5 | Half amplitude |
| -12 | 0.25 | Quarter amplitude |
| -20 | 0.1 | One tenth |
| -40 | 0.01 | One hundredth |
| -60 | 0.001 | One thousandth |

### Peak vs RMS

| Measurement | Meaning | Use For |
|-------------|---------|---------|
| Peak | Maximum instantaneous level | Clipping detection |
| RMS | Average energy | Perceived loudness |
| True Peak | Inter-sample peak | Streaming/broadcast |
| LUFS | Perceptual loudness | Loudness normalization |

### Typical Target Levels

| Platform | Target | Peak Limit |
|----------|--------|------------|
| Streaming | -14 LUFS | -1 dBTP |
| Broadcast | -24 LUFS | -2 dBTP |
| Film | -27 LUFS | -3 dB |
| Mixing | -18 dBFS RMS | -6 dB peak |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::log10()` and `10.0_f32.powf()`
- nih-plug has `util::db_to_gain` and `util::gain_to_db` built-in
- Consider using `nih_plug::util` module

**C++ (JUCE/iPlug2):**
- JUCE: `Decibels::decibelsToGain()` and `Decibels::gainToDecibels()`
- Standard math: `std::pow(10.0f, db / 20.0f)`

**Key Considerations:**
- Always use dB for user-facing controls
- Use linear gain for internal calculations
- Protect against log(0) - use a floor value
- RMS metering needs a time window (typically 300ms)
- True peak requires oversampling (4x typical)
