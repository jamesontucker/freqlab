---
name: Expander
description: Downward expander for reducing noise and increasing dynamics below threshold. Gentler alternative to gating with ratio control.
tags: [expander, dynamics, noise-reduction, gate, effect]
source: Classic dynamics processing
license: Public Domain
---

# Expander

Reduce signal level below threshold (opposite of compression).

## Source Attribution

```
// Classic expander design - Public Domain
// Standard dynamics processing technique
// No attribution required
```

## Algorithm Description

An expander reduces gain for signals below a threshold, opposite of compression. It's a gentler alternative to gating.

### Expander vs Gate vs Compressor

| Processor | Below Threshold | Above Threshold |
|-----------|-----------------|-----------------|
| Expander | Reduce gain by ratio | Unity gain |
| Gate | Mute or attenuate | Unity gain |
| Compressor | Unity gain | Reduce gain |

### Downward vs Upward Expansion

- **Downward**: Reduces signal below threshold (noise reduction)
- **Upward**: Boosts signal above threshold (adds punch)

## Pseudocode

### Detection Modes

```
enum ExpanderDetection:
    Peak        // Faster, more responsive
    Rms         // Smoother, more natural
```

### Downward Expander

```
struct Expander:
    // Parameters
    threshold_db: float = -40
    ratio: float = 2          // 1:1 to 1:∞ (2 = 1:2, 4 = 1:4)
    attack_ms: float = 5
    release_ms: float = 100
    knee_db: float = 6
    detection: ExpanderDetection = Peak
    range_db: float = -40     // Maximum expansion (prevents infinite atten)

    // State
    envelope: float = 0
    gain: float = 1

    // Coefficients
    attack_coef: float
    release_coef: float
    rms_coef: float
    rms_sum: float = 0

    sampleRate: float

function new(sampleRate):
    update_coefficients()

function set_threshold(db):
    threshold_db = clamp(db, -80, 0)

function set_ratio(ratio):
    this.ratio = clamp(ratio, 1, 20)

function set_attack(ms):
    attack_ms = clamp(ms, 0.1, 100)
    update_coefficients()

function set_release(ms):
    release_ms = clamp(ms, 10, 5000)
    update_coefficients()

function set_knee(db):
    knee_db = clamp(db, 0, 24)

function set_range(db):
    range_db = clamp(db, -80, 0)

function set_detection(detection):
    this.detection = detection

function update_coefficients():
    attack_samples = attack_ms * 0.001 * sampleRate
    release_samples = release_ms * 0.001 * sampleRate

    attack_coef = exp(-1 / max(attack_samples, 1))
    release_coef = exp(-1 / max(release_samples, 1))

    // RMS window of ~10ms
    rms_samples = 0.01 * sampleRate
    rms_coef = exp(-1 / max(rms_samples, 1))

function reset():
    envelope = 0
    gain = 1
    rms_sum = 0

function gain_reduction_db() -> float:
    if gain > 0.0001:
        return 20 * log10(gain)
    else:
        return -80

function process(input) -> float:
    // Level detection
    switch detection:
        Peak:
            level = abs(input)
        Rms:
            rms_sum = input*input + rms_coef * (rms_sum - input*input)
            level = sqrt(rms_sum)

    // Convert to dB
    level_db = 20 * log10(max(level, 1e-10))

    // Envelope follower (smoothing)
    if level_db > envelope:
        coef = attack_coef
    else:
        coef = release_coef
    envelope = level_db + coef * (envelope - level_db)

    // Calculate expansion
    expansion_db = calculate_expansion(envelope)

    // Convert to linear gain
    target_gain = db_to_gain(expansion_db)

    // Smooth gain changes
    if target_gain < gain:
        gain_coef = attack_coef
    else:
        gain_coef = release_coef
    gain = target_gain + gain_coef * (gain - target_gain)

    return input * gain

function calculate_expansion(input_db) -> float:
    half_knee = knee_db / 2
    knee_start = threshold_db - half_knee
    knee_end = threshold_db + half_knee

    if input_db >= knee_end:
        // Above threshold: no expansion
        return 0

    else if input_db <= knee_start:
        // Below knee: full expansion
        diff = input_db - threshold_db
        expansion = diff * (1 - 1/ratio)
        return max(expansion, range_db)

    else:
        // In knee: gradual transition
        knee_factor = (knee_end - input_db) / knee_db
        knee_factor = knee_factor * knee_factor    // Quadratic knee

        diff = input_db - threshold_db
        expansion = diff * (1 - 1/ratio) * knee_factor
        return max(expansion, range_db)
```

### Stereo Expander with Linking

