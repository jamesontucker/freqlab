---
name: Reverb (Freeverb)
description: Classic Schroeder reverb based on Freeverb (public domain). Simple algorithmic reverb with room size, damping, and stereo width controls.
tags: [reverb, freeverb, schroeder, public-domain, effect]
source: Freeverb by Jezar at Dreampoint
license: Public Domain
attribution: Jezar at Dreampoint (optional but appreciated)
---

# Freeverb Reverb

Classic Schroeder reverb topology, public domain implementation.

## Source Attribution

```
// Freeverb - Public Domain
// Original author: Jezar at Dreampoint
// Reference: https://ccrma.stanford.edu/~jos/pasp/Freeverb.html
// No attribution required - use freely
```

## Algorithm Description

Freeverb uses the classic Schroeder reverb topology:
- **8 parallel comb filters** with damping (create the reverb tail)
- **4 series allpass filters** (add diffusion/density)

The comb filters provide the echo density and decay, while allpass filters smear the energy to reduce flutter echoes.

### Schroeder Topology

```
Input ─┬─► Comb 1 ─┬─► Allpass 1 ─► Allpass 2 ─► Allpass 3 ─► Allpass 4 ─► Output
       ├─► Comb 2 ─┤
       ├─► Comb 3 ─┤
       ├─► Comb 4 ─┤
       ├─► Comb 5 ─┤
       ├─► Comb 6 ─┤
       ├─► Comb 7 ─┤
       └─► Comb 8 ─┘
```

## Pseudocode

### Comb Filter (with damping)

```
struct CombFilter:
    buffer: array[float]
    index: int = 0
    feedback: float = 0.5
    damp1: float = 0.5        // Damping factor
    damp2: float = 0.5        // 1 - damp1
    filterstore: float = 0    // One-pole LP state

function new(size):
    buffer = new array[size] filled with 0

function set_feedback(fb):
    feedback = fb

function set_damp(damp):
    damp1 = damp
    damp2 = 1 - damp

function clear():
    fill buffer with 0
    filterstore = 0

function process(input) -> float:
    output = buffer[index]

    // Low-pass filter in feedback path (damping)
    // Higher damp = more high-frequency absorption
    filterstore = output * damp2 + filterstore * damp1

    // Write input + filtered feedback
    buffer[index] = input + filterstore * feedback

    index = (index + 1) mod buffer.length

    return output
```

### Allpass Filter (for diffusion)

```
struct AllpassFilter:
    buffer: array[float]
    index: int = 0
    feedback: float = 0.5

function new(size):
    buffer = new array[size] filled with 0

function clear():
    fill buffer with 0

function process(input) -> float:
    bufout = buffer[index]
    output = -input + bufout

    buffer[index] = input + bufout * feedback
    index = (index + 1) mod buffer.length

    return output
```

### Freeverb

