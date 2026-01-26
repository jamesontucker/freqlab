---
name: instrument-patterns
description: Instrument plugin implementation patterns. MIDI handling, voice management, ADSR envelopes, oscillators, samplers, drum machines. Invoke when implementing synthesizers or samplers.
---

# Instrument Plugin Patterns

## Complete Voice Structure

A voice with all common components:

```rust
struct Voice {
    // Identity
    note: u8,
    velocity: f32,
    active: bool,

    // Oscillator state
    phase: f32,
    frequency: f32,

    // Modulation
    envelope: AdsrEnvelope,
    filter_env: AdsrEnvelope,
    lfo_phase: f32,

    // Per-voice filter
    filter: DirectForm1<f32>,
}

impl Voice {
    fn trigger(&mut self, note: u8, velocity: f32, sample_rate: f32) {
        self.note = note;
        self.velocity = velocity / 127.0;
        self.active = true;
        self.phase = 0.0;
        self.frequency = midi_to_freq(note);
        self.envelope.trigger();
        self.filter_env.trigger();
    }

    fn release(&mut self) {
        self.envelope.release();
        self.filter_env.release();
    }

    fn is_finished(&self) -> bool {
        self.envelope.is_idle()
    }
}
```

## MIDI Note to Frequency

Standard equal temperament conversion:

```rust
fn midi_to_freq(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

// A4 (note 69) = 440 Hz
// Each semitone = 2^(1/12) ratio
```

## ADSR Envelope (Correct Implementation)

Use exponential curves for natural-sounding envelopes:

```rust
#[derive(Clone, Copy, PartialEq)]
enum EnvelopeStage { Idle, Attack, Decay, Sustain, Release }

struct AdsrEnvelope {
    stage: EnvelopeStage,
    level: f32,
    attack_coeff: f32,
    decay_coeff: f32,
    sustain_level: f32,
    release_coeff: f32,
}

impl AdsrEnvelope {
    fn set_params(&mut self, attack_s: f32, decay_s: f32, sustain: f32, release_s: f32, sr: f32) {
        // Reach ~99.3% of target in given time
        self.attack_coeff = if attack_s > 0.0 { 1.0 - (-5.0 / (attack_s * sr)).exp() } else { 1.0 };
        self.decay_coeff = if decay_s > 0.0 { 1.0 - (-5.0 / (decay_s * sr)).exp() } else { 1.0 };
        self.release_coeff = if release_s > 0.0 { 1.0 - (-5.0 / (release_s * sr)).exp() } else { 1.0 };
        self.sustain_level = sustain;
    }

    fn trigger(&mut self) {
        self.stage = EnvelopeStage::Attack;
        // Don't reset level - allows retriggering without click
    }

    fn release(&mut self) {
        if self.stage != EnvelopeStage::Idle {
            self.stage = EnvelopeStage::Release;
        }
    }

    fn process(&mut self) -> f32 {
        match self.stage {
            EnvelopeStage::Attack => {
                self.level += self.attack_coeff * (1.0 - self.level);
                if self.level >= 0.999 {
                    self.level = 1.0;
                    self.stage = EnvelopeStage::Decay;
                }
            }
            EnvelopeStage::Decay => {
                self.level += self.decay_coeff * (self.sustain_level - self.level);
                if (self.level - self.sustain_level).abs() < 0.001 {
                    self.stage = EnvelopeStage::Sustain;
                }
            }
            EnvelopeStage::Sustain => {
                self.level = self.sustain_level;
            }
            EnvelopeStage::Release => {
                self.level += self.release_coeff * (0.0 - self.level);
                if self.level < 0.001 {
                    self.level = 0.0;
                    self.stage = EnvelopeStage::Idle;
                }
            }
            EnvelopeStage::Idle => {
                self.level = 0.0;
            }
        }
        self.level
    }

    fn is_idle(&self) -> bool {
        self.stage == EnvelopeStage::Idle
    }
}
```

## Anti-Aliased Oscillators

**DO NOT use naive waveforms** - they cause severe aliasing:

