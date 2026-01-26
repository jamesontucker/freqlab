---
name: velocity-layers
description: Velocity layers for samplers. Layer selection, crossfading between layers, realistic dynamics. Invoke when implementing velocity-sensitive sample playback.
---

# Velocity Layers

## Basic Layer Selection

Map MIDI velocity (0-127) to sample layers:

```rust
struct VelocityMappedSampler {
    layers: Vec<Vec<f32>>,  // Multiple samples per note
}

impl VelocityMappedSampler {
    fn select_layer(&self, velocity: u8) -> usize {
        let num_layers = self.layers.len();

        match num_layers {
            1 => 0,
            2 => if velocity < 64 { 0 } else { 1 },
            3 => match velocity {
                0..=42 => 0,    // Soft
                43..=84 => 1,   // Medium
                85..=127 => 2,  // Hard
            },
            4 => match velocity {
                0..=31 => 0,    // pp
                32..=63 => 1,   // p
                64..=95 => 2,   // f
                96..=127 => 3,  // ff
            },
            _ => ((velocity as usize * num_layers) / 128).min(num_layers - 1),
        }
    }
}
```

## Velocity Crossfading

For smoother transitions between layers:

```rust
struct CrossfadeSampler {
    layers: Vec<Vec<f32>>,
    crossfade_range: u8,  // Velocity range for crossfade
}

impl CrossfadeSampler {
    fn get_layers_with_mix(&self, velocity: u8) -> Vec<(usize, f32)> {
        let num_layers = self.layers.len();
        if num_layers == 1 {
            return vec![(0, 1.0)];
        }

        // Calculate layer boundaries
        let layer_size = 128.0 / num_layers as f32;
        let position = velocity as f32 / layer_size;

        let lower_layer = (position.floor() as usize).min(num_layers - 1);
        let upper_layer = (lower_layer + 1).min(num_layers - 1);

        if lower_layer == upper_layer {
            return vec![(lower_layer, 1.0)];
        }

        // Crossfade between layers
        let crossfade_pos = position - position.floor();
        let lower_gain = 1.0 - crossfade_pos;
        let upper_gain = crossfade_pos;

        vec![
            (lower_layer, lower_gain),
            (upper_layer, upper_gain),
        ]
    }

    fn render(&mut self, voice: &Voice) -> f32 {
        let layers_mix = self.get_layers_with_mix((voice.velocity * 127.0) as u8);

        let mut output = 0.0;
        for (layer_idx, gain) in layers_mix {
            let sample = self.read_sample(&self.layers[layer_idx], voice.position);
            output += sample * gain;
        }

        output
    }
}
```

## Velocity Scaling

Apply velocity to amplitude (not just layer selection):

```rust
fn velocity_to_amplitude(velocity: f32, curve: VelocityCurve) -> f32 {
    match curve {
        // Linear: Direct mapping
        VelocityCurve::Linear => velocity,

        // Soft: More dynamic range in soft playing
        VelocityCurve::Soft => velocity.powf(0.5),

        // Hard: More dynamic range in loud playing
        VelocityCurve::Hard => velocity.powf(2.0),

        // Fixed: Ignore velocity
        VelocityCurve::Fixed => 1.0,
    }
}
```

## Round Robin

Prevent "machine gun" effect with repeated notes:

```rust
struct RoundRobinSampler {
    layers: Vec<Vec<Vec<f32>>>,  // [velocity_layer][round_robin_variant]
    round_robin_index: Vec<usize>,  // Per velocity layer
}

impl RoundRobinSampler {
    fn get_sample(&mut self, velocity: u8) -> &[f32] {
        let layer = self.select_velocity_layer(velocity);

        // Get next round robin variant
        let rr_idx = self.round_robin_index[layer];
        let num_variants = self.layers[layer].len();

        // Advance round robin
        self.round_robin_index[layer] = (rr_idx + 1) % num_variants;

        &self.layers[layer][rr_idx]
    }
}
```
