---
name: Spectrum Analysis
description: FFT-based spectrum analysis with windowing, magnitude calculation, and frequency bin utilities. Building block for analyzers and visualizers.
tags: [fft, spectrum, analysis, frequency, visualization, utility]
source: Classic signal analysis techniques
license: Public Domain
---

# Spectrum Analysis

FFT-based frequency analysis for visualization and analysis tools.

## Source Attribution

```
// FFT-based spectrum analysis - Public Domain
// Standard signal processing technique
// Windowing functions are standard math formulas
// No attribution required
```

## Algorithm Description

Spectrum analysis converts time-domain audio into frequency-domain representation using the Fast Fourier Transform (FFT).

### Key Concepts

- **FFT Size**: Determines frequency resolution (resolution = sampleRate / fftSize)
- **Windowing**: Reduces spectral leakage at frame boundaries
- **Magnitude**: sqrt(re² + im²) gives the amplitude of each frequency bin
- **Phase**: atan2(im, re) gives the phase angle

### Resolution Trade-off

| FFT Size | Resolution at 48kHz | Time Resolution |
|----------|---------------------|-----------------|
| 512 | 94 Hz | 11 ms |
| 1024 | 47 Hz | 21 ms |
| 2048 | 23 Hz | 43 ms |
| 4096 | 12 Hz | 85 ms |

## Pseudocode

### Window Functions

```
enum WindowType:
    Rectangle
    Hann
    Hamming
    Blackman
    BlackmanHarris
    FlatTop

function generate_window(window_type, size) -> array[float]:
    window = new array of size floats
    n = size

    for i in 0..size:
        x = i / n    // 0 to 1

        switch window_type:
            Rectangle:
                window[i] = 1.0

            Hann:
                window[i] = 0.5 * (1 - cos(2π * x))

            Hamming:
                window[i] = 0.54 - 0.46 * cos(2π * x)

            Blackman:
                window[i] = 0.42 - 0.5 * cos(2π * x) + 0.08 * cos(4π * x)

            BlackmanHarris:
                window[i] = 0.35875 - 0.48829 * cos(2π * x)
                          + 0.14128 * cos(4π * x) - 0.01168 * cos(6π * x)

            FlatTop:
                window[i] = 0.21557895 - 0.41663158 * cos(2π * x)
                          + 0.277263158 * cos(4π * x)
                          - 0.083578947 * cos(6π * x)
                          + 0.006947368 * cos(8π * x)

    return window
```

### Spectrum Analyzer

```
struct SpectrumAnalyzer:
    fft_size: int
    sampleRate: float

    // FFT state (uses external FFT library)
    fft_input: array[Complex]
    fft_output: array[Complex]
    window: array[float]

    // Input buffer
    input_buffer: array[float]
    write_pos: int = 0

    // Output
    magnitudes: array[float]       // Linear magnitude (0-1)
    magnitudes_db: array[float]    // dB magnitude
    phases: array[float]           // Phase in radians

function new(fft_size, sampleRate):
    // Ensure power of 2
    fft_size = next_power_of_two(fft_size)
    window = generate_window(Hann, fft_size)

    fft_input = array of fft_size Complex zeros
    fft_output = array of fft_size Complex zeros
    input_buffer = array of fft_size zeros

    bin_count = fft_size / 2 + 1
    magnitudes = array of bin_count zeros
    magnitudes_db = array of bin_count, filled with -120
    phases = array of bin_count zeros

function set_window(window_type):
    window = generate_window(window_type, fft_size)

function fft_size() -> int:
    return this.fft_size

function bin_count() -> int:
    return fft_size / 2 + 1

function bin_to_frequency(bin) -> float:
    return bin * sampleRate / fft_size

function frequency_to_bin(freq) -> int:
    return min(round(freq * fft_size / sampleRate), fft_size / 2)

function process(input) -> bool:
    // Returns true when FFT is ready
    input_buffer[write_pos] = input
    write_pos += 1

    if write_pos >= fft_size:
        compute_fft()
        write_pos = 0
        return true
    return false

function process_block(samples: array[float]):
    for sample in samples:
        process(sample)

function compute_fft():
    // Apply window and convert to complex
    for i in 0..fft_size:
        fft_input[i] = Complex(input_buffer[i] * window[i], 0)

    // Perform FFT (using external library)
    fft_output = FFT.forward(fft_input)

    // Calculate magnitudes and phases
    scale = 2.0 / fft_size

    for i in 0..(fft_size / 2 + 1):
        re = fft_output[i].real
        im = fft_output[i].imag

        // Magnitude
        mag = sqrt(re*re + im*im) * scale
        magnitudes[i] = mag

        // dB magnitude (with floor)
        if mag > 1e-10:
            magnitudes_db[i] = 20 * log10(mag)
        else:
            magnitudes_db[i] = -120

        // Phase
        phases[i] = atan2(im, re)

function peak() -> (float, float):
    // Returns (frequency, magnitude)
    max_mag = 0
    max_bin = 0

    for i, mag in enumerate(magnitudes):
        if mag > max_mag:
            max_mag = mag
            max_bin = i

    return (bin_to_frequency(max_bin), max_mag)

function band_energy(low_freq, high_freq) -> float:
    low_bin = frequency_to_bin(low_freq)
    high_bin = frequency_to_bin(high_freq)

    sum = 0
    for i in low_bin..(high_bin + 1):
        sum += magnitudes[i]^2

    return sqrt(sum)
```

