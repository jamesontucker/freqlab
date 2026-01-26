---
name: Tremolo & Ring Mod
description: Amplitude modulation effects including tremolo, ring modulation, and auto-pan. LFO-driven volume variations for classic vintage effects.
tags: [tremolo, ring-mod, modulation, lfo, effect, vintage]
source: Classic analog effect designs
license: Public Domain
---

# Tremolo & Ring Modulation

Amplitude modulation effects with various LFO shapes.

## Source Attribution

```
// Classic amplitude modulation effects - Public Domain
// Standard effect design techniques
// No attribution required
```

## Algorithm Description

Tremolo and ring modulation are both amplitude modulation effects:
- **Tremolo**: LFO modulates volume at sub-audio rates (0.1-20Hz)
- **Ring Mod**: Carrier multiplies signal at audio rates (creates sidebands)
- **Auto-Pan**: Stereo tremolo with channel phase offset

### Tremolo vs Ring Mod

| Effect | Rate | Result |
|--------|------|--------|
| Tremolo | 0.1-20 Hz | Rhythmic volume pulsing |
| Ring Mod | 20-5000 Hz | Metallic, inharmonic sidebands |

## Pseudocode

### LFO (Low Frequency Oscillator)

```
enum LfoShape:
    Sine
    Triangle
    Square
    SawUp
    SawDown

struct Lfo:
    phase: float = 0
    frequency: float = 4        // 4 Hz default
    sampleRate: float
    shape: LfoShape = Sine

function new(sampleRate):
    // Defaults set above

function set_frequency(freq):
    frequency = clamp(freq, 0.01, 20)

function set_shape(shape):
    this.shape = shape

function reset():
    phase = 0

function sync(new_phase):
    phase = fract(new_phase)    // 0-1

function next() -> float:
    // Returns -1 to +1

    switch shape:
        Sine:
            value = sin(phase * 2π)

        Triangle:
            if phase < 0.25:
                value = phase * 4
            else if phase < 0.75:
                value = 2 - phase * 4
            else:
                value = phase * 4 - 4

        Square:
            value = 1 if phase < 0.5 else -1

        SawUp:
            value = phase * 2 - 1

        SawDown:
            value = 1 - phase * 2

    // Advance phase
    phase += frequency / sampleRate
    if phase >= 1:
        phase -= 1

    return value

function next_unipolar() -> float:
    // Returns 0 to 1
    return (next() + 1) * 0.5
```

### Tremolo

```
struct Tremolo:
    lfo: Lfo
    depth: float = 0.5      // 0-1, how much volume varies
    bias: float = 0         // DC offset for asymmetric tremolo

function new(sampleRate):
    lfo = Lfo.new(sampleRate)

function set_rate(hz):
    lfo.set_frequency(hz)

function set_depth(depth):
    this.depth = clamp(depth, 0, 1)

function set_shape(shape):
    lfo.set_shape(shape)

function set_bias(bias):
    this.bias = clamp(bias, -1, 1)

function reset():
    lfo.reset()

function process(input) -> float:
    mod_value = lfo.next()

    // Modulate amplitude around 1.0
    // depth=0: no modulation
    // depth=1: full 0-2x modulation
    gain = 1 + (mod_value + bias) * depth

    return input * max(gain, 0)
```

### Ring Modulator

```
struct RingModulator:
    lfo: Lfo
    mix: float = 1          // Dry/wet mix

function new(sampleRate):
    lfo = Lfo.new(sampleRate)
    lfo.set_frequency(440)  // Audio-rate default

function set_frequency(hz):
    // Ring mod can go to audio rates
    lfo.frequency = clamp(hz, 0.1, 5000)

function set_shape(shape):
    lfo.set_shape(shape)

function set_mix(mix):
    this.mix = clamp(mix, 0, 1)

function reset():
    lfo.reset()

function process(input) -> float:
    carrier = lfo.next()
    ring = input * carrier

    // Mix dry and wet
    return input * (1 - mix) + ring * mix

function process_with_carrier(input, carrier) -> float:
    // Use external carrier signal
    ring = input * carrier
    return input * (1 - mix) + ring * mix
```

### Auto-Pan (Stereo Tremolo)

