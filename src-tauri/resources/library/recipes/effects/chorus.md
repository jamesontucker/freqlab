---
name: Chorus, Flanger & Phaser
description: Classic modulation effects using delay lines and LFOs. Includes chorus, flanger, phaser, and vibrato implementations.
tags: [chorus, flanger, phaser, vibrato, modulation, effect, lfo]
source: Classic effect design
license: Public Domain
---

# Modulation Effects

Chorus, flanger, phaser, and vibrato using modulated delay lines and allpass filters.

## Source Attribution

```
// Classic modulation effect designs - Public Domain
// Flanger and chorus from bucket-brigade delay emulation
// Phaser from analog phase shifter circuits
// No attribution required
```

## Algorithm Description

These effects all create movement through modulation:

- **Chorus**: Delayed copy with slow pitch modulation creates thickening
- **Flanger**: Short modulated delay with feedback creates comb filtering
- **Phaser**: Cascaded allpass filters create moving notches
- **Vibrato**: Pure pitch modulation (100% wet chorus)

### Core Principle

Modulating delay time = pitch shift. Short delays + fast modulation = flanging. Longer delays + slow modulation = chorus.

## Pseudocode

### LFO (Low Frequency Oscillator)

```
struct Lfo:
    phase: float = 0
    phase_inc: float      // rate_hz / sampleRate

function set_rate(rate_hz, sampleRate):
    phase_inc = rate_hz / sampleRate

function next_sine() -> float:
    value = sin(phase * 2π)
    phase += phase_inc
    if phase >= 1:
        phase -= 1
    return value      // -1 to +1

function next_triangle() -> float:
    if phase < 0.5:
        value = 4 * phase - 1
    else:
        value = 3 - 4 * phase
    phase += phase_inc
    if phase >= 1:
        phase -= 1
    return value      // -1 to +1
```

### Modulated Delay Line

```
struct ModDelay:
    buffer: array[float]
    write_pos: int = 0

function new(max_samples):
    buffer = new array[max_samples + 4] filled with 0

function write(sample):
    buffer[write_pos] = sample
    write_pos = (write_pos + 1) mod buffer.length

function read_cubic(delay_samples) -> float:
    // Calculate read position
    read_pos = write_pos - delay_samples - 1
    if read_pos < 0:
        read_pos += buffer.length

    // Get 4 sample indices for cubic interpolation
    idx1 = floor(read_pos) mod buffer.length
    idx0 = (idx1 - 1 + buffer.length) mod buffer.length
    idx2 = (idx1 + 1) mod buffer.length
    idx3 = (idx2 + 1) mod buffer.length
    frac = read_pos - floor(read_pos)

    // Cubic Hermite interpolation
    y0, y1, y2, y3 = buffer[idx0..idx3]
    c0 = y1
    c1 = 0.5 * (y2 - y0)
    c2 = y0 - 2.5*y1 + 2*y2 - 0.5*y3
    c3 = 0.5*(y3 - y0) + 1.5*(y1 - y2)
    return ((c3*frac + c2)*frac + c1)*frac + c0
```

### Chorus

```
struct Chorus:
    delay_l: ModDelay
    delay_r: ModDelay
    lfo_l: Lfo
    lfo_r: Lfo
    base_delay_samples: float    // ~7ms
    depth_samples: float         // ~3ms
    mix: float = 0.5
    sampleRate: float

function new(sampleRate):
    max_delay_ms = 50
    max_samples = max_delay_ms * 0.001 * sampleRate

    delay_l = ModDelay.new(max_samples)
    delay_r = ModDelay.new(max_samples)

    lfo_l = Lfo(rate=1.0)
    lfo_r = Lfo(rate=1.1)      // Slightly different for stereo
    lfo_r.phase = 0.25         // Phase offset

    base_delay_samples = 7 * 0.001 * sampleRate
    depth_samples = 3 * 0.001 * sampleRate

function set_rate(rate_hz):
    lfo_l.set_rate(rate_hz, sampleRate)
    lfo_r.set_rate(rate_hz * 1.1, sampleRate)

function set_depth_ms(depth_ms):
    depth_samples = depth_ms * 0.001 * sampleRate

function process(left, right) -> (float, float):
    // Modulate delay time
    mod_l = lfo_l.next_sine()
    mod_r = lfo_r.next_sine()

    delay_l_time = base_delay_samples + mod_l * depth_samples
    delay_r_time = base_delay_samples + mod_r * depth_samples

    // Write to delays
    delay_l.write(left)
    delay_r.write(right)

    // Read delayed signals
    wet_l = delay_l.read_cubic(delay_l_time)
    wet_r = delay_r.read_cubic(delay_r_time)

    // Mix dry/wet
    out_l = left * (1 - mix) + wet_l * mix
    out_r = right * (1 - mix) + wet_r * mix

    return (out_l, out_r)
```

