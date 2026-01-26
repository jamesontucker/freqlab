---
name: Limiter
description: Brickwall limiter with lookahead for transparent peak limiting. Essential for final stage protection and loudness maximization.
tags: [dynamics, limiter, mastering, effect, brickwall]
source: Classic dynamics processing
license: Public Domain
---

# Limiter

Brickwall limiter with lookahead for transparent peak control.

## Source Attribution

```
// Classic limiter design - Public Domain
// Lookahead limiting technique widely documented
// No attribution required
```

## Algorithm Description

A limiter prevents signal from exceeding a threshold (ceiling). Unlike a compressor with high ratio, a true brickwall limiter guarantees no signal exceeds the ceiling.

### Key Concepts

- **Threshold/Ceiling**: Maximum output level (typically -0.1 to -1.0 dBFS)
- **Lookahead**: Delay to anticipate peaks and apply smooth gain reduction
- **Attack**: Instant (or very fast) to catch transients
- **Release**: How quickly gain reduction recovers

### Why Lookahead?

Without lookahead, fast transients can slip through before gain reduction kicks in. Lookahead delays the audio while detecting peaks ahead of time, allowing smooth gain reduction before the peak arrives.

## Pseudocode

### Simple Limiter (No Lookahead)

```
struct SimpleLimiter:
    threshold: float = 1.0
    release_coef: float
    envelope: float = 0
    sampleRate: float

function new(sampleRate):
    set_release(100)    // 100ms default

function set_threshold(t):
    threshold = clamp(t, 0.01, 1.0)

function set_threshold_db(db):
    threshold = clamp(db_to_gain(db), 0.01, 1.0)

function set_release(ms):
    samples = ms * 0.001 * sampleRate
    release_coef = exp(-1 / max(samples, 1))

function reset():
    envelope = 0

function process(input) -> float:
    abs_input = abs(input)

    // Instant attack, slow release envelope follower
    if abs_input > envelope:
        envelope = abs_input        // Instant attack
    else:
        envelope *= release_coef    // Slow release

    // Calculate gain (reduce if over threshold)
    if envelope > threshold:
        gain = threshold / envelope
    else:
        gain = 1.0

    output = input * gain

    // Protect against NaN/Inf
    return output if is_finite(output) else 0
```

### Lookahead Limiter

```
struct LookaheadLimiter:
    threshold: float = 1.0
    release_ms: float = 100
    lookahead_ms: float = 5

    // Delay line for lookahead
    delay_buffer: queue[float]
    lookahead_samples: int

    // Gain reduction envelope
    envelope: float = 0
    attack_coef: float
    release_coef: float

    sampleRate: float

function new(sampleRate):
    lookahead_ms = 5
    lookahead_samples = lookahead_ms * 0.001 * sampleRate

    // Initialize delay buffer with zeros
    delay_buffer = queue of lookahead_samples zeros

    update_coefficients()

function set_threshold_db(db):
    threshold = clamp(db_to_gain(db), 0.01, 1.0)

function set_release(ms):
    release_ms = max(ms, 10)
    update_coefficients()

function set_lookahead(ms):
    lookahead_ms = clamp(ms, 0.1, 20)
    lookahead_samples = lookahead_ms * 0.001 * sampleRate

    // Resize delay buffer
    resize delay_buffer to lookahead_samples
    update_coefficients()

function update_coefficients():
    // Attack time = lookahead time (smooth gain reduction)
    attack_samples = lookahead_samples
    attack_coef = exp(-1 / max(attack_samples, 1))

    release_samples = release_ms * 0.001 * sampleRate
    release_coef = exp(-1 / max(release_samples, 1))

function reset():
    fill delay_buffer with 0
    envelope = 0

function latency() -> int:
    return lookahead_samples

function process(input) -> float:
    // Push input to delay line
    delay_buffer.push_back(input)

    // Get delayed sample (this is what we'll output)
    delayed = delay_buffer.pop_front()

    // Peak detection on CURRENT input (before delay)
    peak = abs(input)

    // Calculate target gain reduction
    if peak > threshold:
        target_gr = threshold / peak
    else:
        target_gr = 1.0

    // Smooth the gain reduction
    if target_gr < envelope:
        // Attack (gain reduction increasing)
        coef = attack_coef
    else:
        // Release (gain reduction decreasing)
        coef = release_coef

    envelope = target_gr + coef * (envelope - target_gr)

    // Protect envelope
    if not is_finite(envelope) or envelope <= 0:
        envelope = 1.0

    // Apply gain to delayed sample
    output = delayed * envelope

    // Final safety clamp (should rarely engage)
    return clamp(output, -threshold, threshold)
```

