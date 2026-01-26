---
name: polyphony
description: Polyphony implementation. Voice structure, allocation, stealing, and efficient rendering. Invoke when implementing polyphonic instruments.
---

# Polyphony

## Voice Structure

```rust
const MAX_VOICES: usize = 16;

#[derive(Clone)]
struct Voice {
    note: u8,
    velocity: f32,
    phase: f32,
    frequency: f32,
    envelope: AdsrEnvelope,
    active: bool,
    age: u32,  // For voice stealing
}

impl Voice {
    fn new() -> Self {
        Self {
            note: 0,
            velocity: 0.0,
            phase: 0.0,
            frequency: 440.0,
            envelope: AdsrEnvelope::new(),
            active: false,
            age: 0,
        }
    }

    fn trigger(&mut self, note: u8, velocity: f32, sample_rate: f32) {
        self.note = note;
        self.velocity = velocity / 127.0;
        self.frequency = 440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0);
        self.phase = 0.0;
        self.envelope.trigger();
        self.active = true;
        self.age = 0;
    }

    fn release(&mut self) {
        self.envelope.release();
    }

    fn render(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        self.age += 1;

        // Generate oscillator output
        let osc = (self.phase * std::f32::consts::TAU).sin();
        self.phase += self.frequency / sample_rate;
        if self.phase >= 1.0 { self.phase -= 1.0; }

        // Apply envelope
        let env = self.envelope.process();

        // Mark inactive when envelope finishes
        if self.envelope.is_idle() {
            self.active = false;
        }

        osc * env * self.velocity
    }
}
```

## Voice Allocation

```rust
struct VoiceAllocator {
    voices: [Voice; MAX_VOICES],
}

impl VoiceAllocator {
    fn allocate(&mut self, note: u8, velocity: f32, sample_rate: f32) {
        // Try to find free voice
        if let Some(voice) = self.voices.iter_mut().find(|v| !v.active) {
            voice.trigger(note, velocity, sample_rate);
            return;
        }

        // Voice stealing: find best candidate
        let steal_idx = self.find_voice_to_steal();
        self.voices[steal_idx].trigger(note, velocity, sample_rate);
    }

    fn find_voice_to_steal(&self) -> usize {
        // Priority: released voices first, then oldest
        let mut best_idx = 0;
        let mut best_score = 0u64;

        for (i, voice) in self.voices.iter().enumerate() {
            let score = if voice.envelope.is_releasing() {
                // Prefer releasing voices
                (1u64 << 32) + voice.age as u64
            } else {
                voice.age as u64
            };

            if score > best_score {
                best_score = score;
                best_idx = i;
            }
        }

        best_idx
    }

    fn release(&mut self, note: u8) {
        // Release all voices playing this note
        for voice in &mut self.voices {
            if voice.active && voice.note == note {
                voice.release();
            }
        }
    }

    fn release_all(&mut self) {
        for voice in &mut self.voices {
            voice.release();
        }
    }
}
```

## Efficient Rendering

```rust
fn render_all_voices(&mut self, sample_rate: f32) -> f32 {
    let mut output = 0.0;

    for voice in &mut self.voices {
        if voice.active {
            output += voice.render(sample_rate);
        }
    }

    // Prevent clipping with many voices
    output * (1.0 / (MAX_VOICES as f32).sqrt())
}
```

## Mono Mode (Single Voice)

```rust
fn trigger_mono(&mut self, note: u8, velocity: f32, sample_rate: f32) {
    // Always use voice 0 for mono
    let voice = &mut self.voices[0];

    // Legato: don't reset envelope if already playing
    let legato = voice.active;

    voice.note = note;
    voice.velocity = velocity / 127.0;
    voice.frequency = midi_to_freq(note);

    if !legato {
        voice.envelope.trigger();
    }

    voice.active = true;
}
```
