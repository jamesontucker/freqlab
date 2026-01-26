---
name: HIIR
description: High-quality half-band IIR filters for efficient oversampling. SIMD optimized with minimal latency.
url: http://ldesoras.free.fr/prod.html
license: WTFPL (Public Domain equivalent)
copyright: Laurent de Soras
tags: [oversampling, filter, simd, antialiasing, public-domain]
---

# HIIR (Half-band IIR Filters)

Efficient oversampling library using polyphase half-band IIR filters.

## Overview

HIIR provides 2x upsampling and downsampling with excellent stopband rejection and minimal latency. The polyphase implementation is extremely efficient, especially with SIMD.

## When to Use

| Use Case | Why HIIR |
|----------|----------|
| Saturation/distortion | Reduce aliasing from harmonics |
| Waveshaping | Clean up nonlinear processing |
| Sample rate conversion | 2x, 4x, 8x oversampling |
| Anti-aliasing | Pre-filter before decimation |

## Key Features

- **Polyphase structure**: Efficient half-band design
- **SIMD optimization**: SSE, AVX, NEON
- **Low latency**: Minimal group delay
- **Configurable order**: Trade-off quality vs CPU

## Oversampling Workflow

```
1. Upsample 2x (insert zeros, filter)
2. Process at 2x rate (saturation, etc.)
3. Downsample 2x (filter, decimate)

For 4x: Chain two 2x stages
For 8x: Chain three 2x stages
```

## Quality Levels

| Order | Stopband | Latency | CPU |
|-------|----------|---------|-----|
| 4 | -36 dB | ~2 samples | Low |
| 8 | -70 dB | ~4 samples | Medium |
| 12 | -100 dB | ~6 samples | Higher |

## No Attribution Required

WTFPL license is effectively public domain - no attribution necessary.

```rust
// Oversampling using HIIR half-band filters
// Public domain - no attribution required
// http://ldesoras.free.fr/prod.html
```

## Resources

- **Download**: http://ldesoras.free.fr/prod.html
- **Documentation**: Included in download
- **Theory**: Polyphase filter banks, multirate signal processing

## Related

- /oversampling recipe for implementation details
- /saturation recipe (benefits from oversampling)
- /soft-clip recipe (benefits from oversampling)
