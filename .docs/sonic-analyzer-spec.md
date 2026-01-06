# Freqlab Sonic Analyzer & Reverse Engineering Spec

## Overview

An audio analysis system that extracts detailed characteristics from reference audio and generates a "Sonic Blueprint" - a structured document that gives Claude comprehensive information to build a matching VST plugin.

## Goals

- Extract as much useful information as possible from reference audio
- Present analysis in a format Claude can reason about effectively
- Enable "sonic reverse engineering" - recreating sounds as plugins
- Run fast enough to not disrupt workflow (under 2 seconds for typical clips)
- Support the iterative build-test-refine loop

---

## Core Concept: Sonic Blueprint

A Sonic Blueprint is a structured analysis report that captures:
- What the sound IS (characteristics)
- What likely CREATED it (signal chain guesses)
- How to RECREATE it (actionable build guidance)

The blueprint is injected into Claude's context when starting a plugin build, giving it concrete targets instead of vague descriptions.

---

## Analysis Modes

### Mode 1: Direct Analysis
Analyze the audio file as-is. Best for:
- Isolated sounds
- Single instruments
- Already separated stems
- Sound effects

### Mode 2: Stem Separation → Analysis
First separate the audio into stems, let user choose which stem to analyze. Best for:
- Full mixes
- Songs where you want just the guitar tone
- Extracting drum sounds from tracks
- Isolating vocals for vocal effect analysis

---

## Stem Separation Preprocessing

### How It Works

```
┌─────────────────────────────────────┐
│  Full Mix Input                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Stem Separation Engine             │
│  (ML-based source separation)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Separated Stems                    │
│  ┌─────────┐ ┌─────────┐            │
│  │ Vocals  │ │ Drums   │            │
│  └─────────┘ └─────────┘            │
│  ┌─────────┐ ┌─────────┐            │
│  │ Bass    │ │ Other   │            │
│  └─────────┘ └─────────┘            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  User Selects Stem(s)               │
│  "Analyze the guitar/other stem"    │
└──────────────┬──────────────────────┘
               │
               ▼
        [Normal Analysis Pipeline]
```

### Stem Separation Options

#### Option A: Demucs (Recommended)

Facebook/Meta's Demucs is state of the art for music separation.

**Stems available:**
- Vocals
- Drums
- Bass
- Other (guitars, keys, synths, etc.)

**Integration approaches:**

1. **Python subprocess** - Call Demucs CLI, read output files
   - Easiest to implement
   - Requires Python + Demucs installed
   - Slower startup

2. **ONNX Runtime** - Run Demucs model directly in Rust
   - No Python dependency
   - Faster after initial load
   - More complex setup
   - Model files are large (~80MB per model)

3. **Local API server** - Demucs runs as background service
   - Clean separation of concerns
   - Can be shared across Freqlab instances
   - Adds deployment complexity

**Suggested crates for ONNX approach:**
- `ort` (ONNX Runtime bindings)
- `ndarray` (tensor manipulation)

#### Option B: Spleeter

Deezer's Spleeter is older but lighter weight.

**Stems available:**
- 2-stem: vocals/accompaniment
- 4-stem: vocals/drums/bass/other
- 5-stem: vocals/drums/bass/piano/other

**Pros:** Faster, lighter models
**Cons:** Lower quality separation than Demucs

#### Option C: External Tool Integration

Let user run their preferred separation tool externally, import stems.

- No ML dependency in Freqlab
- User has full control
- More manual workflow

### Stem Separation UI Flow

1. User drops in audio file
2. Freqlab detects it's a full mix (or user selects "Separate First")
3. Progress indicator: "Separating stems..."
4. Display waveforms of each stem with preview playback
5. User clicks stem to analyze: "Analyze Drums" / "Analyze Other"
6. Normal analysis runs on selected stem
7. Blueprint generated

### Combined Stem Analysis

Advanced option: analyze multiple stems and note relationships

