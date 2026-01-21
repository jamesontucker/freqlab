import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig, DawPaths, CustomThemeColors, AudioSettings, AISettings, ChatStyle, ClaudeModel, AgentVerbosity, AIProvider } from '../types';

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
  chatUser: '#3b82f6',
};

const defaultAudioSettings: AudioSettings = {
  outputDevice: null,  // Use system default
  sampleRate: 48000,   // 48kHz - industry standard
  bufferSize: 512,
};

const defaultAISettings: AISettings = {
  provider: 'claude',
  chatStyle: 'conversational',
  model: 'opus',
  customInstructions: '',
  agentVerbosity: 'balanced',
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
  // AI settings
  aiSettings: AISettings;
  setAISettings: (settings: AISettings) => void;
  setProvider: (provider: AIProvider) => void;
  setChatStyle: (style: ChatStyle) => void;
  setModel: (model: ClaudeModel) => void;
  setCustomInstructions: (instructions: string) => void;
  setAgentVerbosity: (verbosity: AgentVerbosity) => void;
  // License versioning (tracks which license version user has accepted)
  acceptedLicenseVersion: number;
  setAcceptedLicenseVersion: (version: number) => void;
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
  setShowNotifications: (show: boolean) => void;
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
      // AI settings defaults
      aiSettings: defaultAISettings,
      // License versioning (0 = never accepted, 1 = GPL-3.0, 2 = PolyForm Shield)
      acceptedLicenseVersion: 0,

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

      // AI settings setters
      setAISettings: (settings) => set({ aiSettings: settings }),
      setProvider: (provider) =>
        set((state) => ({
          aiSettings: { ...state.aiSettings, provider },
        })),
      setChatStyle: (style) =>
        set((state) => ({
          aiSettings: { ...state.aiSettings, chatStyle: style },
        })),
      setModel: (model) =>
        set((state) => ({
          aiSettings: { ...state.aiSettings, model },
        })),
      setCustomInstructions: (instructions) =>
        set((state) => ({
          aiSettings: { ...state.aiSettings, customInstructions: instructions },
        })),
      setAgentVerbosity: (verbosity) =>
        set((state) => ({
          aiSettings: { ...state.aiSettings, agentVerbosity: verbosity },
        })),

      // License versioning setter
      setAcceptedLicenseVersion: (version) => set({ acceptedLicenseVersion: version }),

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
      setShowNotifications: (show) => set({ showNotifications: show }),
    }),
    {
      name: 'freqlab-settings',
      // Merge persisted state with defaults to handle new fields for existing users
      merge: (persistedState, currentState) => {
        // Handle null/undefined persistedState (e.g., after localStorage.clear())
        const persisted = (persistedState ?? {}) as Partial<SettingsState>;
        return {
          ...currentState,
          ...persisted,
          // Ensure acceptedLicenseVersion is always a valid number (handles undefined, null, NaN)
          acceptedLicenseVersion:
            typeof persisted.acceptedLicenseVersion === 'number' && !isNaN(persisted.acceptedLicenseVersion)
              ? persisted.acceptedLicenseVersion
              : 0,
          // Deep merge aiSettings to pick up new fields (model, customInstructions)
          aiSettings: {
            ...currentState.aiSettings,
            ...(persisted.aiSettings || {}),
          },
          // Deep merge other nested objects
          audioSettings: {
            ...currentState.audioSettings,
            ...(persisted.audioSettings || {}),
          },
          dawPaths: {
            ...currentState.dawPaths,
            ...(persisted.dawPaths || {}),
          },
          customColors: {
            ...currentState.customColors,
            ...(persisted.customColors || {}),
          },
        };
      },
    }
  )
);
