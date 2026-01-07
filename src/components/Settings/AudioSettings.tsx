import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { useSettingsStore } from '../../stores/settingsStore';

interface AudioDevice {
  name: string;
  is_default: boolean;
}

const SAMPLE_RATES = [
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' },
  { value: 88200, label: '88.2 kHz' },
  { value: 96000, label: '96 kHz' },
];

const BUFFER_SIZES = [
  { value: 128, label: '128 samples' },
  { value: 256, label: '256 samples' },
  { value: 512, label: '512 samples' },
  { value: 1024, label: '1024 samples' },
  { value: 2048, label: '2048 samples' },
];

export function AudioSettings() {
  const { audioSettings, appliedAudioSettings, updateAudioSetting } = useSettingsStore();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [systemSampleRate, setSystemSampleRate] = useState<number | null>(null);

  // Check if settings have changed from what's currently applied
  const hasChanges = appliedAudioSettings !== null && (
    audioSettings.outputDevice !== appliedAudioSettings.outputDevice ||
    audioSettings.sampleRate !== appliedAudioSettings.sampleRate ||
    audioSettings.bufferSize !== appliedAudioSettings.bufferSize
  );

  // Load available devices and system sample rate on mount
  useEffect(() => {
    loadDevices();
    loadSystemSampleRate();
  }, []);

  const loadDevices = async () => {
    setLoading(true);
    try {
      const deviceList = await invoke<AudioDevice[]>('get_audio_devices');
      setDevices(deviceList);
    } catch (err) {
      console.error('Failed to load audio devices:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSystemSampleRate = async () => {
    try {
      const rate = await invoke<number>('get_system_sample_rate');
      setSystemSampleRate(rate);
    } catch (err) {
      console.error('Failed to get system sample rate:', err);
    }
  };

  const isDev = import.meta.env.DEV;

  const handleRestart = async () => {
    if (isDev) {
      // In dev mode, relaunch doesn't work well - just show instructions
      return;
    }
    try {
      await relaunch();
    } catch (err) {
      console.error('Failed to restart:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">Audio</h3>
        <p className="text-sm text-text-muted">Configure audio output device and quality settings.</p>
      </div>

      {/* Output Device */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text-secondary">Output Device</label>
        <select
          value={audioSettings.outputDevice || ''}
          onChange={(e) => updateAudioSetting('outputDevice', e.target.value || null)}
          disabled={loading}
          className="w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="">System Default</option>
          {devices.map((device) => (
            <option key={device.name} value={device.name}>
              {device.name} {device.is_default ? '(Default)' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          Select the audio interface for plugin preview playback.
        </p>
      </div>

      {/* Sample Rate */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text-secondary">Sample Rate</label>
        <div className="grid grid-cols-4 gap-2">
          {SAMPLE_RATES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => updateAudioSetting('sampleRate', value)}
              className={`relative px-3 py-2 text-sm rounded-lg border transition-colors ${
                audioSettings.sampleRate === value
                  ? 'bg-accent/10 border-accent text-accent'
                  : 'border-border text-text-secondary hover:border-text-muted hover:text-text-primary'
              }`}
            >
              {label}
              {systemSampleRate === value && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" title="System default" />
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {systemSampleRate && (
            <span className="inline-flex items-center gap-1 mr-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              System default: {systemSampleRate / 1000} kHz
            </span>
          )}
          Match this with your DAW to avoid sample rate conflicts. Discord and OBS use 48 kHz.
        </p>
      </div>

      {/* Buffer Size */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text-secondary">Buffer Size</label>
        <div className="grid grid-cols-5 gap-2">
          {BUFFER_SIZES.map(({ value }) => (
            <button
              key={value}
              onClick={() => updateAudioSetting('bufferSize', value)}
              className={`px-2 py-2 text-xs rounded-lg border transition-colors ${
                audioSettings.bufferSize === value
                  ? 'bg-accent/10 border-accent text-accent'
                  : 'border-border text-text-secondary hover:border-text-muted hover:text-text-primary'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          Lower values reduce latency but increase CPU load.
        </p>
      </div>

      {/* Restart Notice */}
      <div className="pt-4 border-t border-border">
        {hasChanges ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              {isDev ? (
                <span className="text-sm text-amber-500 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Restart dev server to apply changes
                </span>
              ) : (
                <>
                  <button
                    onClick={handleRestart}
                    className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Restart to Apply
                  </button>
                  <span className="text-sm text-amber-500 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Restart required
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Audio settings are up to date
          </p>
        )}
        <p className="text-xs text-text-muted mt-2">
          Audio settings require a restart to take effect due to plugin compatibility.
        </p>
      </div>
    </div>
  );
}
