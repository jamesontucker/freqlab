import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig, DawPaths, DawPathConfig, CustomThemeColors, AudioSettings, AISettings, ChatStyle, ClaudeModel, AgentVerbosity } from '../types';
import { getPlatformDefaults } from '../lib/platform';

const platformDefaults = getPlatformDefaults();
const defaultDawPaths: DawPaths = platformDefaults.dawPaths;

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
  setBuildFormats: (formats: string[]) => void;
  updateDawPath: (daw: keyof DawPaths, format: keyof DawPathConfig, path: string) => void;
  setShowNotifications: (show: boolean) => void;
  setAaxSdkPath: (path: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      workspacePath: platformDefaults.workspacePath,
      outputPath: '~/Freqlab/output',
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
      // AAX SDK path (empty = not configured)
      aaxSdkPath: '',
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
      setBuildFormats: (formats) => set({ buildFormats: formats }),
      setShowNotifications: (show) => set({ showNotifications: show }),
      setAaxSdkPath: (path) => set({ aaxSdkPath: path }),
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
            reaper: { ...currentState.dawPaths.reaper, ...(persisted.dawPaths?.reaper || {}) },
            ableton: { ...currentState.dawPaths.ableton, ...(persisted.dawPaths?.ableton || {}) },
            flStudio: { ...currentState.dawPaths.flStudio, ...(persisted.dawPaths?.flStudio || {}) },
            logic: { ...currentState.dawPaths.logic, ...(persisted.dawPaths?.logic || {}) },
            other: { ...currentState.dawPaths.other, ...(persisted.dawPaths?.other || {}) },
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
