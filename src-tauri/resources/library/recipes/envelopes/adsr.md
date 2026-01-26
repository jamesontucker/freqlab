---
name: ADSR Envelope
description: Standard Attack-Decay-Sustain-Release envelope generator with exponential curves for natural-sounding dynamics. Essential for synth instruments.
tags: [envelope, adsr, synth, instrument, modulation]
source: Classic synthesizer design
license: Public Domain
---

# ADSR Envelope

Standard ADSR envelope generator with exponential curves for natural-sounding dynamics.

## Source Attribution

```
// Classic synthesizer envelope design - Public Domain
// Exponential curve technique from analog synthesizer emulation
// No attribution required
```

## Algorithm Description

The ADSR envelope is the standard amplitude contour for synthesizers:

- **Attack**: Time to rise from 0 to peak (1.0)
- **Decay**: Time to fall from peak to sustain level
- **Sustain**: Level held while note is held (0.0 to 1.0)
- **Release**: Time to fall from sustain to 0 after note-off

### Exponential Curves

Linear envelopes sound unnatural. Exponential curves match human perception:

```
// Exponential approach to target
next_value = base + current_value * coefficient

where:
  coefficient = exp(-ln((1 + curve) / curve) / samples)
  base = target_value * (1 - coefficient)
```

The `curve` parameter (typically 0.0001) controls exponential steepness:
- Small curve (0.0001) = Very exponential (natural)
- Large curve (1.0) = Nearly linear

## Pseudocode

### Envelope Stages

```
enum EnvelopeStage:
    Idle        // Envelope inactive, output = 0
    Attack      // Rising to peak
    Decay       // Falling to sustain
    Sustain     // Holding at sustain level
    Release     // Falling to zero
```

### ADSR Envelope Generator

```
struct Adsr:
    stage: EnvelopeStage = Idle
    value: float = 0
    sampleRate: float

    // Time parameters (seconds)
    attack_time: float = 0.01
    decay_time: float = 0.1
    sustain_level: float = 0.7
    release_time: float = 0.3

    // Precomputed coefficients
    attack_coef: float
    attack_base: float
    decay_coef: float
    decay_base: float
    release_coef: float
    release_base: float

    // Curve control (0.0001 = exponential, 1.0 = linear)
    curve: float = 0.0001

function calc_coefficient(samples, curve) -> float:
    if samples <= 0:
        return 0
    return exp(-ln((1 + curve) / curve) / samples)

function recalculate_coefficients():
    // Attack: from 0 to 1
    attack_samples = attack_time * sampleRate
    attack_coef = calc_coefficient(attack_samples, curve)
    attack_base = (1.0 + curve) * (1.0 - attack_coef)

    // Decay: from 1 to sustain
    decay_samples = decay_time * sampleRate
    decay_coef = calc_coefficient(decay_samples, curve)
    decay_base = (sustain_level - curve) * (1.0 - decay_coef)

    // Release: from current to 0
    release_samples = release_time * sampleRate
    release_coef = calc_coefficient(release_samples, curve)
    release_base = -curve * (1.0 - release_coef)

function set_params(attack, decay, sustain, release):
    attack_time = max(attack, 0.001)    // Minimum 1ms
    decay_time = max(decay, 0.001)
    sustain_level = clamp(sustain, 0, 1)
    release_time = max(release, 0.001)
    recalculate_coefficients()

function set_sample_rate(sr):
    sampleRate = sr
    recalculate_coefficients()

function trigger():
    // Called on note-on
    stage = Attack

function release():
    // Called on note-off
    if stage != Idle:
        stage = Release

function reset():
    stage = Idle
    value = 0

function is_active() -> bool:
    return stage != Idle

function next() -> float:
    switch stage:
        Idle:
            value = 0

        Attack:
            value = attack_base + value * attack_coef
            if value >= 1.0:
                value = 1.0
                stage = Decay

        Decay:
            value = decay_base + value * decay_coef
            if value <= sustain_level:
                value = sustain_level
                stage = Sustain

        Sustain:
            value = sustain_level

        Release:
            value = release_base + value * release_coef
            if value <= 0.0001:    // Small threshold for smooth fade
                value = 0
                stage = Idle

    return value
```

### Simple AR Envelope (Attack-Release Only)

```
struct ArEnvelope:
    stage: enum { Idle, Attack, Release }
    value: float = 0
    attack_coef: float
    attack_base: float
    release_coef: float
    release_base: float

function set_params(attack_time, release_time, sampleRate):
    // Similar coefficient calculation as ADSR
    attack_samples = attack_time * sampleRate
    release_samples = release_time * sampleRate
    curve = 0.0001

    attack_coef = calc_coefficient(attack_samples, curve)
    attack_base = (1 + curve) * (1 - attack_coef)

    release_coef = calc_coefficient(release_samples, curve)
    release_base = -curve * (1 - release_coef)

function trigger():
    stage = Attack

function release():
    if stage != Idle:
        stage = Release

function next() -> float:
    switch stage:
        Idle:
            return 0
        Attack:
            value = attack_base + value * attack_coef
            if value >= 1.0:
                value = 1.0
                stage = Release  // Auto-release for one-shot
            return value
        Release:
            value = release_base + value * release_coef
            if value <= 0.0001:
                value = 0
                stage = Idle
            return value
```

## Implementation Notes

### Typical ADSR Values

| Sound Type | Attack | Decay | Sustain | Release |
|------------|--------|-------|---------|---------|
| Pluck/Keys | 1-5ms | 50-200ms | 0-30% | 100-300ms |
| Pad/String | 200-500ms | 500ms-2s | 70-100% | 500ms-2s |
| Brass/Lead | 10-50ms | 100-300ms | 50-80% | 100-300ms |
| Percussion | <1ms | 50-200ms | 0% | 50-100ms |

### Curve Parameter

| Curve Value | Character | Use Case |
|-------------|-----------|----------|
| 0.0001 | Very exponential | Natural decay, most musical |
| 0.001 | Exponential | Good default |
| 0.01 | Mild curve | Slightly linear feel |
| 0.1 | Almost linear | Mechanical/synthetic |
| 1.0 | Linear | Ramps, LFO-like |

### Voice Stealing

Use `is_active()` to determine if a voice can be reused:
- When envelope reaches Idle, voice is free
- Or implement voice stealing when all voices are active

### Re-triggering Behavior

When a note is triggered while envelope is active:
- **Hard retrigger**: Reset value to 0, start Attack
- **Soft retrigger**: Start Attack from current value (no click)

The pseudocode above uses soft retrigger (Attack starts from current value).

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::exp()` and `f32::ln()` for coefficient calculation
- Consider using `#[derive(Clone, Copy)]` for embedding in voice struct
- nih-plug has built-in `Smoother` but not full ADSR

**C++ (JUCE/iPlug2):**
- JUCE provides `ADSR` class in `juce_audio_basics`
- For custom: use `std::exp` and `std::log` from `<cmath>`
- Consider template class for different float types

**Key Considerations:**
- Always recalculate coefficients when sample rate changes
- Minimum time of ~1ms prevents clicks
- Use `is_active()` check to skip processing inactive voices
- Consider per-voice vs global envelope (modulation vs amplitude)
