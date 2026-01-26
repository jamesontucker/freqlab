---
name: PolyBLEP Oscillator
description: Anti-aliased oscillator using polynomial band-limited step (PolyBLEP). Efficient real-time alias reduction without wavetables.
tags: [oscillator, polyblep, anti-aliasing, synth, efficient]
source: Valimaki & Huovilainen (2007), community refinements
license: Public Domain
---

# PolyBLEP Oscillator

Efficient anti-aliased oscillator using polynomial band-limited step correction.

## Source Attribution

```
// PolyBLEP technique - Public Domain
// Original concept: Valimaki & Huovilainen (2007)
// Widely documented on musicdsp.org and KVR
// No attribution required
```

## Algorithm Description

PolyBLEP (Polynomial Band-Limited Step) reduces aliasing in waveforms with discontinuities (saw, square, pulse) by applying a polynomial correction near the discontinuity points.

### The Problem

Naive digital waveforms (e.g., `output = 2 * phase - 1` for sawtooth) create harsh aliasing because the instantaneous jump creates infinite frequency content.

### The Solution

PolyBLEP smooths the discontinuity using a polynomial approximation of the ideal band-limited step function, computed in the time domain.

### Mathematics

**PolyBLEP Correction Function:**
```
// t = normalized position relative to discontinuity
// dt = phase increment per sample

polyblep(t, dt):
    if t < dt:
        // Just after discontinuity
        t_norm = t / dt
        return 2*t_norm - t_norm² - 1
    else if t > (1 - dt):
        // Just before discontinuity
        t_norm = (t - 1) / dt
        return t_norm² + 2*t_norm + 1
    else:
        return 0
```

## Pseudocode

### PolyBLEP Correction

```
function polyblep(t, dt) -> float:
    // t: current phase (0 to 1)
    // dt: phase increment per sample

    if t < dt:
        // Sample is just AFTER the discontinuity
        t_norm = t / dt
        return 2 * t_norm - t_norm * t_norm - 1

    else if t > (1 - dt):
        // Sample is just BEFORE the discontinuity
        t_norm = (t - 1) / dt
        return t_norm * t_norm + 2 * t_norm + 1

    else:
        return 0
```

### Sawtooth Oscillator

```
struct BlepSaw:
    phase: float = 0
    phase_inc: float          // frequency / sampleRate
    sampleRate: float

function set_frequency(freq):
    phase_inc = clamp(freq / sampleRate, 0, 0.5)

function reset():
    phase = 0

function next() -> float:
    // Naive sawtooth: rises from -1 to +1
    output = 2 * phase - 1

    // Apply PolyBLEP correction at the wrap point
    output -= polyblep(phase, phase_inc)

    // Advance phase
    phase += phase_inc
    if phase >= 1:
        phase -= 1

    return output
```

### Square/Pulse Oscillator

```
struct BlepSquare:
    phase: float = 0
    phase_inc: float
    pulse_width: float = 0.5  // 0.5 = square, other = pulse
    sampleRate: float

function set_frequency(freq):
    phase_inc = clamp(freq / sampleRate, 0, 0.5)

function set_pulse_width(pw):
    pulse_width = clamp(pw, 0.01, 0.99)

function reset():
    phase = 0

function next() -> float:
    // Naive square/pulse wave
    if phase < pulse_width:
        output = 1
    else:
        output = -1

    // Apply PolyBLEP at BOTH edges
    // Rising edge at phase = 0
    output += polyblep(phase, phase_inc)

    // Falling edge at phase = pulse_width
    edge_phase = (phase - pulse_width + 1) mod 1
    output -= polyblep(edge_phase, phase_inc)

    // Advance phase
    phase += phase_inc
    if phase >= 1:
        phase -= 1

    return output
```

### Triangle Oscillator (Integrated Square)

```
struct BlepTriangle:
    square: BlepSquare
    integrator: float = 0

function set_frequency(freq):
    square.set_frequency(freq)

function reset():
    square.reset()
    integrator = 0

function next() -> float:
    // Get square wave
    sq = square.next()

    // Leaky integration creates triangle
    // Scale factor depends on frequency
    scale = 4 * square.phase_inc
    integrator = integrator * 0.9999 + sq * scale

    return clamp(integrator, -1, 1)
```

### Multi-Waveform Oscillator

```
enum Waveform:
    Sine
    Saw
    Square
    Triangle
    Pulse

struct PolyBlepOsc:
    phase: float = 0
    phase_inc: float
    pulse_width: float = 0.5
    waveform: Waveform = Saw
    sampleRate: float
    tri_integrator: float = 0

function set_waveform(wf):
    waveform = wf

function set_frequency(freq):
    phase_inc = clamp(freq / sampleRate, 0, 0.5)

function next() -> float:
    switch waveform:
        Sine:
            output = sin(phase * 2π)

        Saw:
            output = 2 * phase - 1
            output -= polyblep(phase, phase_inc)

        Square:
            output = phase < 0.5 ? 1 : -1
            output += polyblep(phase, phase_inc)
            output -= polyblep((phase + 0.5) mod 1, phase_inc)

        Pulse:
            output = phase < pulse_width ? 1 : -1
            output += polyblep(phase, phase_inc)
            output -= polyblep((phase - pulse_width + 1) mod 1, phase_inc)

        Triangle:
            sq = phase < 0.5 ? 1 : -1
            tri_integrator += sq * 4 * phase_inc
            tri_integrator = clamp(tri_integrator, -1, 1)
            output = tri_integrator

    // Advance phase
    phase += phase_inc
    if phase >= 1:
        phase -= 1

    return output
```

## Implementation Notes

### PolyBLEP vs Wavetable Comparison

| Aspect | PolyBLEP | Wavetable |
|--------|----------|-----------|
| Memory | Minimal | Pre-computed tables (KB-MB) |
| CPU | Per-sample math | Table lookup + interpolation |
| Quality | Good | Excellent (with enough tables) |
| PWM | Native support | Needs morphing or multiple tables |
| Custom waves | No | Yes |
| Frequency range | Good | Needs mipmap tables for quality |

### When to Use PolyBLEP

- Basic waveforms (saw, square, pulse, triangle)
- Memory-constrained environments
- Pulse width modulation (PWM)
- Subtractive synthesis with basic oscillators

### When to Use Wavetables

- Custom waveforms
- Wavetable synthesis (morphing between waves)
- Very high quality requirements
- When memory is not a constraint

### Quality Considerations

- PolyBLEP quality degrades slightly at very high frequencies (near Nyquist)
- For very high quality, use wavetables with multiple mipmap levels
- For most musical purposes, PolyBLEP is indistinguishable from ideal

### Phase Increment Limits

- Maximum `phase_inc` = 0.5 (Nyquist frequency)
- At higher frequencies, aliasing becomes unavoidable
- Consider frequency limiting or octave foldback for extreme ranges

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `std::f32::consts::TAU` (2π) for sine calculation
- `phase.fract()` can replace manual wrap (but explicit wrap is often faster)
- Consider `#[inline]` for per-sample functions

**C++ (JUCE/iPlug2):**
- Use `std::sin` and `M_PI` or `juce::MathConstants<float>::twoPi`
- JUCE has `dsp::Oscillator` but it's wavetable-based
- Consider SIMD for multiple voices

**Key Considerations:**
- Always clamp phase_inc to prevent aliasing at extreme frequencies
- Reset phase and integrator state when voice starts
- For FM synthesis, PolyBLEP helps but phase modulation still aliases
