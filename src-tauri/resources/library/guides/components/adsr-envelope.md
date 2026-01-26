---
name: adsr-envelope
description: ADSR envelope implementation. Exponential curves, stage transitions, retriggering. Invoke when implementing or debugging envelopes.
---

# ADSR Envelope

## Complete Implementation

```rust
#[derive(Clone, Copy, PartialEq)]
enum EnvelopeStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone)]
struct AdsrEnvelope {
    stage: EnvelopeStage,
    level: f32,

    // Coefficients (calculated from times)
    attack_coeff: f32,
    decay_coeff: f32,
    release_coeff: f32,

    sustain_level: f32,
}

impl AdsrEnvelope {
    fn new() -> Self {
        Self {
            stage: EnvelopeStage::Idle,
            level: 0.0,
            attack_coeff: 0.01,
            decay_coeff: 0.001,
            release_coeff: 0.001,
            sustain_level: 0.7,
        }
    }

    /// Set envelope times (in seconds)
    fn set_params(&mut self, attack: f32, decay: f32, sustain: f32, release: f32, sample_rate: f32) {
        // Time constant: reach ~99.3% of target in given time
        // coefficient = 1 - e^(-5/samples)
        let time_to_coeff = |time_s: f32| -> f32 {
            if time_s <= 0.0 {
                1.0  // Instant
            } else {
                let samples = time_s * sample_rate;
                1.0 - (-5.0 / samples).exp()
            }
        };

        self.attack_coeff = time_to_coeff(attack);
        self.decay_coeff = time_to_coeff(decay);
        self.release_coeff = time_to_coeff(release);
        self.sustain_level = sustain.clamp(0.0, 1.0);
    }

    fn trigger(&mut self) {
        self.stage = EnvelopeStage::Attack;
        // DON'T reset level - allows smooth retriggering
    }

    fn release(&mut self) {
        if self.stage != EnvelopeStage::Idle {
            self.stage = EnvelopeStage::Release;
        }
    }

    fn process(&mut self) -> f32 {
        match self.stage {
            EnvelopeStage::Idle => {
                self.level = 0.0;
            }

            EnvelopeStage::Attack => {
                // Exponential approach to 1.0
                self.level += self.attack_coeff * (1.0 - self.level);

                if self.level >= 0.999 {
                    self.level = 1.0;
                    self.stage = EnvelopeStage::Decay;
                }
            }

            EnvelopeStage::Decay => {
                // Exponential approach to sustain
                self.level += self.decay_coeff * (self.sustain_level - self.level);

                if (self.level - self.sustain_level).abs() < 0.001 {
                    self.level = self.sustain_level;
                    self.stage = EnvelopeStage::Sustain;
                }
            }

            EnvelopeStage::Sustain => {
                self.level = self.sustain_level;
            }

            EnvelopeStage::Release => {
                // Exponential approach to 0
                self.level += self.release_coeff * (0.0 - self.level);

                if self.level < 0.001 {
                    self.level = 0.0;
                    self.stage = EnvelopeStage::Idle;
                }
            }
        }

        self.level
    }

    fn is_idle(&self) -> bool {
        self.stage == EnvelopeStage::Idle
    }

    fn is_releasing(&self) -> bool {
        self.stage == EnvelopeStage::Release
    }
}
```

## Common Mistakes to Avoid

| Mistake | Problem | Fix |
|---------|---------|-----|
| Resetting level on retrigger | Click when retriggering | Don't reset `level` in `trigger()` |
| Linear attack | Unnatural sound | Use exponential curves |
| Instant release | Clicks on note-off | Minimum 5-10ms release |
| Wrong sample rate | Envelope times off | Recalculate in `initialize()` |
| Level > 1.0 | Clipping | Clamp sustain, check math |

## Modulation Envelope (Bipolar)

For filter cutoff modulation:

```rust
struct ModEnvelope {
    env: AdsrEnvelope,
    amount: f32,  // -1.0 to +1.0
}

impl ModEnvelope {
    fn process(&mut self) -> f32 {
        // Returns value in range [-amount, +amount]
        self.env.process() * self.amount
    }
}
```
