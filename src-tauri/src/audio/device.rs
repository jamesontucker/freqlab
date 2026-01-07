//! Audio device enumeration and management

use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub buffer_size: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            sample_rate: 44100,
            channels: 2,
            buffer_size: 512,
        }
    }
}

/// Get list of available output devices
pub fn list_output_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_device = host.default_output_device();
    let default_name = default_device.as_ref().and_then(|d| d.name().ok());

    let devices = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

    let mut result = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            result.push(AudioDeviceInfo {
                is_default: Some(&name) == default_name.as_ref(),
                name,
            });
        }
    }

    Ok(result)
}

/// Get the default output device
pub fn get_default_output_device() -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    host.default_output_device()
        .ok_or_else(|| "No default output device found".to_string())
}

/// Get output device by name, or default if name is None
pub fn get_output_device(name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();

    match name {
        Some(device_name) => {
            let devices = host
                .output_devices()
                .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

            for device in devices {
                if let Ok(n) = device.name() {
                    if n == device_name {
                        return Ok(device);
                    }
                }
            }
            Err(format!("Device '{}' not found", device_name))
        }
        None => get_default_output_device(),
    }
}

/// Get the default output device's sample rate
pub fn get_default_sample_rate() -> Result<u32, String> {
    let device = get_default_output_device()?;
    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get default config: {}", e))?;
    Ok(config.sample_rate().0)
}

/// Get supported config for a device
pub fn get_supported_config(
    device: &cpal::Device,
    preferred: &AudioConfig,
) -> Result<cpal::StreamConfig, String> {
    let supported_configs = device
        .supported_output_configs()
        .map_err(|e| format!("Failed to get supported configs: {}", e))?;

    // Try to find a config matching our preferences
    for config in supported_configs {
        let min_rate = config.min_sample_rate().0;
        let max_rate = config.max_sample_rate().0;

        if preferred.sample_rate >= min_rate
            && preferred.sample_rate <= max_rate
            && config.channels() >= preferred.channels
        {
            return Ok(cpal::StreamConfig {
                channels: preferred.channels,
                sample_rate: cpal::SampleRate(preferred.sample_rate),
                buffer_size: cpal::BufferSize::Fixed(preferred.buffer_size),
            });
        }
    }

    // Fall back to default config
    let default_config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get default config: {}", e))?;

    Ok(cpal::StreamConfig {
        channels: default_config.channels().min(2),
        sample_rate: default_config.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    })
}
