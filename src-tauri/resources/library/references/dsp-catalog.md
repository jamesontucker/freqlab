---
name: DSP Resources Catalog
description: Comprehensive catalog of permissively-licensed DSP resources for AI-assisted audio plugin development. Use this to discover appropriate algorithms, libraries, and references for any DSP task.
tags: [dsp, algorithms, filters, synthesis, effects, reference, discovery]
---

# DSP Resources Catalog for AI Agents
## Complete Reference - Every Source Tagged & Categorized

> **Purpose**: Reference of permissively-licensed DSP code for AI-assisted audio plugin development.
>
> **License Key**:
> - PUBLIC DOMAIN - No attribution required, use freely
> - PERMISSIVE - Attribution required in source code
> - ALGORITHM - Implement from description, no code to copy
>
> **Last Updated**: January 2026

---

## Attribution Requirements

When using code from permissive-licensed sources (MIT, BSD, ISC, Apache), you MUST include attribution in the generated code. Use this format:

```rust
// Based on [Source Name] by [Author]
// License: [MIT/BSD/ISC/Apache] - See project LICENSE
// Original: [URL if available]
```

**Quick Reference:**
| License | Action Required |
|---------|-----------------|
| Public Domain | None - use freely (optional: cite in comments for reference) |
| MIT/BSD/ISC | Add copyright notice + include in THIRD_PARTY_NOTICES.md |
| Zlib | Attribution optional but recommended |
| Algorithm-only | None - implement from description |

---

## Quick Reference: All Sources

Every source with license, tags, category, and when to use:

### PUBLIC DOMAIN SOURCES

| Source | Category | Tags | When to Use |
|--------|----------|------|-------------|
| **Cytomic Technical Papers** | Filters | `#filter` `#eq` `#svf` `#zdf` | Modern VA filter design, modulation-friendly filters, TPT topology |
| **RBJ Audio EQ Cookbook** | Filters | `#filter` `#eq` `#biquad` | Standard EQ bands, simple filter implementations |
| **Freeverb** | Reverb | `#reverb` `#schroeder` | Simple algorithmic reverb starting point |
| **Dattorro Reverb** | Reverb | `#reverb` `#plate` | Plate reverb, Lexicon-style topology |
| **dr_libs** | Utility | `#audio-file` `#wav` `#flac` `#mp3` | Loading/saving audio files |
| **minimp3** | Utility | `#audio-file` `#mp3` `#decoder` | Lightweight MP3 decoding only |
| **HIIR** | Utility | `#oversampling` `#filter` `#simd` | 2x/4x/8x oversampling with low latency |

### MIT LICENSE SOURCES

| Source | Copyright | Category | Tags | When to Use |
|--------|-----------|----------|------|-------------|
| **Airwindows** | Chris Johnson | Effects | `#saturation` `#compression` `#eq` `#reverb` `#delay` `#tape` `#lofi` `#guitar` `#deesser` | First choice for most effects - saturation, compression, EQ, tape, guitar amps, lo-fi |
| **Mutable Instruments** (STM32) | Emilie Gillet | Synthesis | `#synth` `#oscillator` `#filter` `#granular` `#spectral` `#physical-modeling` `#vocoder` | Synth oscillators, granular (Clouds), physical modeling (Rings/Elements), vocoder (Warps) |
| **Signalsmith DSP** | Signalsmith Audio | Utility | `#delay` `#fft` `#filter` `#interpolation` `#spectral` | Delay lines, FFT, interpolation, spectral processing building blocks |
| **Signalsmith Stretch** | Geraint Luff | Pitch/Time | `#pitchshift` `#timestretch` | **Always use for pitch shifting and time stretching** |
| **DaisySP** (core) | Electrosmith | Synthesis/Effects | `#synth` `#drums` `#filter` `#effects` `#envelope` `#lfo` `#looper` | Embedded DSP, drum synthesis, basic effects, envelopes, looper |
| **Cycfi Q** | Joel de Guzman | Analysis | `#pitch-detection` `#tuner` `#analysis` `#filter` | Pitch detection, tuners, guitar tracking, pitch-to-MIDI |
| **STK** | Perry Cook, Gary Scavone | Synthesis | `#physical-modeling` `#fm` `#waveguide` `#synth` | Physical modeling (strings, wind), FM synthesis, academic reference |
| **Maximilian** | Mick Grierson | Education | `#synth` `#filter` `#fft` `#granular` `#education` | Learning DSP, educational projects, prototyping |
| **r8brain-free-src** | Aleksey Vaneev | Utility | `#resampling` `#sample-rate` `#conversion` | High-quality sample rate conversion |
| **DSPFilters** | Vinnie Falco | Filters | `#filter` `#butterworth` `#chebyshev` `#bessel` `#elliptic` | IIR filter library, exotic filter types (Chebyshev, Elliptic, Bessel) |
| **Madronalib** | Randy Jones | Utility | `#simd` `#dsp` `#signal` | SIMD-optimized DSP, professional quality (Aalto/Kaivo creator) |
| **Soundpipe** | Paul Batchelor | Effects/Synth | `#effects` `#synth` `#csound` `#reverb` `#filter` | Wide variety of Csound-derived algorithms |
| **audioFlux** | libAudioFlux | Analysis | `#fft` `#mfcc` `#analysis` `#ml` `#features` | ML feature extraction, spectrograms, MFCCs, onset detection |
| **Neural Amp Modeler** | Steve Atkinson | Guitar | `#neural-network` `#amp-sim` `#guitar` `#ml` | Training and running neural amp models |
| **LEAF** | Spiricom | Embedded | `#embedded` `#synth` `#effects` `#lightweight` | Lightweight C-based DSP for embedded systems |

