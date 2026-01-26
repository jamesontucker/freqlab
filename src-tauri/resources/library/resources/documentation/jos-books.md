---
name: Julius O. Smith Online Books
description: Definitive academic references for digital signal processing, filter design, physical modeling, and spectral analysis. Free online textbooks.
url: https://ccrma.stanford.edu/~jos/
license: Algorithm (implement from description)
tags: [theory, filter, physical-modeling, fft, reference, academic]
---

# Julius O. Smith III Online Books

Stanford professor's comprehensive DSP textbooks, freely available online.

## Overview

Julius O. Smith's online books are the gold standard for DSP theory. They provide rigorous mathematical foundations while remaining accessible to practitioners.

## Books

### Introduction to Digital Filters
**URL**: https://ccrma.stanford.edu/~jos/filters/

Essential filter theory:
- Transfer functions and poles/zeros
- FIR and IIR filter design
- Biquad implementations
- Filter stability analysis
- Allpass and comb filters

### Physical Audio Signal Processing
**URL**: https://ccrma.stanford.edu/~jos/pasp/

Physical modeling synthesis:
- Waveguide synthesis theory
- String, wind, percussion models
- Delay line interpolation
- Acoustic tube modeling
- Room acoustics simulation

### Spectral Audio Signal Processing
**URL**: https://ccrma.stanford.edu/~jos/sasp/

FFT and spectral methods:
- DFT/FFT fundamentals
- Window functions
- Phase vocoder
- Spectral modeling synthesis
- STFT analysis/synthesis

### Mathematics of the DFT
**URL**: https://ccrma.stanford.edu/~jos/mdft/

DFT foundations:
- Complex numbers review
- Discrete Fourier Transform
- FFT algorithms
- Sampling theory
- Convolution theorem

## When to Use

| Topic | Which Book |
|-------|-----------|
| Filter design basics | Introduction to Digital Filters |
| Understanding biquads | Introduction to Digital Filters |
| Reverb/room acoustics | Physical Audio Signal Processing |
| String/wind synthesis | Physical Audio Signal Processing |
| Phase vocoder | Spectral Audio Signal Processing |
| Time stretching theory | Spectral Audio Signal Processing |
| FFT implementation | Mathematics of the DFT |

## How to Use

These are **algorithm references**, not code libraries:
1. Read the relevant section for your DSP task
2. Understand the mathematics and signal flow
3. Implement in your target language using the formulas
4. Use recipes in this library for concrete pseudocode

## Resources

- **Main Portal**: https://ccrma.stanford.edu/~jos/
- **All Books**: https://ccrma.stanford.edu/~jos/pubs.html
- **CCRMA**: Stanford Center for Computer Research in Music and Acoustics

## Related

- /biquad recipe for practical filter implementation
- /reverb recipe for Freeverb implementation
- STK library for physical modeling code
- RBJ Cookbook for simpler filter formulas
