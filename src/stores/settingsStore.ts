import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../types';

interface SettingsState extends AppConfig {
  setSetupComplete: (complete: boolean) => void;
  setWorkspacePath: (path: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
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
      setupComplete: false,

      setSetupComplete: (complete) => set({ setupComplete: complete }),
      setWorkspacePath: (path) => set({ workspacePath: path }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'freqlab-settings',
    }
  )
);
