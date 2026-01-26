---
name: Wavetable Oscillator
description: Band-limited wavetable oscillator with interpolation. Generates classic waveforms (sine, saw, square, triangle) without aliasing.
tags: [oscillator, wavetable, synth, instrument, band-limited]
source: Classic digital synthesis
license: Public Domain
---

# Wavetable Oscillator

Band-limited wavetable oscillator for classic waveforms.

## Source Attribution

```
// Classic wavetable synthesis - Public Domain
// Additive synthesis for band-limiting
// No attribution required
```

## Algorithm Description

Wavetable oscillators pre-compute waveforms into lookup tables. To prevent aliasing at high frequencies, multiple tables are generated with decreasing harmonic content.

### Key Concepts

- **Table size**: Number of samples per waveform (typically 2048)
- **Band-limiting**: Generate tables with harmonics that don't exceed Nyquist
- **Interpolation**: Read fractional positions between samples
- **Table selection**: Choose appropriate table based on frequency

### Fourier Series (Additive Synthesis)

**Saw wave:**
```
saw(t) = Σ (2 / (n * π)) * (-1)^(n+1) * sin(n * 2π * t)    for n = 1, 2, 3...
```

**Square wave (odd harmonics only):**
```
square(t) = Σ (4 / (n * π)) * sin(n * 2π * t)    for n = 1, 3, 5...
```

**Triangle wave (odd harmonics only):**
```
triangle(t) = Σ (8 / (n * π)²) * (-1)^((n-1)/2) * sin(n * 2π * t)    for n = 1, 3, 5...
```

## Pseudocode

### Constants

```
TABLE_SIZE = 2048
NUM_OCTAVES = 10           // 20Hz to 20kHz ≈ 10 octaves
BASE_FREQUENCY = 20        // Lowest frequency

enum Waveform:
    Sine
    Saw
    Square
    Triangle
```

### Wavetable Generation

```
struct WavetableSet:
    tables: array[NUM_OCTAVES] of array[TABLE_SIZE] of float
    base_frequency: float = BASE_FREQUENCY

function generate(waveform, sampleRate):
    for octave in 0..NUM_OCTAVES:
        freq = base_frequency * 2^octave
        max_harmonic = floor(sampleRate / 2 / freq)

        table = tables[octave]
        fill table with 0

        switch waveform:
            Sine:
                for i in 0..TABLE_SIZE:
                    phase = (i / TABLE_SIZE) * 2π
                    table[i] = sin(phase)

            Saw:
                for harmonic in 1..min(max_harmonic, 512):
                    amplitude = 2 / (harmonic * π)
                    sign = -1 if harmonic is even else 1
                    for i in 0..TABLE_SIZE:
                        phase = (i / TABLE_SIZE) * 2π
                        table[i] += sign * amplitude * sin(harmonic * phase)

            Square:
                for harmonic in 1, 3, 5... up to min(max_harmonic, 512):
                    amplitude = 4 / (harmonic * π)
                    for i in 0..TABLE_SIZE:
                        phase = (i / TABLE_SIZE) * 2π
                        table[i] += amplitude * sin(harmonic * phase)

            Triangle:
                for harmonic in 1, 3, 5... up to min(max_harmonic, 512):
                    amplitude = 8 / (harmonic * π)²
                    sign = 1 if ((harmonic-1)/2) is even else -1
                    for i in 0..TABLE_SIZE:
                        phase = (i / TABLE_SIZE) * 2π
                        table[i] += sign * amplitude * sin(harmonic * phase)

        // Normalize table to [-1, 1]
        max_val = max(abs(table[i]) for all i)
        if max_val > 0:
            for i in 0..TABLE_SIZE:
                table[i] /= max_val

function table_index(frequency) -> int:
    octave = log2(frequency / base_frequency)
    idx = floor(octave)
    return clamp(idx, 0, NUM_OCTAVES - 1)

function read(table_idx, phase) -> float:
    // Linear interpolation
    table = tables[table_idx]
    pos = phase * TABLE_SIZE
    idx0 = floor(pos) mod TABLE_SIZE
    idx1 = (idx0 + 1) mod TABLE_SIZE
    frac = pos - floor(pos)

    return table[idx0] * (1 - frac) + table[idx1] * frac
```

