---
name: lfo
description: LFO implementation. Waveforms, tempo sync, modulation routing. Invoke when implementing low-frequency oscillators for modulation.
---

# LFO (Low Frequency Oscillator)

## Basic Implementation

```rust
use std::f32::consts::TAU;

#[derive(Clone, Copy, PartialEq)]
enum LfoWaveform {
    Sine,
    Triangle,
    Square,
    Saw,
    SawDown,
    SampleAndHold,
}

struct Lfo {
    phase: f32,
    frequency: f32,
    waveform: LfoWaveform,
    sample_hold_value: f32,
    last_phase: f32,
}

impl Lfo {
    fn new() -> Self {
        Self {
            phase: 0.0,
            frequency: 1.0,
            waveform: LfoWaveform::Sine,
            sample_hold_value: 0.0,
            last_phase: 0.0,
        }
    }

    fn set_frequency(&mut self, hz: f32) {
        self.frequency = hz.max(0.001);
    }

    fn process(&mut self, sample_rate: f32) -> f32 {
        let output = match self.waveform {
            LfoWaveform::Sine => (self.phase * TAU).sin(),

            LfoWaveform::Triangle => {
                let p = self.phase;
                if p < 0.5 {
                    4.0 * p - 1.0
                } else {
                    -4.0 * p + 3.0
                }
            }

            LfoWaveform::Square => {
                if self.phase < 0.5 { 1.0 } else { -1.0 }
            }

            LfoWaveform::Saw => {
                2.0 * self.phase - 1.0
            }

            LfoWaveform::SawDown => {
                1.0 - 2.0 * self.phase
            }

            LfoWaveform::SampleAndHold => {
                // Update value when phase wraps
                if self.phase < self.last_phase {
                    self.sample_hold_value = fastrand::f32() * 2.0 - 1.0;
                }
                self.last_phase = self.phase;
                self.sample_hold_value
            }
        };

        // Advance phase
        self.phase += self.frequency / sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        output  // Returns -1.0 to +1.0
    }

    fn reset(&mut self) {
        self.phase = 0.0;
    }
}
```

## Tempo Sync

Convert tempo divisions to frequency:

```rust
#[derive(Clone, Copy)]
enum TempoDiv {
    Whole,      // 1/1
    Half,       // 1/2
    Quarter,    // 1/4
    Eighth,     // 1/8
    Sixteenth,  // 1/16
    DottedHalf,
    DottedQuarter,
    Triplet8th,
}

fn tempo_div_to_freq(bpm: f64, div: TempoDiv) -> f32 {
    let beats_per_sec = bpm / 60.0;

    let multiplier = match div {
        TempoDiv::Whole => 0.25,
        TempoDiv::Half => 0.5,
        TempoDiv::Quarter => 1.0,
        TempoDiv::Eighth => 2.0,
        TempoDiv::Sixteenth => 4.0,
        TempoDiv::DottedHalf => 1.0 / 3.0,
        TempoDiv::DottedQuarter => 2.0 / 3.0,
        TempoDiv::Triplet8th => 3.0,
    };

    (beats_per_sec * multiplier) as f32
}

// In process():
if self.params.lfo_sync.value() {
    if let Some(tempo) = context.transport().tempo {
        let freq = tempo_div_to_freq(tempo, self.params.lfo_div.value());
        self.lfo.set_frequency(freq);
    }
} else {
    self.lfo.set_frequency(self.params.lfo_rate.value());
}
```

## Modulation Routing

Apply LFO to parameters:

```rust
struct ModulationTarget {
    base_value: f32,
    lfo_amount: f32,  // -1.0 to +1.0
    lfo_value: f32,
}

impl ModulationTarget {
    fn get_modulated(&self) -> f32 {
        self.base_value + (self.lfo_value * self.lfo_amount * self.base_value)
    }
}

// In process:
let lfo_out = self.lfo.process(sample_rate);

// Modulate filter cutoff
let base_cutoff = self.params.cutoff.smoothed.next();
let lfo_amount = self.params.lfo_to_cutoff.value();
let modulated_cutoff = base_cutoff * (1.0 + lfo_out * lfo_amount);

// Clamp to valid range
let final_cutoff = modulated_cutoff.clamp(20.0, 20000.0);
```

## Per-Voice vs Global LFO

```rust
// Global LFO: Same phase for all voices (classic synth behavior)
struct Synth {
    lfo: Lfo,  // Single LFO
    voices: [Voice; MAX_VOICES],
}

// Per-voice LFO: Each voice has own phase (more organic)
struct Voice {
    lfo: Lfo,  // Each voice has its own
    // ...
}
```
