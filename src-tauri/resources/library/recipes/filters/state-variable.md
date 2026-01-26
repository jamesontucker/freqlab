---
name: State Variable Filter
description: TPT (Topology-Preserving Transform) State Variable Filter based on Cytomic technical papers. Modulation-friendly with simultaneous LP/HP/BP/Notch outputs.
tags: [filter, svf, zdf, public-domain, cytomic, resonant]
source: Cytomic Technical Papers
license: Public Domain
attribution: Andy Simper / Cytomic (optional but appreciated)
---

# State Variable Filter (SVF)

Based on Andy Simper's Cytomic Technical Papers (Public Domain).

## Source Attribution

```
// Cytomic Technical Papers - Public Domain
// https://cytomic.com/technical-papers/
// Original design by Andy Simper
// No attribution required - use freely
```

## Algorithm Description

The TPT (Topology-Preserving Transform) State Variable Filter is the modern standard for audio filters. It provides:

- **Simultaneous outputs**: Low-pass, high-pass, band-pass, and notch from one computation
- **Modulation-friendly**: Safe to update coefficients every sample
- **Numerically stable**: Better behavior at high frequencies than Direct Form filters
- **Intuitive controls**: Direct frequency and resonance parameters

### Mathematics

**Transfer Functions:**
```
Low-pass:   H_LP(s) = 1 / (s² + s/Q + 1)
High-pass:  H_HP(s) = s² / (s² + s/Q + 1)
Band-pass:  H_BP(s) = s/Q / (s² + s/Q + 1)
Notch:      H_N(s) = (s² + 1) / (s² + s/Q + 1)
```

**Coefficient Calculation:**
```
g = tan(π * freq / sampleRate)    // Pre-warped frequency
k = 1 / Q                          // Damping (k = 2 - 2*resonance for 0-1 range)

// TPT coefficients
a1 = 1 / (1 + g * (g + k))
a2 = g * a1
a3 = g * a2
```

## Pseudocode

### State Variable Filter

```
struct StateVariableFilter:
    // State variables
    ic1eq: float = 0    // Integrator 1 state
    ic2eq: float = 0    // Integrator 2 state

    // Coefficients
    g: float = 0        // Frequency coefficient
    k: float = 2        // Damping coefficient (1/Q)
    a1: float = 0
    a2: float = 0
    a3: float = 0

struct SvfOutput:
    low: float
    high: float
    band: float
    notch: float

function set_params(freq, resonance, sampleRate):
    // Clamp frequency to valid range (below Nyquist)
    freq = clamp(freq, 20, sampleRate * 0.49)
    resonance = clamp(resonance, 0, 1)

    // Pre-warp the frequency for accurate digital response
    g = tan(π * freq / sampleRate)

    // Resonance to damping conversion
    // resonance=0 -> k=2 (heavily damped, Q=0.5)
    // resonance=1 -> k=0 (self-oscillation)
    k = 2.0 - 2.0 * resonance

    // Compute TPT coefficients
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2

function reset():
    ic1eq = 0
    ic2eq = 0

function process(input) -> SvfOutput:
    // TPT SVF tick
    v3 = input - ic2eq
    v1 = a1 * ic1eq + a2 * v3
    v2 = ic2eq + a2 * ic1eq + a3 * v3

    // Update state
    ic1eq = 2 * v1 - ic1eq
    ic2eq = 2 * v2 - ic2eq

    // Protect against NaN/Inf
    if not is_finite(ic1eq) or not is_finite(ic2eq):
        reset()
        return SvfOutput(0, 0, 0, 0)

    // Compute all outputs simultaneously
    return SvfOutput(
        low:   v2,
        band:  v1,
        high:  input - k * v1 - v2,
        notch: input - k * v1
    )

function process_lowpass(input) -> float:
    return process(input).low

function process_highpass(input) -> float:
    return process(input).high

function process_bandpass(input) -> float:
    return process(input).band

function process_notch(input) -> float:
    return process(input).notch
```

### Mode-Selectable Wrapper

```
enum SvfMode:
    LowPass
    HighPass
    BandPass
    Notch

struct Svf:
    filter: StateVariableFilter
    mode: SvfMode

function set_mode(new_mode):
    mode = new_mode

function process(input) -> float:
    output = filter.process(input)

    switch mode:
        LowPass:  return output.low
        HighPass: return output.high
        BandPass: return output.band
        Notch:    return output.notch
```

## Implementation Notes

### Advantages Over Biquad

| Aspect | SVF (TPT) | Biquad (Direct Form) |
|--------|-----------|---------------------|
| Modulation | Safe per-sample | Can cause artifacts |
| Stability | Better at high freq | Can become unstable |
| Outputs | 4 simultaneous | 1 at a time |
| Coefficient calc | Intuitive (freq, Q) | Complex (many coefficients) |
| CPU | Slightly more | Slightly less |

### Resonance Behavior

| Resonance | k Value | Q Value | Character |
|-----------|---------|---------|-----------|
| 0.0 | 2.0 | 0.5 | Heavily damped, no peak |
| 0.5 | 1.0 | 1.0 | Moderate resonance |
| 0.7 | 0.6 | ~1.7 | Noticeable peak |
| 0.9 | 0.2 | 5.0 | Strong resonance |
| 1.0 | 0.0 | ∞ | Self-oscillation |

### When to Use

- **Always**: When automating filter cutoff (unlike biquad, no zipper noise)
- **Synths**: Standard filter for subtractive synthesis
- **EQ**: When you need smooth parameter changes
- **Multi-mode**: When you need multiple filter types from one structure

### Peak Gain and Normalization

Band-pass output is normalized to unity gain at the center frequency. For matched peak gain across modes, you may need to scale the band-pass output by Q.

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32` for standard audio, `f64` for very high precision needs
- Use `std::f32::consts::PI` for π
- Consider `#[inline]` on the process function

**C++ (JUCE/iPlug2):**
- JUCE has `dsp::StateVariableTPTFilter` built-in
- For custom implementation, use `std::tan` from `<cmath>`
- Consider template for float/double flexibility

**Key Considerations:**
- Update coefficients at control rate (every 32-64 samples) for efficiency
- Or update per-sample if you need aggressive modulation
- Always clamp frequency below Nyquist (sampleRate * 0.49)
- Reset state when switching presets or sample rate changes
