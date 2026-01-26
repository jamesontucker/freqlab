---
name: Wah & Envelope Filter
description: Wah-wah effect with manual and auto-wah modes. Envelope follower for dynamic filtering. Classic funk and guitar effects.
tags: [wah, envelope-filter, auto-wah, filter, effect, funk]
source: Classic analog effect designs
license: Public Domain
---

# Wah & Envelope Filter

Dynamic filtering based on pedal position or input level.

## Source Attribution

```
// Classic wah and envelope filter design - Public Domain
// Standard effect design techniques
// No attribution required
```

## Algorithm Description

Wah effects use a resonant bandpass filter swept through frequencies:
- **Manual Wah**: Pedal position controls filter frequency
- **Auto-Wah**: Input envelope controls filter frequency
- **LFO Wah**: LFO sweeps filter automatically

### Wah Types

| Type | Frequency Range | Character |
|------|-----------------|-----------|
| Classic | 350-2200 Hz | Cry Baby style |
| Boutique | 400-1800 Hz | More vocal, mid-focused |
| Bass | 100-800 Hz | Lower range for bass |

## Pseudocode

### Wah Filter Core (State Variable)

```
enum WahType:
    Classic         // 350-2200 Hz
    Boutique        // 400-1800 Hz
    Bass            // 100-800 Hz

struct WahFilter:
    // State variable filter state
    lp: float = 0
    bp: float = 0

    // Parameters
    frequency: float = 1000
    resonance: float = 4
    sampleRate: float
    wah_type: WahType = Classic

function new(sampleRate):
    this.sampleRate = sampleRate

function set_type(wah_type):
    this.wah_type = wah_type

function set_resonance(q):
    resonance = clamp(q, 0.5, 20)

function set_position(position):
    // Position: 0-1, heel to toe
    pos = clamp(position, 0, 1)

    // Frequency range depends on type
    switch wah_type:
        Classic:
            min_freq = 350; max_freq = 2200
        Boutique:
            min_freq = 400; max_freq = 1800
        Bass:
            min_freq = 100; max_freq = 800

    // Exponential sweep feels more natural
    exp_pos = pos * pos
    frequency = min_freq * pow(max_freq / min_freq, exp_pos)

function reset():
    lp = 0
    bp = 0

function process(input) -> float:
    // TPT state variable filter
    g = tan(π * frequency / sampleRate)
    k = 1 / resonance

    hp = (input - (k + g) * bp - lp) / (1 + k * g + g * g)
    bp_new = g * hp + bp
    lp_new = g * bp_new + lp

    bp = bp_new + g * hp
    lp = lp_new + g * bp_new

    // Wah output: mostly bandpass with some lowpass
    return bp_new * 1.5 + lp_new * 0.3
```

### Envelope Follower

```
struct EnvelopeFollower:
    envelope: float = 0
    attack_coef: float
    release_coef: float
    sampleRate: float

function new(sampleRate):
    this.sampleRate = sampleRate
    set_attack(1)
    set_release(50)

function set_attack(ms):
    samples = ms * 0.001 * sampleRate
    attack_coef = exp(-1 / max(samples, 1))

function set_release(ms):
    samples = ms * 0.001 * sampleRate
    release_coef = exp(-1 / max(samples, 1))

function reset():
    envelope = 0

function process(input) -> float:
    abs_input = abs(input)

    if abs_input > envelope:
        coef = attack_coef
    else:
        coef = release_coef

    envelope = abs_input + coef * (envelope - abs_input)
    return envelope
```

### Auto-Wah (Envelope-Controlled Filter)

