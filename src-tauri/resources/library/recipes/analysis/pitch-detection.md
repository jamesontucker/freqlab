---
name: Pitch Detection
description: Autocorrelation and zero-crossing pitch detection for monophonic audio. Useful for tuners, pitch correction, and audio-to-MIDI.
tags: [pitch, detection, analysis, autocorrelation, tuner, utility]
source: Classic signal analysis techniques
license: Public Domain
---

# Pitch Detection

Detect fundamental frequency from monophonic audio signals.

## Source Attribution

```
// Classic pitch detection algorithms - Public Domain
// Autocorrelation and zero-crossing methods
// YIN algorithm: de Cheveigné & Kawahara (2002) - widely implemented
// No attribution required for basic implementations
```

## Algorithm Description

Pitch detection finds the fundamental frequency (F0) of a periodic signal. Common methods:

1. **Zero-Crossing**: Counts zero crossings (fast, inaccurate)
2. **Autocorrelation**: Finds periodicity by correlating signal with itself
3. **YIN**: Improved autocorrelation with normalized difference function

### Method Comparison

| Method | Accuracy | Speed | Best For |
|--------|----------|-------|----------|
| Zero-crossing | Low | Very fast | Rough estimates |
| Autocorrelation | Good | Medium | General use |
| YIN | Excellent | Slower | Tuners, pitch correction |

## Pseudocode

### Autocorrelation Pitch Detector

```
struct AutocorrelationPitchDetector:
    buffer: array[float]
    buffer_pos: int = 0
    sampleRate: float
    min_freq: float = 60        // E2
    max_freq: float = 1400      // F6

    // Results
    detected_freq: float = 0
    confidence: float = 0

function new(sampleRate):
    // Buffer size for lowest frequency detection
    buffer_size = (sampleRate / 50) * 2    // Down to ~50Hz
    buffer = array of buffer_size zeros

function set_frequency_range(min_freq, max_freq):
    this.min_freq = clamp(min_freq, 20, 500)
    this.max_freq = clamp(max_freq, 200, 5000)

function process(input):
    buffer[buffer_pos] = input
    buffer_pos += 1

    if buffer_pos >= buffer.length:
        detect_pitch()
        buffer_pos = 0

function frequency() -> float:
    return detected_freq

function confidence() -> float:
    return this.confidence

function midi_note() -> float:
    if detected_freq > 0:
        return 69 + 12 * log2(detected_freq / 440)
    else:
        return 0

function cents() -> float:
    // Cents deviation from nearest note
    midi = midi_note()
    return (midi - round(midi)) * 100

function detect_pitch():
    n = buffer.length

    // Check if there's signal (RMS)
    rms = sqrt(sum(x*x for x in buffer) / n)
    if rms < 0.01:
        detected_freq = 0
        confidence = 0
        return

    // Lag range based on frequency limits
    min_lag = sampleRate / max_freq
    max_lag = min(sampleRate / min_freq, n / 2)

    // Normalized autocorrelation
    best_correlation = 0
    best_lag = 0

    // Energy at lag 0 for normalization
    energy0 = sum(buffer[i]^2 for i in 0..(n - min_lag))

    for lag in min_lag..max_lag:
        // Autocorrelation at this lag
        correlation = 0
        energy_lag = 0

        for i in 0..(n - lag):
            correlation += buffer[i] * buffer[i + lag]
            energy_lag += buffer[i + lag]^2

        // Normalize
        normalizer = sqrt(energy0 * energy_lag)
        if normalizer > 0:
            correlation /= normalizer

        if correlation > best_correlation:
            best_correlation = correlation
            best_lag = lag

    if best_correlation > 0.5 and best_lag > 0:
        // Parabolic interpolation for sub-sample accuracy
        refined_lag = parabolic_interpolation(best_lag)
        detected_freq = sampleRate / refined_lag
        confidence = best_correlation
    else:
        detected_freq = 0
        confidence = 0

function parabolic_interpolation(peak_idx) -> float:
    if peak_idx == 0 or peak_idx >= buffer.length - 1:
        return peak_idx

    // Calculate autocorrelation at peak-1, peak, peak+1
    y0 = autocorr_at(peak_idx - 1)
    y1 = autocorr_at(peak_idx)
    y2 = autocorr_at(peak_idx + 1)

    // Parabolic peak finding
    d = (y0 - y2) / (2 * (y0 - 2*y1 + y2))

    return peak_idx + d

function autocorr_at(lag) -> float:
    sum = 0
    for i in 0..(buffer.length - lag):
        sum += buffer[i] * buffer[i + lag]
    return sum
```

### Zero-Crossing Detector (Simple/Fast)