```
[STEM ANALYSIS: DRUMS]
...drum blueprint...

[STEM ANALYSIS: BASS]
...bass blueprint...

[INTER-STEM RELATIONSHIPS]
- Bass follows kick drum timing
- Sidechain compression detected on bass (triggered by kick)
- Frequency separation: bass rolls off where kick has energy
```

### Performance Considerations

Stem separation is computationally expensive:

| Method | Time (3 min song) | GPU | Quality |
|--------|-------------------|-----|---------|
| Demucs (CPU) | 30-60s | No | Best |
| Demucs (GPU) | 5-10s | Yes | Best |
| Spleeter (CPU) | 15-30s | No | Good |
| Spleeter (GPU) | 3-5s | Yes | Good |

**Recommendations:**
- Cache separated stems (don't re-separate same file)
- Show progress with time estimate
- Allow user to cancel
- Consider GPU acceleration if available
- For quick iteration, let user provide pre-separated stems

### Stem Selection Intelligence

Help user pick the right stem:

- If they mention "guitar" → suggest "Other" stem
- If they mention "kick" or "snare" → suggest "Drums" stem
- If they mention "808" or "sub" → suggest "Bass" stem
- Preview each stem so user can verify before analysis

---

## Analysis Pipeline

```
┌─────────────────────────────────────┐
│  Audio File Input                   │
│  (wav, mp3, flac, etc.)             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Analysis Mode Selection            │
│  [Direct] or [Separate First]       │
└──────────────┬──────────────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌─────────────┐  ┌─────────────────────┐
│  Direct     │  │  Stem Separation    │
│  (skip)     │  │  → User selects     │
└──────┬──────┘  └──────────┬──────────┘
       │                    │
       └────────┬───────────┘
                │
                ▼
┌─────────────────────────────────────┐
│  Loader & Preprocessing             │
│  - Decode to PCM                    │
│  - Normalize                        │
│  - Split stereo if needed           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Parallel Analysis Workers          │
│                                     │
│  ┌───────────┐  ┌───────────────┐   │
│  │ Temporal  │  │ Spectral      │   │
│  │ Analysis  │  │ Analysis      │   │
│  └───────────┘  └───────────────┘   │
│                                     │
│  ┌───────────┐  ┌───────────────┐   │
│  │ Dynamics  │  │ Harmonic      │   │
│  │ Analysis  │  │ Analysis      │   │
│  └───────────┘  └───────────────┘   │
│                                     │
│  ┌───────────┐  ┌───────────────┐   │
│  │ MFCC      │  │ Effects       │   │
│  │ Extraction│  │ Detection     │   │
│  └───────────┘  └───────────────┘   │
│                                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Report Generator                   │
│  - Aggregate all analysis           │
│  - Generate build suggestions       │
│  - Format as Sonic Blueprint        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Sonic Blueprint Output             │
│  (Structured text for Claude)       │
└─────────────────────────────────────┘
```

---

## Analysis Categories

### 1. Global Characteristics

| Metric | Description | Use |
|--------|-------------|-----|
| Duration | Length of audio | Context |
| Sample Rate | Original sample rate | Technical |
| Channels | Mono/Stereo | Routing decisions |
| Overall Loudness (LUFS) | Integrated loudness | Gain staging |
| Peak Level (dBFS) | Maximum amplitude | Headroom |
| RMS Level | Average energy | Perceived loudness |
| Dynamic Range | Difference between loud and quiet | Compression decisions |
| Crest Factor | Peak to RMS ratio | Transient character |
| Stereo Width | Correlation between channels | Stereo processing |

### 2. Temporal Analysis

| Metric | Description | Use |
|--------|-------------|-----|
| Attack Time | Time to reach peak | Envelope shaping |
| Attack Shape | Linear, exponential, etc. | Envelope curve type |
| Decay Time | Time from peak to sustain | Envelope shaping |
| Sustain Level | Steady-state level | Envelope shaping |
| Release Time | Time to silence | Envelope shaping |
| Transient Sharpness | How percussive the attack is | Transient design |
| Onset Locations | Where notes/hits occur | Rhythmic content |
| Tempo (if applicable) | BPM | Sync effects |

### 3. Spectral Analysis

| Metric | Description | Use |
|--------|-------------|-----|
| Spectral Centroid | "Center of mass" of spectrum | Brightness |
| Spectral Rolloff | Frequency below which X% energy | High frequency content |
| Spectral Flux | Rate of spectral change | Movement/animation |
| Spectral Flatness | Tonal vs noisy | Noise content |
| Frequency Peaks | Dominant frequencies | EQ targets |
| Frequency Balance | Low/mid/high energy ratios | Tonal balance |
| Bandwidth | Frequency spread | Overall spectrum use |
| Resonant Frequencies | Peaks that sustain | Filter resonance points |

### 4. Harmonic Analysis

| Metric | Description | Use |
|--------|-------------|-----|
| Fundamental Frequency | Base pitch | Pitch reference |
| Harmonic Series | Overtone frequencies | Harmonic content |
| Odd/Even Ratio | Balance of odd vs even harmonics | Distortion character |
| Harmonic Decay | Which harmonics die first | Natural vs synthetic |
| Inharmonicity | Deviation from perfect harmonics | Bell-like vs string-like |
| Harmonic Count | Number of significant overtones | Richness |
| Missing Harmonics | Gaps in harmonic series | Filtering clues |

### 5. Dynamics Analysis

| Metric | Description | Use |
|--------|-------------|-----|
| Compression Detected | Yes/no + estimated ratio | Compressor settings |
| Attack Time (compression) | How fast compression engages | Compressor settings |
| Release Time (compression) | How fast compression releases | Compressor settings |
| Pumping Artifacts | Audible compression artifacts | Style choice |
| Limiting Detected | Hard limiting present | Limiter use |
| Gating Detected | Noise gate present | Gate settings |
| Envelope Shape | Overall amplitude envelope | Dynamics processing |

### 6. Effects Detection

| Effect | Detection Method | Extracted Info |
|--------|------------------|----------------|
| Reverb | Decay tail analysis, density | RT60, early/late ratio, size estimate |
| Delay | Autocorrelation, echo finding | Delay time, feedback amount, stereo |
| Chorus | Comb filtering detection | Rate, depth, voices |
| Flanger | Comb filter sweep | Rate, depth, feedback |
| Phaser | Notch sweep detection | Rate, stages estimate |
| Distortion | Harmonic analysis | Type (tube/tape/clip), amount |
| EQ | Spectral shape | Curve estimation |
| Filtering | Resonance, cutoff movement | Filter type, cutoff, Q |

### 7. Timbre Fingerprint (MFCC)

Mel-Frequency Cepstral Coefficients capture timbral characteristics in a compact form.

- 12-20 coefficients per analysis frame
- Good for comparing "does this sound like that"
- Captures formant-like information
- Used in iterative matching

---

## Suggested Rust Crates

### Core Analysis

| Crate | Purpose |
|-------|---------|
| `aubio-rs` | Swiss army knife: onset, pitch, tempo, MFCC, transient separation |
| `rustfft` | Fast Fourier Transform |
| `spectrum-analyzer` | Easy spectral analysis |
| `pitch-detection` | Pitch tracking (McLeod algorithm) |

### Audio Loading

| Crate | Purpose |
|-------|---------|
| `symphonia` | Decode any audio format |
| `hound` | Simple WAV I/O |

### Specific Features

| Crate | Purpose |
|-------|---------|
| `ebur128` | Loudness measurement (LUFS) |
| `mfcc` | Mel-frequency cepstral coefficients |
| `biquad` | Filters for band isolation |
| `dasp` | Signal processing fundamentals, RMS, envelope |

### Performance

| Crate | Purpose |
|-------|---------|
| `rayon` | Parallel analysis execution |

### Stem Separation (if using ONNX approach)

| Crate | Purpose |
|-------|---------|
| `ort` | ONNX Runtime - run ML models in Rust |
| `ndarray` | Tensor/array manipulation |

**Alternative:** Call Demucs/Spleeter via Python subprocess (simpler, external dependency)

---

## Output Format: Sonic Blueprint

```
=== SONIC BLUEPRINT ===
Source: [filename]
Duration: [X.X]s
Sample Rate: [XXXXX]

[GLOBAL]
Peak: [X.X] dBFS
RMS: [X.X] dBFS
LUFS: [X.X]
Dynamic Range: [X.X] dB
Crest Factor: [X.X] dB
Stereo Width: [X]% (0=mono, 100=full stereo)

[TEMPORAL]
Attack Time: [X]ms
Attack Shape: [description]
Decay Time: [X]ms
Sustain Level: [X]%
Release Time: [X]ms
Transient Character: [description]

[SPECTRAL]
Spectral Centroid: [X.X] kHz
Brightness: [Low/Medium/High]
Frequency Balance:
  - Low (20-250Hz): [X]%
  - Mid (250Hz-2kHz): [X]%
  - High (2kHz-20kHz): [X]%
Spectral Peaks:
  - [XXX] Hz: [+/-X] dB
  - [XXX] Hz: [+/-X] dB
  - [XXX] Hz: [+/-X] dB
Rolloff Frequency: [X] kHz

[HARMONICS]
Fundamental: [X.X] Hz ([Note])
Harmonic Count: [X] significant
Odd/Even Ratio: [X.X] ([interpretation])
Inharmonicity: [Low/Medium/High]
Harmonic Pattern: [description]

[DYNAMICS]
Compression Detected: [Yes/No]
  - Estimated Ratio: [X:1]
  - Attack: [X]ms
  - Release: [X]ms
Gating Detected: [Yes/No]
Limiting Detected: [Yes/No]

[SATURATION]
Type: [Symmetric/Asymmetric]
Character: [Clean/Warm/Crunchy/Heavy]
Harmonic Signature: [description]

[EFFECTS]
Reverb:
  - Detected: [Yes/No]
  - RT60: [X.X]s
  - Character: [description]
Delay:
  - Detected: [Yes/No]
  - Time: [X]ms
  - Feedback: [X]%
Modulation:
  - Type: [None/Chorus/Flanger/Phaser]
  - Rate: [X.X] Hz
  - Depth: [X]%

[MFCC FINGERPRINT]
[array of coefficients]

[TRANSIENT/SUSTAIN ANALYSIS]
Transient Character: [description]
Sustain Character: [description]

=== BUILD GUIDANCE ===
Suggested Plugin Type: [Effect/Instrument]

Suggested Signal Chain:
1. [Stage 1]
2. [Stage 2]
3. [Stage 3]
...

Key Parameters to Expose:
- [Parameter 1]: [suggested range]
- [Parameter 2]: [suggested range]

Priority Focus Areas:
1. [Most important aspect to nail]
2. [Second priority]
3. [Third priority]

Notes:
[Any additional observations or caveats]
```

---

## Claude Integration

### Context Injection

When starting a build with a reference:

```
System: You are building a VST plugin to match or approximate this reference sound.
Review the Sonic Blueprint carefully before writing code.
Focus on the Priority Focus Areas first.
After each iteration, we will compare output to reference.

[SONIC BLUEPRINT INSERTED HERE]

User: Build a NIH-plug effect that recreates this sound. Start with the saturation and EQ curve.
```

### Iterative Refinement Loop

1. Claude generates initial plugin based on blueprint
2. User previews with same source audio
3. Analysis runs on plugin output
4. Delta report generated (what's different)
5. Claude receives delta: "Output is 3dB brighter, attack is 2ms slower, needs more odd harmonics"
6. Claude adjusts
7. Repeat until satisfied

### What Claude Can Reason About

Claude understands:
- "Odd harmonics = asymmetric waveshaping"
- "RT60 of 1.2s = medium room reverb"
- "4:1 ratio with 5ms attack = punchy compression"
- "Spectral centroid at 2kHz = bright sound"
- "Bump at 800Hz = presence/warmth"

Claude struggles with:
- Subtle "feel" that's hard to quantify
- Complex multi-stage interactions
- "Make it sound more analog"
- Matching exact saturation character

---

## Performance Expectations

For a 3-5 second audio clip:

| Analysis | Estimated Time |
|----------|----------------|
| File load/decode | ~50ms |
| Loudness (LUFS/RMS) | ~10ms |
| FFT + spectral features | ~20ms |
| Pitch detection | ~30ms |
| Onset detection | ~15ms |
| MFCC extraction | ~40ms |
| Harmonic analysis | ~50ms |
| Transient/sustain separation | ~100ms |
| Effects detection | ~200ms |
| Report generation | ~10ms |
| **Total (sequential)** | **~525ms** |
| **Total (parallel)** | **~300ms** |

With parallelization via rayon, most clips should analyze under 500ms.

Longer files or deeper analysis (multi-resolution FFT, extensive effects detection) may take 1-2 seconds.

---

## Related Feature Ideas

These build on the core analysis system:

### Preset DNA Extraction
Load existing VST, run test signals through it, analyze output, generate blueprint of what that plugin does. "Clone" behavior of favorite presets.

### A/B Morphing
Two reference sounds → plugin with single knob that interpolates parameters between them.

### Chain Flattening
Analyze before/after of a multi-plugin chain, build single plugin that approximates the whole chain.

### Difference Extraction
Given dry and wet audio, extract just the processing delta. "What did they do to this?"

### Sample to Synth
Analyze one-shot sample, generate synthesizer that creates variations (not just playback).

### "Explain This Plugin"
Run analysis signals through unknown plugin, document what it's doing. Demystify black boxes.

### Vintage Gear Profiling
Run test tones through hardware, capture response, build plugin model.

### Null Test Comparison
Play reference and output in opposite polarity, analyze what remains (the difference). Feed residual analysis to Claude for refinement.

---

## Limitations & Honest Expectations

### What This Can Do
- Get Claude 60-80% of the way on first attempt
- Provide concrete targets instead of vague descriptions
- Enable faster iteration by quantifying differences
- Work well for straightforward sounds (clean tones, simple effects)

### What This Cannot Do
- Perfectly reverse engineer complex sounds
- Capture "magic" or "vibe" that defies measurement
- Replace human ears for final judgment
- Handle heavily layered or mixed sources well

### Best Use Cases
- Single instruments or isolated sounds
- Effect chains on clean sources
- Amp/cab simulation
- Simple to moderate complexity effects
- Stems extracted from full mixes (with separation)
- Drum sounds from songs (via drum stem)
- Guitar tones from recordings (via other stem)

### Challenging Use Cases
- Full mixes without separation (too much going on)
- Heavily processed/layered sounds
- Sounds with multiple simultaneous effects
- "Character" that comes from specific gear
- Low quality stem separations (artifacts affect analysis)
- Sounds that bleed across stems

---

## Open Questions for Implementation

### General Analysis
1. How to handle stereo files - analyze L/R separately, sum to mono, or both?
2. Should analysis be configurable (quick vs deep mode)?
3. How to present delta/comparison reports for iteration?
4. Store analysis results for later comparison?
5. Allow user to annotate blueprint with their own observations?
6. How to handle very short samples (<1s) vs longer audio (>30s)?
7. Should certain analysis features be optional/pluggable?
8. How to detect and report analysis confidence levels?
9. Format for MFCC - raw numbers vs some kind of visualization hint?
10. Should the system suggest what kind of test audio to use for effects vs synths?

### Stem Separation
11. Which separation engine to use - Demucs (best quality) vs Spleeter (faster)?
12. Python subprocess vs ONNX runtime vs external API service?
13. Should GPU acceleration be supported/required?
14. How to handle separation failures or low-quality separations?
15. Cache separated stems on disk? For how long?
16. Allow analyzing multiple stems and combining blueprints?
17. Auto-detect if input is already a clean stem vs full mix?
18. Support custom separation models (user-provided)?
19. How to handle songs longer than ~5 minutes (memory/time constraints)?
20. Should stem separation be a separate standalone tool or tightly integrated?