### BSD LICENSE SOURCES

| Source | Copyright | Category | Tags | When to Use |
|--------|-----------|----------|------|-------------|
| **RTNeural** | Jatin Chowdhury | ML | `#neural-network` `#ml` `#amp-sim` `#inference` `#simd` | Running trained neural networks in real-time (amp modeling) |
| **chowdsp_wdf** | Jatin Chowdhury | Circuit Modeling | `#circuit-model` `#wdf` `#guitar` `#analog` `#tube` | Accurate analog circuit emulation (amps, pedals, filters) |
| **ChowKick** | Jatin Chowdhury | Drums | `#drums` `#808` `#kick` `#circuit-model` | 808-style kick drum synthesis |
| **chowdsp_utils** | Jatin Chowdhury | Utility | `#juce` `#filter` `#delay` `#simd` `#utility` | JUCE DSP modules, filters, delays, SIMD helpers |
| **RNNoise** | Xiph.org | Noise Reduction | `#noisereduction` `#neural-network` `#vocals` `#broadcast` | Real-time voice noise suppression |
| **Gamma** | Lance Putnam | DSP Library | `#dsp` `#stft` `#filter` `#oscillator` `#analysis` | Elegant DSP library, good STFT examples |
| **libpd** | libpd team | Integration | `#puredata` `#pd` `#embedded` `#patching` | Embed Pure Data patches in applications |

### ISC LICENSE SOURCES

| Source | Copyright | Category | Tags | When to Use |
|--------|-----------|----------|------|-------------|
| **CHOC** | Julian Storer | Utility | `#midi` `#utility` `#containers` `#javascript` | MIDI processing, general utilities |
| **Spatial Audio Framework** | Leo McCormack | Spatial | `#spatial` `#ambisonics` `#hrtf` `#binaural` `#3d` | Ambisonics, HRTF, binaural audio, 3D sound |
| **NIH-plug** | Robbert van der Helm | Framework | `#rust` `#plugin` `#framework` `#clap` `#vst3` | Rust audio plugin development |
| **CLAP SDK** | free-audio | Framework | `#plugin` `#api` `#clap` | CLAP plugin format development |
| **DPF** | DISTRHO | Framework | `#plugin` `#framework` `#lv2` `#vst` | Cross-platform plugin framework |

### ZLIB LICENSE SOURCES

| Source | Copyright | Category | Tags | When to Use |
|--------|-----------|----------|------|-------------|
| **WDL** | Cockos | Utility | `#convolution` `#resampling` `#fft` | Convolution reverb, high-quality resampling, FFT |

### ALGORITHM-ONLY RESOURCES

