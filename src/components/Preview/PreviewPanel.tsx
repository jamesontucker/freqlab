import { useState, useEffect, useCallback, useRef } from 'react';
import { usePreviewStore, type SignalType, type GatePattern } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import * as previewApi from '../../api/preview';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface BuildStreamEvent {
  type: 'start' | 'output' | 'error' | 'done';
  line?: string;
  message?: string;
  success?: boolean;
  output_path?: string;
}

const SIGNAL_OPTIONS: { value: SignalType; label: string }[] = [
  { value: 'sine', label: 'Sine Wave' },
  { value: 'white_noise', label: 'White Noise' },
  { value: 'pink_noise', label: 'Pink Noise' },
  { value: 'impulse', label: 'Impulse' },
  { value: 'sweep', label: 'Frequency Sweep' },
  { value: 'square', label: 'Square Wave' },
];

const GATE_OPTIONS: { value: GatePattern; label: string; rateLabel: string }[] = [
  { value: 'continuous', label: 'Continuous', rateLabel: '' },
  { value: 'pulse', label: 'Pulse', rateLabel: 'Rate (Hz)' },
  { value: 'quarter', label: '1/4 Notes', rateLabel: 'Tempo (BPM)' },
  { value: 'eighth', label: '1/8 Notes', rateLabel: 'Tempo (BPM)' },
  { value: 'sixteenth', label: '1/16 Notes', rateLabel: 'Tempo (BPM)' },
];

// Common frequency notches for the slider (logarithmic scale)
const FREQ_NOTCHES = [
  { value: 20, label: '20' },
  { value: 100, label: '100' },
  { value: 440, label: '440' },
  { value: 1000, label: '1k' },
  { value: 5000, label: '5k' },
  { value: 10000, label: '10k' },
  { value: 20000, label: '20k' },
];

// Musical notes
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVES = [2, 3, 4, 5, 6];

// Convert MIDI note number to frequency (A4 = 69 = 440Hz)
function midiToFreq(midiNote: number): number {
  return Math.round(440 * Math.pow(2, (midiNote - 69) / 12));
}

// Convert note name and octave to MIDI note number
function noteToMidi(note: string, octave: number): number {
  const noteIndex = NOTE_NAMES.indexOf(note);
  return (octave + 1) * 12 + noteIndex;
}

// Get closest note name and octave from frequency
function freqToNote(freq: number): { note: string; octave: number } | null {
  if (freq < 20 || freq > 20000) return null;
  const midiNote = 69 + 12 * Math.log2(freq / 440);
  const roundedMidi = Math.round(midiNote);
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteIndex = roundedMidi % 12;
  return { note: NOTE_NAMES[noteIndex], octave };
}

// Convert linear slider value (0-1) to frequency (20-20000 Hz, logarithmic)
function sliderToFreq(value: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const freq = Math.pow(10, minLog + value * (maxLog - minLog));
  return Math.round(freq);
}

// Convert frequency to linear slider value (0-1)
function freqToSlider(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return (Math.log10(freq) - minLog) / (maxLog - minLog);
}

// Frequency Selector Component
interface FrequencySelectorProps {
  frequency: number;
  onChange: (freq: number) => void;
}

