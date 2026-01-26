---
name: sidechain-input
description: Sidechain input implementation. Aux input configuration, accessing sidechain signal, ducking/gating. Invoke when adding sidechain functionality.
---

# Sidechain Input

## Audio I/O Configuration

Configure auxiliary inputs in the Plugin trait:

```rust
const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[
    AudioIOLayout {
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        aux_input_ports: &[
            // Sidechain input (stereo)
            AuxPort {
                name: "Sidechain",
                num_channels: 2,
            },
        ],
        ..AudioIOLayout::const_default()
    }
];
```

## Accessing Sidechain in process()

```rust
fn process(
    &mut self,
    buffer: &mut Buffer,
    aux: &mut AuxiliaryBuffers,
    _context: &mut impl ProcessContext<Self>,
) -> ProcessStatus {
    // Get sidechain buffer (may not be connected!)
    let sidechain = aux.inputs.first();

    for (sample_idx, mut channel_samples) in buffer.iter_samples().enumerate() {
        // Get sidechain level (handle disconnected case)
        let sidechain_level = if let Some(sc) = sidechain {
            let sc_samples = sc.as_slice();
            // Average left and right channels
            let sc_left = sc_samples.get(0).map(|c| c[sample_idx]).unwrap_or(0.0);
            let sc_right = sc_samples.get(1).map(|c| c[sample_idx]).unwrap_or(0.0);
            (sc_left.abs() + sc_right.abs()) * 0.5
        } else {
            0.0  // No sidechain connected
        };

        // Use sidechain_level for ducking, gating, etc.
        let duck_amount = self.calculate_duck(sidechain_level);

        for sample in channel_samples.iter_mut() {
            *sample *= duck_amount;
        }
    }

    ProcessStatus::Normal
}
```

## Sidechain Ducking (Compressor Style)

```rust
struct SidechainDucker {
    envelope: f32,
    attack_coeff: f32,
    release_coeff: f32,
    threshold: f32,
    ratio: f32,
}

impl SidechainDucker {
    fn process(&mut self, sidechain_level: f32) -> f32 {
        // Envelope follower
        let coeff = if sidechain_level > self.envelope {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.envelope += coeff * (sidechain_level - self.envelope);

        // Calculate gain reduction
        if self.envelope > self.threshold {
            let over = self.envelope / self.threshold;
            over.powf(1.0 / self.ratio - 1.0)
        } else {
            1.0
        }
    }
}
```

## Sidechain Gate

```rust
struct SidechainGate {
    envelope: f32,
    attack_coeff: f32,
    release_coeff: f32,
    threshold: f32,
    hold_samples: usize,
    hold_counter: usize,
}

impl SidechainGate {
    fn process(&mut self, sidechain_level: f32) -> f32 {
        // Update envelope
        let coeff = if sidechain_level > self.envelope {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.envelope += coeff * (sidechain_level - self.envelope);

        // Gate logic with hold
        if self.envelope > self.threshold {
            self.hold_counter = self.hold_samples;
            1.0  // Gate open
        } else if self.hold_counter > 0 {
            self.hold_counter -= 1;
            1.0  // Hold period
        } else {
            0.0  // Gate closed
        }
    }
}
```

## DAW Compatibility Notes

- Most DAWs support sidechain routing, but UI varies
- Test in multiple DAWs (Logic, Ableton, FL Studio, etc.)
- Consider adding a "Listen to Sidechain" toggle for debugging