### Wavetable Oscillator

```
struct WavetableOsc:
    wavetable: WavetableSet
    phase: float = 0
    phase_increment: float = 0
    frequency: float = 440
    sampleRate: float

function new(waveform, sampleRate):
    wavetable = WavetableSet.generate(waveform, sampleRate)

function set_frequency(freq):
    frequency = clamp(freq, 20, sampleRate / 2)
    phase_increment = frequency / sampleRate

function reset_phase():
    phase = 0

function set_phase(p):
    phase = p mod 1.0

function next() -> float:
    table_idx = wavetable.table_index(frequency)
    output = wavetable.read(table_idx, phase)

    phase += phase_increment
    if phase >= 1.0:
        phase -= 1.0

    return output
```

### Morph Oscillator (Waveform Crossfade)

```
struct MorphOsc:
    sine: WavetableOsc
    saw: WavetableOsc
    square: WavetableOsc
    triangle: WavetableOsc
    morph: float = 0        // 0=sine, 1=saw, 2=square, 3=triangle

function new(sampleRate):
    sine = WavetableOsc.new(Waveform.Sine, sampleRate)
    saw = WavetableOsc.new(Waveform.Saw, sampleRate)
    square = WavetableOsc.new(Waveform.Square, sampleRate)
    triangle = WavetableOsc.new(Waveform.Triangle, sampleRate)

function set_frequency(freq):
    sine.set_frequency(freq)
    saw.set_frequency(freq)
    square.set_frequency(freq)
    triangle.set_frequency(freq)

function set_morph(m):
    morph = clamp(m, 0, 3)

function reset_phase():
    sine.reset_phase()
    saw.reset_phase()
    square.reset_phase()
    triangle.reset_phase()

function next() -> float:
    s = sine.next()
    w = saw.next()
    q = square.next()
    t = triangle.next()

    waves = [s, w, q, t]

    // Crossfade between adjacent waveforms
    idx = floor(morph)
    frac = morph - idx

    if idx >= 3:
        return t
    else:
        return waves[idx] * (1 - frac) + waves[idx + 1] * frac
```

## Implementation Notes

### Table Size Trade-offs

| Table Size | Memory | Quality | Best For |
|------------|--------|---------|----------|
| 512 | Low | Lower | Lo-fi, many voices |
| 1024 | Medium | Good | General use |
| 2048 | Higher | Better | High-quality synthesis |
| 4096 | High | Best | Mastering quality |

### Interpolation Quality

| Method | Points | Quality | CPU |
|--------|--------|---------|-----|
| Linear | 2 | Good enough | Lowest |
| Cubic | 4 | Better | Low |
| Hermite | 4 | Best balance | Low |

### Band-Limiting

At high frequencies, fewer harmonics fit below Nyquist:
- 100 Hz: ~220 harmonics at 44.1kHz
- 1 kHz: ~22 harmonics
- 10 kHz: ~2 harmonics

Using one table for all frequencies causes aliasing. Multiple tables solve this.

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `Vec<[f32; TABLE_SIZE]>` for tables
- Consider `std::f32::consts::PI` for π
- Pre-generate tables in `new()` or lazily

**C++ (JUCE/iPlug2):**
- Use `std::vector<std::array<float, TABLE_SIZE>>` for tables
- JUCE: Consider `dsp::Oscillator` for basic needs
- Use `std::sin` from `<cmath>`

**Key Considerations:**
- Wavetables are pre-computed for efficiency
- Band-limiting prevents aliasing at high frequencies
- Linear interpolation is usually sufficient
- For PWM, use two saw waves with offset phase
- `MorphOsc` allows smooth transitions between waveforms