| Source | Category | Tags | When to Use |
|--------|----------|------|-------------|
| **musicdsp.org** | Reference | `#algorithm` `#filter` `#oscillator` `#effects` | Algorithm descriptions, implement yourself |
| **DAFx Papers** | Academic | `#algorithm` `#pitchshift` `#timestretch` `#spectral` `#vocoder` | Phase vocoder, WSOLA, spectral effects theory |
| **Julius O. Smith Books** | Academic | `#algorithm` `#filter` `#physical-modeling` `#fft` `#theory` | Filter theory, physical modeling math, FFT theory |
| **Synth Secrets** | Educational | `#algorithm` `#synth` `#drums` `#oscillator` `#filter` | Synthesis techniques, drum synthesis theory |
| **Valhalla DSP Blog** | Educational | `#algorithm` `#reverb` `#design` | Reverb design insights, FDN theory |

---

## Detailed Source Entries

### PUBLIC DOMAIN

#### Cytomic Technical Papers
- **URL**: https://cytomic.com/technical-papers/
- **Author**: Andy Simper
- **License**: Public Domain
- **Category**: Filters
- **Tags**: `#filter` `#eq` `#svf` `#zdf` `#public-domain`
- **Content**: SVF (State Variable Filter), ZDF designs, peaking/shelving EQ, nonlinear processing
- **When to Use**: Modern filter implementations, modulation-friendly filters, any filter that needs to handle fast parameter changes
- **Priority**: 5/5

#### RBJ Audio EQ Cookbook
- **URL**: https://www.w3.org/2011/audio/audio-eq-cookbook.html
- **Author**: Robert Bristow-Johnson
- **License**: Public Domain
- **Category**: Filters
- **Tags**: `#filter` `#eq` `#biquad` `#public-domain`
- **Content**: Biquad coefficient formulas for LPF, HPF, BPF, Notch, APF, Peaking EQ, Shelves
- **When to Use**: Standard EQ implementations, simple filters, DC blocking
- **Priority**: 5/5

#### Freeverb
- **URL**: https://ccrma.stanford.edu/~jos/pasp/Freeverb.html
- **Author**: Jezar at Dreampoint
- **License**: Public Domain (explicit declaration)
- **Category**: Reverb
- **Tags**: `#reverb` `#schroeder` `#public-domain`
- **Content**: Classic Schroeder reverb implementation
- **When to Use**: Simple algorithmic reverb, learning reverb design
- **Priority**: 4/5

#### Dattorro Reverb
- **Reference**: JAES paper "Effect Design Part 1: Reverberator and Other Filters"
- **License**: Algorithm is public knowledge
- **Category**: Reverb
- **Tags**: `#reverb` `#plate` `#public-domain`
- **Content**: Plate reverb topology (Lexicon-style)
- **When to Use**: High-quality plate reverb, studio-style reverb
- **Priority**: 4/5

#### dr_libs
- **URL**: https://github.com/mackron/dr_libs
- **Author**: David Reid
- **License**: Public Domain (Unlicense) or MIT (your choice)
- **Category**: Utility
- **Tags**: `#audio-file` `#wav` `#flac` `#mp3` `#public-domain`
- **Content**: Single-header audio file I/O (dr_wav, dr_flac, dr_mp3)
- **When to Use**: Loading/saving WAV, FLAC, MP3 files
- **Priority**: 4/5

#### minimp3
- **URL**: https://github.com/lieff/minimp3
- **Author**: lieff
- **License**: CC0 (Public Domain)
- **Category**: Utility
- **Tags**: `#audio-file` `#mp3` `#decoder` `#public-domain`
- **Content**: Minimalist MP3 decoder
- **When to Use**: MP3 decoding only (smaller than dr_mp3)
- **Priority**: 3/5

#### HIIR
- **URL**: http://ldesoras.free.fr/prod.html
- **Author**: Laurent de Soras
- **License**: WTFPL (effectively public domain)
- **Category**: Utility
- **Tags**: `#oversampling` `#filter` `#simd` `#public-domain`
- **Content**: Half-band IIR filters for oversampling, SIMD optimized
- **When to Use**: 2x/4x/8x oversampling with minimal latency
- **Priority**: 5/5

---

### MIT LICENSE

#### Airwindows
- **URL**: https://github.com/airwindows/airwindows
- **Copyright**: Chris Johnson
- **License**: MIT
- **Category**: Effects
- **Tags**: `#saturation` `#compression` `#eq` `#reverb` `#delay` `#tape` `#lofi` `#guitar` `#deesser` `#mit`
- **Content**: 400+ effects including Console, Density, Pressure, ToTape, IronOxide, DeEss, FireAmp, Cabs
- **When to Use**:
  - Saturation/warmth: Console, Density, PurestDrive
  - Compression: Pressure, CStrip, ButterComp
  - Tape emulation: ToTape5/6/7/8, IronOxide
  - Guitar amps: FireAmp, GrindAmp, Cabs
  - De-essing: DeEss, DeBess
  - Lo-fi: ToVinyl, DeRez
