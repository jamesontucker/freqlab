---
name: Delay Line
description: Interpolating delay line for echo, chorus, flanger, and reverb building blocks. Supports fractional delays with multiple interpolation modes.
tags: [delay, echo, effect, building-block, interpolation]
source: Classic DSP technique
license: Public Domain
---

# Delay Line

Essential building block for time-based effects (echo, chorus, flanger, reverb).

## Source Attribution

```
// Classic DSP technique - Public Domain
// Described in Smith's "Physical Audio Signal Processing"
// https://ccrma.stanford.edu/~jos/pasp/
// No attribution required
```

## Algorithm Description

A delay line is a circular buffer that stores audio samples and reads them back after a specified delay. Fractional delay times require interpolation between samples.

### Core Concept

```
Write sample to buffer at write_pos
Read sample from buffer at (write_pos - delay)
Advance write_pos (circular)
```

### Interpolation Methods

| Method | Quality | CPU | Use Case |
|--------|---------|-----|----------|
| No interpolation | Poor | Lowest | Fixed integer delays |
| Linear | Good | Low | Most echo/delay effects |
| Cubic | Excellent | Medium | Chorus, flanger, pitch |
| Allpass | Very good | Low | Modulated delays |

## Pseudocode

### Basic Delay Line

```
struct DelayLine:
    buffer: array[float]
    write_pos: int = 0
    max_delay: int
    buffer_size: int      // max_delay + 1

function new(max_delay_samples):
    max_delay = max_delay_samples
    buffer_size = max_delay_samples + 1
    buffer = new array[buffer_size] filled with 0

function new_from_seconds(max_seconds, sampleRate):
    samples = ceil(max_seconds * sampleRate)
    return new(samples)

function reset():
    fill buffer with 0
    write_pos = 0

function write(sample):
    buffer[write_pos] = sample
    write_pos = (write_pos + 1) mod buffer_size

function read_linear(delay_samples) -> float:
    // Clamp delay to valid range
    delay = clamp(delay_samples, 0, max_delay)

    // Calculate read position (fractional)
    read_pos = write_pos - delay - 1
    if read_pos < 0:
        read_pos += buffer_size

    // Get integer indices for interpolation
    idx0 = floor(read_pos) mod buffer_size
    idx1 = (idx0 + 1) mod buffer_size
    frac = read_pos - floor(read_pos)

    // Linear interpolation
    return buffer[idx0] * (1 - frac) + buffer[idx1] * frac

function read_cubic(delay_samples) -> float:
    // Clamp with margin for cubic (needs 4 samples)
    delay = clamp(delay_samples, 1, max_delay - 2)

    // Calculate read position
    read_pos = write_pos - delay - 1
    if read_pos < 0:
        read_pos += buffer_size

    // Get 4 sample indices
    idx1 = floor(read_pos) mod buffer_size
    idx0 = (idx1 - 1 + buffer_size) mod buffer_size
    idx2 = (idx1 + 1) mod buffer_size
    idx3 = (idx2 + 1) mod buffer_size
    frac = read_pos - floor(read_pos)

    // Read samples
    y0 = buffer[idx0]
    y1 = buffer[idx1]
    y2 = buffer[idx2]
    y3 = buffer[idx3]

    // Cubic Hermite interpolation
    c0 = y1
    c1 = 0.5 * (y2 - y0)
    c2 = y0 - 2.5*y1 + 2*y2 - 0.5*y3
    c3 = 0.5*(y3 - y0) + 1.5*(y1 - y2)

    return ((c3*frac + c2)*frac + c1)*frac + c0

function process(input, delay_samples) -> float:
    output = read_linear(delay_samples)
    write(input)
    return output
```

### Feedback Delay (Echo Effect)

```
struct FeedbackDelay:
    delay_line: DelayLine
    delay_samples: float
    feedback: float = 0.5    // 0 to <1
    mix: float = 0.5         // dry/wet

function new(max_seconds, sampleRate):
    delay_line = DelayLine.new_from_seconds(max_seconds, sampleRate)
    delay_samples = sampleRate * 0.5  // 500ms default

function set_delay_seconds(seconds, sampleRate):
    delay_samples = seconds * sampleRate

function set_feedback(fb):
    feedback = clamp(fb, 0, 0.99)  // Prevent runaway

function set_mix(m):
    mix = clamp(m, 0, 1)

function reset():
    delay_line.reset()

function process(input) -> float:
    // Read delayed signal
    delayed = delay_line.read_linear(delay_samples)

    // Write input + feedback
    delay_line.write(input + delayed * feedback)

    // Mix dry/wet
    output = input * (1 - mix) + delayed * mix

    // Protect against runaway
    if not is_finite(output):
        reset()
        return input

    return output
```