### Smoothed Spectrum (For Visualization)

```
struct SmoothedSpectrum:
    current: array[float]
    attack: float = 0.7      // Fast attack
    release: float = 0.95    // Slow release

function new(bin_count):
    current = array of bin_count, filled with -120

function set_smoothing(attack, release):
    this.attack = clamp(attack, 0, 0.99)
    this.release = clamp(release, 0, 0.999)

function update(new_values: array[float]):
    for i in 0..current.length:
        if new_values[i] > current[i]:
            coef = attack
        else:
            coef = release
        current[i] = new_values[i] + coef * (current[i] - new_values[i])

function values() -> array[float]:
    return current
```

### Log-Spaced Bin Converter

```
struct LogBinConverter:
    log_bins: int
    mapping: array[(start_bin, end_bin)]

function new(fft_size, sampleRate, log_bins, min_freq, max_freq):
    bin_count = fft_size / 2 + 1
    mapping = empty array

    for i in 0..log_bins:
        // Log-spaced frequency
        ratio = i / (log_bins - 1)
        freq_low = min_freq * pow(max_freq / min_freq, ratio)
        freq_high = min_freq * pow(max_freq / min_freq, (i+1) / log_bins)

        bin_low = clamp(round(freq_low * fft_size / sampleRate), 0, bin_count - 1)
        bin_high = clamp(round(freq_high * fft_size / sampleRate), bin_low, bin_count - 1)

        mapping.append((bin_low, bin_high))

function convert(linear_spectrum) -> array[float]:
    result = empty array

    for (start, end) in mapping:
        if start == end:
            result.append(linear_spectrum[start])
        else:
            // Average bins in range
            sum = 0
            for i in start..(end + 1):
                sum += linear_spectrum[i]
            result.append(sum / (end - start + 1))

    return result
```

### Spectral Features

```
struct SpectralFeatures:

function centroid(magnitudes, sampleRate, fft_size) -> float:
    // Spectral centroid (brightness)
    bin_width = sampleRate / fft_size

    weighted_sum = 0
    mag_sum = 0

    for i, mag in enumerate(magnitudes):
        weighted_sum += i * bin_width * mag
        mag_sum += mag

    if mag_sum > 0:
        return weighted_sum / mag_sum
    return 0

function flatness(magnitudes) -> float:
    // Spectral flatness: 0 = tonal, 1 = noisy
    n = magnitudes.length

    // Geometric mean (via log)
    log_sum = sum(ln(x + 1e-10) for x in magnitudes)
    geometric_mean = exp(log_sum / n)

    // Arithmetic mean
    arithmetic_mean = sum(magnitudes) / n

    if arithmetic_mean > 0:
        return min(geometric_mean / arithmetic_mean, 1)
    return 0

function rolloff(magnitudes, sampleRate, fft_size, percent) -> float:
    // Frequency below which X% of energy is contained
    bin_width = sampleRate / fft_size

    total_energy = sum(x*x for x in magnitudes)
    threshold = total_energy * percent

    cumulative = 0
    for i, mag in enumerate(magnitudes):
        cumulative += mag * mag
        if cumulative >= threshold:
            return i * bin_width

    return sampleRate / 2
```

## Implementation Notes

### Window Function Comparison

| Window | Main Lobe | Side Lobes | Use For |
|--------|-----------|------------|---------|
| Rectangle | Narrowest | Worst (-13dB) | Analysis only |
| Hann | Medium | Good (-32dB) | General purpose |
| Hamming | Medium | Better (-43dB) | Speech |
| Blackman | Wide | Very good (-58dB) | Music |
| BlackmanHarris | Very wide | Excellent (-92dB) | High precision |
| FlatTop | Widest | Good | Amplitude accuracy |

### Common FFT Sizes

| Application | FFT Size | Notes |
|-------------|----------|-------|
| Real-time visualization | 512-1024 | Low latency |
| General analysis | 2048 | Good balance |
| High-resolution | 4096-8192 | Low frequencies |

### Overlap Processing

For smoother updates, use overlapping windows:
- 50% overlap: Hop = FFT_SIZE / 2
- 75% overlap: Hop = FFT_SIZE / 4

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `rustfft` crate for FFT
- `num_complex::Complex` for complex numbers
- Consider `realfft` for real-valued input

**C++ (JUCE/iPlug2):**
- JUCE: `dsp::FFT` for FFT operations
- JUCE: `dsp::WindowingFunction` for windows
- Consider FFTW for maximum performance

**Key Considerations:**
- FFT size determines frequency resolution
- Use overlapping windows for smoother visualization
- Hann window is best general-purpose choice
- Log-frequency display is more perceptually meaningful
- Smooth the output for pleasant visualization
