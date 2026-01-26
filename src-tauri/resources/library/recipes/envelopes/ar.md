---
name: AR Envelope
description: Simple Attack-Release envelope generator. Useful for transient shapers, gates, and simple modulation sources.
tags: [envelope, ar, transient, gate, simple]
source: Classic envelope design
license: Public Domain
---

# AR Envelope

Simple attack-release envelope for transients and modulation.

## Source Attribution

```
// Classic envelope design - Public Domain
// Exponential coefficient approach widely documented
// No attribution required
```

## Algorithm Description

An AR envelope has two stages:
- **Attack**: Time to rise from 0 to 1 when triggered
- **Release**: Time to fall from current value to 0 when released

Uses exponential curves for natural-sounding dynamics.

### Mathematics

**Exponential coefficient from time:**
```
samples = time_seconds * sampleRate
coefficient = exp(-1 / max(samples, 1))
```

**Envelope update:**
```
// Moving toward target with exponential smoothing
value = target + coefficient * (value - target)
```

## Pseudocode

### AR Envelope

```
struct ArEnvelope:
    value: float = 0
    target: float = 0
    attack_coef: float
    release_coef: float
    sampleRate: float

function new(sampleRate):
    set_attack(0.01)    // 10ms default
    set_release(0.1)    // 100ms default

function set_attack(seconds):
    samples = max(seconds * sampleRate, 1)
    attack_coef = exp(-1 / samples)

function set_release(seconds):
    samples = max(seconds * sampleRate, 1)
    release_coef = exp(-1 / samples)

function set_attack_ms(ms):
    set_attack(ms * 0.001)

function set_release_ms(ms):
    set_release(ms * 0.001)

function trigger():
    target = 1.0

function release():
    target = 0.0

function set_target(t):
    target = clamp(t, 0, 1)

function reset(val):
    value = val
    target = val

function is_idle() -> bool:
    return target == 0 and value < 0.0001

function current() -> float:
    return value

function next() -> float:
    // Choose coefficient based on direction
    if value < target:
        coef = attack_coef     // Rising (attack)
    else:
        coef = release_coef    // Falling (release)

    // Exponential approach to target
    value = target + coef * (value - target)

    // Protect against denormals and NaN
    if not is_finite(value) or abs(value) < 1e-10:
        value = 0

    return value
```

### Envelope Follower

```
struct EnvelopeFollower:
    envelope: ArEnvelope

function new(sampleRate):
    envelope = ArEnvelope.new(sampleRate)

function set_attack(seconds):
    envelope.set_attack(seconds)

function set_release(seconds):
    envelope.set_release(seconds)

function reset():
    envelope.reset(0)

function process(input) -> float:
    abs_input = abs(input)
    envelope.set_target(abs_input)
    return envelope.next()
```

### Gate with Hysteresis

```
struct Gate:
    follower: EnvelopeFollower
    threshold_open: float = 0.1
    threshold_close: float = 0.05    // Hysteresis prevents chattering
    is_open: bool = false

function new(sampleRate):
    follower = EnvelopeFollower.new(sampleRate)
    follower.set_attack(0.001)       // 1ms fast attack
    follower.set_release(0.050)      // 50ms release

function set_threshold(threshold):
    threshold_open = threshold
    threshold_close = threshold * 0.5    // 6dB hysteresis

function set_attack(seconds):
    follower.set_attack(seconds)

function set_release(seconds):
    follower.set_release(seconds)

function process(input) -> float:
    level = follower.process(input)

    if is_open:
        if level < threshold_close:
            is_open = false
    else:
        if level > threshold_open:
            is_open = true

    return 1.0 if is_open else 0.0
```

## Implementation Notes

### AR vs ADSR Comparison

| Envelope | Stages | Use Case |
|----------|--------|----------|
| AR | Attack, Release | Transient shapers, gates, simple modulation |
| ADSR | Attack, Decay, Sustain, Release | Instruments, full amplitude envelopes |

### Typical Settings

| Application | Attack | Release |
|-------------|--------|---------|
| Transient shaper | 0.1-5ms | 50-200ms |
| Gate | 0.5-2ms | 20-100ms |
| Envelope follower | 1-10ms | 50-300ms |
| Modulation | 10-500ms | 50-1000ms |

### Gate Hysteresis

Without hysteresis, a gate will rapidly open/close when the signal is near threshold. Hysteresis provides two thresholds:
- **Open threshold**: Signal must exceed this to open
- **Close threshold**: Signal must fall below this to close (typically 3-6dB lower)

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::exp()` for coefficient calculation
- Consider `#[inline]` on `next()` for per-sample processing
- Can be stored directly in voice struct

**C++ (JUCE/iPlug2):**
- Use `std::exp()` from `<cmath>`
- JUCE: Consider using `ADSR` class if sustain behavior is needed
- Store as member variable in processor class

**Key Considerations:**
- AR is lighter weight than ADSR
- Use for transient shapers, gates, or simple modulation
- Envelope follower is great for sidechain compression or ducking
- Gate hysteresis prevents chattering at threshold boundary
- For instruments with sustained notes, use ADSR instead