### Multi-Tap Delay

```
struct DelayTap:
    delay_samples: float
    gain: float
    pan: float              // -1 (left) to +1 (right)

struct MultiTapDelay:
    delay_line: DelayLine
    taps: array[DelayTap]

function new(max_samples, num_taps):
    delay_line = DelayLine.new(max_samples)
    taps = new array[num_taps]

function set_tap(index, delay, gain, pan):
    taps[index].delay_samples = delay
    taps[index].gain = gain
    taps[index].pan = pan

function process(input) -> (float, float):
    delay_line.write(input)

    left = 0
    right = 0

    for tap in taps:
        if tap.gain > 0.0001:
            sample = delay_line.read_linear(tap.delay_samples) * tap.gain

            // Simple pan law
            left_gain = sqrt((1 - tap.pan) * 0.5)
            right_gain = sqrt((1 + tap.pan) * 0.5)

            left += sample * left_gain
            right += sample * right_gain

    return (left, right)
```

### Ping-Pong Delay

```
struct PingPongDelay:
    left_delay: DelayLine
    right_delay: DelayLine
    delay_samples: float
    feedback: float = 0.5
    mix: float = 0.5

function new(max_seconds, sampleRate):
    max_samples = ceil(max_seconds * sampleRate)
    left_delay = DelayLine.new(max_samples)
    right_delay = DelayLine.new(max_samples)

function process(left_in, right_in) -> (float, float):
    // Read from OPPOSITE channel's delay (ping-pong)
    left_delayed = right_delay.read_linear(delay_samples)
    right_delayed = left_delay.read_linear(delay_samples)

    // Write input + cross-feedback
    left_delay.write(left_in + right_delayed * feedback)
    right_delay.write(right_in + left_delayed * feedback)

    // Mix
    left_out = left_in * (1 - mix) + left_delayed * mix
    right_out = right_in * (1 - mix) + right_delayed * mix

    return (left_out, right_out)
```

## Implementation Notes

### Tempo-Synced Delay Times

```
function delay_for_note(bpm, note_division) -> float:
    // note_division: 1.0 = quarter, 0.5 = eighth, etc.
    beat_duration = 60.0 / bpm         // seconds per beat
    return beat_duration * 4 * note_division

// Example: 8th note at 120 BPM
delay_seconds = delay_for_note(120, 0.5)  // = 0.25 seconds
```

### Common Note Divisions

| Division | Value | At 120 BPM |
|----------|-------|------------|
| Whole | 4.0 | 2000ms |
| Half | 2.0 | 1000ms |
| Quarter | 1.0 | 500ms |
| Eighth | 0.5 | 250ms |
| Sixteenth | 0.25 | 125ms |
| Dotted eighth | 0.75 | 375ms |
| Triplet eighth | 0.333 | 167ms |

### Feedback Safety

- Always clamp feedback < 1.0 (typically < 0.99)
- Higher feedback = longer decay, but risks runaway
- Consider adding a gentle limiter or saturator in the feedback path

### Interpolation Choice

| Effect Type | Recommended Interpolation |
|-------------|---------------------------|
| Echo/Delay | Linear (static delay time) |
| Chorus | Cubic (modulated delay) |
| Flanger | Cubic or Allpass |
| Reverb | Linear (many delay lines, CPU matters) |
| Pitch shift | Cubic (quality critical) |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `Vec<f32>` for dynamic buffer
- Consider `std::mem::swap` for ping-pong optimization
- `#[inline]` on read/write functions

**C++ (JUCE/iPlug2):**
- JUCE has `dsp::DelayLine` with multiple interpolation types
- Use `std::vector<float>` or `juce::AudioBuffer`
- Consider aligned memory for SIMD

**Key Considerations:**
- Pre-allocate buffer for maximum delay at initialization
- Clear buffer when bypassing to prevent stale audio
- Modulating delay time rapidly creates pitch shift (chorus effect)
- For very long delays (>5s), consider disk-based streaming
