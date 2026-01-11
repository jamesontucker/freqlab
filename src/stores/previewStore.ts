import { create } from 'zustand';
import type { PluginState } from '../api/preview';

export type InputSourceType = 'sample' | 'signal' | 'custom' | 'live';
export type SignalType = 'sine' | 'white_noise' | 'pink_noise' | 'impulse' | 'sweep' | 'square';
export type GatePattern = 'continuous' | 'pulse' | 'quarter' | 'eighth' | 'sixteenth';
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
  liveDeviceId?: string;  // Selected input device for live input
  liveChunkSize?: number; // Resampler chunk size for latency control (64-512)
}

export interface AudioDevice {
  name: string;
  is_default: boolean;
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
  // Input levels for live input metering
  inputLeft: number;
  inputRight: number;
  inputLeftDb: number;
  inputRightDb: number;
  // Spectrum data
  spectrum: number[];         // Post-FX output spectrum
  spectrumInput: number[];    // Pre-FX input spectrum for comparison
  // Output waveform data (post-FX)
  waveformLeft: number[];
  waveformRight: number[];
  waveformPeakLeft: number;   // Peak hold value (0.0 - 1.0, cleared after read)
  waveformPeakRight: number;  // Peak hold value (0.0 - 1.0, cleared after read)
  // Input waveform data (pre-FX)
  waveformInputLeft: number[];
  waveformInputRight: number[];
  waveformInputPeakLeft: number;
  waveformInputPeakRight: number;
  clippingLeft: boolean;
  clippingRight: boolean;
  // Output stereo imaging data (post-FX)
  stereoPositions: [number, number][];  // [angle, radius] pairs for particle display
  stereoCorrelation: number;            // -1 to +1 correlation coefficient
  // Input stereo imaging data (pre-FX)
  stereoPositionsInput: [number, number][];
  stereoCorrelationInput: number;
}

interface PreviewState {
  // Panel visibility
  isOpen: boolean;

  // Playback state
  isPlaying: boolean;
  isLooping: boolean;

  // Master volume (0.0 - 1.0)
  masterVolume: number;

  // Plugin info
  pluginType: 'effect' | 'instrument' | null;
  projectName: string | null;

  // Loaded plugin state
  loadedPlugin: PluginState;

  // Input source
  inputSource: InputSource;

  // Live input state
  isLivePaused: boolean;
  availableInputDevices: AudioDevice[];

  // Build/reload state
  isAutoReload: boolean;
  lastReloadTime: number | null;

  // Output metering (levels, dB, spectrum)
  metering: OutputMetering;

  // Plugin parameters
  parameters: PluginParameter[];

  // Demo samples list
  demoSamples: DemoSample[];

  // Plugin viewer state (shared between Header toggle and PreviewPanel)
  pluginAvailable: boolean;
  currentPluginVersion: number;
  webviewNeedsFreshBuild: boolean;
  pluginLoading: boolean;
  engineInitialized: boolean;
  editorOpen: boolean;

  // Pending build version (set when Claude creates a new version, cleared on build success)
  // Includes projectPath to ensure we only show glow for the correct project
  pendingBuildVersion: { projectPath: string; version: number } | null;

  // Actions
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setLooping: (looping: boolean) => void;
  setMasterVolume: (volume: number) => void;
  setPluginType: (type: 'effect' | 'instrument' | null) => void;
  setProjectName: (name: string | null) => void;
  setLoadedPlugin: (state: PluginState) => void;
  setInputSource: (source: InputSource) => void;
  setSignalFrequency: (freq: number) => void;
  setLivePaused: (paused: boolean) => void;
  setAvailableInputDevices: (devices: AudioDevice[]) => void;
  setAutoReload: (enabled: boolean) => void;
  setLastReloadTime: (time: number | null) => void;
  setMetering: (metering: OutputMetering) => void;
  setParameters: (params: PluginParameter[]) => void;
  updateParameter: (id: string, value: number) => void;
  setDemoSamples: (samples: DemoSample[]) => void;
  setPluginAvailable: (available: boolean) => void;
  setCurrentPluginVersion: (version: number) => void;
  setWebviewNeedsFreshBuild: (needs: boolean) => void;
  setPluginLoading: (loading: boolean) => void;
  setEngineInitialized: (initialized: boolean) => void;
  setEditorOpen: (open: boolean) => void;
  setPendingBuildVersion: (pending: { projectPath: string; version: number } | null) => void;
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
  liveChunkSize: 128, // Default to low latency (128 samples)
};

