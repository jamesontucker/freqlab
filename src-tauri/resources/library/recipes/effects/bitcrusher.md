---
name: Bit Crusher
description: Bit depth and sample rate reduction for lo-fi digital effects. Creates aliasing and quantization noise for retro/chiptune sounds.
tags: [bitcrusher, lofi, retro, effect, distortion, quantization]
source: Classic digital effect design
license: Public Domain
---

# Bit Crusher

Reduce bit depth and sample rate for lo-fi effects.

## Source Attribution

```
// Classic bit crusher design - Public Domain
// Standard digital effect technique
// No attribution required
```

## Algorithm Description

Bit crushing reduces audio quality by:
1. **Bit Depth Reduction**: Quantizes amplitude to fewer levels
2. **Sample Rate Reduction**: Holds samples longer (sample-and-hold)

### Bit Depth Character

| Bits | Character | Similar To |
|------|-----------|------------|
| 1 | Extreme | 1-bit delta |
| 2-4 | Very harsh | Early games |
| 5-6 | Crunchy | NES, vintage |
| 8 | Gritty | Phone quality |
| 12 | Warm | Early CD |
| 16 | Clean | CD quality |
| 24 | Transparent | Pro audio |

## Pseudocode

### Basic Bit Crusher

```
struct BitCrusher:
    bits: int = 16              // Bit depth (1-24)
    rate_divisor: float = 1     // Sample rate reduction factor
    hold_counter: float = 0     // Sample hold counter
    held_sample: float = 0      // Currently held sample
    mix: float = 1              // Dry/wet mix

function new():
    // Defaults set above

function set_bits(bits):
    this.bits = clamp(bits, 1, 24)

function set_rate_divisor(divisor):
    // 1 = no change, 10 = 1/10th rate
    rate_divisor = clamp(divisor, 1, 100)

function set_target_rate(target_rate, actual_rate):
    rate_divisor = max(actual_rate / target_rate, 1)

function set_mix(mix):
    this.mix = clamp(mix, 0, 1)

function reset():
    hold_counter = 0
    held_sample = 0

function process(input) -> float:
    // Sample rate reduction via sample-and-hold
    hold_counter += 1
    if hold_counter >= rate_divisor:
        hold_counter -= rate_divisor
        held_sample = quantize(input)

    // Mix dry and crushed
    return input * (1 - mix) + held_sample * mix

function quantize(input) -> float:
    // Number of quantization levels
    levels = 2^bits
    half_levels = levels / 2

    // Quantize to bit depth
    scaled = round(input * half_levels)
    return scaled / half_levels
```

### Advanced Bit Crusher

```
struct AdvancedBitCrusher:
    // Bit depth
    bits: float = 16            // Fractional bits allowed
    dither_amount: float = 0    // Random dither before quantization

    // Sample rate reduction
    rate_divisor: float = 1
    jitter: float = 0           // Random variation in hold time
    hold_counter: float = 0
    held_sample: float = 0

    // Character
    asymmetry: float = 0        // Asymmetric quantization (tube-like)

    // State
    rng_state: int = 12345
    mix: float = 1

function new():
    // Defaults set above

function set_bits(bits):
    // Can be fractional for smooth transitions
    this.bits = clamp(bits, 1, 24)

function set_dither(amount):
    dither_amount = clamp(amount, 0, 1)

function set_rate_divisor(divisor):
    rate_divisor = clamp(divisor, 1, 100)

function set_jitter(jitter):
    this.jitter = clamp(jitter, 0, 1)

function set_asymmetry(asymmetry):
    this.asymmetry = clamp(asymmetry, 0, 1)

function set_mix(mix):
    this.mix = clamp(mix, 0, 1)

function reset():
    hold_counter = 0
    held_sample = 0

function next_random() -> float:
    // xorshift32
    rng_state ^= rng_state << 13
    rng_state ^= rng_state >> 17
    rng_state ^= rng_state << 5
    return (rng_state / MAX_INT) * 2 - 1    // -1 to 1

function process(input) -> float:
    // Sample rate reduction with jitter
    jitter_offset = 0
    if jitter > 0:
        jitter_offset = next_random() * jitter * rate_divisor * 0.5

    hold_counter += 1
    threshold = rate_divisor + jitter_offset

    if hold_counter >= threshold:
        hold_counter -= rate_divisor
        held_sample = quantize(input)

    return input * (1 - mix) + held_sample * mix

function quantize(input) -> float:
    // Fractional bit depth via interpolation
    bits_floor = floor(bits)
    bits_ceil = ceil(bits)
    frac = bits - bits_floor

    quant_floor = quantize_bits(input, bits_floor)
    quant_ceil = quantize_bits(input, bits_ceil)

    // Interpolate between bit depths
    return quant_floor * (1 - frac) + quant_ceil * frac

function quantize_bits(input, bits) -> float:
    levels = 2^min(bits, 24)
    half_levels = levels / 2

    // Add dither
    dithered = input
    if dither_amount > 0:
        dither = next_random() * dither_amount / half_levels
        dithered = input + dither

    // Asymmetric quantization
    if asymmetry > 0 and dithered > 0:
        // Positive values: fewer levels (more distortion)
        reduced_levels = half_levels * (1 - asymmetry * 0.5)
        scaled = round(dithered * reduced_levels)
        return clamp(scaled / reduced_levels, -1, 1)
    else:
        scaled = round(dithered * half_levels)
        return clamp(scaled / half_levels, -1, 1)
```