```
struct ZeroCrossingDetector:
    buffer: array[float]
    buffer_pos: int = 0
    sampleRate: float
    detected_freq: float = 0

function new(sampleRate):
    buffer = array of 2048 zeros

function process(input):
    buffer[buffer_pos] = input
    buffer_pos += 1

    if buffer_pos >= buffer.length:
        detect_pitch()
        buffer_pos = 0

function frequency() -> float:
    return detected_freq

function detect_pitch():
    crossings = empty list

    // Find positive-going zero crossings
    for i in 1..buffer.length:
        if buffer[i-1] <= 0 and buffer[i] > 0:
            // Linear interpolation for sub-sample accuracy
            fraction = -buffer[i-1] / (buffer[i] - buffer[i-1])
            crossings.append((i-1) + fraction)

    if crossings.length >= 2:
        // Average period from consecutive crossings
        total_period = 0
        count = 0

        for i in 1..crossings.length:
            period = crossings[i] - crossings[i-1]
            // Filter out unreasonable periods
            if period > 10 and period < 1000:
                total_period += period
                count += 1

        if count > 0:
            avg_period = total_period / count
            detected_freq = sampleRate / avg_period
```

### YIN Pitch Detector (High Accuracy)

```
struct YinPitchDetector:
    buffer: array[float]
    yin_buffer: array[float]
    buffer_pos: int = 0
    sampleRate: float
    threshold: float = 0.15     // Typically 0.1-0.2

    detected_freq: float = 0
    confidence: float = 0

function new(sampleRate, buffer_size):
    buffer = array of buffer_size zeros
    yin_buffer = array of (buffer_size / 2) zeros

function set_threshold(threshold):
    this.threshold = clamp(threshold, 0.05, 0.5)

function process(input):
    buffer[buffer_pos] = input
    buffer_pos += 1

    if buffer_pos >= buffer.length:
        detect_pitch()
        buffer_pos = 0

function frequency() -> float:
    return detected_freq

function confidence() -> float:
    return this.confidence

function detect_pitch():
    half = buffer.length / 2

    // Step 2: Difference function
    for tau in 0..half:
        sum = 0
        for i in 0..half:
            diff = buffer[i] - buffer[i + tau]
            sum += diff * diff
        yin_buffer[tau] = sum

    // Step 3: Cumulative mean normalized difference
    yin_buffer[0] = 1
    running_sum = 0

    for tau in 1..half:
        running_sum += yin_buffer[tau]
        yin_buffer[tau] *= tau / running_sum

    // Step 4: Absolute threshold
    tau_estimate = 2
    while tau_estimate < half:
        if yin_buffer[tau_estimate] < threshold:
            // Found a dip below threshold
            while tau_estimate + 1 < half and
                  yin_buffer[tau_estimate + 1] < yin_buffer[tau_estimate]:
                tau_estimate += 1
            break
        tau_estimate += 1

    if tau_estimate >= half:
        detected_freq = 0
        confidence = 0
        return

    // Step 5: Parabolic interpolation
    if tau_estimate > 0 and tau_estimate < half - 1:
        s0 = yin_buffer[tau_estimate - 1]
        s1 = yin_buffer[tau_estimate]
        s2 = yin_buffer[tau_estimate + 1]

        d = (s0 - s2) / (2 * (s0 - 2*s1 + s2))
        better_tau = tau_estimate + d
    else:
        better_tau = tau_estimate

    detected_freq = sampleRate / better_tau
    confidence = 1 - min(yin_buffer[tau_estimate], 1)
```

### Utility Functions

```
function midi_to_note_name(midi) -> string:
    note_names = ["C", "C#", "D", "D#", "E", "F",
                  "F#", "G", "G#", "A", "A#", "B"]
    rounded = round(midi)
    note_idx = ((rounded mod 12) + 12) mod 12
    octave = (rounded / 12) - 1
    return note_names[note_idx] + octave

function freq_to_midi(freq) -> float:
    return 69 + 12 * log2(freq / 440)

function midi_to_freq(midi) -> float:
    return 440 * pow(2, (midi - 69) / 12)
```

## Implementation Notes

### Parameters Guide

| Parameter | Range | Default | Purpose |
|-----------|-------|---------|---------|
| Buffer size | 1024-4096 | 2048 | Lower = faster, higher = more accurate for low freq |
| Threshold (YIN) | 0.05-0.5 | 0.15 | Lower = stricter, fewer false positives |
| Min frequency | 20-500 Hz | 60 Hz | Lowest detectable pitch |
| Max frequency | 200-5000 Hz | 1400 Hz | Highest detectable pitch |

### Buffer Size vs Accuracy

| Buffer | Min Freq at 48kHz | Latency |
|--------|-------------------|---------|
| 1024 | ~47 Hz | ~21 ms |
| 2048 | ~23 Hz | ~43 ms |
| 4096 | ~12 Hz | ~85 ms |

### Improving Detection

- Add low-pass filter before detection for noisy signals
- Use windowing (Hann) to reduce edge artifacts
- For real-time, use overlapping buffers with hop size
- Confidence threshold helps reject noise/polyphonic input

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `f32::log2()` for MIDI conversion
- Consider `VecDeque` for ring buffer
- Use `#[inline]` on inner loops

**C++ (JUCE/iPlug2):**
- Use `std::log2` from `<cmath>`
- Consider FFT-based autocorrelation for performance
- JUCE: Consider `Tuner` example in extras

**Key Considerations:**
- YIN is most accurate for monophonic pitch detection
- Buffer size limits lowest detectable frequency
- Parabolic interpolation improves sub-sample accuracy
- All methods assume monophonic input
