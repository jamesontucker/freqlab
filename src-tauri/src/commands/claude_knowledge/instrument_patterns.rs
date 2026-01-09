//! Advanced instrument plugin patterns
//!
//! Production-ready patterns for synthesizers and samplers.

/// Returns advanced instrument patterns for CLAUDE.md
pub fn get_instrument_patterns() -> &'static str {
    r#"## Advanced Instrument Implementation

These patterns go deeper than the basics above. Copy and adapt as needed.

### Complete Voice Structure

A complete voice with all common components:

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

### MIDI Note to Frequency

Standard equal temperament conversion:

```rust
fn midi_to_freq(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

// A4 (note 69) = 440 Hz
// Each semitone = 2^(1/12) ratio
```

### ADSR Envelope (Correct Implementation)

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
        // Attempt to reach ~99.3% of target in given time
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

### Anti-Aliased Oscillators

**DO NOT use naive waveforms** - they cause severe aliasing:

```rust
// BAD - causes aliasing above ~1kHz
fn naive_saw(phase: f32) -> f32 {
    2.0 * phase - 1.0
}

// GOOD - use PolyBLEP or wavetable from a crate
// synfx-dsp provides PolyBLEP oscillators
// fundsp provides anti-aliased oscillators

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

### Voice Stealing

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

    // Last resort: steal oldest (first in array for simple impl)
    0
}
```

### Sample-Accurate Note Timing

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

        // Write to all channels
        for channel in buffer.as_slice() {
            channel[sample_idx] = output.clamp(-1.0, 1.0);
        }
    }

    ProcessStatus::Normal
}
```

### Modulation Matrix Pattern

For complex synths with flexible modulation:

```rust
// Modulation sources
enum ModSourceType {
    Lfo1,
    Lfo2,
    EnvFilter,
    EnvAmp,
    ModWheel,      // CC1
    Aftertouch,
    Velocity,
    KeyTrack,      // Based on note number
}

// Modulation destinations
enum ModDestType {
    Osc1Pitch,
    Osc2Pitch,
    FilterCutoff,
    FilterResonance,
    Amplitude,
    PanPosition,
    Lfo1Rate,
}

struct ModSlot {
    source: ModSourceType,
    destination: ModDestType,
    amount: f32,  // -1.0 to +1.0
    enabled: bool,
}

struct ModMatrix {
    slots: [ModSlot; 8],  // 8 modulation slots
    source_values: [f32; 8],  // Current value of each source
}

impl ModMatrix {
    fn get_modulated_value(&self, dest: ModDestType, base_value: f32) -> f32 {
        let mut total_mod = 0.0;

        for slot in &self.slots {
            if slot.enabled && slot.destination == dest {
                let source_idx = slot.source as usize;
                total_mod += self.source_values[source_idx] * slot.amount;
            }
        }

        base_value + total_mod
    }
}
```

### Unison/Detune Pattern

For thicker sounds with multiple detuned voices:

```rust
struct UnisonVoice {
    detune_cents: f32,   // Detune amount in cents
    pan: f32,            // Stereo position -1 to +1
    phase: f32,
}

struct UnisonOscillator {
    voices: [UnisonVoice; 7],  // Up to 7 unison voices
    active_count: usize,
    spread: f32,  // 0.0 to 1.0 controls detune spread
}

impl UnisonOscillator {
    fn setup_unison(&mut self, count: usize, spread_cents: f32) {
        self.active_count = count.min(7);

        for (i, voice) in self.voices.iter_mut().take(self.active_count).enumerate() {
            if count == 1 {
                voice.detune_cents = 0.0;
                voice.pan = 0.0;
            } else {
                // Spread voices evenly
                let t = i as f32 / (count - 1) as f32;  // 0.0 to 1.0
                voice.detune_cents = (t * 2.0 - 1.0) * spread_cents;  // -spread to +spread
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

            // Generate sample (using your oscillator of choice)
            let sample = (voice.phase * std::f32::consts::TAU).sin();

            // Advance phase
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

### Wavetable Oscillator Pattern

```rust
struct Wavetable {
    tables: Vec<Vec<f32>>,  // Multiple tables for different frequencies (anti-aliasing)
    table_size: usize,
}

struct WavetableOscillator {
    wavetable: Wavetable,
    phase: f32,
    table_position: f32,  // Morph between tables (0.0 to 1.0)
}

impl WavetableOscillator {
    fn render(&mut self, freq: f32, sample_rate: f32) -> f32 {
        // Select appropriate table based on frequency (higher freq = simpler table)
        let table_idx = self.select_table_for_frequency(freq, sample_rate);

        let table = &self.wavetable.tables[table_idx];
        let table_size = table.len() as f32;

        // Linear interpolation within table
        let pos = self.phase * table_size;
        let idx0 = pos as usize;
        let idx1 = (idx0 + 1) % table.len();
        let frac = pos - idx0 as f32;

        let sample = table[idx0] * (1.0 - frac) + table[idx1] * frac;

        // Advance phase
        self.phase += freq / sample_rate;
        if self.phase >= 1.0 { self.phase -= 1.0; }

        sample
    }

    fn select_table_for_frequency(&self, freq: f32, sample_rate: f32) -> usize {
        // Use higher mipmap levels for higher frequencies to avoid aliasing
        let nyquist = sample_rate / 2.0;
        let harmonics_available = (nyquist / freq) as usize;

        // Map to table index (more tables = better quality)
        let table_count = self.wavetable.tables.len();
        ((table_count - 1) - harmonics_available.min(table_count - 1)).max(0)
    }
}
```

"#
}