- **Priority**: 5/5 (First choice for most effects)

#### Mutable Instruments Eurorack (STM32 modules only)
- **URL**: https://github.com/pichenettes/eurorack
- **Copyright**: Emilie Gillet
- **License**: MIT (STM32 projects only - AVR projects are GPL, avoid those)
- **Category**: Synthesis
- **Tags**: `#synth` `#oscillator` `#filter` `#granular` `#spectral` `#physical-modeling` `#vocoder` `#mit`
- **Safe Modules**: Clouds, Plaits, Rings, Elements, Warps, Braids, Tides, Marbles, Stages, Peaks, Streams, Shelves, Blades
- **When to Use**:
  - Granular/spectral: Clouds
  - Oscillators/wavetables: Plaits, Braids
  - Physical modeling: Rings, Elements
  - Frequency shifter/vocoder: Warps
  - Envelopes/LFOs: Stages, Peaks
- **Priority**: 5/5 (Best synth DSP)

#### Signalsmith DSP
- **URL**: https://github.com/Signalsmith-Audio/signalsmith-dsp
- **Copyright**: Signalsmith Audio
- **License**: MIT
- **Category**: Utility
- **Tags**: `#delay` `#fft` `#filter` `#interpolation` `#spectral` `#header-only` `#mit`
- **Content**: Header-only C++ library - delays, FFT, filters, interpolation
- **When to Use**:
  - Delay lines (fractional, interpolated)
  - FFT processing
  - High-quality interpolation (linear, cubic, sinc)
  - Building blocks for spectral effects
- **Priority**: 5/5

#### Signalsmith Stretch
- **URL**: https://github.com/Signalsmith-Audio/signalsmith-stretch
- **Copyright**: 2022 Geraint Luff / Signalsmith Audio Ltd.
- **License**: MIT
- **Category**: Pitch/Time
- **Tags**: `#pitchshift` `#timestretch` `#mit`
- **Content**: Polyphonic pitch/time stretching, C++11 header-only
- **When to Use**: **ALWAYS use for pitch shifting and time stretching** - do not use LGPL/GPL alternatives
- **Priority**: 5/5 (Only choice for pitch/time)

#### DaisySP (core repo only)
- **URL**: https://github.com/electro-smith/DaisySP
- **Copyright**: 2020 Electrosmith, Corp
- **License**: MIT (do NOT use DaisySP-LGPL repo)
- **Category**: Synthesis/Effects
- **Tags**: `#synth` `#drums` `#filter` `#effects` `#envelope` `#lfo` `#looper` `#mit`
- **Content**: Oscillators, filters, drums, effects, envelopes, looper, physical modeling
- **When to Use**:
  - Drum synthesis: AnalogBassDrum, AnalogSnare, HiHat
  - Basic synth: Oscillator, Svf, ADSR
  - Looper: Looper class
  - Modulation effects: Chorus, Flanger, Phaser, Tremolo
  - Portamento: Port class
- **Priority**: 5/5

#### Cycfi Q
- **URL**: https://github.com/cycfi/q
- **Copyright**: Joel de Guzman
- **License**: MIT
- **Category**: Analysis
- **Tags**: `#pitch-detection` `#tuner` `#analysis` `#filter` `#mit`
- **Content**: Pitch detection (bitstream autocorrelation), filters, envelope followers
- **When to Use**: Tuners, pitch-to-MIDI, guitar tracking, any pitch detection
- **Priority**: 4/5

#### STK (Synthesis Toolkit)
- **URL**: https://github.com/thestk/stk
- **Copyright**: Perry Cook, Gary Scavone
- **License**: MIT
- **Category**: Synthesis
- **Tags**: `#physical-modeling` `#fm` `#waveguide` `#synth` `#mit`
- **Content**: Physical modeling (strings, wind, percussion), FM synthesis, delays, filters
- **When to Use**: Physical modeling reference, academic-quality implementations, FM synthesis
- **Priority**: 4/5

