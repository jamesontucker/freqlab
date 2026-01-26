---
name: Saturation & Distortion
description: Waveshaping, soft clipping, and saturation algorithms for warmth and harmonics. Includes tape-style saturation, tube emulation curves, and basic distortion.
tags: [saturation, distortion, waveshaping, warmth, harmonics, effect]
source: Classic analog emulation techniques
license: Public Domain
---

# Saturation & Distortion

Waveshaping curves for adding harmonics and warmth.

## Source Attribution

```
// Classic waveshaping techniques - Public Domain
// Tanh, cubic, and asymmetric clipping curves
// No attribution required
```

## Algorithm Description

Saturation/distortion works by applying a nonlinear transfer function to the signal. This creates harmonic content:

- **Symmetric clipping** (same curve for + and -): Odd harmonics (3rd, 5th, 7th...)
- **Asymmetric clipping** (different curves): Even + odd harmonics (warmer, more "analog")

### Common Transfer Functions

| Function | Character | Harmonics |
|----------|-----------|-----------|
| tanh(x) | Smooth, natural | Mostly odd |
| sin(x) | Warm, round | Even |
| x - x³/3 | Subtle, musical | Odd |
| Hard clip | Harsh, buzzy | Many |
| Asymmetric | Tube-like | Even + odd |

## Pseudocode

### Basic Waveshaping Functions

```
function soft_clip_tanh(x, drive) -> float:
    // Smooth, natural saturation
    return tanh(x * drive)

function fast_tanh(x) -> float:
    // Approximation (cheaper than std::tanh)
    x2 = x * x
    return x * (27 + x2) / (27 + 9 * x2)

function soft_clip_fast(x, drive) -> float:
    return fast_tanh(x * drive)

function hard_clip(x, threshold) -> float:
    // Digital distortion
    return clamp(x, -threshold, threshold)

function soft_clip_cubic(x) -> float:
    // Subtle, low-order harmonics
    if x > 1:
        return 2/3
    else if x < -1:
        return -2/3
    else:
        return x - x*x*x / 3

function sine_shaper(x, amount) -> float:
    // Warm, even harmonics
    wet = sin(x * π * 0.5)
    return x * (1 - amount) + wet * amount

function asymmetric_clip(x, positive_drive, negative_drive) -> float:
    // Tube-like, adds even harmonics
    if x >= 0:
        return tanh(x * positive_drive)
    else:
        return tanh(x * negative_drive)
```

### Bit Crusher (Lo-Fi)

```
function bit_crush(x, bits) -> float:
    steps = 2^bits
    return round(x * steps) / steps
```

### Sample Rate Reducer

```
struct SampleRateReducer:
    hold: float = 0
    counter: float = 0
    ratio: float = 1

function set_ratio(r):
    ratio = max(r, 1)    // 1 = no reduction

function process(input) -> float:
    counter += 1
    if counter >= ratio:
        counter -= ratio
        hold = input
    return hold
```

### Full Saturator

```
enum SaturationMode:
    Tape        // Asymmetric, warm
    Tube        // Even harmonics, smooth
    Transistor  // Harder, odd harmonics
    Digital     // Hard clip

struct Saturator:
    drive: float = 1
    output_gain: float = 1
    mix: float = 1
    mode: SaturationMode = Tape
    dc_blocker: DcBlocker

function new(sampleRate):
    dc_blocker = DcBlocker.new(10, sampleRate)

function set_drive(d):
    drive = max(d, 0.1)

function set_drive_db(db):
    drive = db_to_gain(db)

function set_output_gain(gain):
    output_gain = gain

function set_mix(m):
    mix = clamp(m, 0, 1)

function process(input) -> float:
    driven = input * drive

    switch mode:
        Tape:
            // Asymmetric - more compression on positive
            saturated = asymmetric_clip(driven, 1.0, 0.8)

        Tube:
            // Sine waveshaping for even harmonics
            x = clamp(driven, -1.5, 1.5)
            saturated = sin(x * π / 3) * 1.05

        Transistor:
            // Symmetric tanh - odd harmonics
            saturated = soft_clip_tanh(driven, 1.0)

        Digital:
            // Hard clip
            saturated = hard_clip(driven, 1.0)

    // Apply output gain compensation
    wet = saturated * output_gain

    // Mix dry/wet
    mixed = input * (1 - mix) + wet * mix

    // DC blocking (asymmetric saturation introduces DC offset)
    output = dc_blocker.process(mixed)

    // Protect against NaN/Inf
    return output if is_finite(output) else 0
```

### Overdrive (Guitar-Style)

```
struct Overdrive:
    gain: float = 5
    tone: float = 0.5      // 0 = dark, 1 = bright
    level: float = 0.5
    lp_state: float = 0
    hp_state: float = 0
    sampleRate: float

function set_gain(g):
    gain = clamp(g, 1, 100)

function set_tone(t):
    tone = clamp(t, 0, 1)

function process(input) -> float:
    // Input boost
    boosted = input * gain

    // Asymmetric soft clip
    clipped = asymmetric_clip(boosted, 1.2, 0.9)

    // Tone control (one-pole LP/HP mix)
    lp_freq = 800 + tone * 4000    // 800-4800 Hz
    lp_coef = exp(-2π * lp_freq / sampleRate)
    lp_state = clipped * (1 - lp_coef) + lp_state * lp_coef

    // High-pass at 80 Hz to remove mud
    hp_coef = 0.995
    hp_state = lp_state - hp_state
    output = hp_state
    hp_state = lp_state * (1 - hp_coef) + hp_state * hp_coef

    return output * level
```

## Implementation Notes

### Saturation Mode Comparison

| Mode | Character | Harmonics | Best For |
|------|-----------|-----------|----------|
| Tape | Warm, smooth compression | Even + odd | Warmth, glue |
| Tube | Rich, musical | Mostly even | Vocals, bass |
| Transistor | Aggressive, edgy | Mostly odd | Guitars, drums |
| Digital | Harsh, buzzy | All | Lo-fi, special FX |

### Drive and Output Gain

Rule of thumb: Reduce output gain as drive increases to maintain similar loudness.

| Drive (dB) | Suggested Output Gain |
|------------|----------------------|
| +3 | 0.85 |
| +6 | 0.70 |
| +12 | 0.50 |
| +20 | 0.30 |

### Aliasing Considerations

Saturation creates harmonics. At high drive levels, harmonics can exceed Nyquist and alias back. Solutions:

1. **Oversampling**: Process at 2x-4x sample rate, then downsample
2. **Softer curves**: tanh aliases less than hard clip
3. **Lower drive**: Less harmonics = less aliasing

### DC Blocking

Asymmetric saturation (tape, tube) introduces DC offset. Always follow with a DC blocker.

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::tanh()` for standard tanh
- Consider the fast_tanh approximation for performance
- Use `std::f32::consts::PI` for π

**C++ (JUCE/iPlug2):**
- Use `std::tanh` from `<cmath>`
- JUCE: Consider `dsp::WaveShaper` for custom curves
- For authentic analog: see chowdsp_wdf for circuit modeling

**Key Considerations:**
- Always DC block after asymmetric saturation
- Lower drive + higher mix often sounds better than high drive
- Tape mode is most forgiving and works on almost anything
- Consider oversampling for high-drive settings (reduces aliasing)
