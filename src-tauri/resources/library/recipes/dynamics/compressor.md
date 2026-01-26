---
name: Compressor
description: Dynamic range compressor with attack/release, ratio, threshold, and knee. Includes RMS and peak detection modes.
tags: [dynamics, compressor, mixing, effect]
source: Classic dynamics processing
license: Public Domain
---

# Compressor Algorithm

Dynamic range compressor with smooth gain reduction.

## Source Attribution

- **Source**: Standard audio engineering principles
- **License**: Algorithm (no specific source - common knowledge)
- **References**:
  - Digital Audio FX (DAFX) literature
  - Airwindows (MIT) for production-quality implementations

## Algorithm Description

A compressor reduces the dynamic range of audio by applying gain reduction when the signal exceeds a threshold. Key components:

1. **Level Detection**: Measure input level (peak or RMS)
2. **Envelope Follower**: Smooth the detected level with attack/release
3. **Gain Computer**: Calculate how much gain reduction to apply
4. **Gain Stage**: Apply the calculated gain reduction

## Parameters

| Parameter | Typical Range | Description |
|-----------|---------------|-------------|
| Threshold | -40 to 0 dB | Level above which compression begins |
| Ratio | 1:1 to 20:1 | Compression amount (4:1 = 4dB over threshold → 1dB output) |
| Attack | 0.1 to 100 ms | How fast compression engages |
| Release | 10 to 1000 ms | How fast compression releases |
| Knee | 0 to 12 dB | Transition smoothness around threshold |
| Makeup Gain | 0 to 20 dB | Compensate for reduced level |

## Pseudocode

### Time Constant Coefficients

```
FUNCTION calculate_attack_coef(attack_ms, sample_rate):
    RETURN exp(-1.0 / (attack_ms * 0.001 * sample_rate))

FUNCTION calculate_release_coef(release_ms, sample_rate):
    RETURN exp(-1.0 / (release_ms * 0.001 * sample_rate))
```

### Level Detection

```
// Peak detection (faster response)
FUNCTION detect_peak(sample):
    RETURN abs(sample)

// RMS detection (smoother, use circular buffer)
STRUCT RmsDetector:
    buffer[]     // Circular buffer, size = sample_rate * window_ms / 1000
    index = 0
    sum = 0

FUNCTION detect_rms(detector, sample):
    squared = sample * sample
    detector.sum = detector.sum - detector.buffer[detector.index] + squared
    detector.buffer[detector.index] = squared
    detector.index = (detector.index + 1) MOD length(detector.buffer)
    RETURN sqrt(detector.sum / length(detector.buffer))
```

### Gain Computer (with Soft Knee)

```
FUNCTION compute_gain_reduction(input_db, threshold_db, ratio, knee_db):
    knee_half = knee_db / 2
    knee_start = threshold_db - knee_half
    knee_end = threshold_db + knee_half

    IF input_db < knee_start:
        // Below knee - no compression
        RETURN 0

    ELSE IF input_db > knee_end OR knee_db <= 0:
        // Above knee - full compression
        overshoot = input_db - threshold_db
        RETURN overshoot * (1 - 1/ratio)

    ELSE:
        // In knee region - gradual compression (quadratic curve)
        x = input_db - knee_start
        knee_factor = x / knee_db
        RETURN x * knee_factor * (1 - 1/ratio) / 2
```

### Envelope Follower

```
FUNCTION update_envelope(current_envelope, target_db, attack_coef, release_coef):
    IF target_db > current_envelope:
        coef = attack_coef
    ELSE:
        coef = release_coef

    new_envelope = target_db + coef * (current_envelope - target_db)

    // Safety check
    IF NOT is_finite(new_envelope):
        new_envelope = -200

    RETURN new_envelope
```

### Complete Processing

```
STRUCT Compressor:
    threshold_db, ratio, attack_coef, release_coef, knee_db, makeup_db
    envelope = -200  // Start silent
    detection_mode   // PEAK or RMS
    rms_detector     // If using RMS mode

FUNCTION process(comp, input):
    // 1. Level detection
    IF comp.detection_mode == PEAK:
        level = abs(input)
    ELSE:
        level = detect_rms(comp.rms_detector, input)

    // 2. Convert to dB (with floor to avoid log(0))
    IF level > 1e-10:
        level_db = 20 * log10(level)
    ELSE:
        level_db = -200

    // 3. Update envelope
    comp.envelope = update_envelope(
        comp.envelope, level_db,
        comp.attack_coef, comp.release_coef
    )

    // 4. Compute gain reduction
    gain_reduction_db = compute_gain_reduction(
        comp.envelope, comp.threshold_db,
        comp.ratio, comp.knee_db
    )

    // 5. Apply gain
    total_gain_db = -gain_reduction_db + comp.makeup_db
    gain = 10^(total_gain_db / 20)
    output = input * gain

    // 6. Safety check
    IF NOT is_finite(output):
        output = 0

    RETURN (output, gain_reduction_db)
```

### Stereo Linked Processing

```
FUNCTION process_stereo_linked(comp, left, right):
    // Use max of both channels for detection
    level = max(abs(left), abs(right))

    // Process to get gain reduction
    (_, gain_reduction) = process(comp, level)

    // Apply same gain to both channels
    total_gain_db = -gain_reduction + comp.makeup_db
    gain = 10^(total_gain_db / 20)

    RETURN (left * gain, right * gain, gain_reduction)
```

## Implementation Notes

### Detection Mode Choice
- **Peak**: Faster response, catches transients, good for drums/bus limiting
- **RMS**: Smoother response, better for vocals/bus compression, more "musical"

### Attack/Release Guidelines
- Fast attack (0.1-5ms): Clamps transients, can sound "pumpy"
- Slow attack (10-50ms): Preserves transients, more natural
- Fast release (10-50ms): Quick recovery, can sound aggressive
- Slow release (100-500ms): Smooth, natural, good for mastering

### Soft Knee
- Hard knee (0 dB): Abrupt compression onset
- Soft knee (6-12 dB): Gradual compression, more transparent
- Use soft knee for bus compression and mastering

### Common Presets
| Use Case | Threshold | Ratio | Attack | Release | Knee |
|----------|-----------|-------|--------|---------|------|
| Vocals | -20 dB | 3:1 | 10 ms | 100 ms | 6 dB |
| Drums | -15 dB | 4:1 | 1 ms | 50 ms | 0 dB |
| Bus | -12 dB | 2:1 | 30 ms | 200 ms | 6 dB |
| Mastering | -6 dB | 1.5:1 | 30 ms | 300 ms | 12 dB |

## Adapt to Your Framework

When implementing, use your framework's conventions:
- **Rust/nih-plug**: Use parameter smoothing for threshold/ratio changes
- **C++/JUCE**: Consider juce::dsp::Compressor or implement custom
- **C++/iPlug2**: Integrate with IPlugProcessor parameter system

Consult `/dsp-catalog` for production-quality implementations (Airwindows Pressure, etc.).
