//! Audio sample loading and playback using Symphonia

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::buffer::StereoSample;

/// Information about a loaded sample
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleInfo {
    pub name: String,
    pub path: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_secs: f32,
    pub num_samples: usize,
}

/// A loaded audio sample ready for playback
pub struct AudioSample {
    pub info: SampleInfo,
    /// Interleaved stereo samples (always converted to stereo)
    pub data: Vec<StereoSample>,
}

impl AudioSample {
    /// Load an audio file from disk
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let path = path.as_ref();
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;

        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        // Create a hint to help the format registry
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        // Probe the media source
        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| format!("Failed to probe format: {}", e))?;

        let mut format = probed.format;

        // Get the default track
        let track = format
            .default_track()
            .ok_or_else(|| "No audio track found".to_string())?;

        let track_id = track.id;
        let sample_rate = track
            .codec_params
            .sample_rate
            .ok_or_else(|| "Unknown sample rate".to_string())?;
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count() as u32)
            .unwrap_or(2);

        // Create decoder
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("Failed to create decoder: {}", e))?;

        // Decode all samples
        let mut samples: Vec<StereoSample> = Vec::new();

        loop {
            match format.next_packet() {
                Ok(packet) => {
                    if packet.track_id() != track_id {
                        continue;
                    }

                    match decoder.decode(&packet) {
                        Ok(audio_buf) => {
                            append_audio_buffer(&audio_buf, &mut samples, channels);
                        }
                        Err(symphonia::core::errors::Error::DecodeError(_)) => {
                            // Skip decode errors
                            continue;
                        }
                        Err(e) => {
                            return Err(format!("Decode error: {}", e));
                        }
                    }
                }
                Err(symphonia::core::errors::Error::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    // End of stream
                    break;
                }
                Err(e) => {
                    return Err(format!("Format error: {}", e));
                }
            }
        }

        let duration_secs = samples.len() as f32 / sample_rate as f32;

        Ok(Self {
            info: SampleInfo {
                name,
                path: path.to_string_lossy().to_string(),
                sample_rate,
                channels,
                duration_secs,
                num_samples: samples.len(),
            },
            data: samples,
        })
    }

    /// Get a sample at a given position (with optional interpolation)
    pub fn get_sample(&self, position: usize) -> StereoSample {
        if position < self.data.len() {
            self.data[position]
        } else {
            StereoSample::silence()
        }
    }
}

