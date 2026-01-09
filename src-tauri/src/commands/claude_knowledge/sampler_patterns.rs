//! Sampler and drum machine patterns
//!
//! Patterns for sample playback, pitch shifting, and step sequencing.

/// Returns sampler/drum machine patterns for CLAUDE.md
pub fn get_sampler_patterns() -> &'static str {
    r#"## Sampler & Drum Machine Implementation

### Sample Playback Fundamentals

**Pre-load samples in initialize(), never in process():**

```rust
struct Sample {
    data: Vec<f32>,      // Mono samples (interleave for stereo)
    sample_rate: f32,    // Original sample rate
    root_note: u8,       // MIDI note the sample was recorded at
}

struct Voice {
    sample_index: usize, // Which sample to play
    position: f64,       // Fractional position for interpolation
    playback_rate: f64,  // 1.0 = original pitch, 2.0 = octave up
    active: bool,
}
```

### Pitch Shifting via Resampling

**Calculate playback rate from MIDI note:**

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

### Interpolation Methods (Quality vs CPU)

**Linear interpolation (fast, acceptable for small pitch shifts):**
```rust
fn linear_interpolate(samples: &[f32], position: f64) -> f32 {
    let index = position as usize;
    let frac = (position - index as f64) as f32;

    let s0 = samples.get(index).copied().unwrap_or(0.0);
    let s1 = samples.get(index + 1).copied().unwrap_or(0.0);

    s0 + frac * (s1 - s0)
}
```

**Hermite interpolation (better quality, still fast):**
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

### Sample Playback Loop

```rust
fn render_voice(&mut self, voice: &mut Voice, samples: &Sample) -> f32 {
    if !voice.active || voice.position >= samples.data.len() as f64 {
        voice.active = false;
        return 0.0;
    }

    let output = hermite_interpolate(&samples.data, voice.position);

    // Advance position by playback rate
    voice.position += voice.playback_rate;

    output
}
```

### Drum Machine Step Sequencer

**16-step pattern at tempo:**

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

### Loop Points

**For sustained/looping samples:**

```rust
struct LoopingVoice {
    position: f64,
    loop_start: usize,  // Sample index
    loop_end: usize,
    looping: bool,
}

fn advance_with_loop(&mut self, rate: f64) {
    self.position += rate;

    if self.looping && self.position >= self.loop_end as f64 {
        // Wrap back to loop start
        let loop_length = (self.loop_end - self.loop_start) as f64;
        self.position = self.loop_start as f64 + (self.position - self.loop_end as f64) % loop_length;
    }
}
```

### Sample Rate Conversion

**When sample rate differs from host:**

```rust
fn initialize(&mut self, buffer_config: &BufferConfig) {
    let host_rate = buffer_config.sample_rate;

    for sample in &mut self.samples {
        // Adjust playback rate if sample was recorded at different rate
        sample.rate_adjustment = sample.sample_rate / host_rate;
    }
}

// In playback:
let effective_rate = voice.playback_rate * sample.rate_adjustment;
voice.position += effective_rate;
```

"#
}