### Flanger

```
struct Flanger:
    delay: ModDelay
    lfo: Lfo
    base_delay_samples: float    // ~1ms (shorter than chorus)
    depth_samples: float         // ~2ms
    feedback: float = 0.7        // Creates resonance
    mix: float = 0.5
    last_output: float = 0

function new(sampleRate):
    delay = ModDelay.new(20ms worth of samples)
    lfo = Lfo(rate=0.5)
    base_delay_samples = 1 * 0.001 * sampleRate
    depth_samples = 2 * 0.001 * sampleRate

function set_feedback(fb):
    feedback = clamp(fb, -0.95, 0.95)   // Negative = inverted comb

function process(input) -> float:
    // Triangle LFO for flanger (smoother sweeps)
    mod_value = lfo.next_triangle()
    delay_time = base_delay_samples + (mod_value * 0.5 + 0.5) * depth_samples

    // Write input + feedback
    delay.write(input + last_output * feedback)

    // Read delayed
    wet = delay.read_cubic(delay_time)
    last_output = wet

    // Mix (negative mix creates different comb pattern)
    return input * (1 - abs(mix)) + wet * mix
```

### Phaser

```
struct AllpassStage:
    a1: float = 0
    z1: float = 0

function set_frequency(freq, sampleRate):
    omega = 2π * freq / sampleRate
    a1 = (1 - tan(omega)) / (1 + tan(omega))

function process(input) -> float:
    output = a1 * input + z1
    z1 = input - a1 * output
    return output

struct Phaser:
    allpass: array[AllpassStage, 6]    // 6 stages typical
    lfo: Lfo
    min_freq: float = 200
    max_freq: float = 2000
    feedback: float = 0.7
    mix: float = 0.5
    last_output: float = 0

function process(input) -> float:
    // LFO modulates allpass frequency
    mod_value = (lfo.next_sine() + 1) * 0.5    // 0 to 1
    freq = min_freq + mod_value * (max_freq - min_freq)

    // Update all stages with same frequency
    for stage in allpass:
        stage.set_frequency(freq, sampleRate)

    // Process through allpass chain with feedback
    signal = input + last_output * feedback
    for stage in allpass:
        signal = stage.process(signal)

    last_output = signal

    // Mix creates notches (summing shifted and original)
    return input * (1 - mix) + signal * mix
```

### Vibrato

```
struct Vibrato:
    delay: ModDelay
    lfo: Lfo
    depth_samples: float

function new(sampleRate):
    delay = ModDelay.new(20ms worth of samples)
    lfo = Lfo(rate=5.0)    // Faster than chorus
    depth_samples = 3 * 0.001 * sampleRate

function process(input) -> float:
    mod_value = lfo.next_sine()
    delay_time = depth_samples * (mod_value + 1)   // Always positive

    delay.write(input)
    return delay.read_cubic(delay_time)    // 100% wet
```

## Implementation Notes

### Effect Comparison

| Effect | Delay Time | LFO Rate | Feedback | Character |
|--------|------------|----------|----------|-----------|
| Chorus | 7-30ms | 0.5-3 Hz | None | Thick, wide |
| Flanger | 1-10ms | 0.1-5 Hz | Yes (±) | Jet, whoosh |
| Phaser | Allpass | 0.1-2 Hz | Yes (±) | Swirly, swooshy |
| Vibrato | 1-10ms | 4-8 Hz | None | Pitch wobble |

### Typical Parameter Ranges

| Parameter | Chorus | Flanger | Phaser |
|-----------|--------|---------|--------|
| Rate | 0.1-5 Hz | 0.1-10 Hz | 0.1-4 Hz |
| Depth | 1-10ms | 0.5-5ms | 200-4000 Hz |
| Feedback | 0 | ±0.95 | ±0.95 |
| Mix | 30-70% | 30-70% | 30-70% |

### Negative Feedback

Negative feedback in flanger/phaser inverts the comb pattern:
- **Positive feedback**: Emphasizes harmonics
- **Negative feedback**: Emphasizes odd harmonics, "hollow" sound

### Stereo Enhancement

- Use different LFO rates per channel (e.g., 1.0 Hz vs 1.1 Hz)
- Use phase offset between channels (e.g., 90° = 0.25 phase)
- Creates width without sounding unnatural

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `std::f32::consts::PI` for π
- Use `Vec<f32>` for delay buffer
- Consider `#[inline]` on process functions

**C++ (JUCE/iPlug2):**
- JUCE has `dsp::Chorus` built-in
- For phaser: cascaded `IIRFilter` with allpass coefficients
- Consider SIMD for multiple allpass stages

**Key Considerations:**
- Use cubic interpolation for modulated delays (avoids zipper noise)
- Clamp feedback < 1.0 to prevent runaway
- Reset delay buffers when bypassing to prevent stale audio
- Consider sample rate scaling for delay times