/// Append decoded audio buffer to our sample vector
fn append_audio_buffer(buf: &AudioBufferRef, output: &mut Vec<StereoSample>, channels: u32) {
    match buf {
        AudioBufferRef::F32(buffer) => {
            log::debug!("Decoding F32 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = *buffer.chan(0).get(frame).unwrap_or(&0.0);
                let right = if channels > 1 {
                    *buffer.chan(1).get(frame).unwrap_or(&0.0)
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::F64(buffer) => {
            log::debug!("Decoding F64 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = *buffer.chan(0).get(frame).unwrap_or(&0.0) as f32;
                let right = if channels > 1 {
                    *buffer.chan(1).get(frame).unwrap_or(&0.0) as f32
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::S16(buffer) => {
            log::debug!("Decoding S16 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = *buffer.chan(0).get(frame).unwrap_or(&0) as f32 / 32768.0;
                let right = if channels > 1 {
                    *buffer.chan(1).get(frame).unwrap_or(&0) as f32 / 32768.0
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::S24(buffer) => {
            // 24-bit audio is common in WAV files
            log::debug!("Decoding S24 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                // S24 is stored as i24 but we get it as a wrapper type
                let left = buffer.chan(0).get(frame).map(|s| s.inner() as f32 / 8388608.0).unwrap_or(0.0);
                let right = if channels > 1 {
                    buffer.chan(1).get(frame).map(|s| s.inner() as f32 / 8388608.0).unwrap_or(0.0)
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::S32(buffer) => {
            log::debug!("Decoding S32 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = *buffer.chan(0).get(frame).unwrap_or(&0) as f32 / 2147483648.0;
                let right = if channels > 1 {
                    *buffer.chan(1).get(frame).unwrap_or(&0) as f32 / 2147483648.0
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::U8(buffer) => {
            log::debug!("Decoding U8 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                // U8 is centered at 128
                let left = (*buffer.chan(0).get(frame).unwrap_or(&128) as f32 - 128.0) / 128.0;
                let right = if channels > 1 {
                    (*buffer.chan(1).get(frame).unwrap_or(&128) as f32 - 128.0) / 128.0
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::U16(buffer) => {
            log::debug!("Decoding U16 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                // U16 is centered at 32768
                let left = (*buffer.chan(0).get(frame).unwrap_or(&32768) as f32 - 32768.0) / 32768.0;
                let right = if channels > 1 {
                    (*buffer.chan(1).get(frame).unwrap_or(&32768) as f32 - 32768.0) / 32768.0
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::U24(buffer) => {
            log::debug!("Decoding U24 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = buffer.chan(0).get(frame).map(|s| (s.inner() as f32 - 8388608.0) / 8388608.0).unwrap_or(0.0);
                let right = if channels > 1 {
                    buffer.chan(1).get(frame).map(|s| (s.inner() as f32 - 8388608.0) / 8388608.0).unwrap_or(0.0)
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::U32(buffer) => {
            log::debug!("Decoding U32 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = (*buffer.chan(0).get(frame).unwrap_or(&2147483648) as f64 - 2147483648.0) as f32 / 2147483648.0;
                let right = if channels > 1 {
                    (*buffer.chan(1).get(frame).unwrap_or(&2147483648) as f64 - 2147483648.0) as f32 / 2147483648.0
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
        AudioBufferRef::S8(buffer) => {
            log::debug!("Decoding S8 audio buffer, {} frames", buffer.frames());
            let frames = buffer.frames();
            for frame in 0..frames {
                let left = *buffer.chan(0).get(frame).unwrap_or(&0) as f32 / 128.0;
                let right = if channels > 1 {
                    *buffer.chan(1).get(frame).unwrap_or(&0) as f32 / 128.0
                } else {
                    left
                };
                output.push(StereoSample::new(left, right));
            }
        }
    }
}

/// Sample player that handles playback position and looping
pub struct SamplePlayer {
    sample: Option<AudioSample>,
    position: usize,
    is_playing: bool,
    is_looping: bool,
    /// Playback speed ratio (for resampling)
    speed_ratio: f32,
    fractional_position: f32,
}

impl SamplePlayer {
    pub fn new() -> Self {
        Self {
            sample: None,
            position: 0,
            is_playing: false,
            is_looping: true,
            speed_ratio: 1.0,
            fractional_position: 0.0,
        }
    }

    pub fn load_sample(&mut self, sample: AudioSample) {
        self.sample = Some(sample);
        self.position = 0;
        self.fractional_position = 0.0;
    }

    pub fn unload(&mut self) {
        self.sample = None;
        self.position = 0;
        self.is_playing = false;
    }

    pub fn play(&mut self) {
        self.is_playing = true;
    }

    pub fn stop(&mut self) {
        self.is_playing = false;
        self.position = 0;
        self.fractional_position = 0.0;
    }

    pub fn pause(&mut self) {
        self.is_playing = false;
    }

    pub fn set_looping(&mut self, looping: bool) {
        self.is_looping = looping;
    }

    pub fn set_speed_ratio(&mut self, ratio: f32) {
        self.speed_ratio = ratio.max(0.1).min(4.0);
    }

    pub fn is_playing(&self) -> bool {
        self.is_playing
    }

    pub fn has_sample(&self) -> bool {
        self.sample.is_some()
    }

    /// Get the next sample (with resampling if needed)
    pub fn next_sample(&mut self) -> StereoSample {
        if !self.is_playing {
            return StereoSample::silence();
        }

        let sample = match &self.sample {
            Some(s) => s,
            None => return StereoSample::silence(),
        };

        if self.position >= sample.data.len() {
            if self.is_looping {
                self.position = 0;
                self.fractional_position = 0.0;
            } else {
                self.is_playing = false;
                return StereoSample::silence();
            }
        }

        // Linear interpolation for resampling
        let current = sample.get_sample(self.position);
        let next = sample.get_sample(self.position + 1);
        let frac = self.fractional_position;

        let interpolated = StereoSample::new(
            current.left * (1.0 - frac) + next.left * frac,
            current.right * (1.0 - frac) + next.right * frac,
        );

        // Advance position
        self.fractional_position += self.speed_ratio;
        while self.fractional_position >= 1.0 {
            self.fractional_position -= 1.0;
            self.position += 1;
        }

        interpolated
    }

    /// Fill a buffer with samples
    pub fn fill_buffer(&mut self, buffer: &mut [StereoSample]) {
        for sample in buffer.iter_mut() {
            *sample = self.next_sample();
        }
    }
}

impl Default for SamplePlayer {
    fn default() -> Self {
        Self::new()
    }
}
