---
name: Noise Gate
description: Noise gate with attack, hold, release, and range controls. Includes sidechain filtering and lookahead for transparent gating.
tags: [gate, dynamics, noise-reduction, effect]
source: Classic dynamics processing
license: Public Domain
---

# Noise Gate

Reduce noise by attenuating signal below threshold.

## Source Attribution

```
// Classic noise gate design - Public Domain
// Standard dynamics processing technique
// No attribution required
```

## Algorithm Description

A gate attenuates or mutes signal when it falls below a threshold. Unlike an expander (which has variable ratio), a gate has a fixed response: open (full signal) or closed (attenuated).

### Key Concepts

- **Threshold**: Level at which gate opens/closes
- **Range**: Attenuation when closed (0dB = mute, -20dB = partial)
- **Attack**: How fast the gate opens
- **Hold**: Minimum time gate stays open
- **Release**: How fast the gate closes
- **Hysteresis**: Different thresholds for opening/closing (prevents chatter)

### State Machine

```
States: Closed → Attack → Open → Hold → Release → Closed
```

## Pseudocode

### Simple Gate

```
enum GateState:
    Closed
    Attack
    Open
    Hold
    Release

struct NoiseGate:
    // Parameters
    threshold_db: float = -40
    range_db: float = -80         // Attenuation when closed
    attack_ms: float = 0.5
    hold_ms: float = 50
    release_ms: float = 100
    hysteresis_db: float = 4      // Prevents chattering

    // State
    state: GateState = Closed
    envelope: float = 0
    gain: float = 0
    hold_counter: float = 0

    // Coefficients
    attack_coef: float
    release_coef: float
    hold_samples: float

    sampleRate: float

function new(sampleRate):
    update_coefficients()

function set_threshold(db):
    threshold_db = clamp(db, -80, 0)

function set_range(db):
    range_db = clamp(db, -80, 0)

function set_attack(ms):
    attack_ms = clamp(ms, 0.01, 100)
    update_coefficients()

function set_hold(ms):
    hold_ms = clamp(ms, 0, 1000)
    update_coefficients()

function set_release(ms):
    release_ms = clamp(ms, 1, 5000)
    update_coefficients()

function set_hysteresis(db):
    hysteresis_db = clamp(db, 0, 12)

function update_coefficients():
    attack_samples = attack_ms * 0.001 * sampleRate
    release_samples = release_ms * 0.001 * sampleRate

    attack_coef = exp(-1 / max(attack_samples, 1))
    release_coef = exp(-1 / max(release_samples, 1))
    hold_samples = hold_ms * 0.001 * sampleRate

function reset():
    state = Closed
    envelope = 0
    gain = 0
    hold_counter = 0

function gain_reduction_db() -> float:
    if gain > 0.0001:
        return 20 * log10(gain)
    else:
        return -80

function process(input) -> float:
    return process_with_sidechain(input, input)

function process_with_sidechain(input, sidechain) -> float:
    // Convert sidechain to dB
    level_db = 20 * log10(max(abs(sidechain), 1e-10))

    // Envelope follower
    if level_db > envelope:
        env_coef = 0    // Instant attack for detection
    else:
        env_coef = 0.9995
    envelope = level_db + env_coef * (envelope - level_db)

    // Hysteresis thresholds
    open_threshold = threshold_db
    close_threshold = threshold_db - hysteresis_db

    // State machine
    switch state:
        Closed:
            if envelope > open_threshold:
                state = Attack

        Attack:
            gain = 1 + attack_coef * (gain - 1)
            if gain > 0.999:
                gain = 1
                state = Open

        Open:
            if envelope < close_threshold:
                hold_counter = hold_samples
                state = Hold

        Hold:
            hold_counter -= 1
            if envelope > open_threshold:
                state = Open
            else if hold_counter <= 0:
                state = Release

        Release:
            range_linear = db_to_gain(range_db)
            gain = range_linear + release_coef * (gain - range_linear)

            if envelope > open_threshold:
                state = Attack
            else if abs(gain - range_linear) < 0.001:
                gain = range_linear
                state = Closed

    return input * gain
```

