---
name: ChowDSP WDF
description: Wave Digital Filter library for accurate analog circuit emulation. Essential for authentic tube amp, pedal, and vintage filter modeling.
url: https://github.com/Chowdhury-DSP/chowdsp_wdf
license: BSD-3-Clause
copyright: Jatin Chowdhury
tags: [circuit-modeling, wdf, analog, tube, guitar, filters]
---

# ChowDSP WDF (Wave Digital Filters)

Library for modeling analog circuits using wave digital filter methodology.

## Overview

Wave Digital Filters (WDFs) are a mathematical framework for simulating analog circuits in the digital domain. Unlike simple DSP approximations, WDFs model the actual circuit topology, preserving nonlinear behavior and component interactions.

## When to Use

| Use Case | Why ChowDSP WDF |
|----------|-----------------|
| Tube amp modeling | Accurate triode/pentode behavior |
| Guitar pedal emulation | Authentic diode/transistor clipping |
| Vintage filter recreation | Moog ladder, TB-303 filter character |
| Preamp modeling | Tube warmth with proper saturation curves |

## Key Capabilities

- **Analog Circuit Simulation**: Model real circuits, not just approximations
- **Nonlinear Components**: Diodes, transistors, tubes with authentic behavior
- **Reactive Components**: Accurate capacitor and inductor modeling
- **Circuit Topology Preservation**: Wave scattering captures interactions

## Circuit Elements Supported

- Resistors, capacitors, inductors
- Ideal voltage/current sources
- Diodes (various models)
- Transistors (BJT)
- Vacuum tubes (triode, pentode)

## Example Use Cases

### Tube Preamp Stage
Model a 12AX7 triode stage with realistic saturation curves and frequency response.

### Diode Clipper
Authentic asymmetric clipping from germanium or silicon diodes.

### Passive Tone Stack
Marshall/Fender style tone controls with proper interaction.

## Attribution Required

```rust
// Based on chowdsp_wdf by Jatin Chowdhury
// License: BSD-3-Clause
// https://github.com/Chowdhury-DSP/chowdsp_wdf
```

## Resources

- **Repository**: https://github.com/Chowdhury-DSP/chowdsp_wdf
- **Documentation**: Included in repository
- **Theory**: "Wave Digital Filters" by Fettweis (1986)
- **Blog**: https://jatinchowdhury18.medium.com/

## Related

- RTNeural for neural amp modeling approach
- Airwindows for simpler saturation effects
- /saturation recipe for basic waveshaping