```
struct AutoWah:
    filter: WahFilter
    envelope: EnvelopeFollower
    sensitivity: float = 1      // How much envelope affects frequency
    direction: float = 1        // 1 = up, -1 = down
    base_position: float = 0.2  // Starting filter position

function new(sampleRate):
    filter = WahFilter.new(sampleRate)
    envelope = EnvelopeFollower.new(sampleRate)

function set_sensitivity(sensitivity):
    this.sensitivity = clamp(sensitivity, 0, 3)

function set_direction_up(up):
    direction = 1 if up else -1

function set_base_position(pos):
    base_position = clamp(pos, 0, 1)

function set_resonance(q):
    filter.set_resonance(q)

function set_wah_type(wah_type):
    filter.set_type(wah_type)

function set_attack(ms):
    envelope.set_attack(ms)

function set_release(ms):
    envelope.set_release(ms)

function reset():
    filter.reset()
    envelope.reset()

function process(input) -> float:
    // Get envelope
    env = envelope.process(input)

    // Calculate filter position
    mod_amount = env * sensitivity * direction
    position = clamp(base_position + mod_amount, 0, 1)

    filter.set_position(position)
    return filter.process(input)
```

### Manual Wah (Pedal Controlled)

```
struct ManualWah:
    filter: WahFilter
    position: float = 0.5
    smoothed_position: float = 0.5
    smooth_coef: float

function new(sampleRate):
    filter = WahFilter.new(sampleRate)
    smooth_coef = exp(-2π * 30 / sampleRate)    // 30Hz smoothing

function set_position(pos):
    position = clamp(pos, 0, 1)

function set_resonance(q):
    filter.set_resonance(q)

function set_wah_type(wah_type):
    filter.set_type(wah_type)

function reset():
    filter.reset()
    smoothed_position = position

function process(input) -> float:
    // Smooth pedal movement
    smoothed_position = position + smooth_coef * (smoothed_position - position)

    filter.set_position(smoothed_position)
    return filter.process(input)
```

### LFO Wah (Automatic Sweeping)

```
struct LfoWah:
    filter: WahFilter
    phase: float = 0
    frequency: float = 1        // 1 Hz default
    depth: float = 0.5
    center: float = 0.5         // Center position (0-1)
    sampleRate: float

function new(sampleRate):
    filter = WahFilter.new(sampleRate)
    this.sampleRate = sampleRate

function set_rate(hz):
    frequency = clamp(hz, 0.1, 20)

function set_depth(depth):
    this.depth = clamp(depth, 0, 1)

function set_center(center):
    this.center = clamp(center, 0, 1)

function set_resonance(q):
    filter.set_resonance(q)

function reset():
    filter.reset()
    phase = 0

function sync(new_phase):
    phase = fract(new_phase)

function process(input) -> float:
    // Sine LFO
    lfo = sin(phase * 2π)

    // Calculate position
    position = center + lfo * depth * 0.5

    filter.set_position(clamp(position, 0, 1))

    // Advance phase
    phase += frequency / sampleRate
    if phase >= 1:
        phase -= 1

    return filter.process(input)
```

## Implementation Notes

### Parameters Guide

| Parameter | Auto-Wah | Manual | LFO Wah |
|-----------|----------|--------|---------|
| Sensitivity | 0-300% | N/A | N/A |
| Resonance | 0.5-20 | 0.5-20 | 0.5-20 |
| Attack | 1-50 ms | N/A | N/A |
| Release | 10-500 ms | N/A | N/A |
| Position | N/A | 0-100% | N/A |
| Rate | N/A | N/A | 0.1-20 Hz |
| Depth | N/A | N/A | 0-100% |

### Wah Character

| Resonance | Character |
|-----------|-----------|
| 2-4 | Subtle, smooth |
| 5-8 | Vocal, quacky |
| 10-15 | Sharp, synth-like |
| 15+ | Self-oscillating |

### Use Cases

| Mode | Application |
|------|-------------|
| Auto-wah | Funk guitar, bass, synthesizers |
| Manual wah | Rock guitar solos, expressive playing |
| LFO wah | Electronic music, ambient textures |
| Down direction | "Underwater" dip effect |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::tan()` for TPT filter
- Smooth MIDI CC input for pedal control
- Use `std::f32::consts::PI` for π

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::StateVariableTPTFilter` for the filter
- Use `std::tan` from `<cmath>`
- Map MIDI expression pedal (CC11) or CC1

**Key Considerations:**
- Higher resonance = more "vocal" quack character
- Smooth position changes to avoid clicks
- Sensitivity controls how much dynamics affect filter
- Classic wah frequency range: ~350Hz to ~2200Hz
