import { create } from 'zustand';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date: string | null;
  body: string | null;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error';

interface UpdateState {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  error: string | null;
  lastChecked: string | null;

  // Actions
  setStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setDownloadProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  setLastChecked: (timestamp: string) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  updateInfo: null,
  downloadProgress: 0,
  error: null,
  lastChecked: null,

  setStatus: (status) => set({ status }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setDownloadProgress: (downloadProgress) => set({ downloadProgress }),
  setError: (error) => set({ error, status: 'error' }),
  setLastChecked: (lastChecked) => set({ lastChecked }),
  reset: () =>
    set({
      status: 'idle',
      updateInfo: null,
      downloadProgress: 0,
      error: null,
    }),
}));