#### Maximilian
- **URL**: https://github.com/micknoise/Maximilian
- **Copyright**: Mick Grierson
- **License**: MIT
- **Category**: Education
- **Tags**: `#synth` `#filter` `#fft` `#granular` `#education` `#mit`
- **Content**: Educational C++ DSP library - synthesis, filters, FFT, granular
- **When to Use**: Learning DSP, educational projects, quick prototyping
- **Priority**: 3/5

#### r8brain-free-src
- **URL**: https://github.com/avaneev/r8brain-free-src
- **Copyright**: Aleksey Vaneev (Voxengo)
- **License**: MIT
- **Category**: Utility
- **Tags**: `#resampling` `#sample-rate` `#conversion` `#mit`
- **Content**: Professional-quality sample rate converter
- **When to Use**: High-quality sample rate conversion, resampling audio files
- **Priority**: 4/5

#### DSPFilters
- **URL**: https://github.com/vinniefalco/DSPFilters
- **Copyright**: Vinnie Falco
- **License**: MIT
- **Category**: Filters
- **Tags**: `#filter` `#butterworth` `#chebyshev` `#bessel` `#elliptic` `#mit`
- **Content**: IIR filter library - Butterworth, Chebyshev I/II, Elliptic, Bessel, Legendre
- **When to Use**: Exotic filter types beyond basic biquads, scientific filter design
- **Priority**: 4/5

#### Madronalib
- **URL**: https://github.com/madronalabs/madronalib
- **Copyright**: Randy Jones (Madrona Labs)
- **License**: MIT
- **Category**: Utility
- **Tags**: `#simd` `#dsp` `#signal` `#mit`
- **Content**: SIMD-optimized DSP library from creator of Aalto/Kaivo synths
- **When to Use**: Professional SIMD-optimized DSP, signal flow architecture
- **Priority**: 4/5

#### Soundpipe
- **URL**: https://github.com/PaulBatchelor/Soundpipe
- **Copyright**: Paul Batchelor
- **License**: MIT
- **Category**: Effects/Synthesis
- **Tags**: `#effects` `#synth` `#csound` `#reverb` `#filter` `#mit`
- **Content**: Large collection of Csound-derived DSP modules
- **When to Use**: Wide variety of algorithms, Csound algorithm ports
- **Priority**: 4/5

#### audioFlux
- **URL**: https://github.com/libAudioFlux/audioFlux
- **Copyright**: libAudioFlux
- **License**: MIT
- **Category**: Analysis
- **Tags**: `#fft` `#mfcc` `#analysis` `#ml` `#features` `#mit`
- **Content**: Audio feature extraction - spectrograms, MFCCs, chroma, onset detection
- **When to Use**: ML feature extraction, audio analysis, beat/onset detection
- **Priority**: 3/5

#### Neural Amp Modeler (NAM)
- **URL**: https://github.com/sdatkinson/neural-amp-modeler
- **Copyright**: Steve Atkinson
- **License**: MIT
- **Category**: Guitar/ML
- **Tags**: `#neural-network` `#amp-sim` `#guitar` `#ml` `#mit`
- **Content**: Neural network amp/pedal capture and inference
- **When to Use**: Training neural amp models, loading .nam files
- **Priority**: 4/5

#### LEAF
- **URL**: https://github.com/spiricom/LEAF
- **Copyright**: Spiricom
- **License**: MIT
- **Category**: Embedded
- **Tags**: `#embedded` `#synth` `#effects` `#lightweight` `#c` `#mit`
- **Content**: Lightweight C-based DSP for embedded systems
- **When to Use**: Resource-constrained embedded systems, C-only projects
- **Priority**: 3/5

---

### BSD LICENSE

#### RTNeural
- **URL**: https://github.com/jatinchowdhury18/RTNeural
- **Copyright**: Jatin Chowdhury
- **License**: BSD-3-Clause
- **Category**: ML
- **Tags**: `#neural-network` `#ml` `#amp-sim` `#inference` `#simd` `#bsd`
- **Content**: Real-time neural network inference (LSTM, GRU, Conv1D, Dense), SIMD optimized
- **When to Use**: Running pre-trained ML models in real-time, amp modeling inference
- **Priority**: 5/5