```
// Tuning constants (for 44100 Hz base)
COMB_SIZES = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
ALLPASS_SIZES = [556, 441, 341, 225]
STEREO_SPREAD = 23    // Offset for right channel

struct Freeverb:
    // Left channel
    comb_l: array[CombFilter, 8]
    allpass_l: array[AllpassFilter, 4]

    // Right channel (slightly different sizes for stereo)
    comb_r: array[CombFilter, 8]
    allpass_r: array[AllpassFilter, 4]

    // Parameters
    room_size: float = 0.5
    damping: float = 0.5
    wet: float = 0.33
    dry: float = 0.67
    width: float = 1.0

    // Derived for stereo mixing
    wet1: float
    wet2: float

function new(sampleRate):
    scale = sampleRate / 44100    // Scale buffer sizes

    // Create comb filters
    for i in 0..8:
        comb_l[i] = CombFilter.new(COMB_SIZES[i] * scale)
        comb_r[i] = CombFilter.new((COMB_SIZES[i] + STEREO_SPREAD) * scale)

    // Create allpass filters
    for i in 0..4:
        allpass_l[i] = AllpassFilter.new(ALLPASS_SIZES[i] * scale)
        allpass_l[i].feedback = 0.5
        allpass_r[i] = AllpassFilter.new((ALLPASS_SIZES[i] + STEREO_SPREAD) * scale)
        allpass_r[i].feedback = 0.5

    set_room_size(0.5)
    set_damping(0.5)
    update_wet()

function set_room_size(size):
    room_size = clamp(size, 0, 1)
    // Scale to useful feedback range (0.7 - 0.98)
    feedback = room_size * 0.28 + 0.7

    for comb in comb_l + comb_r:
        comb.set_feedback(feedback)

function set_damping(damp):
    damping = clamp(damp, 0, 1)
    damp_scaled = damping * 0.4    // Scale to reasonable range

    for comb in comb_l + comb_r:
        comb.set_damp(damp_scaled)

function set_wet(w):
    wet = clamp(w, 0, 1)
    update_wet()

function set_dry(d):
    dry = clamp(d, 0, 1)

function set_width(w):
    width = clamp(w, 0, 1)
    update_wet()

function update_wet():
    // Width affects stereo cross-mixing
    wet1 = wet * (width / 2 + 0.5)
    wet2 = wet * ((1 - width) / 2)

function reset():
    for comb in comb_l + comb_r:
        comb.clear()
    for ap in allpass_l + allpass_r:
        ap.clear()

function process(left_in, right_in) -> (float, float):
    // Mix input to mono for reverb processing
    input = (left_in + right_in) * 0.5

    // Accumulate parallel comb filters
    out_l = 0
    out_r = 0

    for comb in comb_l:
        out_l += comb.process(input)
    for comb in comb_r:
        out_r += comb.process(input)

    // Feed through series allpass filters
    for ap in allpass_l:
        out_l = ap.process(out_l)
    for ap in allpass_r:
        out_r = ap.process(out_r)

    // Mix wet (with width) and dry
    left_out = out_l * wet1 + out_r * wet2 + left_in * dry
    right_out = out_r * wet1 + out_l * wet2 + right_in * dry

    // Protect against NaN/Inf
    if not is_finite(left_out): left_out = 0
    if not is_finite(right_out): right_out = 0

    return (left_out, right_out)
```

## Implementation Notes

### Parameter Ranges

| Parameter | Range | Effect |
|-----------|-------|--------|
| Room Size | 0.0-1.0 | Larger = longer decay, more diffuse |
| Damping | 0.0-1.0 | Higher = darker, more HF absorption |
| Wet | 0.0-1.0 | Reverb level |
| Dry | 0.0-1.0 | Original signal level |
| Width | 0.0-1.0 | 0 = mono, 1 = full stereo |

### Buffer Size Tuning

The original Freeverb buffer sizes are tuned for:
- Prime-ish numbers to avoid resonance
- Spread out to avoid flutter echo
- `STEREO_SPREAD` adds slight offset for decorrelation

Scale all sizes by `sampleRate / 44100` for different sample rates.

### Typical Presets

| Preset | Room Size | Damping | Wet | Notes |
|--------|-----------|---------|-----|-------|
| Small Room | 0.3 | 0.6 | 0.2 | Tight, controlled |
| Medium Room | 0.5 | 0.5 | 0.3 | General purpose |
| Large Hall | 0.8 | 0.3 | 0.4 | Long, bright tail |
| Cathedral | 0.95 | 0.2 | 0.5 | Very long, bright |
| Plate | 0.6 | 0.7 | 0.35 | Dense, dark |

### Limitations and Alternatives

Freeverb is simple but has limitations:
- Fixed early reflections pattern
- Can sound "boxy" on some material
- Limited control over decay shape

For higher quality, consider:
- **Dattorro Plate**: Better for lush, smooth reverb
- **FDN (Feedback Delay Network)**: More parameters, scalable
- **Convolution**: Ultimate realism (see IR-based reverbs)

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `std::array::from_fn` for creating filter arrays
- Use `Vec<f32>` for variable-size buffers
- Consider `#[inline]` on inner process functions

**C++ (JUCE/iPlug2):**
- JUCE has `dsp::Reverb` (Freeverb-based)
- Use `std::array` or `std::vector` for buffers
- Consider SIMD for parallel comb processing

**Key Considerations:**
- Pre-delay can be added with a delay line before the reverb
- EQ before reverb shapes the character (cut lows = cleaner)
- Clear buffers when bypassing to prevent stale reverb
- Report zero latency (Freeverb has no lookahead)