### Chiptune Crusher (Console Emulation)

```
enum ChiptuneConsole:
    Nes         // ~5-bit effective, ~44kHz
    GameBoy     // 4-bit, ~32kHz
    Atari2600   // ~4-bit, ~15.7kHz
    C64         // 4-bit, ~44kHz
    Custom      // User-defined

struct ChiptuneCrusher:
    crusher: BitCrusher
    console: ChiptuneConsole

function new(console, sampleRate):
    crusher = BitCrusher.new()

    switch console:
        Nes:
            crusher.set_bits(5)
            crusher.set_target_rate(44100, sampleRate)

        GameBoy:
            crusher.set_bits(4)
            crusher.set_target_rate(32768, sampleRate)

        Atari2600:
            crusher.set_bits(4)
            crusher.set_target_rate(15700, sampleRate)

        C64:
            crusher.set_bits(4)
            crusher.set_target_rate(44100, sampleRate)

        Custom:
            // Use defaults

function set_console(console, sampleRate):
    // Re-initialize with new console type
    this = ChiptuneCrusher.new(console, sampleRate)

function set_bits(bits):
    crusher.set_bits(bits)

function set_rate_divisor(divisor):
    crusher.set_rate_divisor(divisor)

function process(input) -> float:
    return crusher.process(input)
```

### Smooth Bit Crusher (With Anti-Aliasing)

```
struct SmoothBitCrusher:
    crusher: BitCrusher
    lowpass_z1: float = 0
    lowpass_coef: float

function new(sampleRate):
    crusher = BitCrusher.new()

    // Lowpass at effective Nyquist
    cutoff = sampleRate * 0.4    // Start high
    lowpass_coef = exp(-2π * cutoff / sampleRate)

function set_bits(bits):
    crusher.set_bits(bits)

function set_rate_divisor(divisor, sampleRate):
    crusher.set_rate_divisor(divisor)

    // Adjust lowpass based on effective sample rate
    effective_rate = sampleRate / divisor
    cutoff = min(effective_rate * 0.4, sampleRate * 0.49)
    lowpass_coef = exp(-2π * cutoff / sampleRate)

function reset():
    crusher.reset()
    lowpass_z1 = 0

function process(input) -> float:
    crushed = crusher.process(input)

    // Smooth out the steps
    lowpass_z1 = crushed + lowpass_coef * (lowpass_z1 - crushed)
    return lowpass_z1
```

## Implementation Notes

### Parameters Guide

| Parameter | Range | Default | Purpose |
|-----------|-------|---------|---------|
| Bits | 1-24 | 16 | Quantization resolution |
| Rate Divisor | 1-100 | 1 | Sample rate reduction |
| Dither | 0-1 | 0 | Reduces quantization noise |
| Jitter | 0-1 | 0 | Unstable/warped sound |
| Asymmetry | 0-1 | 0 | Tube-like distortion |
| Mix | 0-1 | 1 | Dry/wet blend |

### Sample Rate Reduction Effects

| Rate Divisor | At 48kHz | Character |
|--------------|----------|-----------|
| 1 | 48000 Hz | Clean |
| 2 | 24000 Hz | Slight dulling |
| 4 | 12000 Hz | Noticeable aliasing |
| 8 | 6000 Hz | Radio quality |
| 16 | 3000 Hz | Telephone |
| 32 | 1500 Hz | Extreme lo-fi |

### Reducing Aliasing

- Use the SmoothBitCrusher variant
- Apply 2x oversampling before crushing
- Lower rate divisor creates less aliasing

## Adapt to Your Framework

**Rust (nih-plug):**
- Use `u32` for RNG state (xorshift)
- Use `f32::floor()` and `f32::ceil()` for fractional bits
- Consider `#[inline]` on process function

**C++ (JUCE/iPlug2):**
- Use `std::floor` and `std::ceil` from `<cmath>`
- Consider `std::round` for quantization
- Use `std::uniform_real_distribution` for jitter

**Key Considerations:**
- Lower bit depth = more quantization noise
- Rate reduction creates aliasing (use oversampling if unwanted)
- Dither smooths out harsh quantization
- Jitter adds instability (VHS/tape feel)
- Chiptune presets emulate vintage consoles