#### chowdsp_wdf
- **URL**: https://github.com/Chowdhury-DSP/chowdsp_wdf
- **Copyright**: Jatin Chowdhury
- **License**: BSD-3-Clause
- **Category**: Circuit Modeling
- **Tags**: `#circuit-model` `#wdf` `#guitar` `#analog` `#tube` `#bsd`
- **Content**: Wave Digital Filter library - resistors, capacitors, diodes, transistors
- **When to Use**: Accurate analog circuit emulation, tube amp modeling, pedal circuits
- **Priority**: 5/5

#### ChowKick
- **URL**: https://github.com/Chowdhury-DSP/ChowKick
- **Copyright**: Jatin Chowdhury
- **License**: BSD-3-Clause
- **Category**: Drums
- **Tags**: `#drums` `#808` `#kick` `#circuit-model` `#bsd`
- **Content**: 808-style kick synthesizer based on Kurt Werner's PhD research
- **When to Use**: 808/TR-style kick drum synthesis
- **Priority**: 4/5

#### chowdsp_utils
- **URL**: https://github.com/Chowdhury-DSP/chowdsp_utils
- **Copyright**: Jatin Chowdhury
- **License**: BSD-3-Clause
- **Category**: Utility
- **Tags**: `#juce` `#filter` `#delay` `#simd` `#utility` `#bsd`
- **Content**: JUCE modules - filters, delays, reverb components, SIMD helpers
- **When to Use**: JUCE plugin development, DSP building blocks
- **Priority**: 4/5

#### RNNoise
- **URL**: https://github.com/xiph/rnnoise
- **Copyright**: Xiph.org Foundation
- **License**: BSD-3-Clause
- **Category**: Noise Reduction
- **Tags**: `#noisereduction` `#neural-network` `#vocals` `#broadcast` `#bsd`
- **Content**: Neural noise suppression (85KB model), real-time capable
- **When to Use**: Voice noise reduction, broadcast audio cleanup
- **Priority**: 4/5

#### Gamma
- **URL**: https://github.com/LancePutnam/Gamma
- **Copyright**: Lance Putnam
- **License**: BSD-3-Clause
- **Category**: DSP Library
- **Tags**: `#dsp` `#stft` `#filter` `#oscillator` `#analysis` `#bsd`
- **Content**: Elegant C++ DSP library with good STFT examples
- **When to Use**: Clean API design reference, STFT processing
- **Priority**: 3/5

#### libpd
- **URL**: https://github.com/libpd/libpd
- **Copyright**: libpd team
- **License**: BSD (Standard Improved)
- **Category**: Integration
- **Tags**: `#puredata` `#pd` `#embedded` `#patching` `#bsd`
- **Content**: Embeddable Pure Data
- **When to Use**: Running Pd patches inside applications, visual patching integration
- **Priority**: 3/5

---

### ISC LICENSE

#### CHOC
- **URL**: https://github.com/Tracktion/choc
- **Copyright**: Julian Storer
- **License**: ISC
- **Category**: Utility
- **Tags**: `#midi` `#utility` `#containers` `#javascript` `#isc`
- **Content**: Header-only utilities - MIDI, containers, JavaScript engine
- **When to Use**: MIDI processing, general C++ utilities
- **Priority**: 4/5

#### Spatial Audio Framework
- **URL**: https://github.com/leomccormack/Spatial_Audio_Framework
- **Copyright**: Leo McCormack
- **License**: ISC
- **Category**: Spatial
- **Tags**: `#spatial` `#ambisonics` `#hrtf` `#binaural` `#3d` `#isc`
- **Content**: Ambisonics, HRTF processing, binaural rendering
- **When to Use**: 3D audio, VR/AR audio, surround sound, binaural
- **Priority**: 4/5

#### NIH-plug
- **URL**: https://github.com/robbert-vdh/nih-plug
- **Copyright**: Robbert van der Helm
- **License**: ISC
- **Category**: Framework
- **Tags**: `#rust` `#plugin` `#framework` `#clap` `#vst3` `#isc`
- **Content**: Rust audio plugin framework
- **When to Use**: Rust plugin development
- **Priority**: 4/5

#### CLAP SDK
- **URL**: https://github.com/free-audio/clap
- **Copyright**: free-audio
- **License**: MIT
- **Category**: Framework
- **Tags**: `#plugin` `#api` `#clap` `#mit`
- **Content**: CLAP plugin format SDK
- **When to Use**: CLAP plugin development
- **Priority**: 4/5

