//! FFT-based spectrum analyzer for real-time audio visualization

use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

/// Number of frequency bands for visualization
pub const NUM_BANDS: usize = 32;

/// FFT size (must be power of 2)
const FFT_SIZE: usize = 2048;

/// Spectrum analyzer using FFT
pub struct SpectrumAnalyzer {
    fft: Arc<dyn RealToComplex<f32>>,
    input_buffer: Vec<f32>,
    spectrum_buffer: Vec<realfft::num_complex::Complex<f32>>,
    /// Pre-allocated scratch buffer for windowed samples (avoids allocation in hot path)
    windowed_buffer: Vec<f32>,
    window: Vec<f32>,
    sample_rate: u32,
    write_pos: usize,
    /// Band magnitudes (0.0 - 1.0, linear)
    band_magnitudes: [f32; NUM_BANDS],
    /// Band frequencies (center frequency of each band)
    band_frequencies: [f32; NUM_BANDS],
    /// Smoothing factor for band magnitudes
    smoothing: f32,
}

impl SpectrumAnalyzer {
    pub fn new(sample_rate: u32) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);

        let input_buffer = vec![0.0f32; FFT_SIZE];
        let spectrum_buffer = fft.make_output_vec();
        // Pre-allocate scratch buffer for windowed samples
        let windowed_buffer = vec![0.0f32; FFT_SIZE];

        // Create Hann window for smooth frequency response
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| {
                let x = i as f32 / FFT_SIZE as f32;
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * x).cos())
            })
            .collect();

        // Calculate logarithmically spaced band frequencies
        // Range: 20Hz to 20kHz
        let min_freq = 20.0f32;
        let max_freq = 20000.0f32.min(sample_rate as f32 / 2.0);
        let log_min = min_freq.ln();
        let log_max = max_freq.ln();

        let mut band_frequencies = [0.0f32; NUM_BANDS];
        for i in 0..NUM_BANDS {
            let t = i as f32 / (NUM_BANDS - 1) as f32;
            band_frequencies[i] = (log_min + t * (log_max - log_min)).exp();
        }

        Self {
            fft,
            input_buffer,
            spectrum_buffer,
            windowed_buffer,
            window,
            sample_rate,
            write_pos: 0,
            band_magnitudes: [0.0; NUM_BANDS],
            band_frequencies,
            smoothing: 0.7, // Higher = smoother, slower response
        }
    }

    /// Push audio samples into the analyzer
    /// Returns true if enough samples have been collected for FFT
    pub fn push_samples(&mut self, samples: &[f32]) -> bool {
        for &sample in samples {
            self.input_buffer[self.write_pos] = sample;
            self.write_pos = (self.write_pos + 1) % FFT_SIZE;
        }

        // Return true when we've collected enough samples
        // We process on every buffer for smoother updates
        true
    }

    /// Compute FFT and update band magnitudes
    pub fn analyze(&mut self) {
        // Apply window to pre-allocated scratch buffer (no allocation in hot path)
        for (i, (&s, &w)) in self.input_buffer.iter().zip(&self.window).enumerate() {
            self.windowed_buffer[i] = s * w;
        }

        // Perform FFT
        if self.fft.process(&mut self.windowed_buffer, &mut self.spectrum_buffer).is_err() {
            return;
        }

        // Calculate magnitude for each band
        let bin_freq = self.sample_rate as f32 / FFT_SIZE as f32;
        let num_bins = self.spectrum_buffer.len();

        for band_idx in 0..NUM_BANDS {
            // Get frequency range for this band
            let center_freq = self.band_frequencies[band_idx];
            let (low_freq, high_freq) = if band_idx == 0 {
                (20.0, (center_freq + self.band_frequencies[1]) / 2.0)
            } else if band_idx == NUM_BANDS - 1 {
                (
                    (self.band_frequencies[band_idx - 1] + center_freq) / 2.0,
                    self.sample_rate as f32 / 2.0,
                )
            } else {
                (
                    (self.band_frequencies[band_idx - 1] + center_freq) / 2.0,
                    (center_freq + self.band_frequencies[band_idx + 1]) / 2.0,
                )
            };

            // Find bin range for this frequency band
            let low_bin = ((low_freq / bin_freq) as usize).max(1);
            let high_bin = ((high_freq / bin_freq) as usize).min(num_bins - 1);

            // Sum magnitudes in this range
            let mut sum = 0.0f32;
            let mut count = 0;
            for bin in low_bin..=high_bin {
                let mag = self.spectrum_buffer[bin].norm();
                sum += mag;
                count += 1;
            }

            // Average magnitude
            let avg_mag = if count > 0 { sum / count as f32 } else { 0.0 };

            // Normalize (rough scaling for visualization)
            // The scaling factor depends on FFT size and window
            let normalized = (avg_mag / (FFT_SIZE as f32 / 4.0)).min(1.0);

            // Apply smoothing
            self.band_magnitudes[band_idx] = self.band_magnitudes[band_idx] * self.smoothing
                + normalized * (1.0 - self.smoothing);
        }
    }

    /// Get current band magnitudes (0.0 - 1.0)
    pub fn get_magnitudes(&self) -> [f32; NUM_BANDS] {
        self.band_magnitudes
    }

    /// Get band center frequencies
    pub fn get_frequencies(&self) -> [f32; NUM_BANDS] {
        self.band_frequencies
    }

    /// Convert linear magnitude to decibels
    /// Returns -inf for 0, and approximately -60 to 0 dB for typical audio
    pub fn magnitude_to_db(mag: f32) -> f32 {
        if mag <= 0.0 {
            -60.0
        } else {
            20.0 * mag.log10()
        }
    }

    /// Reset the analyzer state
    pub fn reset(&mut self) {
        self.input_buffer.fill(0.0);
        self.write_pos = 0;
        self.band_magnitudes.fill(0.0);
    }
}
