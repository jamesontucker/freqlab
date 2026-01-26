---
name: Noise Generators
description: White, pink, and brown noise generators for synthesis, testing, and effect design. Includes filtered noise and sample-and-hold.
tags: [noise, white-noise, pink-noise, synthesis, utility, random]
source: Classic noise generation algorithms
license: Public Domain
---

# Noise Generators

Various noise colors for synthesis and testing.

## Source Attribution

```
// Classic noise generation algorithms - Public Domain
// Pink noise filter coefficients by Paul Kellet
// No attribution required
```

## Algorithm Description

Noise generators produce random signals with different spectral characteristics:

- **White noise**: Flat frequency spectrum (equal energy per Hz)
- **Pink noise**: -3dB/octave rolloff (equal energy per octave)
- **Brown noise**: -6dB/octave rolloff (integrated white noise)

### Noise Color Spectrum

| Type | Spectrum | Perceived Sound |
|------|----------|-----------------|
| White | Flat | Harsh, bright |
| Pink | -3dB/octave | Natural, balanced |
| Brown | -6dB/octave | Rumbling, warm |

## Pseudocode

### Random Number Generator (XORShift)

```
struct Rng:
    state: uint32

function new(seed):
    state = seed if seed != 0 else 1

function next_u32() -> uint32:
    // XORShift32 algorithm
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return state

function next_f32() -> float:
    // Returns [0, 1)
    return next_u32() / MAX_UINT32

function next_bipolar() -> float:
    // Returns [-1, 1)
    return next_f32() * 2 - 1
```

### White Noise

```
struct WhiteNoise:
    rng: Rng

function new():
    rng = Rng.new(12345)

function with_seed(seed):
    rng = Rng.new(seed)

function next() -> float:
    return rng.next_bipolar()
```

### Pink Noise (Paul Kellet's Method)

```
struct PinkNoise:
    rng: Rng
    b0, b1, b2, b3, b4, b5, b6: float = 0

function new():
    rng = Rng.new(12345)

function reset():
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0

function next() -> float:
    white = rng.next_bipolar()

    // Filter bank with different decay rates
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.96900 * b2 + white * 0.1538520
    b3 = 0.86650 * b3 + white * 0.3104856
    b4 = 0.55000 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.0168980

    pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
    b6 = white * 0.115926

    return pink * 0.11    // Normalize to roughly [-1, 1]
```

### Brown Noise (Brownian/Random Walk)

```
struct BrownNoise:
    rng: Rng
    last: float = 0
    leak: float = 0.02    // Prevents DC buildup

function new():
    rng = Rng.new(12345)

function reset():
    last = 0

function next() -> float:
    white = rng.next_bipolar()

    // Leaky integrator
    last = last * (1 - leak) + white * 0.1

    // Soft clip to prevent runaway
    last = clamp(last, -1, 1)

    return last
```

### Sample and Hold

```
struct SampleAndHold:
    rng: Rng
    value: float = 0
    counter: float = 0
    rate: float            // Samples between changes

function new(rate_hz, sampleRate):
    rng = Rng.new(12345)
    rate = sampleRate / rate_hz

function set_rate(rate_hz, sampleRate):
    rate = sampleRate / max(rate_hz, 0.1)

function reset():
    value = 0
    counter = 0

function next() -> float:
    counter += 1
    if counter >= rate:
        counter -= rate
        value = rng.next_bipolar()
    return value

function next_smooth(slew) -> float:
    // With slew limiting for smoother transitions
    counter += 1
    target = value
    if counter >= rate:
        counter -= rate
        target = rng.next_bipolar()

    diff = target - value
    value += diff * clamp(slew, 0, 1)
    return value
```

### Dust (Sparse Impulses)

```
struct Dust:
    rng: Rng
    density: float    // Probability per sample

function new(density_hz, sampleRate):
    rng = Rng.new(12345)
    density = density_hz / sampleRate

function set_density(density_hz, sampleRate):
    density = clamp(density_hz / sampleRate, 0, 1)

function next() -> float:
    if rng.next_f32() < density:
        return rng.next_bipolar()    // Random amplitude impulse
    else:
        return 0
```

### Velvet Noise (Sparse +/-1 Impulses)

```
struct VelvetNoise:
    rng: Rng
    density: float

function new(density_hz, sampleRate):
    rng = Rng.new(12345)
    density = density_hz / sampleRate

function set_density(density_hz, sampleRate):
    density = density_hz / sampleRate

function next() -> float:
    if rng.next_f32() < density:
        // Return +1 or -1 randomly
        return 1.0 if rng.next_f32() < 0.5 else -1.0
    else:
        return 0
```

### Crackle (Chaotic Noise)

```
struct Crackle:
    y: array[2] = [0.3, 0.3]
    param: float = 1.5    // Chaos parameter (1.0-2.0)
    rng: Rng

function new():
    rng = Rng.new(12345)

function set_chaos(chaos):
    param = clamp(chaos, 1, 2)

function next() -> float:
    // Chaotic noise generator
    y0 = abs(abs(y[1]) - param) * sign(y[1]) + rng.next_f32() * 0.001

    y[1] = y[0]
    y[0] = y0

    return clamp(y0, -1, 1)
```

## Implementation Notes

### Noise Color Comparison

| Type | Spectrum | Sound | Use For |
|------|----------|-------|---------|
| White | Flat | Harsh, bright | Testing, hi-hats |
| Pink | -3dB/oct | Natural, balanced | Mixing reference, snares |
| Brown | -6dB/oct | Rumbling, warm | Wind, ocean, bass |
| S&H | Stepped | Robotic, random | Modulation source |
| Dust | Sparse impulses | Crackle | Vinyl simulation |
| Velvet | Sparse ±1 | Textured | Reverb tails |

### Applications

| Application | Recommended Noise |
|-------------|-------------------|
| Testing speakers/room | Pink |
| Synthesizer oscillator | White, Pink |
| Wind/ocean ambience | Brown |
| Vinyl crackle | Dust, Crackle |
| Random modulation | Sample & Hold |
| Reverb tail enhancement | Velvet |
| Hi-hat synthesis | White (filtered) |

### RNG Quality

For audio, a simple PRNG like XORShift is sufficient. Cryptographic quality is not needed.

| Algorithm | Speed | Quality | Audio Use |
|-----------|-------|---------|-----------|
| XORShift | Fastest | Good | Recommended |
| LCG | Fast | Poor | Avoid (correlated) |
| Mersenne Twister | Medium | Excellent | Overkill |
| Cryptographic | Slow | Perfect | Overkill |

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `rand` crate or implement simple XORShift
- Consider `fastrand` for lightweight RNG
- Wrap in struct for per-voice seeding

**C++ (JUCE/iPlug2):**
- Use `std::minstd_rand` or custom XORShift
- JUCE: `Random::getSystemRandom()` for convenience
- Avoid `std::random_device` per-sample (too slow)

**Key Considerations:**
- White noise has equal energy per Hz (sounds bright)
- Pink noise has equal energy per octave (sounds natural)
- Brown noise is integrated white noise (low frequency emphasis)
- Always seed your RNG for reproducibility if needed
- Use pink noise for testing audio systems (matches human hearing)
