---
name: Synthesis Toolkit (STK)
description: Physical modeling synthesis library with waveguide models for strings, wind instruments, and FM synthesis. Academic reference quality.
url: https://github.com/thestk/stk
license: MIT
copyright: Perry Cook, Gary Scavone
tags: [physical-modeling, fm, waveguide, synth, strings, wind]
---

# Synthesis Toolkit (STK)

The standard reference for physical modeling synthesis, maintained since 1995.

## Overview

STK provides well-documented implementations of synthesis algorithms, particularly physical modeling using waveguide synthesis. Used in academic research and commercial products.

## When to Use

| Use Case | Why STK |
|----------|---------|
| String instruments | Plucked/bowed string waveguides |
| Wind instruments | Flute, clarinet, brass models |
| FM synthesis | Classic DX7-style algorithms |
| Drum synthesis | Physical membrane models |
| Learning DSP | Extremely well-documented code |

## Key Algorithms

### Physical Modeling
- **Plucked strings**: Karplus-Strong, waveguide strings
- **Bowed strings**: Bow-string interaction models
- **Wind instruments**: Flute, clarinet, saxophone, brass
- **Percussion**: Membrane, bar, modal models

### Classic Synthesis
- **FM**: 2/4 operator FM synthesis
- **Wavetable**: Basic wavetable oscillators
- **Subtractive**: Filters and envelopes

## Notable Classes

| Class | Purpose |
|-------|---------|
| `Plucked` | Karplus-Strong plucked string |
| `Bowed` | Bowed string physical model |
| `Flute` | Waveguide flute model |
| `Clarinet` | Single reed instrument |
| `Rhodey` | Rhodes electric piano |
| `Wurley` | Wurlitzer electric piano |
| `FMVoices` | 4-operator FM voices |

## Attribution Required

```rust
// Based on the Synthesis Toolkit (STK)
// Copyright (c) Perry Cook, Gary Scavone
// License: MIT
// https://github.com/thestk/stk
```

## Resources

- **Repository**: https://github.com/thestk/stk
- **Documentation**: https://ccrma.stanford.edu/software/stk/
- **Book**: "Real Sound Synthesis for Interactive Applications" by Perry Cook

## Related

- Julius O. Smith books for underlying theory
- Mutable Instruments for modern physical modeling
- /polyblep recipe for basic oscillator anti-aliasing
