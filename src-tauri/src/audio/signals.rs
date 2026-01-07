//! Test signal generators for audio preview

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

use super::buffer::StereoSample;

/// Type of test signal to generate
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SignalType {
    Sine,
    Square,
    WhiteNoise,
    PinkNoise,
    Impulse,
    Sweep,
}

/// Gate/pulse pattern for test signals
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GatePattern {
    /// Continuous signal (no gating)
    Continuous,
    /// Regular pulse at specified rate (pulses per second)
    Pulse,
    /// Musical note divisions (requires tempo)
    Quarter,
    Eighth,
    Sixteenth,
}

impl Default for GatePattern {
    fn default() -> Self {
        Self::Continuous
    }
}

/// Configuration for signal generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalConfig {
    pub signal_type: SignalType,
    pub frequency: f32,        // Hz (for sine, square)
    pub amplitude: f32,        // 0.0 - 1.0
    pub sweep_start: f32,      // Hz (for sweep)
    pub sweep_end: f32,        // Hz (for sweep)
    pub sweep_duration: f32,   // seconds (for sweep)
    pub gate_pattern: GatePattern,
    pub gate_rate: f32,        // Hz for Pulse mode, BPM for musical divisions
    pub gate_duty: f32,        // 0.0 - 1.0, portion of cycle that's "on"
}

impl Default for SignalConfig {
    fn default() -> Self {
        Self {
            signal_type: SignalType::Sine,
            frequency: 440.0,
            amplitude: 0.5,
            sweep_start: 20.0,
            sweep_end: 20000.0,
            sweep_duration: 5.0,
            gate_pattern: GatePattern::Continuous,
            gate_rate: 2.0,    // 2 Hz default for pulse mode
            gate_duty: 0.5,    // 50% duty cycle
        }
    }
}

/// Signal generator that produces audio samples
pub struct SignalGenerator {
    config: SignalConfig,
    sample_rate: f32,
    phase: f32,
    sweep_phase: f32,
    gate_phase: f32,
    // Pink noise state (Voss-McCartney algorithm)
    pink_rows: [f32; 16],
    pink_running_sum: f32,
    pink_index: usize,
}