#### DPF
- **URL**: https://github.com/DISTRHO/DPF
- **Copyright**: DISTRHO
- **License**: ISC
- **Category**: Framework
- **Tags**: `#plugin` `#framework` `#lv2` `#vst` `#isc`
- **Content**: Cross-platform plugin framework
- **When to Use**: Multi-format plugin development
- **Priority**: 3/5

---

### ZLIB LICENSE

#### WDL
- **URL**: https://github.com/justinfrankel/WDL
- **Copyright**: Cockos (Justin Frankel)
- **License**: Zlib (attribution optional but recommended)
- **Category**: Utility
- **Tags**: `#convolution` `#resampling` `#fft` `#zlib`
- **Content**: convoengine.h (convolution), resample.h (resampling), FFT
- **When to Use**: Convolution reverb, high-quality resampling
- **Priority**: 5/5

---

### ALGORITHM RESOURCES

#### musicdsp.org
- **URL**: https://www.musicdsp.org/
- **License**: Algorithm descriptions (implement yourself)
- **Category**: Reference
- **Tags**: `#algorithm` `#filter` `#oscillator` `#effects`
- **Content**: Massive algorithm collection - filters, oscillators, effects
- **When to Use**: Learning algorithms, finding formulas to implement
- **Priority**: 5/5

#### DAFx Conference Proceedings
- **URL**: https://www.dafx.de/paper-archive/
- **License**: Academic papers (implement algorithms yourself)
- **Category**: Academic
- **Tags**: `#algorithm` `#pitchshift` `#timestretch` `#spectral` `#vocoder`
- **Content**: Phase vocoder, WSOLA, TD-PSOLA, spectral effects, reverb
- **When to Use**: Advanced algorithm research, pitch/time theory
- **Priority**: 5/5

#### Julius O. Smith Books (CCRMA)
- **URLs**: ccrma.stanford.edu/~jos/
- **License**: Textbook (implement from equations)
- **Category**: Academic
- **Tags**: `#algorithm` `#filter` `#physical-modeling` `#fft` `#theory`
- **Content**: DFT math, digital filters, physical modeling, spectral audio
- **When to Use**: Deep theory understanding, mathematical foundations
- **Priority**: 5/5

#### Synth Secrets (Sound on Sound)
- **URL**: https://www.soundonsound.com/series/synth-secrets-sound-sound
- **License**: Educational (implement techniques yourself)
- **Category**: Educational
- **Tags**: `#algorithm` `#synth` `#drums` `#oscillator` `#filter`
- **Content**: 63-part synthesis series - oscillators, filters, drum synthesis
- **When to Use**: Learning synthesis, drum synthesis theory
- **Priority**: 5/5

#### Valhalla DSP Blog
- **URL**: https://valhalladsp.com/blog/
- **Author**: Sean Costello
- **License**: Educational (design guidance)
- **Category**: Educational
- **Tags**: `#algorithm` `#reverb` `#design`
- **Content**: Reverb design, allpass loops, FDN theory
- **When to Use**: Reverb design guidance
- **Priority**: 5/5

---

## Decision Tree: What Source to Use