```rust
// BAD - causes aliasing above ~1kHz
fn naive_saw(phase: f32) -> f32 {
    2.0 * phase - 1.0
}

// GOOD - use PolyBLEP or wavetable from a crate
// fundsp provides anti-aliased oscillators (stable Rust)
// NOTE: synfx-dsp has PolyBLEP but requires nightly Rust

// If you must implement, use PolyBLEP correction:
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        2.0 * t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + 2.0 * t + 1.0
    } else {
        0.0
    }
}

fn saw_poly_blep(phase: f32, phase_inc: f32) -> f32 {
    let naive = 2.0 * phase - 1.0;
    naive - poly_blep(phase, phase_inc)
}
```

## Voice Stealing

When all voices are in use, steal intelligently:

```rust
fn find_voice_to_steal(&self) -> usize {
    // Priority: 1) Idle, 2) Released + quietest, 3) Oldest

    // Try to find idle voice
    for (i, v) in self.voices.iter().enumerate() {
        if !v.active {
            return i;
        }
    }

    // Try to find released voice (prefer quietest)
    let mut best_idx = 0;
    let mut best_score = f32::MAX;

    for (i, v) in self.voices.iter().enumerate() {
        if v.envelope.stage == EnvelopeStage::Release {
            let score = v.envelope.level;
            if score < best_score {
                best_score = score;
                best_idx = i;
            }
        }
    }

    if best_score < f32::MAX {
        return best_idx;
    }

    // Last resort: steal oldest
    0
}
```

## Sample-Accurate Note Timing

Use the `timing` field for precise note placement within buffer:

```rust
fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
    let mut next_event = context.next_event();
    let num_samples = buffer.samples();

    for sample_idx in 0..num_samples {
        // Process events that occur at this sample
        while let Some(event) = next_event {
            if event.timing() > sample_idx as u32 {
                break;
            }

            match event {
                NoteEvent::NoteOn { note, velocity, .. } => {
                    self.trigger_voice(note, velocity.as_f32());
                }
                NoteEvent::NoteOff { note, .. } => {
                    self.release_voice(note);
                }
                _ => {}
            }

            next_event = context.next_event();
        }

        // Render all voices for this sample
        let output = self.render_voices();

        // Write to all channels (protect against NaN/Inf)
        let safe_output = if output.is_finite() { output } else { 0.0 };
        for channel in buffer.as_slice() {
            channel[sample_idx] = safe_output;
        }
    }

    ProcessStatus::Normal
}
```

## Sample Playback Fundamentals

**Pre-load samples in initialize(), never in process():**

```rust
struct Sample {
    data: Vec<f32>,      // Mono samples
    sample_rate: f32,    // Original sample rate
    root_note: u8,       // MIDI note the sample was recorded at
}

struct SampleVoice {
    sample_index: usize, // Which sample to play
    position: f64,       // Fractional position for interpolation
    playback_rate: f64,  // 1.0 = original pitch, 2.0 = octave up
    active: bool,
}
```

## Pitch Shifting via Resampling

Calculate playback rate from MIDI note:

```rust
fn note_to_playback_rate(note: u8, root_note: u8) -> f64 {
    // Semitone difference
    let semitones = note as f64 - root_note as f64;
    // 2^(semitones/12) gives the frequency ratio
    2.0_f64.powf(semitones / 12.0)
}

// If sample was recorded at C3 (note 60), playing C4 (note 72):
// rate = 2^(12/12) = 2.0 (octave up, plays twice as fast)
```

## Interpolation Methods

**Hermite interpolation (good quality, still fast):**

```rust
fn hermite_interpolate(samples: &[f32], position: f64) -> f32 {
    let index = position as usize;
    let frac = (position - index as f64) as f32;

    // Need 4 samples: index-1, index, index+1, index+2
    let get = |i: isize| -> f32 {
        samples.get((index as isize + i) as usize).copied().unwrap_or(0.0)
    };

    let xm1 = get(-1);
    let x0 = get(0);
    let x1 = get(1);
    let x2 = get(2);

    let c0 = x0;
    let c1 = 0.5 * (x1 - xm1);
    let c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
    let c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);

    ((c3 * frac + c2) * frac + c1) * frac + c0
}
```

