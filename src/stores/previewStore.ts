import { create } from 'zustand';
import type { PluginState } from '../api/preview';

export type InputSourceType = 'sample' | 'signal' | 'custom' | 'live';
export type SignalType = 'sine' | 'white_noise' | 'pink_noise' | 'impulse' | 'sweep' | 'square';
export type GatePattern = 'continuous' | 'pulse' | 'quarter' | 'eighth' | 'sixteenth';
export type BuildStatus = 'idle' | 'building' | 'ready' | 'error' | 'needs_rebuild';

export type { PluginState } from '../api/preview';

export interface DemoSample {
  id: string;
  name: string;
  path: string;
  duration?: number;
}

export interface InputSource {
  type: InputSourceType;
  sampleId?: string;
  signalType?: SignalType;
  signalFrequency?: number;
  customPath?: string;
  gatePattern?: GatePattern;
  gateRate?: number;    // Hz for pulse, BPM for musical divisions
  gateDuty?: number;    // 0.0 - 1.0
}

export interface PluginParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface OutputMetering {
  left: number;
  right: number;
  leftDb: number;
  rightDb: number;
  spectrum: number[];
  waveform: number[];
  clippingLeft: boolean;
  clippingRight: boolean;
}

interface PreviewState {
  // Panel visibility
  isOpen: boolean;

  // Playback state
  isPlaying: boolean;
  isLooping: boolean;

  // Plugin info
  pluginType: 'effect' | 'instrument' | null;
  projectName: string | null;

  // Loaded plugin state
  loadedPlugin: PluginState;

  // Input source
  inputSource: InputSource;

  // Build/reload state
  buildStatus: BuildStatus;
  isAutoReload: boolean;
  lastReloadTime: number | null;

  // Output metering (levels, dB, spectrum)
  metering: OutputMetering;

  // Plugin parameters
  parameters: PluginParameter[];

  // Demo samples list
  demoSamples: DemoSample[];

  // Actions
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setLooping: (looping: boolean) => void;
  setPluginType: (type: 'effect' | 'instrument' | null) => void;
  setProjectName: (name: string | null) => void;
  setLoadedPlugin: (state: PluginState) => void;
  setInputSource: (source: InputSource) => void;
  setSignalFrequency: (freq: number) => void;
  setBuildStatus: (status: BuildStatus) => void;
  setAutoReload: (enabled: boolean) => void;
  setLastReloadTime: (time: number | null) => void;
  setMetering: (metering: OutputMetering) => void;
  setParameters: (params: PluginParameter[]) => void;
  updateParameter: (id: string, value: number) => void;
  setDemoSamples: (samples: DemoSample[]) => void;
  reset: () => void;
}

const defaultInputSource: InputSource = {
  type: 'sample',
  sampleId: undefined,
  signalType: 'sine',
  signalFrequency: 440,
  gatePattern: 'continuous',
  gateRate: 2.0,
  gateDuty: 0.5,
};

const defaultMetering: OutputMetering = {
  left: 0,
  right: 0,
  leftDb: -60,
  rightDb: -60,
  spectrum: new Array(32).fill(0),
  waveform: new Array(256).fill(0),
  clippingLeft: false,
  clippingRight: false,
};

const initialState = {
  isOpen: false,
  isPlaying: false,
  isLooping: true,
  pluginType: null as 'effect' | 'instrument' | null,
  projectName: null as string | null,
  loadedPlugin: { status: 'unloaded' } as PluginState,
  inputSource: defaultInputSource,
  buildStatus: 'idle' as BuildStatus,
  isAutoReload: true,
  lastReloadTime: null as number | null,
  metering: defaultMetering,
  parameters: [] as PluginParameter[],
  demoSamples: [] as DemoSample[],
};

export const usePreviewStore = create<PreviewState>()((set) => ({
  ...initialState,

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  setPlaying: (playing) => set({ isPlaying: playing }),
  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setLooping: (looping) => set({ isLooping: looping }),

  setPluginType: (type) => set({ pluginType: type }),
  setProjectName: (name) => set({ projectName: name }),
  setLoadedPlugin: (state) => set({ loadedPlugin: state }),

  setInputSource: (source) => set({ inputSource: source }),
  setSignalFrequency: (freq) =>
    set((state) => ({
      inputSource: { ...state.inputSource, signalFrequency: freq },
    })),

  setBuildStatus: (status) => set({ buildStatus: status }),
  setAutoReload: (enabled) => set({ isAutoReload: enabled }),
  setLastReloadTime: (time) => set({ lastReloadTime: time }),

  setMetering: (metering) => set({ metering }),

  setParameters: (params) => set({ parameters: params }),
  updateParameter: (id, value) =>
    set((state) => ({
      parameters: state.parameters.map((p) =>
        p.id === id ? { ...p, value } : p
      ),
    })),

  setDemoSamples: (samples) => set({ demoSamples: samples }),

  reset: () => set(initialState),
}));