impl SignalGenerator {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            config: SignalConfig::default(),
            sample_rate: sample_rate as f32,
            phase: 0.0,
            sweep_phase: 0.0,
            gate_phase: 0.0,
            pink_rows: [0.0; 16],
            pink_running_sum: 0.0,
            pink_index: 0,
        }
    }

    pub fn set_config(&mut self, config: SignalConfig) {
        self.config = config;
        // Reset state for new signal
        self.phase = 0.0;
        self.sweep_phase = 0.0;
        self.gate_phase = 0.0;
    }

    pub fn set_gate_pattern(&mut self, pattern: GatePattern) {
        self.config.gate_pattern = pattern;
        self.gate_phase = 0.0;
    }

    pub fn set_gate_rate(&mut self, rate: f32) {
        self.config.gate_rate = rate.max(0.1);
    }

    pub fn set_gate_duty(&mut self, duty: f32) {
        self.config.gate_duty = duty.clamp(0.1, 1.0);
    }

    pub fn set_frequency(&mut self, frequency: f32) {
        self.config.frequency = frequency;
    }

    pub fn set_amplitude(&mut self, amplitude: f32) {
        self.config.amplitude = amplitude.clamp(0.0, 1.0);
    }

    /// Generate the next sample
    pub fn next_sample(&mut self) -> StereoSample {
        // Generate the base signal
        let sample = match self.config.signal_type {
            SignalType::Sine => self.generate_sine(),
            SignalType::Square => self.generate_square(),
            SignalType::WhiteNoise => self.generate_white_noise(),
            SignalType::PinkNoise => self.generate_pink_noise(),
            SignalType::Impulse => self.generate_impulse(),
            SignalType::Sweep => self.generate_sweep(),
        };

        // Apply gating
        let gate = self.calculate_gate();

        StereoSample::mono(sample * self.config.amplitude * gate)
    }

    /// Calculate the gate multiplier (0.0 or 1.0 with optional smoothing)
    fn calculate_gate(&mut self) -> f32 {
        match self.config.gate_pattern {
            GatePattern::Continuous => 1.0,
            GatePattern::Pulse => {
                // gate_rate is in Hz (pulses per second)
                let cycle_samples = self.sample_rate / self.config.gate_rate;
                let position_in_cycle = self.gate_phase / cycle_samples;

                self.gate_phase += 1.0;
                if self.gate_phase >= cycle_samples {
                    self.gate_phase = 0.0;
                }

                if position_in_cycle < self.config.gate_duty {
                    1.0
                } else {
                    0.0
                }
            }
            GatePattern::Quarter | GatePattern::Eighth | GatePattern::Sixteenth => {
                // gate_rate is BPM
                let bpm = self.config.gate_rate.max(20.0);
                let beats_per_second = bpm / 60.0;

                // Subdivide based on pattern
                let subdivisions = match self.config.gate_pattern {
                    GatePattern::Quarter => 1.0,
                    GatePattern::Eighth => 2.0,
                    GatePattern::Sixteenth => 4.0,
                    _ => 1.0,
                };

                let notes_per_second = beats_per_second * subdivisions;
                let cycle_samples = self.sample_rate / notes_per_second;
                let position_in_cycle = self.gate_phase / cycle_samples;

                self.gate_phase += 1.0;
                if self.gate_phase >= cycle_samples {
                    self.gate_phase = 0.0;
                }

                if position_in_cycle < self.config.gate_duty {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    /// Fill a buffer with samples
    pub fn fill_buffer(&mut self, buffer: &mut [StereoSample]) {
        for sample in buffer.iter_mut() {
            *sample = self.next_sample();
        }
    }

    fn generate_sine(&mut self) -> f32 {
        let sample = (self.phase * 2.0 * PI).sin();
        self.phase += self.config.frequency / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        sample
    }

    fn generate_square(&mut self) -> f32 {
        let sample = if self.phase < 0.5 { 1.0 } else { -1.0 };
        self.phase += self.config.frequency / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        // Soften the square wave slightly to reduce harshness
        sample * 0.8
    }

    fn generate_white_noise(&mut self) -> f32 {
        let mut rng = rand::thread_rng();
        rng.gen_range(-1.0..1.0)
    }

    fn generate_pink_noise(&mut self) -> f32 {
        // Voss-McCartney algorithm for pink noise
        let mut rng = rand::thread_rng();

        // Determine which rows to update based on trailing zeros
        let num_zeros = self.pink_index.trailing_zeros() as usize;
        let num_zeros = num_zeros.min(15);

        // Update the row
        self.pink_running_sum -= self.pink_rows[num_zeros];
        self.pink_rows[num_zeros] = rng.gen_range(-1.0..1.0);
        self.pink_running_sum += self.pink_rows[num_zeros];

        self.pink_index = self.pink_index.wrapping_add(1);

        // Add white noise and normalize
        let white = rng.gen_range(-1.0..1.0);
        (self.pink_running_sum + white) / 5.0
    }

    fn generate_impulse(&mut self) -> f32 {
        // Repeating impulse at the configured frequency (impulses per second)
        // e.g., frequency=1 means 1 impulse per second, frequency=4 means 4 per second
        let impulse_rate = self.config.frequency.max(0.1); // At least 0.1 Hz
        let samples_between_impulses = self.sample_rate / impulse_rate;

        self.phase += 1.0;

        if self.phase >= samples_between_impulses {
            self.phase = 0.0;
            1.0 // Impulse!
        } else {
            0.0
        }
    }

    fn generate_sweep(&mut self) -> f32 {
        // Logarithmic frequency sweep
        let t = self.sweep_phase / self.sample_rate;
        let sweep_progress = (t / self.config.sweep_duration).min(1.0);

        // Logarithmic interpolation between start and end frequencies
        let log_start = self.config.sweep_start.ln();
        let log_end = self.config.sweep_end.ln();
        let current_freq = (log_start + (log_end - log_start) * sweep_progress).exp();

        let sample = (self.phase * 2.0 * PI).sin();
        self.phase += current_freq / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        self.sweep_phase += 1.0;

        // Loop the sweep
        if sweep_progress >= 1.0 {
            self.sweep_phase = 0.0;
        }

        sample
    }

    /// Reset the generator state (for looping, etc.)
    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.sweep_phase = 0.0;
        self.gate_phase = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sine_range() {
        let mut gen = SignalGenerator::new(44100);
        gen.set_config(SignalConfig {
            signal_type: SignalType::Sine,
            frequency: 440.0,
            amplitude: 1.0,
            ..Default::default()
        });

        for _ in 0..44100 {
            let sample = gen.next_sample();
            assert!(sample.left >= -1.0 && sample.left <= 1.0);
            assert!(sample.right >= -1.0 && sample.right <= 1.0);
        }
    }

    #[test]
    fn test_white_noise_range() {
        let mut gen = SignalGenerator::new(44100);
        gen.set_config(SignalConfig {
            signal_type: SignalType::WhiteNoise,
            amplitude: 1.0,
            ..Default::default()
        });

        for _ in 0..1000 {
            let sample = gen.next_sample();
            assert!(sample.left >= -1.0 && sample.left <= 1.0);
        }
    }
}