```
struct StereoExpander:
    left: Expander
    right: Expander
    link: float = 1        // 0 = independent, 1 = fully linked

function new(sampleRate):
    left = Expander.new(sampleRate)
    right = Expander.new(sampleRate)

function set_link(link):
    this.link = clamp(link, 0, 1)

// Apply same settings to both channels
function set_threshold(db):
    left.set_threshold(db)
    right.set_threshold(db)

function set_ratio(ratio):
    left.set_ratio(ratio)
    right.set_ratio(ratio)

function set_attack(ms):
    left.set_attack(ms)
    right.set_attack(ms)

function set_release(ms):
    left.set_release(ms)
    right.set_release(ms)

function reset():
    left.reset()
    right.reset()

function process(left_in, right_in) -> (float, float):
    if link <= 0.001:
        // Fully independent
        return (left.process(left_in), right.process(right_in))

    else if link >= 0.999:
        // Fully linked: use max level for detection
        left_out = left.process(left_in)
        linked_gain = left.gain

        // Apply same gain to right
        return (left_out, right_in * linked_gain)

    else:
        // Partial linking
        left_solo = left.process(left_in)
        right_solo = right.process(right_in)

        // Get linked gain
        left.process(max(abs(left_in), abs(right_in)))
        linked_gain = left.gain

        // Blend between solo and linked
        left_out = left_solo * (1 - link) + (left_in * linked_gain) * link
        right_out = right_solo * (1 - link) + (right_in * linked_gain) * link

        return (left_out, right_out)
```

### Upward Expander

```
struct UpwardExpander:
    threshold_db: float = -20
    ratio: float = 2
    attack_ms: float = 10
    release_ms: float = 100

    envelope: float = 0
    gain: float = 1

    attack_coef: float
    release_coef: float

    sampleRate: float

function new(sampleRate):
    this.sampleRate = sampleRate
    update_coefficients()

function set_threshold(db):
    threshold_db = clamp(db, -60, 0)

function set_ratio(ratio):
    this.ratio = clamp(ratio, 1, 10)

function update_coefficients():
    attack_samples = attack_ms * 0.001 * sampleRate
    release_samples = release_ms * 0.001 * sampleRate

    attack_coef = exp(-1 / max(attack_samples, 1))
    release_coef = exp(-1 / max(release_samples, 1))

function process(input) -> float:
    level_db = 20 * log10(max(abs(input), 1e-10))

    // Envelope
    if level_db > envelope:
        coef = attack_coef
    else:
        coef = release_coef
    envelope = level_db + coef * (envelope - level_db)

    // Upward expansion: boost above threshold
    if envelope > threshold_db:
        diff = envelope - threshold_db
        expansion_db = diff * (ratio - 1)
    else:
        expansion_db = 0

    target_gain = db_to_gain(expansion_db)
    gain = target_gain + release_coef * (gain - target_gain)

    return input * gain
```

## Implementation Notes

### Parameters Guide

| Parameter | Range | Default | Purpose |
|-----------|-------|---------|---------|
| Threshold | -80 to 0 dB | -40 dB | Level to begin expansion |
| Ratio | 1:1 to 1:20 | 1:2 | Expansion amount |
| Attack | 0.1 to 100 ms | 5 ms | Expansion onset speed |
| Release | 10 to 5000 ms | 100 ms | Recovery speed |
| Knee | 0 to 24 dB | 6 dB | Transition smoothness |
| Range | -80 to 0 dB | -40 dB | Maximum expansion |

### Expander vs Gate

| Feature | Expander | Gate |
|---------|----------|------|
| Ratio control | Yes (smooth) | No (binary) |
| Knee control | Yes | Hysteresis |
| Sound | Natural | Abrupt |
| Use case | General noise reduction | Drums, cleanup |

### Typical Settings

| Application | Threshold | Ratio | Attack | Release |
|-------------|-----------|-------|--------|---------|
| Noise reduction | -50dB | 1:2 | 10ms | 200ms |
| Transient shaping | -30dB | 1:4 | 2ms | 50ms |
| Vocal cleanup | -40dB | 1:3 | 5ms | 150ms |
| Drum gating | -35dB | 1:8 | 0.5ms | 100ms |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::log10()` and `powf()` for dB conversion
- Use `enum` for detection modes
- Consider `#[inline]` on process function

**C++ (JUCE/iPlug2):**
- JUCE: Use `dsp::Compressor` with ratio < 1 for expansion
- Use `std::log10` from `<cmath>`
- Consider SIMD for stereo processing

**Key Considerations:**
- Lower ratio = gentler expansion, higher = more aggressive
- Use soft knee for transparent noise reduction
- Range parameter prevents infinite attenuation
- RMS detection is smoother, peak is more responsive
- Stereo linking prevents image shift