### Stereo Linked Limiter

```
function process_stereo(left, right) -> (float, float):
    // Use max of both channels for linked detection
    peak = max(abs(left), abs(right))

    // Same envelope calculation as mono...
    // (target_gr, coef, envelope update)

    // Apply same gain to both channels
    out_l = clamp(left * envelope, -threshold, threshold)
    out_r = clamp(right * envelope, -threshold, threshold)

    return (out_l, out_r)
```

### True Peak Limiter

```
struct TruePeakLimiter:
    limiter: LookaheadLimiter
    os_buffer: array[float, 4]    // For interpolation

function new(sampleRate):
    limiter = LookaheadLimiter.new(sampleRate)

function set_threshold_db(db):
    // Reduce threshold slightly to account for true peaks
    limiter.set_threshold_db(db - 0.3)

function detect_true_peak(input) -> float:
    // Shift history buffer
    os_buffer[0..3] = os_buffer[1..4]
    os_buffer[3] = input

    // Check 4 interpolated positions
    max_peak = abs(input)
    for i in 1..4:
        t = i / 4.0
        interpolated = hermite_interpolate(os_buffer, t)
        max_peak = max(max_peak, abs(interpolated))

    return max_peak

function process(input) -> float:
    true_peak = detect_true_peak(input)
    // Use true peak for detection, process regular sample
    return limiter.process(input)
```

## Implementation Notes

### Limiter Types Comparison

| Type | Latency | Quality | Use Case |
|------|---------|---------|----------|
| Simple | 0 | Basic | Safety limiting |
| Lookahead | 1-5ms | Good | General mastering |
| True Peak | 1-5ms | Best | Streaming/broadcast |

### Typical Settings

| Application | Threshold | Release | Lookahead |
|-------------|-----------|---------|-----------|
| Mix bus protection | -0.3 dB | 50-100ms | 1-3ms |
| Mastering | -0.1 to -1.0 dB | 100-300ms | 3-5ms |
| Streaming | -1.0 dBTP | 100-200ms | 5ms |
| Broadcast | -2.0 dBTP | 150-300ms | 5ms |

### Release Time Effects

| Release | Character | Best For |
|---------|-----------|----------|
| 10-50ms | Aggressive pumping | Electronic, effect |
| 50-150ms | Transparent | General purpose |
| 150-300ms | Smooth, subtle | Mastering |
| 300ms+ | Very subtle | Gentle loudness |

### Latency Reporting

Lookahead limiters introduce latency. Always report this to the host:

```
// In your plugin
function get_latency() -> int:
    return limiter.latency()
```

The DAW uses this for PDC (Plugin Delay Compensation).

### Inter-Sample Peaks

Digital audio can have peaks between samples that exceed the sample values. True peak limiting catches these by oversampling (typically 4x) during detection.

For streaming targets (Spotify, Apple Music), use True Peak at -1.0 dBTP.

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `VecDeque<f32>` for the delay buffer
- Report latency via `latency_samples()` method
- Consider `std::collections::VecDeque` for efficient push/pop

**C++ (JUCE/iPlug2):**
- JUCE: Consider `dsp::Limiter` for simple limiting
- Use `std::deque<float>` or circular buffer for delay
- Report latency via `setLatencySamples()`

**Key Considerations:**
- Always place limiter last in the chain
- Report latency to host for proper compensation
- True peak limiting is essential for streaming targets
- Consider separate left/right limiters vs. linked stereo
