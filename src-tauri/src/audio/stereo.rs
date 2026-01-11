//! Stereo field analyzer for real-time stereo imaging visualization
//!
//! Computes polar sample positions and stereo correlation coefficient
//! for visualizing stereo width in a semicircular "sound field" display.

/// Number of sample positions to track for particle visualization
/// Larger = denser particle cloud, but more memory/bandwidth
pub const STEREO_HISTORY_SIZE: usize = 2048;

/// Stereo field analyzer
///
/// Tracks sample positions in polar coordinates and computes
/// stereo correlation coefficient for visualization.
pub struct StereoAnalyzer {
    /// Ring buffer for sample positions: (angle, radius)
    /// angle: 0 = full right, PI/2 = center (mono), PI = full left
    /// radius: 0-1 based on M/S amplitude
    positions: [(f32, f32); STEREO_HISTORY_SIZE],
    write_pos: usize,

    /// Running sums for correlation calculation
    sum_lr: f32,
    sum_l2: f32,
    sum_r2: f32,
    sample_count: usize,

    /// Smoothed correlation output (-1.0 to +1.0)
    correlation: f32,

    /// Smoothing factor for correlation (higher = smoother)
    smoothing: f32,

    /// Window size for correlation calculation
    correlation_window: usize,
}

impl StereoAnalyzer {
    pub fn new() -> Self {
        Self {
            positions: [(std::f32::consts::FRAC_PI_2, 0.0); STEREO_HISTORY_SIZE],
            write_pos: 0,
            sum_lr: 0.0,
            sum_l2: 0.0,
            sum_r2: 0.0,
            sample_count: 0,
            correlation: 1.0, // Start at mono
            smoothing: 0.95,  // Smooth correlation to prevent jitter
            correlation_window: 4096, // About 100ms at 44.1kHz
        }
    }

    /// Push a stereo sample pair and update position buffer
    ///
    /// Uses standard polar vectorscope formula:
    /// - angle = 2 * atan2(|L|, |R|) — gives correct L/R positioning regardless of phase
    /// - magnitude = sqrt(L² + R²)
    /// This maps: pure right → 0, center → π/2, pure left → π
    pub fn push_sample(&mut self, left: f32, right: f32) {
        // Calculate magnitude (Euclidean distance)
        let magnitude = (left * left + right * right).sqrt();

        // Skip very quiet samples
        if magnitude < 0.001 {
            return;
        }

        // Standard polar vectorscope angle: 2 * atan2(|L|, |R|)
        // Using absolute values ensures correct L/R positioning regardless of waveform phase
        // The 2x multiplier scales atan2's [0, π/2] range to [0, π] for the semicircle
        let abs_l = left.abs();
        let abs_r = right.abs();
        let angle = 2.0 * f32::atan2(abs_l, abs_r);

        // Radius from magnitude with sqrt scaling for better visual spread
        let radius = magnitude.sqrt().min(1.0);

        // Store position
        self.positions[self.write_pos] = (angle, radius);
        self.write_pos = (self.write_pos + 1) % STEREO_HISTORY_SIZE;

        // Update correlation sums
        self.sum_lr += left * right;
        self.sum_l2 += left * left;
        self.sum_r2 += right * right;
        self.sample_count += 1;

        // Compute correlation when we have enough samples
        if self.sample_count >= self.correlation_window {
            self.compute_correlation();
        }
    }

    /// Push multiple stereo sample pairs (interleaved L/R)
    pub fn push_samples(&mut self, samples: &[f32]) {
        for chunk in samples.chunks(2) {
            if chunk.len() == 2 {
                self.push_sample(chunk[0], chunk[1]);
            }
        }
    }

    /// Compute and update the correlation coefficient
    fn compute_correlation(&mut self) {
        // correlation = Σ(L×R) / sqrt(Σ(L²) × Σ(R²))
        let denom = (self.sum_l2 * self.sum_r2).sqrt();
        let raw_correlation = if denom > 0.0 {
            self.sum_lr / denom
        } else {
            1.0 // If both channels are silent, assume mono
        };

        // Clamp to valid range
        let raw_correlation = raw_correlation.clamp(-1.0, 1.0);

        // Apply smoothing
        self.correlation = self.correlation * self.smoothing
            + raw_correlation * (1.0 - self.smoothing);

        // Reset running sums for next window
        self.sum_lr = 0.0;
        self.sum_l2 = 0.0;
        self.sum_r2 = 0.0;
        self.sample_count = 0;
    }

    /// Get all sample positions for visualization
    /// Returns positions in order from oldest to newest
    pub fn get_positions(&self) -> [(f32, f32); STEREO_HISTORY_SIZE] {
        let mut result = [(0.0f32, 0.0f32); STEREO_HISTORY_SIZE];

        // Copy positions starting from write_pos (oldest) to end of buffer
        // then from start of buffer to write_pos-1 (newest)
        for i in 0..STEREO_HISTORY_SIZE {
            let src_idx = (self.write_pos + i) % STEREO_HISTORY_SIZE;
            result[i] = self.positions[src_idx];
        }

        result
    }

    /// Get current smoothed correlation coefficient
    /// Returns value from -1.0 (out of phase) to +1.0 (mono/in-phase)
    pub fn get_correlation(&self) -> f32 {
        self.correlation
    }

    /// Reset the analyzer state
    pub fn reset(&mut self) {
        self.positions.fill((std::f32::consts::FRAC_PI_2, 0.0));
        self.write_pos = 0;
        self.sum_lr = 0.0;
        self.sum_l2 = 0.0;
        self.sum_r2 = 0.0;
        self.sample_count = 0;
        self.correlation = 1.0;
    }
}

impl Default for StereoAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}