function FrequencySelector({ frequency, onChange }: FrequencySelectorProps) {
  const [mode, setMode] = useState<'slider' | 'note'>('slider');
  const [selectedOctave, setSelectedOctave] = useState(4);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);

  const currentNote = freqToNote(frequency);

  const handleNoteClick = (note: string) => {
    setSelectedNote(note);
    const freq = midiToFreq(noteToMidi(note, selectedOctave));
    onChange(freq);
  };

  const handleOctaveChange = (octave: number) => {
    setSelectedOctave(octave);
    // If a note is selected, update frequency with new octave
    if (selectedNote) {
      const freq = midiToFreq(noteToMidi(selectedNote, octave));
      onChange(freq);
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-0.5 bg-bg-primary rounded-md">
          <button
            onClick={() => setMode('slider')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              mode === 'slider'
                ? 'bg-bg-tertiary text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Frequency
          </button>
          <button
            onClick={() => setMode('note')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              mode === 'note'
                ? 'bg-bg-tertiary text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Note
          </button>
        </div>
        <span className="text-sm font-medium text-accent">
          {frequency} Hz
          {currentNote && (
            <span className="text-text-muted ml-1">
              ({currentNote.note}{currentNote.octave})
            </span>
          )}
        </span>
      </div>

      {mode === 'slider' ? (
        <>
          {/* Frequency Slider */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={freqToSlider(frequency)}
            onChange={(e) => onChange(sliderToFreq(Number(e.target.value)))}
            className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
          />
          <div className="flex justify-between px-0.5">
            {FREQ_NOTCHES.map((notch) => (
              <button
                key={notch.value}
                onClick={() => onChange(notch.value)}
                className={`text-[10px] transition-colors ${
                  Math.abs(frequency - notch.value) < notch.value * 0.1
                    ? 'text-accent font-medium'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {notch.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Octave Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Octave:</span>
            <div className="flex gap-1">
              {OCTAVES.map((oct) => (
                <button
                  key={oct}
                  onClick={() => handleOctaveChange(oct)}
                  className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                    selectedOctave === oct
                      ? 'bg-accent text-white'
                      : 'bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  {oct}
                </button>
              ))}
            </div>
          </div>

          {/* Note Grid */}
          <div className="grid grid-cols-6 gap-1">
            {NOTE_NAMES.map((note) => {
              const isSharp = note.includes('#');
              const isSelected = selectedNote === note;
              return (
                <button
                  key={note}
                  onClick={() => handleNoteClick(note)}
                  className={`py-2 rounded text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-accent text-white'
                      : isSharp
                        ? 'bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                        : 'bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                  }`}
                >
                  {note}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// No hardcoded samples - we use only what the backend provides or custom files

export function PreviewPanel() {
  const {
    isOpen,
    setOpen,
    isPlaying,
    setPlaying,
    isLooping,
    setLooping,
    inputSource,
    setInputSource,
    setSignalFrequency,
    buildStatus,
    setBuildStatus,
    metering,
    setMetering,
    demoSamples,
    setDemoSamples,
    loadedPlugin,
    setLoadedPlugin,
  } = usePreviewStore();

  const { activeProject } = useProjectStore();
  const { audioSettings, markAudioSettingsApplied } = useSettingsStore();
  const [engineInitialized, setEngineInitialized] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginAvailable, setPluginAvailable] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(1);
  // WebView projects need a fresh build after switching due to wry class name conflicts
  const [webviewNeedsFreshBuild, setWebviewNeedsFreshBuild] = useState(false);
  // Spectrum analyzer toggle
  const [showSpectrum, setShowSpectrum] = useState(false);
  // Waveform display toggle
  const [showWaveform, setShowWaveform] = useState(false);
  // Debounced dB values for smoother display (text only)
  const [displayDb, setDisplayDb] = useState({ left: -60, right: -60 });
  const dbUpdateRef = useRef<{ left: number; right: number }>({ left: -60, right: -60 });
  // Animated spectrum, waveform, and levels for buttery smooth 60fps rendering
  const animatedSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const animatedWaveformRef = useRef<number[]>(new Array(256).fill(0));
  const animatedLevelsRef = useRef({ left: 0, right: 0 });
  const [animatedSpectrum, setAnimatedSpectrum] = useState<number[]>(new Array(32).fill(0));
  const [animatedWaveform, setAnimatedWaveform] = useState<number[]>(new Array(256).fill(0));
  const [animatedLevels, setAnimatedLevels] = useState({ left: 0, right: 0 });
  const rafIdRef = useRef<number | null>(null);
  // Clipping indicator with hold (stays lit for 1 second after clip)
  const [clipHold, setClipHold] = useState({ left: false, right: false });
  const clipTimeoutRef = useRef<{ left: NodeJS.Timeout | null; right: NodeJS.Timeout | null }>({ left: null, right: null });
  // Collapsible section state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    input: false,
    transport: false,
    output: false,  // Open by default (contains spectrum analyzer)
    plugin: false,
    build: true,    // Collapsed by default
  });
  const levelListenerRef = useRef<(() => void) | null>(null);
  const pluginListenersRef = useRef<(() => void)[]>([]);
  // Refs to avoid stale closure issues in project-switching cleanup
  const isPlayingRef = useRef(isPlaying);
  const engineInitializedRef = useRef(engineInitialized);
  const loadedPluginRef = useRef(loadedPlugin);

  // Keep refs in sync
  isPlayingRef.current = isPlaying;
  engineInitializedRef.current = engineInitialized;
  loadedPluginRef.current = loadedPlugin;

  // Keep metering ref in sync for debounce access
  const meteringRef = useRef(metering);
  meteringRef.current = metering;

  // Debounce dB display updates - only update when change is significant or periodically
  // Only runs when panel is open to save CPU
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      const newLeft = meteringRef.current.leftDb;
      const newRight = meteringRef.current.rightDb;
      const currentLeft = dbUpdateRef.current.left;
      const currentRight = dbUpdateRef.current.right;

      // Only update if change is > 1dB or if dropping significantly
      const leftDiff = Math.abs(newLeft - currentLeft);
      const rightDiff = Math.abs(newRight - currentRight);

      if (leftDiff > 1 || rightDiff > 1 || newLeft < currentLeft - 3 || newRight < currentRight - 3) {
        dbUpdateRef.current = { left: newLeft, right: newRight };
        setDisplayDb({ left: newLeft, right: newRight });
      }
    }, 100); // Update at most 10 times per second

    return () => clearInterval(interval);
  }, [isOpen]); // Only run when panel is open

  // Smooth animation loop for spectrum and levels (requestAnimationFrame @ 60fps)
  // Only runs when panel is open to save CPU
  useEffect(() => {
    if (!isOpen) return;

    const smoothingFactor = 0.25; // Lower = smoother but more laggy, higher = snappier

    const animate = () => {
      const targetSpectrum = meteringRef.current.spectrum;
      const targetLeft = meteringRef.current.left;
      const targetRight = meteringRef.current.right;

      // Interpolate spectrum bands (handle array length mismatch)
      const currentSpectrum = animatedSpectrumRef.current;
      const numBands = Math.min(currentSpectrum.length, targetSpectrum?.length || 0);
      let spectrumChanged = false;
      for (let i = 0; i < numBands; i++) {
        const target = targetSpectrum[i] || 0;
        const current = currentSpectrum[i];
        const diff = target - current;
        if (Math.abs(diff) > 0.0001) {
          currentSpectrum[i] = current + diff * smoothingFactor;
          spectrumChanged = true;
        }
      }

      // Interpolate waveform (use faster smoothing for time-domain to capture transients)
      const targetWaveform = meteringRef.current.waveform;
      const currentWaveform = animatedWaveformRef.current;
      const numSamples = Math.min(currentWaveform.length, targetWaveform?.length || 0);
      const waveformSmoothing = 0.5; // Faster response for time-domain
      let waveformChanged = false;
      for (let i = 0; i < numSamples; i++) {
        const target = targetWaveform[i] || 0;
        const current = currentWaveform[i];
        const diff = target - current;
        if (Math.abs(diff) > 0.0001) {
          currentWaveform[i] = current + diff * waveformSmoothing;
          waveformChanged = true;
        }
      }

      // Interpolate levels
      const currentLevels = animatedLevelsRef.current;
      const leftDiff = (targetLeft || 0) - currentLevels.left;
      const rightDiff = (targetRight || 0) - currentLevels.right;
      let levelsChanged = false;
      if (Math.abs(leftDiff) > 0.0001 || Math.abs(rightDiff) > 0.0001) {
        currentLevels.left += leftDiff * smoothingFactor;
        currentLevels.right += rightDiff * smoothingFactor;
        levelsChanged = true;
      }

      // Only trigger re-render if values changed
      if (spectrumChanged) {
        setAnimatedSpectrum([...currentSpectrum]);
      }
      if (waveformChanged) {
        setAnimatedWaveform([...currentWaveform]);
      }
      if (levelsChanged) {
        setAnimatedLevels({ ...currentLevels });
      }

      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isOpen]);

  // Handle clipping indicator with hold time (stays lit for 1 second after clip)
  // Separate effects for left/right to avoid clearing the other channel's timeout
  useEffect(() => {
    if (metering.clippingLeft) {
      setClipHold(prev => ({ ...prev, left: true }));
      if (clipTimeoutRef.current.left) clearTimeout(clipTimeoutRef.current.left);
      clipTimeoutRef.current.left = setTimeout(() => {
        setClipHold(prev => ({ ...prev, left: false }));
        clipTimeoutRef.current.left = null;
      }, 1000);
    }
    return () => {
      if (clipTimeoutRef.current.left) {
        clearTimeout(clipTimeoutRef.current.left);
        clipTimeoutRef.current.left = null;
      }
    };
  }, [metering.clippingLeft]);

  useEffect(() => {
    if (metering.clippingRight) {
      setClipHold(prev => ({ ...prev, right: true }));
      if (clipTimeoutRef.current.right) clearTimeout(clipTimeoutRef.current.right);
      clipTimeoutRef.current.right = setTimeout(() => {
        setClipHold(prev => ({ ...prev, right: false }));
        clipTimeoutRef.current.right = null;
      }, 1000);
    }
    return () => {
      if (clipTimeoutRef.current.right) {
        clearTimeout(clipTimeoutRef.current.right);
        clipTimeoutRef.current.right = null;
      }
    };
  }, [metering.clippingRight]);

  // Initialize audio engine when panel opens
  useEffect(() => {
    if (!isOpen) return;

    // Cancellation flag to prevent race conditions when effect cleanup runs
    // while async initialization is still in progress
    let isCancelled = false;

    const initEngine = async () => {
      try {
        // Initialize with saved audio settings
        await previewApi.initAudioEngine(
          audioSettings.outputDevice,
          audioSettings.sampleRate,
          audioSettings.bufferSize
        );

        // Check cancellation after each async operation
        if (isCancelled) return;

        setEngineInitialized(true);
        setEngineError(null);
        // Mark current audio settings as "applied" (engine is using them)
        markAudioSettingsApplied();

        // Start level meter updates (includes spectrum data)
        await previewApi.startLevelMeter();
        if (isCancelled) return;

        // Listen for combined metering data (levels + dB + spectrum + waveform + clipping)
        const unlisten = await previewApi.onMeteringUpdate((data) => {
          setMetering({
            left: data.left,
            right: data.right,
            leftDb: data.left_db,
            rightDb: data.right_db,
            spectrum: data.spectrum,
            waveform: data.waveform,
            clippingLeft: data.clipping_left,
            clippingRight: data.clipping_right,
          });
        });
        if (isCancelled) {
          // Clean up immediately if cancelled
          unlisten();
          return;
        }
        levelListenerRef.current = unlisten;

        // Load demo samples
        const samples = await previewApi.getDemoSamples();
        if (isCancelled) return;
        setDemoSamples(samples);

        // Get initial plugin state
        const pluginState = await previewApi.pluginGetState();
        if (isCancelled) return;
        setLoadedPlugin(pluginState);

        // Set up plugin event listeners
        const listeners: (() => void)[] = [];

        const loadingListener = await previewApi.onPluginLoading(() => {
          setPluginLoading(true);
        });
        if (isCancelled) {
          loadingListener();
          return;
        }
        listeners.push(loadingListener);

        const loadedListener = await previewApi.onPluginLoaded((state) => {
          setLoadedPlugin(state);
          setPluginLoading(false);
        });
        if (isCancelled) {
          listeners.forEach(l => l());
          loadedListener();
          return;
        }
        listeners.push(loadedListener);

        const errorListener = await previewApi.onPluginError((error) => {
          setLoadedPlugin({ status: 'error', message: error });
          setPluginLoading(false);
        });
        if (isCancelled) {
          listeners.forEach(l => l());
          errorListener();
          return;
        }
        listeners.push(errorListener);

        const unloadedListener = await previewApi.onPluginUnloaded(() => {
          setLoadedPlugin({ status: 'unloaded' });
          setPluginLoading(false);
        });
        if (isCancelled) {
          listeners.forEach(l => l());
          unloadedListener();
          return;
        }
        listeners.push(unloadedListener);

        pluginListenersRef.current = listeners;
      } catch (err) {
        if (isCancelled) return;
        console.error('Failed to initialize audio engine:', err);
        setEngineError(err instanceof Error ? err.message : String(err));
      }
    };

    initEngine();

    return () => {
      // Mark as cancelled to prevent stale async operations from updating state
      isCancelled = true;

      // Stop level meter thread first
      previewApi.stopLevelMeter().catch(err => {
        console.error('Failed to stop level meter:', err);
      });
      // Clean up level listener
      if (levelListenerRef.current) {
        levelListenerRef.current();
        levelListenerRef.current = null;
      }
      // Clean up plugin listeners
      pluginListenersRef.current.forEach(unlisten => unlisten());
      pluginListenersRef.current = [];
    };
  }, [isOpen, setDemoSamples, setLoadedPlugin]);

  // Check if plugin is available when project changes
  useEffect(() => {
    if (!activeProject || !isOpen) {
      setPluginAvailable(false);
      return;
    }

    const checkPluginAvailability = async () => {
      try {
        // Get current version for this project
        const version = await invoke<number>('get_current_version', {
          projectPath: activeProject.path,
        });
        setCurrentVersion(version);

        // Check if a .clap plugin exists for this version
        const pluginPath = await previewApi.getProjectPluginPath(activeProject.name, version);
        setPluginAvailable(!!pluginPath);
      } catch (err) {
        console.error('Failed to check plugin availability:', err);
        setPluginAvailable(false);
      }
    };

    checkPluginAvailability();
  }, [activeProject, isOpen]);

  // Plugin idle loop: Call pluginIdle() periodically when plugin is active
  // This ensures GUI parameter changes are processed even without audio playing
  useEffect(() => {
    if (!isOpen || !engineInitialized || loadedPlugin.status !== 'active') return;

    const intervalId = setInterval(async () => {
      try {
        await previewApi.pluginIdle();
      } catch (err) {
        // Silently ignore errors - plugin may have been unloaded
      }
    }, 16); // ~60fps

    return () => {
      clearInterval(intervalId);
    };
  }, [isOpen, engineInitialized, loadedPlugin.status]);

  // Hot reload: Listen for build completion and reload plugin (always enabled)
  useEffect(() => {
    if (!isOpen || !activeProject) return;

    const handleBuildComplete = async (event: { payload: BuildStreamEvent }) => {
      const data = event.payload;

      // Only act on successful build completions
      if (data.type !== 'done' || !data.success) return;

      // Check if we have a plugin loaded for this project
      if (loadedPlugin.status !== 'active') return;

      console.log('Build completed, triggering hot reload...');

      // Check if editor was open before reload (so we can re-open it)
      let editorWasOpen = false;
      try {
        editorWasOpen = await previewApi.pluginIsEditorOpen();
      } catch {
        // Ignore error
      }

      // Get the current version
      try {
        const version = await invoke<number>('get_current_version', {
          projectPath: activeProject.path,
        });

        // Check if plugin file exists
        const pluginPath = await previewApi.getProjectPluginPath(activeProject.name, version);
        if (!pluginPath) {
          console.log('No plugin found after build, skipping reload');
          return;
        }

        // Update plugin availability
        setPluginAvailable(true);
        setCurrentVersion(version);

        // Trigger hot reload
        console.log('Hot reloading plugin...');
        setLoadedPlugin({ status: 'reloading', path: pluginPath });
        await previewApi.pluginReload(activeProject.name, version);

        // Re-open editor if it was open before
        if (editorWasOpen) {
          // Small delay to ensure plugin is fully loaded
          setTimeout(async () => {
            try {
              // Verify plugin is still active before opening editor
              const state = await previewApi.pluginGetState();
              if (state.status === 'active') {
                const hasEditor = await previewApi.pluginHasEditor();
                if (hasEditor) {
                  await previewApi.pluginOpenEditor();
                  console.log('Re-opened editor after hot reload');
                }
              }
            } catch (err) {
              console.error('Failed to re-open editor after hot reload:', err);
            }
          }, 200);
        }
      } catch (err) {
        console.error('Hot reload failed:', err);
      }
    };

    const setupListener = async () => {
      const unlisten = await listen<BuildStreamEvent>('build-stream', handleBuildComplete);
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(unlisten => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, [isOpen, activeProject, loadedPlugin.status, setLoadedPlugin]);

  // Listen for build completion to update plugin availability (for first build case)
  // This is separate from hot reload - it just updates the "plugin available" state
  useEffect(() => {
    if (!isOpen || !activeProject) return;

    const handleBuildComplete = async (event: { payload: BuildStreamEvent }) => {
      const data = event.payload;
      console.log('[PreviewPanel] build-stream event received:', data.type, data.success);

      // Only act on successful build completions
      if (data.type !== 'done' || !data.success) return;

      console.log('[PreviewPanel] Build completed successfully, checking plugin availability...');
      console.log('[PreviewPanel] activeProject:', activeProject?.name, activeProject?.path);

      // Check if plugin is now available
      try {
        const version = await invoke<number>('get_current_version', {
          projectPath: activeProject.path,
        });
        console.log('[PreviewPanel] Got version:', version);

        const pluginPath = await previewApi.getProjectPluginPath(activeProject.name, version);
        console.log('[PreviewPanel] Plugin path result:', pluginPath);

        if (pluginPath) {
          console.log('[PreviewPanel] Setting pluginAvailable=true, currentVersion=', version);
          setPluginAvailable(true);
          setCurrentVersion(version);
          // Build succeeded - update status to ready
          setBuildStatus('ready');
          // Clear the WebView fresh build requirement since we just built
          setWebviewNeedsFreshBuild(false);
        } else {
          console.log('[PreviewPanel] No plugin found at path, pluginAvailable stays false');
        }
      } catch (err) {
        console.error('[PreviewPanel] Failed to check plugin availability after build:', err);
      }
    };

    const setupListener = async () => {
      const unlisten = await listen<BuildStreamEvent>('build-stream', handleBuildComplete);
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(unlisten => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, [isOpen, activeProject]);

  // Close plugin and stop playback when switching projects
  // Uses refs to get current values instead of stale closure values
  // The cleanup runs BEFORE the new project is loaded (return function runs on dependency change)
  useEffect(() => {
    // No setup needed on mount, just return the cleanup function
    return () => {
      // This cleanup runs when activeProject?.name changes (before the new project loads)
      // Using refs ensures we get the current values, not stale closure values
      const cleanupAsync = async () => {
        // Stop playback (using refs for current state)
        if (isPlayingRef.current && engineInitializedRef.current) {
          try {
            await previewApi.previewStop();
            setPlaying(false);
          } catch (err) {
            console.error('Failed to stop playback on project switch:', err);
          }
        }

        // Close editor and unload plugin when switching projects
        if (loadedPluginRef.current.status === 'active' && engineInitializedRef.current) {
          try {
            await previewApi.pluginCloseEditor();
            await previewApi.pluginUnload();
          } catch (err) {
            console.error('Failed to close plugin on project switch:', err);
          }
        }
      };

      // Fire and forget the async cleanup
      // Note: This is intentionally not awaited since React cleanup is synchronous
      cleanupAsync();
    };
  }, [activeProject?.name, setPlaying]);

  // Track when WebView projects need a fresh build (due to wry class name conflicts)
  // When switching to a WebView project, require a fresh build before opening editor
  useEffect(() => {
    if (activeProject?.uiFramework === 'webview') {
      // WebView projects need a fresh build after switching to ensure unique class names
      setWebviewNeedsFreshBuild(true);
    } else {
      setWebviewNeedsFreshBuild(false);
    }
  }, [activeProject?.name, activeProject?.uiFramework]);

  // Handle play/stop
  const handleTogglePlaying = useCallback(async () => {
    if (!engineInitialized) return;

    try {
      if (isPlaying) {
        await previewApi.previewStop();
        setPlaying(false);
      } else {
        // Set up the input source before playing
        if (inputSource.type === 'signal' && inputSource.signalType) {
          await previewApi.previewSetSignal(
            inputSource.signalType,
            inputSource.signalFrequency || 440,
            0.5,
            inputSource.gatePattern || 'continuous',
            inputSource.gateRate || 2.0,
            inputSource.gateDuty || 0.5
          );
        } else if (inputSource.type === 'sample') {
          // Custom file takes precedence
          if (inputSource.customPath) {
            console.log('Loading custom sample:', inputSource.customPath);
            await previewApi.previewLoadSample(inputSource.customPath);
          } else if (inputSource.sampleId) {
            // Find demo sample path
            const sample = demoSamples.find(s => s.id === inputSource.sampleId);
            if (sample) {
              console.log('Loading demo sample:', sample.path);
              await previewApi.previewLoadSample(sample.path);
            }
          }
        }
        await previewApi.previewPlay();
        setPlaying(true);
      }
    } catch (err) {
      console.error('Playback error:', err);
    }
  }, [engineInitialized, isPlaying, setPlaying, inputSource, demoSamples]);

  // Handle looping change
  const handleLoopingChange = useCallback(async (looping: boolean) => {
    setLooping(looping);
    if (engineInitialized) {
      try {
        await previewApi.previewSetLooping(looping);
      } catch (err) {
        console.error('Failed to set looping:', err);
      }
    }
  }, [setLooping, engineInitialized]);

  // Update signal when frequency changes (while playing)
  const handleFrequencyChange = useCallback(async (freq: number) => {
    setSignalFrequency(freq);
    if (engineInitialized && isPlaying && inputSource.type === 'signal') {
      try {
        await previewApi.previewSetFrequency(freq);
      } catch (err) {
        console.error('Failed to set frequency:', err);
      }
    }
  }, [setSignalFrequency, engineInitialized, isPlaying, inputSource.type]);

  // Switch input source type (samples <-> signals) - stops playback and clears demo sample selection
  // Custom sample path is preserved across switches
  const handleInputTypeChange = useCallback(async (type: 'sample' | 'signal') => {
    // Stop playback when switching modes
    if (isPlaying && engineInitialized) {
      try {
        await previewApi.previewStop();
        setPlaying(false);
      } catch (err) {
        console.error('Failed to stop playback:', err);
      }
    }

    // Clear demo sample selection but preserve custom path
    // Custom path persists so user can switch back to their loaded file
    setInputSource({ ...inputSource, type, sampleId: undefined });
  }, [isPlaying, engineInitialized, setPlaying, inputSource, setInputSource]);

  // Change signal type - updates immediately if playing
  const handleSignalTypeChange = useCallback(async (signalType: SignalType) => {
    setInputSource({ ...inputSource, signalType });

    // If playing, update the signal immediately
    if (isPlaying && engineInitialized) {
      try {
        await previewApi.previewSetSignal(
          signalType,
          inputSource.signalFrequency || 440,
          0.5,
          inputSource.gatePattern || 'continuous',
          inputSource.gateRate || 2.0,
          inputSource.gateDuty || 0.5
        );
      } catch (err) {
        console.error('Failed to change signal type:', err);
      }
    }
  }, [inputSource, setInputSource, isPlaying, engineInitialized]);

  // Change gate pattern - updates immediately if playing
  const handleGateChange = useCallback(async (
    pattern: GatePattern,
    rate?: number,
    duty?: number
  ) => {
    // Use appropriate default rate based on pattern type
    const defaultRate = pattern === 'pulse' ? 2.0 : 120; // Hz for pulse, BPM for musical
    const newRate = rate ?? (pattern !== inputSource.gatePattern ? defaultRate : inputSource.gateRate);

    setInputSource({
      ...inputSource,
      gatePattern: pattern,
      gateRate: newRate,
      gateDuty: duty ?? inputSource.gateDuty,
    });

    // If playing, update the gate immediately
    if (isPlaying && engineInitialized && inputSource.type === 'signal') {
      try {
        await previewApi.previewSetGate(pattern, newRate, duty ?? inputSource.gateDuty);
      } catch (err) {
        console.error('Failed to change gate pattern:', err);
      }
    }
  }, [inputSource, setInputSource, isPlaying, engineInitialized]);

  // Select a demo sample
  const handleSampleSelect = useCallback(async (sampleId: string) => {
    // Update selection
    setInputSource({ ...inputSource, sampleId, customPath: undefined });

    // If playing, load and start playing the new sample
    if (isPlaying && engineInitialized) {
      const sample = demoSamples.find(s => s.id === sampleId);
      if (sample) {
        try {
          await previewApi.previewLoadSample(sample.path);
        } catch (err) {
          console.error('Failed to load sample:', err);
        }
      }
    }
  }, [inputSource, setInputSource, isPlaying, engineInitialized, demoSamples]);

  // Load a custom audio file
  const handleLoadCustomFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio Files',
          extensions: ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a']
        }]
      });

      if (selected && typeof selected === 'string') {
        // Set the custom path (clear demo sample selection)
        setInputSource({ ...inputSource, customPath: selected, sampleId: undefined });

        // Load the sample into the engine
        if (engineInitialized) {
          try {
            await previewApi.previewLoadSample(selected);
            console.log('Loaded custom sample:', selected);
          } catch (err) {
            console.error('Failed to load sample into engine:', err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  }, [engineInitialized, inputSource, setInputSource]);

  // Open the plugin's editor window
  const handleOpenEditor = useCallback(async () => {
    if (!engineInitialized) return;

    try {
      await previewApi.pluginOpenEditor();
    } catch (err) {
      console.error('Failed to open plugin editor:', err);
    }
  }, [engineInitialized]);

  // Determine plugin type from active project
  const effectivePluginType = activeProject?.template === 'instrument' ? 'instrument' : 'effect';

  // Toggle section collapse
  const toggleSection = useCallback((section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  if (!isOpen) return null;

  // Helper to render section header
  const renderSectionHeader = (id: string, title: string, icon: React.ReactNode) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between py-2 text-sm font-medium text-text-primary hover:text-accent transition-colors group"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span>{title}</span>
      </div>
      <svg
        className={`w-4 h-4 text-text-muted group-hover:text-accent transition-transform duration-200 ${
          collapsedSections[id] ? '' : 'rotate-180'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );

  return (
    <div
      className={`fixed top-14 right-0 bottom-0 w-[480px] bg-bg-secondary border-l border-border shadow-2xl z-40 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            <h2 className="text-lg font-semibold text-text-primary">Preview</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* No Project Warning */}
          {!activeProject && (
            <div className="p-4 rounded-lg bg-warning-subtle border border-warning/20 text-warning text-sm">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Select a project to preview</span>
              </div>
            </div>
          )}

          {activeProject && (
            <>
              {/* Plugin Type Badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">Plugin Type:</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  effectivePluginType === 'instrument'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-blue-500/15 text-blue-400'
                }`}>
                  {effectivePluginType === 'instrument' ? 'Instrument' : 'Effect'}
                </span>
              </div>

              {/* Input Source Section */}
              <div className="border-b border-border pb-3">
                {renderSectionHeader('input', 'Input Source',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                )}
                {!collapsedSections.input && (
                <div className="space-y-3 pt-2">

                {effectivePluginType === 'effect' && (
                  <>
                    {/* Source Type Tabs */}
                    <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
                      <button
                        onClick={() => handleInputTypeChange('sample')}
                        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                          inputSource.type === 'sample'
                            ? 'bg-bg-primary text-text-primary shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Samples
                      </button>
                      <button
                        onClick={() => handleInputTypeChange('signal')}
                        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                          inputSource.type === 'signal'
                            ? 'bg-bg-primary text-text-primary shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Test Signals
                      </button>
                    </div>

                    {/* Sample Selection */}
                    {inputSource.type === 'sample' && (
                      <div className="space-y-3">
                        {/* Demo Samples */}
                        {demoSamples.length > 0 && (
                          <div className="grid grid-cols-2 gap-2">
                            {demoSamples.map((sample) => (
                              <button
                                key={sample.id}
                                onClick={() => handleSampleSelect(sample.id)}
                                className={`p-2 rounded-lg text-sm text-left transition-colors ${
                                  inputSource.sampleId === sample.id && !inputSource.customPath
                                    ? 'bg-accent/10 border border-accent/30 text-accent'
                                    : 'bg-bg-tertiary border border-transparent text-text-secondary hover:text-text-primary hover:border-border'
                                }`}
                              >
                                {sample.name}
                              </button>
                            ))}
                          </div>
                        )}

                        {demoSamples.length === 0 && !inputSource.customPath && (
                          <div className="p-3 rounded-lg bg-bg-tertiary border border-border text-center">
                            <p className="text-sm text-text-secondary">No demo samples found</p>
                            <p className="text-xs text-text-muted mt-1">Load a custom audio file below</p>
                          </div>
                        )}

                        {/* Custom File Loader */}
                        <div className={demoSamples.length > 0 ? "pt-2 border-t border-border" : ""}>
                          {inputSource.customPath ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 p-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm truncate">
                                {inputSource.customPath.split('/').pop()}
                              </div>
                              <button
                                onClick={handleLoadCustomFile}
                                className="p-2.5 rounded-lg bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
                                title="Replace audio file"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={handleLoadCustomFile}
                              className="w-full p-2.5 rounded-lg text-sm flex items-center justify-center gap-2 bg-bg-tertiary border border-dashed border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              Load Custom Audio File
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Signal Selection */}
                    {inputSource.type === 'signal' && (
                      <div className="space-y-4">
                        <select
                          value={inputSource.signalType || 'sine'}
                          onChange={(e) => handleSignalTypeChange(e.target.value as SignalType)}
                          className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent"
                        >
                          {SIGNAL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {(inputSource.signalType === 'sine' || inputSource.signalType === 'square' || inputSource.signalType === 'impulse') && (
                          <FrequencySelector
                            frequency={inputSource.signalFrequency || 440}
                            onChange={handleFrequencyChange}
                          />
                        )}

                        {/* Gate/Pulse Pattern Controls */}
                        <div className="space-y-3 pt-2 border-t border-border">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-text-secondary">Gate Pattern</span>
                          </div>

                          {/* Gate Pattern Selector */}
                          <div className="flex flex-wrap gap-1">
                            {GATE_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => handleGateChange(opt.value)}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                  (inputSource.gatePattern || 'continuous') === opt.value
                                    ? 'bg-accent text-white'
                                    : 'bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          {/* Rate and Duty Controls (only for non-continuous patterns) */}
                          {inputSource.gatePattern && inputSource.gatePattern !== 'continuous' && (
                            <div className="space-y-3">
                              {/* Rate Control */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-text-muted">
                                    {GATE_OPTIONS.find(o => o.value === inputSource.gatePattern)?.rateLabel || 'Rate'}
                                  </span>
                                  <span className="text-xs font-medium text-accent">
                                    {inputSource.gatePattern === 'pulse'
                                      ? `${(inputSource.gateRate || 2).toFixed(1)} Hz`
                                      : `${Math.round(inputSource.gateRate || 120)} BPM`}
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={inputSource.gatePattern === 'pulse' ? 0.1 : 40}
                                  max={inputSource.gatePattern === 'pulse' ? 20 : 240}
                                  step={inputSource.gatePattern === 'pulse' ? 0.1 : 1}
                                  value={inputSource.gateRate || (inputSource.gatePattern === 'pulse' ? 2 : 120)}
                                  onChange={(e) => handleGateChange(
                                    inputSource.gatePattern!,
                                    Number(e.target.value),
                                    inputSource.gateDuty
                                  )}
                                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
                                />
                              </div>

                              {/* Duty Cycle Control */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-text-muted">Duty Cycle</span>
                                  <span className="text-xs font-medium text-accent">
                                    {Math.round((inputSource.gateDuty || 0.5) * 100)}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={0.05}
                                  max={0.95}
                                  step={0.05}
                                  value={inputSource.gateDuty || 0.5}
                                  onChange={(e) => handleGateChange(
                                    inputSource.gatePattern!,
                                    inputSource.gateRate,
                                    Number(e.target.value)
                                  )}
                                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {effectivePluginType === 'instrument' && (
                  <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
                    <p className="text-sm text-text-secondary text-center">
                      Virtual keyboard coming soon...
                    </p>
                    <p className="text-xs text-text-muted text-center mt-1">
                      MIDI input for instrument plugins
                    </p>
                  </div>
                )}
                </div>
                )}
              </div>

              {/* Engine Error */}
              {engineError && (
                <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Audio engine error: {engineError}</span>
                  </div>
                </div>
              )}

              {/* Transport Controls - only for effects */}
              {effectivePluginType === 'effect' && (
                <div className="border-b border-border pb-3">
                  {renderSectionHeader('transport', 'Transport',
                    <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                  )}
                  {!collapsedSections.transport && (
                  <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleTogglePlaying}
                      disabled={!engineInitialized}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium transition-all duration-200 ${
                        !engineInitialized
                          ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                          : isPlaying
                            ? 'bg-error text-white hover:bg-error/90'
                            : 'bg-accent text-white hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25'
                      }`}
                    >
                      {isPlaying ? (
                        <>
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                          </svg>
                          Stop
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5.14v14l11-7-11-7z" />
                          </svg>
                          Play
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleLoopingChange(!isLooping)}
                      className={`p-2.5 rounded-xl border transition-colors ${
                        isLooping
                          ? 'bg-accent/10 border-accent/30 text-accent'
                          : 'bg-bg-tertiary border-border text-text-muted hover:text-text-primary hover:border-border-hover'
                      }`}
                      title={isLooping ? 'Looping enabled' : 'Looping disabled'}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                  </div>
                  )}
                </div>
              )}

              {/* Output Meter & Spectrum */}
              <div className="border-b border-border pb-3">
                {renderSectionHeader('output', 'Output',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                )}
                {!collapsedSections.output && (
                <div className="space-y-3 pt-2">
                  {/* Level meters with dB readings (using animated values for smooth 60fps) */}
                  <div className="space-y-2">
                    {(() => {
                      // Convert animated linear levels to dB for smooth bar rendering
                      const animLeftDb = animatedLevels.left > 0 ? Math.max(-60, 20 * Math.log10(animatedLevels.left)) : -60;
                      const animRightDb = animatedLevels.right > 0 ? Math.max(-60, 20 * Math.log10(animatedLevels.right)) : -60;
                      return (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-muted w-3 font-mono">L</span>
                            <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
                              <div
                                className={`h-full ${
                                  metering.leftDb > -6 ? 'bg-gradient-to-r from-accent to-yellow-500' :
                                  metering.leftDb > -3 ? 'bg-gradient-to-r from-yellow-500 to-orange-500' :
                                  metering.leftDb > -1 ? 'bg-gradient-to-r from-orange-500 to-red-500' :
                                  'bg-gradient-to-r from-accent to-accent-hover'
                                }`}
                                style={{ width: `${Math.max(0, (animLeftDb + 60) / 60 * 100)}%` }}
                              />
                              {/* dB notches */}
                              <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute left-[50%] w-px h-full bg-white/20" title="-30dB" />
                                <div className="absolute left-[70%] w-px h-full bg-white/20" title="-18dB" />
                                <div className="absolute left-[80%] w-px h-full bg-white/25" title="-12dB" />
                                <div className="absolute left-[90%] w-px h-full bg-yellow-400/40" title="-6dB" />
                                <div className="absolute left-[100%] w-px h-full bg-red-400/50" title="0dB" />
                              </div>
                            </div>
                            {clipHold.left ? (
                              <span className="text-[10px] text-red-500 w-14 text-right font-mono font-bold animate-pulse">
                                CLIP
                              </span>
                            ) : (
                              <span className="text-[10px] text-text-muted w-14 text-right font-mono tabular-nums">
                                {displayDb.left > -60 ? `${displayDb.left.toFixed(1)}` : '-∞'} dB
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-muted w-3 font-mono">R</span>
                            <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
                              <div
                                className={`h-full ${
                                  metering.rightDb > -6 ? 'bg-gradient-to-r from-accent to-yellow-500' :
                                  metering.rightDb > -3 ? 'bg-gradient-to-r from-yellow-500 to-orange-500' :
                                  metering.rightDb > -1 ? 'bg-gradient-to-r from-orange-500 to-red-500' :
                                  'bg-gradient-to-r from-accent to-accent-hover'
                                }`}
                                style={{ width: `${Math.max(0, (animRightDb + 60) / 60 * 100)}%` }}
                              />
                              {/* dB notches */}
                              <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute left-[50%] w-px h-full bg-white/20" title="-30dB" />
                                <div className="absolute left-[70%] w-px h-full bg-white/20" title="-18dB" />
                                <div className="absolute left-[80%] w-px h-full bg-white/25" title="-12dB" />
                                <div className="absolute left-[90%] w-px h-full bg-yellow-400/40" title="-6dB" />
                                <div className="absolute left-[100%] w-px h-full bg-red-400/50" title="0dB" />
                              </div>
                            </div>
                            {clipHold.right ? (
                              <span className="text-[10px] text-red-500 w-14 text-right font-mono font-bold animate-pulse">
                                CLIP
                              </span>
                            ) : (
                              <span className="text-[10px] text-text-muted w-14 text-right font-mono tabular-nums">
                                {displayDb.right > -60 ? `${displayDb.right.toFixed(1)}` : '-∞'} dB
                              </span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                    {/* dB scale labels */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="w-3"></span>
                      <div className="flex-1 flex justify-between text-[8px] text-text-muted/60 px-0.5">
                        <span>-60</span>
                        <span>-30</span>
                        <span>-18</span>
                        <span>-12</span>
                        <span>-6</span>
                        <span>0</span>
                      </div>
                      <span className="w-14"></span>
                    </div>
                  </div>

                  {/* Spectrum Analyzer */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-text-muted font-medium">Spectrum</span>
                      <button
                        onClick={() => setShowSpectrum(!showSpectrum)}
                        className={`text-xs px-2 py-0.5 rounded transition-colors ${
                          showSpectrum
                            ? 'bg-accent/20 text-accent'
                            : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {showSpectrum ? 'On' : 'Off'}
                      </button>
                    </div>
                    {showSpectrum && (
                    <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                      {/* Smooth curve spectrum like FabFilter Pro-Q */}
                      <svg
                        viewBox="0 0 400 100"
                        className="w-full h-28"
                        preserveAspectRatio="none"
                      >
                        {/* Grid lines */}
                        <defs>
                          {/* Using accent color #2DA86E directly since CSS vars don't work in SVG */}
                          <linearGradient id="spectrumGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.7" />
                            <stop offset="50%" stopColor="#2DA86E" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.05" />
                          </linearGradient>
                          <linearGradient id="spectrumStroke" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#36C07E" stopOpacity="1" />
                            <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.7" />
                          </linearGradient>
                        </defs>
                        {/* Horizontal grid lines for dB */}
                        <line x1="0" y1="16.67" x2="400" y2="16.67" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        <line x1="0" y1="50" x2="400" y2="50" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        <line x1="0" y1="83.33" x2="400" y2="83.33" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        {/* Vertical grid lines for frequencies */}
                        <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        <line x1="125" y1="0" x2="125" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        <line x1="225" y1="0" x2="225" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        <line x1="325" y1="0" x2="325" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />

                        {/* Spectrum curve - smooth bezier path */}
                        {(() => {
                          // Safety check for empty or too-small spectrum
                          if (!animatedSpectrum || animatedSpectrum.length < 2) {
                            return null;
                          }

                          const numBands = animatedSpectrum.length;
                          const width = 400;
                          const height = 100;

                          // Convert magnitudes to Y positions (using animated values for smooth 60fps)
                          const points = animatedSpectrum.map((mag, i) => {
                            // Handle edge cases: NaN, undefined, negative
                            const safeMag = (typeof mag === 'number' && !isNaN(mag) && mag > 0) ? mag : 0;
                            const db = safeMag > 0 ? 20 * Math.log10(safeMag) : -60;
                            const normalizedDb = Math.max(0, Math.min(1, (db + 60) / 60));
                            const x = (i / (numBands - 1)) * width;
                            const y = height - (normalizedDb * height);
                            return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? height : y };
                          });

                          // Create smooth bezier curve path
                          let pathD = `M ${points[0].x} ${points[0].y}`;

                          for (let i = 0; i < points.length - 1; i++) {
                            const p0 = points[Math.max(0, i - 1)];
                            const p1 = points[i];
                            const p2 = points[i + 1];
                            const p3 = points[Math.min(points.length - 1, i + 2)];

                            // Catmull-Rom to Bezier conversion
                            const tension = 0.3;
                            const cp1x = p1.x + (p2.x - p0.x) * tension;
                            const cp1y = p1.y + (p2.y - p0.y) * tension;
                            const cp2x = p2.x - (p3.x - p1.x) * tension;
                            const cp2y = p2.y - (p3.y - p1.y) * tension;

                            pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
                          }

                          // Create filled area path
                          const areaD = pathD + ` L ${width} ${height} L 0 ${height} Z`;

                          return (
                            <>
                              {/* Filled area under curve */}
                              <path
                                d={areaD}
                                fill="url(#spectrumGradient)"
                              />
                              {/* Curve line */}
                              <path
                                d={pathD}
                                fill="none"
                                stroke="url(#spectrumStroke)"
                                strokeWidth="1.5"
                              />
                            </>
                          );
                        })()}
                      </svg>
                      {/* Frequency labels */}
                      <div className="flex justify-between px-2 py-1 border-t border-border/50 bg-bg-primary/30">
                        <span className="text-[9px] text-text-muted">20Hz</span>
                        <span className="text-[9px] text-text-muted">100</span>
                        <span className="text-[9px] text-text-muted">1k</span>
                        <span className="text-[9px] text-text-muted">10k</span>
                        <span className="text-[9px] text-text-muted">20k</span>
                      </div>
                    </div>
                    )}
                  </div>

                  {/* Waveform Display (Time-Domain) */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-text-muted font-medium">Waveform</span>
                      <button
                        onClick={() => setShowWaveform(!showWaveform)}
                        className={`text-xs px-2 py-0.5 rounded transition-colors ${
                          showWaveform
                            ? 'bg-accent/20 text-accent'
                            : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {showWaveform ? 'On' : 'Off'}
                      </button>
                    </div>
                    {showWaveform && (
                    <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                      {/* Time-domain waveform display */}
                      <svg
                        viewBox="0 0 400 100"
                        className="w-full h-28"
                        preserveAspectRatio="none"
                      >
                        {/* Grid lines */}
                        <defs>
                          <linearGradient id="waveformGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.3" />
                            <stop offset="50%" stopColor="#2DA86E" stopOpacity="0.05" />
                            <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.3" />
                          </linearGradient>
                          <linearGradient id="waveformStroke" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.7" />
                            <stop offset="50%" stopColor="#36C07E" stopOpacity="1" />
                            <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.7" />
                          </linearGradient>
                        </defs>
                        {/* Center line (0 amplitude) */}
                        <line x1="0" y1="50" x2="400" y2="50" stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5" />
                        {/* Amplitude grid lines (+/-0.5) */}
                        <line x1="0" y1="25" x2="400" y2="25" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        <line x1="0" y1="75" x2="400" y2="75" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
                        {/* Clipping threshold lines */}
                        <line x1="0" y1="5" x2="400" y2="5" stroke="#ef4444" strokeOpacity="0.2" strokeWidth="0.5" />
                        <line x1="0" y1="95" x2="400" y2="95" stroke="#ef4444" strokeOpacity="0.2" strokeWidth="0.5" />

                        {/* Waveform path */}
                        {(() => {
                          if (!animatedWaveform || animatedWaveform.length < 2) {
                            return null;
                          }

                          const numSamples = animatedWaveform.length;
                          const width = 400;
                          const height = 100;

                          // Convert samples to Y positions (samples are -1 to 1, center is 0.5)
                          const points = animatedWaveform.map((sample, i) => {
                            const safeSample = (typeof sample === 'number' && !isNaN(sample)) ? sample : 0;
                            // Clamp to -1, 1 and convert to y position (center = 50)
                            const clampedSample = Math.max(-1, Math.min(1, safeSample));
                            const x = (i / (numSamples - 1)) * width;
                            const y = 50 - (clampedSample * 45); // 45 gives a bit of padding from edges
                            return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? 50 : y };
                          });

                          // Create polyline path (faster than bezier for waveform)
                          const pathD = `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')}`;

                          // Create filled area (from center line)
                          const areaD = `M 0 50 L ${points.map(p => `${p.x} ${p.y}`).join(' L ')} L ${width} 50 Z`;

                          return (
                            <>
                              {/* Filled area */}
                              <path
                                d={areaD}
                                fill="url(#waveformGradient)"
                              />
                              {/* Waveform line */}
                              <path
                                d={pathD}
                                fill="none"
                                stroke="url(#waveformStroke)"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                              />
                            </>
                          );
                        })()}
                      </svg>
                      {/* Amplitude labels */}
                      <div className="flex justify-between px-2 py-1 border-t border-border/50 bg-bg-primary/30">
                        <span className="text-[9px] text-text-muted">Time →</span>
                        <span className="text-[9px] text-text-muted">-1.0 to +1.0</span>
                      </div>
                    </div>
                    )}
                  </div>
                </div>
                )}
              </div>

              {/* Plugin Viewer */}
              <div className="border-b border-border pb-3">
                {renderSectionHeader('plugin', 'Plugin Viewer',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                )}
                {!collapsedSections.plugin && (
                <div className="space-y-3 pt-2">

                {/* No build available */}
                {!pluginAvailable && loadedPlugin.status === 'unloaded' && (
                  <div className="p-4 bg-bg-tertiary rounded-lg border border-border text-center">
                    <svg className="w-8 h-8 mx-auto text-text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <div className="text-sm text-text-secondary mb-1">No plugin built yet</div>
                    <div className="text-xs text-text-muted">Build your project first to preview it here</div>
                  </div>
                )}

                {/* Plugin available - show viewer toggle */}
                {(pluginAvailable || loadedPlugin.status !== 'unloaded') && (
                  <div className="p-3 bg-bg-tertiary rounded-lg border border-border space-y-3">
                    {/* WebView fresh build warning */}
                    {webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' && loadedPlugin.status === 'unloaded' && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                        <div className="flex items-start gap-2">
                          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div>
                            <div className="font-medium">Fresh build required</div>
                            <div className="text-amber-400/80 mt-1">
                              WebView plugins need a fresh build after switching projects to avoid class name conflicts with the host app. Build the project to enable the plugin viewer.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Viewer Toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-text-primary">Enable Plugin Viewer</div>
                        <div className="text-xs text-text-muted">
                          {loadedPlugin.status === 'unloaded'
                            ? `${activeProject?.name} v${currentVersion}`
                            : loadedPlugin.status === 'active'
                              ? loadedPlugin.name
                              : 'Loading...'}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          console.log('[PreviewPanel] Toggle clicked - status:', loadedPlugin.status, 'pluginAvailable:', pluginAvailable, 'currentVersion:', currentVersion);
                          if (loadedPlugin.status === 'active') {
                            // Disable - close editor and unload
                            try {
                              await previewApi.pluginCloseEditor();
                              await previewApi.pluginUnload();
                              // WebView plugins need a fresh build after unloading due to wry class name conflicts
                              if (activeProject?.uiFramework === 'webview') {
                                setWebviewNeedsFreshBuild(true);
                              }
                            } catch (err) {
                              console.error('Failed to disable plugin viewer:', err);
                            }
                          } else if (loadedPlugin.status === 'unloaded' && pluginAvailable && activeProject) {
                            // Enable - load plugin and open editor
                            console.log('[PreviewPanel] Loading plugin for project:', activeProject.name, 'v', currentVersion);
                            setPluginLoading(true);
                            try {
                              await previewApi.pluginLoadForProject(activeProject.name, currentVersion);
                              // Auto-open editor after load (if plugin has one) - but not if webview needs fresh build
                              if (!webviewNeedsFreshBuild || activeProject.uiFramework !== 'webview') {
                                // Use setTimeout to allow state to update
                                setTimeout(async () => {
                                  try {
                                    // Verify plugin is still active before opening editor
                                    const state = await previewApi.pluginGetState();
                                    if (state.status === 'active') {
                                      const hasEditor = await previewApi.pluginHasEditor();
                                      if (hasEditor) {
                                        await previewApi.pluginOpenEditor();
                                      }
                                    }
                                  } catch (err) {
                                    console.error('Failed to open editor:', err);
                                  }
                                }, 100);
                              }
                            } catch (err) {
                              console.error('Failed to load plugin:', err);
                            } finally {
                              setPluginLoading(false);
                            }
                          }
                        }}
                        disabled={!engineInitialized || pluginLoading || loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading' || (webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' && loadedPlugin.status === 'unloaded')}
                        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                          loadedPlugin.status === 'active'
                            ? 'bg-accent'
                            : 'bg-bg-elevated border border-border'
                        } ${(!engineInitialized || pluginLoading || loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading' || (webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' && loadedPlugin.status === 'unloaded')) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
                            loadedPlugin.status === 'active' ? 'left-6' : 'left-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* WebView warning when plugin is active - disabling requires rebuild */}
                    {loadedPlugin.status === 'active' && activeProject?.uiFramework === 'webview' && (
                      <div className="text-xs text-text-muted flex items-start gap-1.5">
                        <svg className="w-3 h-3 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>Disabling will require a rebuild to re-enable (WebView limitation)</span>
                      </div>
                    )}

                    {/* Status indicator */}
                    {loadedPlugin.status === 'loading' && (
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Loading plugin...
                      </div>
                    )}

                    {loadedPlugin.status === 'reloading' && (
                      <div className="flex items-center gap-2 text-xs text-amber-400">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Hot reloading...
                      </div>
                    )}

                    {loadedPlugin.status === 'active' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-green-400">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Plugin active - audio processing through plugin
                        </div>

                        {/* Editor controls */}
                        {loadedPlugin.has_editor ? (
                          webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' ? (
                            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs space-y-2">
                              <div className="flex items-start gap-2">
                                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <div>
                                  <div className="font-medium">Fresh build required</div>
                                  <div className="text-amber-400/80 mt-1">
                                    WebView plugins need a fresh build after switching projects to avoid conflicts with the host app.
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={handleOpenEditor}
                              className="w-full px-3 py-2 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors flex items-center justify-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              Open Plugin Window
                            </button>
                          )
                        ) : (
                          <div className="text-xs text-text-muted text-center py-2 bg-bg-primary rounded">
                            This plugin has no GUI (headless)
                          </div>
                        )}
                      </div>
                    )}

                    {loadedPlugin.status === 'error' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-error">
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          Failed to load: {loadedPlugin.message}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                </div>
                )}
              </div>

              {/* Build Status */}
              <div className="pb-3">
                {renderSectionHeader('build', 'Build Status',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                  </svg>
                )}
                {!collapsedSections.build && (
                <div className="space-y-3 pt-2">
                {/* Status indicator */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-text-secondary">Status:</span>
                  <span className={`flex items-center gap-1.5 ${
                    buildStatus === 'ready' ? 'text-green-400' :
                    buildStatus === 'building' ? 'text-amber-400' :
                    buildStatus === 'needs_rebuild' ? 'text-amber-400' :
                    buildStatus === 'error' ? 'text-error' :
                    'text-text-muted'
                  }`}>
                    {buildStatus === 'building' && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {buildStatus === 'ready' && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {buildStatus === 'needs_rebuild' && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    {buildStatus === 'error' && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    {buildStatus === 'idle' ? 'Idle' :
                     buildStatus === 'building' ? 'Building...' :
                     buildStatus === 'ready' ? 'Ready' :
                     buildStatus === 'needs_rebuild' ? 'Needs Rebuild' :
                     'Error'}
                  </span>
                </div>
                {/* Needs rebuild message */}
                {buildStatus === 'needs_rebuild' && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>Source code changed. Build to update the plugin.</span>
                    </div>
                  </div>
                )}
                </div>
                )}
              </div>

              {/* Engine Status */}
              <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${
                    engineInitialized ? 'bg-green-400' : engineError ? 'bg-error' : 'bg-amber-400 animate-pulse'
                  }`} />
                  <div>
                    <p className="text-sm text-text-secondary">
                      {engineInitialized
                        ? 'Audio engine ready'
                        : engineError
                          ? 'Audio engine failed to initialize'
                          : 'Initializing audio engine...'}
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      {engineInitialized
                        ? 'Test signals and CLAP plugin hosting available.'
                        : 'Setting up audio output...'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