```
FILTERS
├── Standard EQ (peak, shelf, LP, HP) → RBJ Cookbook (Public Domain)
├── Modulation-friendly / resonant → Cytomic SVF (Public Domain)
├── Moog ladder → musicdsp.org or DaisySP (MIT)
├── Exotic (Chebyshev, Elliptic) → DSPFilters (MIT)
└── Formant / vowel → Mutable Rings (MIT)

SATURATION / DISTORTION
├── Any type (first choice) → Airwindows (MIT)
├── Circuit-accurate → chowdsp_wdf (BSD)
├── Neural amp modeling → RTNeural + NAM (BSD/MIT)
└── Waveshaping theory → musicdsp.org

REVERB
├── Simple starting point → Freeverb (Public Domain)
├── Plate reverb → Dattorro (Public Domain)
├── Shimmer / granular → Mutable Clouds (MIT)
├── Convolution → WDL (Zlib)
└── Design theory → Valhalla Blog

DELAY / MODULATION
├── Delay lines → Signalsmith DSP (MIT)
├── Chorus, Flanger, Phaser → DaisySP (MIT) or Airwindows (MIT)
├── Tremolo, Vibrato → DaisySP (MIT)
└── Ring mod → DaisySP (MIT)

PITCH / TIME
└── Always → Signalsmith Stretch (MIT)
    (Never use SoundTouch or Rubber Band)

SYNTHESIS
├── Oscillators → Mutable Plaits (MIT)
├── Wavetable → Mutable Plaits (MIT)
├── FM → DaisySP (MIT)
├── Physical modeling → Mutable Rings/Elements (MIT) or STK (MIT)
├── Granular → Mutable Clouds (MIT)
└── Theory → Synth Secrets

DRUMS
├── 808 kick → ChowKick (BSD)
├── General drums → DaisySP (MIT)
└── Theory → Synth Secrets

GUITAR
├── Amp simulation → Airwindows (MIT)
├── Neural amps → RTNeural (BSD) + NAM (MIT)
├── Circuit modeling → chowdsp_wdf (BSD)
└── Cabinet IRs → WDL convolution (Zlib)

ANALYSIS
├── Pitch detection → Cycfi Q (MIT)
├── FFT → Signalsmith DSP (MIT)
├── ML features (MFCC) → audioFlux (MIT)
└── Theory → J.O. Smith

UTILITY
├── Audio file I/O → dr_libs (Public Domain)
├── Oversampling → HIIR (Public Domain)
├── Resampling → r8brain (MIT) or WDL (Zlib)
├── MIDI → CHOC (ISC)
└── Convolution → WDL (Zlib)

SPATIAL
└── 3D / Ambisonics / Binaural → Spatial Audio Framework (ISC)
```

---

## Complete Tags Index

### By Effect Type
| Tag | Sources |
|-----|---------|
| `#filter` | Cytomic, RBJ, DSPFilters, Mutable, DaisySP, Signalsmith, Gamma |
| `#eq` | RBJ, Cytomic, Airwindows |
| `#reverb` | Freeverb, Dattorro, Airwindows, Mutable Clouds, WDL, Soundpipe |
| `#delay` | Signalsmith, DaisySP, Airwindows, chowdsp_utils |
| `#saturation` | Airwindows, chowdsp_wdf |
| `#compression` | Airwindows |
| `#pitchshift` | Signalsmith Stretch |
| `#timestretch` | Signalsmith Stretch |
| `#granular` | Mutable Clouds, DaisySP, Maximilian |
| `#spectral` | Mutable Clouds, Signalsmith, Gamma |
| `#vocoder` | Mutable Warps |
| `#noisereduction` | RNNoise |
| `#lofi` | Airwindows |
| `#tape` | Airwindows |

### By Instrument
| Tag | Sources |
|-----|---------|
| `#guitar` | Airwindows, RTNeural, chowdsp_wdf, NAM, Cycfi Q |
| `#synth` | Mutable, DaisySP, STK, Maximilian, Soundpipe |
| `#drums` | ChowKick, DaisySP, Mutable Plaits |
| `#vocals` | Airwindows (DeEss), RNNoise, Mutable Warps |

### By Technical Category
| Tag | Sources |
|-----|---------|
| `#oscillator` | Mutable Plaits, DaisySP, Gamma |
| `#envelope` | DaisySP, Mutable Stages |
| `#lfo` | DaisySP, Mutable Stages |
| `#fft` | Signalsmith, WDL, audioFlux |
| `#convolution` | WDL |
| `#oversampling` | HIIR, WDL |
| `#resampling` | r8brain, WDL |
| `#interpolation` | Signalsmith |
| `#midi` | CHOC |
| `#simd` | HIIR, RTNeural, Madronalib, chowdsp_utils |

### By License
| Tag | Sources |
|-----|---------|
| `#public-domain` | Cytomic, RBJ, Freeverb, Dattorro, dr_libs, minimp3, HIIR |
| `#mit` | Airwindows, Mutable, Signalsmith, DaisySP, Cycfi Q, STK, Maximilian, r8brain, DSPFilters, Madronalib, Soundpipe, audioFlux, NAM, LEAF |
| `#bsd` | RTNeural, chowdsp_wdf, ChowKick, chowdsp_utils, RNNoise, Gamma, libpd |
| `#isc` | CHOC, SAF, NIH-plug, DPF |
| `#zlib` | WDL |
| `#algorithm` | musicdsp.org, DAFx, J.O. Smith, Synth Secrets, Valhalla Blog |

---

*Every source in this catalog has been verified for permissive licensing. No GPL or LGPL code is included or recommended.*
