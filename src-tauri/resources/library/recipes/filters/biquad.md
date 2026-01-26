---
name: Biquad Filter
description: Standard biquad filter implementation based on RBJ Audio EQ Cookbook. Supports low-pass, high-pass, band-pass, notch, peak, and shelf filters.
tags: [filter, eq, biquad, public-domain, rbj]
source: RBJ Audio EQ Cookbook
license: Public Domain
---

# Biquad Filter Algorithm

Based on Robert Bristow-Johnson's Audio EQ Cookbook (Public Domain).

## Source Attribution

- **Source**: RBJ Audio EQ Cookbook
- **License**: Public Domain (no attribution required)
- **URL**: https://www.w3.org/2011/audio/audio-eq-cookbook.html

## Algorithm Description

The biquad filter is a second-order IIR filter with the transfer function:

```
H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
```

### Filter Types

| Type | Use Case |
|------|----------|
| Low-pass | Remove high frequencies |
| High-pass | Remove low frequencies |
| Band-pass | Isolate a frequency band |
| Notch | Remove a specific frequency |
| All-pass | Phase shift without amplitude change |
| Peaking EQ | Boost/cut a frequency band |
| Low-shelf | Boost/cut below a frequency |
| High-shelf | Boost/cut above a frequency |

## Coefficient Calculation (Pseudocode)

```
FUNCTION calculate_coefficients(filter_type, freq_hz, sample_rate, Q, gain_db):
    omega = 2 * PI * freq_hz / sample_rate
    sin_omega = sin(omega)
    cos_omega = cos(omega)
    alpha = sin_omega / (2 * Q)
    A = sqrt(10^(gain_db/20))  // Linear amplitude from dB

    SWITCH filter_type:
        CASE low_pass:
            b0 = (1 - cos_omega) / 2
            b1 = 1 - cos_omega
            b2 = (1 - cos_omega) / 2
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        CASE high_pass:
            b0 = (1 + cos_omega) / 2
            b1 = -(1 + cos_omega)
            b2 = (1 + cos_omega) / 2
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        CASE band_pass:
            b0 = sin_omega / 2  // or alpha for constant peak gain
            b1 = 0
            b2 = -sin_omega / 2
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        CASE notch:
            b0 = 1
            b1 = -2 * cos_omega
            b2 = 1
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        CASE all_pass:
            b0 = 1 - alpha
            b1 = -2 * cos_omega
            b2 = 1 + alpha
            a0 = 1 + alpha
            a1 = -2 * cos_omega
            a2 = 1 - alpha

        CASE peaking_eq:
            b0 = 1 + alpha * A
            b1 = -2 * cos_omega
            b2 = 1 - alpha * A
            a0 = 1 + alpha / A
            a1 = -2 * cos_omega
            a2 = 1 - alpha / A

        CASE low_shelf:
            sqrt_A = sqrt(A)
            b0 = A * ((A + 1) - (A - 1) * cos_omega + 2 * sqrt_A * alpha)
            b1 = 2 * A * ((A - 1) - (A + 1) * cos_omega)
            b2 = A * ((A + 1) - (A - 1) * cos_omega - 2 * sqrt_A * alpha)
            a0 = (A + 1) + (A - 1) * cos_omega + 2 * sqrt_A * alpha
            a1 = -2 * ((A - 1) + (A + 1) * cos_omega)
            a2 = (A + 1) + (A - 1) * cos_omega - 2 * sqrt_A * alpha

        CASE high_shelf:
            sqrt_A = sqrt(A)
            b0 = A * ((A + 1) + (A - 1) * cos_omega + 2 * sqrt_A * alpha)
            b1 = -2 * A * ((A - 1) + (A + 1) * cos_omega)
            b2 = A * ((A + 1) + (A - 1) * cos_omega - 2 * sqrt_A * alpha)
            a0 = (A + 1) - (A - 1) * cos_omega + 2 * sqrt_A * alpha
            a1 = 2 * ((A - 1) - (A + 1) * cos_omega)
            a2 = (A + 1) - (A - 1) * cos_omega - 2 * sqrt_A * alpha

    // Normalize coefficients by a0
    RETURN (b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
```

## Processing (Direct Form II Transposed)

```
STRUCT BiquadState:
    z1 = 0  // Delay element 1
    z2 = 0  // Delay element 2
    b0, b1, b2, a1, a2  // Coefficients

FUNCTION process(state, input):
    output = b0 * input + z1
    z1 = b1 * input - a1 * output + z2
    z2 = b2 * input - a2 * output

    // Safety: protect against NaN/Inf
    IF NOT is_finite(output):
        z1 = 0
        z2 = 0
        RETURN 0

    RETURN output

FUNCTION reset(state):
    z1 = 0
    z2 = 0
```

## Implementation Notes

### Q Values
- Q = 0.707 (1/sqrt(2)): Butterworth response (maximally flat passband)
- Higher Q: Narrower bandwidth, sharper resonance
- For shelves: Q controls transition slope (0.707 is typical)

### Safety
- Always check output for NaN/Inf (can occur with extreme parameters)
- Reset state when changing sample rate
- Reset state when filter type changes dramatically

### Typical Parameter Ranges
- Frequency: 20 Hz to Nyquist (sample_rate / 2)
- Q: 0.1 to 10 (0.707 default)
- Gain: -24 dB to +24 dB for peaking/shelf

## Adapt to Your Framework

When implementing, use your framework's conventions:
- **Rust/nih-plug**: Use `f32` or `f64`, `#[inline]` for process function
- **C++/JUCE**: Use `float` or `double`, consider SIMD with juce::dsp
- **C++/iPlug2**: Use `sample` type, integrate with IPlugProcessor

Consult your framework's filter skill for complete implementation patterns.