```
struct AutoPan:
    lfo: Lfo
    depth: float = 0.5
    width: float = 1        // Stereo width (0 = mono, 1 = full pan)

function new(sampleRate):
    lfo = Lfo.new(sampleRate)

function set_rate(hz):
    lfo.set_frequency(hz)

function set_depth(depth):
    this.depth = clamp(depth, 0, 1)

function set_width(width):
    this.width = clamp(width, 0, 1)

function set_shape(shape):
    lfo.set_shape(shape)

function reset():
    lfo.reset()

function process_stereo(left, right) -> (float, float):
    mod_value = lfo.next()

    // Convert LFO to pan position (-1 to 1)
    pan = mod_value * depth * width

    // Constant power panning
    angle = (pan + 1) * 0.25 * π
    left_gain = cos(angle)
    right_gain = sin(angle)

    // Mix mono sum with panned signal
    mono = (left + right) * 0.5
    panned_left = mono * left_gain
    panned_right = mono * right_gain

    // Blend based on depth
    out_left = left * (1 - depth) + panned_left * depth
    out_right = right * (1 - depth) + panned_right * depth

    return (out_left, out_right)

function process_mono_to_stereo(input) -> (float, float):
    return process_stereo(input, input)
```

### Harmonic Tremolo (Fender-Style)

```
struct HarmonicTremolo:
    lfo: Lfo
    depth: float = 0.5
    // Simple crossover state
    lp_z1: float = 0
    crossover_freq: float = 800
    sampleRate: float

function new(sampleRate):
    lfo = Lfo.new(sampleRate)
    this.sampleRate = sampleRate

function set_rate(hz):
    lfo.set_frequency(hz)

function set_depth(depth):
    this.depth = clamp(depth, 0, 1)

function set_crossover(freq):
    crossover_freq = clamp(freq, 100, 4000)

function reset():
    lfo.reset()
    lp_z1 = 0

function process(input) -> float:
    // Simple one-pole crossover
    omega = 2π * crossover_freq / sampleRate
    coef = exp(-omega)

    // Low-pass
    lp_z1 = input * (1 - coef) + lp_z1 * coef
    low = lp_z1

    // High-pass (complement)
    high = input - low

    // Get LFO and its inverse (180° out of phase)
    mod_val = lfo.next()
    low_gain = 1 + mod_val * depth
    high_gain = 1 - mod_val * depth    // Inverted

    return low * max(low_gain, 0) + high * max(high_gain, 0)
```

## Implementation Notes

### Parameters Guide

| Parameter | Tremolo | Ring Mod | Auto-Pan |
|-----------|---------|----------|----------|
| Rate | 0.1-20 Hz | 0.1-5000 Hz | 0.1-10 Hz |
| Depth | 0-100% | N/A | 0-100% |
| Mix | N/A | 0-100% | N/A |
| Width | N/A | N/A | 0-100% |
| Shape | All | Sine usually | All |

### LFO Shape Character

| Shape | Sound | Best For |
|-------|-------|----------|
| Sine | Smooth, natural | General use |
| Triangle | Slightly sharper | Subtle variation |
| Square | Choppy, rhythmic | Trance gates |
| Saw Up | Building tension | Risers |
| Saw Down | Releasing tension | Drops |

### Typical Settings

| Effect | Rate | Depth | Notes |
|--------|------|-------|-------|
| Subtle tremolo | 3-5 Hz | 20-40% | Gentle movement |
| Vintage amp | 5-8 Hz | 50-70% | Classic Fender |
| Trance gate | 4-16 Hz | 100% | Square wave |
| Slow auto-pan | 0.2-1 Hz | 50% | Ambient movement |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::sin()` for sine LFO
- Use `std::f32::consts::PI` for π
- Consider `#[inline]` on process functions

**C++ (JUCE/iPlug2):**
- JUCE: Consider `dsp::Oscillator` for LFO
- Use `std::sin` from `<cmath>`
- JUCE `dsp::Panner` for stereo panning

**Key Considerations:**
- Sync LFOs to tempo for rhythmic effects
- Use constant-power panning for smooth auto-pan
- Harmonic tremolo creates unique vintage character
- Ring mod at audio rates creates inharmonic sidebands