**When to use each:**
- Linear: Quick prototyping, drums (short percussive sounds)
- Hermite: Melodic content, longer samples, noticeable pitch shifts
- Sinc: Mastering quality (use `rubato` or `dasp` crate)

## Drum Machine Step Sequencer

```rust
struct DrumPattern {
    steps: [[bool; 16]; 4],  // 4 drum sounds × 16 steps
    velocities: [[f32; 16]; 4],
}

struct DrumMachine {
    pattern: DrumPattern,
    samples: [Sample; 4],  // Kick, snare, hihat, etc.
    current_step: usize,
    samples_per_step: f32,
    sample_counter: f32,
}

impl DrumMachine {
    fn set_tempo(&mut self, bpm: f32, sample_rate: f32) {
        // 16 steps per bar, 4 beats per bar = 4 steps per beat
        let beats_per_second = bpm / 60.0;
        let steps_per_second = beats_per_second * 4.0;  // 16th notes
        self.samples_per_step = sample_rate / steps_per_second;
    }

    fn process(&mut self) -> f32 {
        self.sample_counter += 1.0;

        // Check if we've reached the next step
        if self.sample_counter >= self.samples_per_step {
            self.sample_counter -= self.samples_per_step;
            self.current_step = (self.current_step + 1) % 16;

            // Trigger drums for this step
            for drum in 0..4 {
                if self.pattern.steps[drum][self.current_step] {
                    let vel = self.pattern.velocities[drum][self.current_step];
                    self.trigger_drum(drum, vel);
                }
            }
        }

        // Mix all active drum voices
        self.render_all_drums()
    }
}
```

## Unison/Detune Pattern

For thicker sounds with multiple detuned voices:

```rust
struct UnisonVoice {
    detune_cents: f32,
    pan: f32,  // -1 to +1
    phase: f32,
}

struct UnisonOscillator {
    voices: [UnisonVoice; 7],
    active_count: usize,
}

impl UnisonOscillator {
    fn setup_unison(&mut self, count: usize, spread_cents: f32) {
        self.active_count = count.min(7);

        for (i, voice) in self.voices.iter_mut().take(self.active_count).enumerate() {
            if count == 1 {
                voice.detune_cents = 0.0;
                voice.pan = 0.0;
            } else {
                let t = i as f32 / (count - 1) as f32;
                voice.detune_cents = (t * 2.0 - 1.0) * spread_cents;
                voice.pan = t * 2.0 - 1.0;  // Left to right
            }
        }
    }

    fn render(&mut self, base_freq: f32, israte: f32) -> (f32, f32) {
        let mut left = 0.0;
        let mut right = 0.0;

        for voice in self.voices.iter_mut().take(self.active_count) {
            // Convert cents to frequency multiplier
            let freq_mult = 2.0_f32.powf(voice.detune_cents / 1200.0);
            let freq = base_freq * freq_mult;

            let sample = (voice.phase * std::f32::consts::TAU).sin();

            voice.phase += freq * israte;
            if voice.phase >= 1.0 { voice.phase -= 1.0; }

            // Pan the voice
            let pan_l = ((1.0 - voice.pan) * 0.5).sqrt();
            let pan_r = ((1.0 + voice.pan) * 0.5).sqrt();

            left += sample * pan_l;
            right += sample * pan_r;
        }

        // Normalize by voice count
        let norm = 1.0 / (self.active_count as f32).sqrt();
        (left * norm, right * norm)
    }
}
```

## Feature Completion Checklist (Instruments)

Before saying a feature is "done", verify:

- [ ] MIDI_INPUT set to `MidiConfig::Basic` in Plugin trait
- [ ] Voice allocation with proper voice stealing
- [ ] Sample-accurate note timing using `event.timing()`
- [ ] Envelopes using exponential curves, not linear
- [ ] reset() clears all voices and sets them to idle
- [ ] NaN/Inf protection: `if !sample.is_finite() { *sample = 0.0; }`
- [ ] **UI control exists** for each new parameter
