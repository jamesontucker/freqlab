import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig, DawPaths, CustomThemeColors, AudioSettings } from '../types';

const defaultDawPaths: DawPaths = {
  reaper: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP' },
  ableton: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP' },
  flStudio: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP' },
  logic: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP' },
  other: { vst3: '', clap: '' },
};

const defaultCustomColors: CustomThemeColors = {
  accent: '#2DA86E',
  bgPrimary: '#0f0f0f',
  bgSecondary: '#171717',
  bgTertiary: '#1f1f1f',
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
};

const defaultAudioSettings: AudioSettings = {
  outputDevice: null,  // Use system default
  sampleRate: 48000,   // 48kHz - industry standard
  bufferSize: 512,
};

interface SettingsState extends AppConfig {
  // Audio settings (what the user has configured)
  audioSettings: AudioSettings;
  // Applied audio settings (what the engine is currently using - set on app startup)
  appliedAudioSettings: AudioSettings | null;
  setAudioSettings: (settings: AudioSettings) => void;
  updateAudioSetting: <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => void;
  // Mark current audioSettings as applied (called after engine init)
  markAudioSettingsApplied: () => void;
  // Other settings
  setSetupComplete: (complete: boolean) => void;
  setWorkspacePath: (path: string) => void;
  setTheme: (theme: 'dark' | 'light' | 'custom') => void;
  setCustomColors: (colors: CustomThemeColors) => void;
  updateCustomColor: (key: keyof CustomThemeColors, value: string) => void;
  setVendorName: (name: string) => void;
  setVendorUrl: (url: string) => void;
  setVendorEmail: (email: string) => void;
  setDawPaths: (paths: DawPaths) => void;
  updateDawPath: (daw: keyof DawPaths, format: 'vst3' | 'clap', path: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      workspacePath: '~/VSTWorkshop',
      outputPath: '~/VSTWorkshop/output',
      buildFormats: ['vst3', 'clap'],
      autoOpenOutput: true,
      showNotifications: true,
      theme: 'dark',
      customColors: defaultCustomColors,
      setupComplete: false,
      // Branding defaults
      vendorName: 'freqlab',
      vendorUrl: '',
      vendorEmail: '',
      // DAW paths defaults
      dawPaths: defaultDawPaths,
      // Audio settings defaults
      audioSettings: defaultAudioSettings,
      appliedAudioSettings: null, // Set on first engine init

      // Audio settings setters
      setAudioSettings: (settings) => set({ audioSettings: settings }),
      updateAudioSetting: (key, value) =>
        set((state) => ({
          audioSettings: {
            ...state.audioSettings,
            [key]: value,
          },
        })),
      markAudioSettingsApplied: () =>
        set((state) => ({
          appliedAudioSettings: { ...state.audioSettings },
        })),

      setSetupComplete: (complete) => set({ setupComplete: complete }),
      setWorkspacePath: (path) => set({ workspacePath: path }),
      setTheme: (theme) => set({ theme }),
      setCustomColors: (colors) => set({ customColors: colors }),
      updateCustomColor: (key, value) =>
        set((state) => ({
          customColors: {
            ...state.customColors,
            [key]: value,
          },
        })),
      setVendorName: (name) => set({ vendorName: name }),
      setVendorUrl: (url) => set({ vendorUrl: url }),
      setVendorEmail: (email) => set({ vendorEmail: email }),
      setDawPaths: (paths) => set({ dawPaths: paths }),
      updateDawPath: (daw, format, path) =>
        set((state) => ({
          dawPaths: {
            ...state.dawPaths,
            [daw]: {
              ...state.dawPaths[daw],
              [format]: path,
            },
          },
        })),
    }),
    {
      name: 'freqlab-settings',
    }
  )
);