const defaultMetering: OutputMetering = {
  left: 0,
  right: 0,
  leftDb: -60,
  rightDb: -60,
  inputLeft: 0,
  inputRight: 0,
  inputLeftDb: -60,
  inputRightDb: -60,
  spectrum: new Array(32).fill(0),
  spectrumInput: new Array(32).fill(0),  // Pre-FX input spectrum
  // Output waveform (post-FX)
  waveformLeft: new Array(4096).fill(0),
  waveformRight: new Array(4096).fill(0),
  waveformPeakLeft: 0,
  waveformPeakRight: 0,
  // Input waveform (pre-FX)
  waveformInputLeft: new Array(4096).fill(0),
  waveformInputRight: new Array(4096).fill(0),
  waveformInputPeakLeft: 0,
  waveformInputPeakRight: 0,
  clippingLeft: false,
  clippingRight: false,
  // Output stereo (post-FX)
  stereoPositions: [],  // Empty initially, will be populated by metering events
  stereoCorrelation: 1.0,  // Start at mono
  // Input stereo (pre-FX)
  stereoPositionsInput: [],
  stereoCorrelationInput: 1.0,
};

const initialState = {
  isOpen: false,
  isPlaying: false,
  isLooping: true,
  masterVolume: 0.75, // Default 75% volume
  pluginType: null as 'effect' | 'instrument' | null,
  projectName: null as string | null,
  loadedPlugin: { status: 'unloaded' } as PluginState,
  inputSource: defaultInputSource,
  isLivePaused: false,
  availableInputDevices: [] as AudioDevice[],
  isAutoReload: true,
  lastReloadTime: null as number | null,
  metering: defaultMetering,
  parameters: [] as PluginParameter[],
  demoSamples: [] as DemoSample[],
  pluginAvailable: false,
  currentPluginVersion: 0,  // 0 = no plugin loaded yet, allows first Claude version to trigger glow
  webviewNeedsFreshBuild: false,
  pluginLoading: false,
  engineInitialized: false,
  editorOpen: false,
  pendingBuildVersion: null,
};

export const usePreviewStore = create<PreviewState>()((set) => ({
  ...initialState,

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  setPlaying: (playing) => set({ isPlaying: playing }),
  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setLooping: (looping) => set({ isLooping: looping }),

  setMasterVolume: (volume) => set({ masterVolume: volume }),

  setPluginType: (type) => set({ pluginType: type }),
  setProjectName: (name) => set({ projectName: name }),
  setLoadedPlugin: (state) => set({ loadedPlugin: state }),

  setInputSource: (source) => set({ inputSource: source }),
  setSignalFrequency: (freq) =>
    set((state) => ({
      inputSource: { ...state.inputSource, signalFrequency: freq },
    })),

  setLivePaused: (paused) => set({ isLivePaused: paused }),
  setAvailableInputDevices: (devices) => set({ availableInputDevices: devices }),

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

  setPluginAvailable: (available) => set({ pluginAvailable: available }),
  setCurrentPluginVersion: (version) => set({ currentPluginVersion: version }),
  setWebviewNeedsFreshBuild: (needs) => set({ webviewNeedsFreshBuild: needs }),
  setPluginLoading: (loading) => set({ pluginLoading: loading }),
  setEngineInitialized: (initialized) => set({ engineInitialized: initialized }),
  setEditorOpen: (open) => set({ editorOpen: open }),
  setPendingBuildVersion: (pending) => set({ pendingBuildVersion: pending }),

  reset: () => set(initialState),
}));