### Gate with Sidechain Filter

```
struct GateWithFilter:
    gate: NoiseGate
    hp_filter: OnePoleHighpass
    filter_enabled: bool = false

struct OnePoleHighpass:
    z1: float = 0
    coef: float

function set_frequency(freq, sampleRate):
    coef = exp(-2π * freq / sampleRate)

function process(input) -> float:
    output = input - z1
    z1 = input * (1 - coef) + z1 * coef
    return output

function GateWithFilter.new(sampleRate):
    gate = NoiseGate.new(sampleRate)
    hp_filter.set_frequency(100, sampleRate)

function set_sidechain_filter(enabled, freq, sampleRate):
    filter_enabled = enabled
    hp_filter.set_frequency(freq, sampleRate)

function process(input) -> float:
    if filter_enabled:
        sidechain = hp_filter.process(input)
    else:
        sidechain = input

    return gate.process_with_sidechain(input, sidechain)
```

### Lookahead Gate

```
struct LookaheadGate:
    gate: NoiseGate
    delay_buffer: array[float]
    write_pos: int = 0
    lookahead_samples: int

function new(lookahead_ms, sampleRate):
    lookahead_samples = lookahead_ms * 0.001 * sampleRate

    gate = NoiseGate.new(sampleRate)
    gate.set_attack(lookahead_ms)    // Attack matches lookahead

    delay_buffer = array of lookahead_samples + 1 zeros

function latency() -> int:
    return lookahead_samples

function reset():
    gate.reset()
    fill delay_buffer with 0
    write_pos = 0

function process(input) -> float:
    // Use current input for detection (lookahead)
    gate.process(input)

    // Output delayed signal with current gate gain
    read_pos = (write_pos + delay_buffer.length - lookahead_samples)
               mod delay_buffer.length
    delayed = delay_buffer[read_pos]

    delay_buffer[write_pos] = input
    write_pos = (write_pos + 1) mod delay_buffer.length

    return delayed * gate.gain
```

## Implementation Notes

### Parameters Guide

| Parameter | Range | Purpose |
|-----------|-------|---------|
| Threshold | -80 to 0 dB | Level to open gate |
| Range | -80 to 0 dB | Attenuation when closed |
| Attack | 0.01 to 100 ms | How fast gate opens |
| Hold | 0 to 1000 ms | Minimum open time |
| Release | 1 to 5000 ms | How fast gate closes |
| Hysteresis | 0 to 12 dB | Prevents chattering |

### Use Case Settings

| Application | Threshold | Attack | Hold | Release |
|-------------|-----------|--------|------|---------|
| Drums | -30dB | 0.5ms | 50ms | 100ms |
| Vocals | -40dB | 5ms | 200ms | 300ms |
| Guitar | -35dB | 2ms | 100ms | 200ms |
| Noise reduction | -50dB | 10ms | 100ms | 500ms |

### Sidechain Filter Usage

- **High-pass 80-100Hz**: Focus on kick drum, ignore bass bleed
- **High-pass 500Hz**: Focus on snare attack
- **Band-pass**: Focus on specific frequency range

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `enum` for state machine
- Use `VecDeque` for lookahead delay buffer
- Report latency via `latency_samples()`

**C++ (JUCE/iPlug2):**
- JUCE: Consider `dsp::NoiseGate` for simple gating
- Use `std::deque` or circular buffer for lookahead
- Report latency via `setLatencySamples()`

**Key Considerations:**
- Hysteresis prevents rapid opening/closing on edge signals
- Lookahead allows smoother gating but adds latency
- Sidechain filtering helps focus detection
- Range < 0dB allows some signal through (ducking vs hard gate)
