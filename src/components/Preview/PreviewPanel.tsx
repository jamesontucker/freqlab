import { useState, useEffect, useCallback, useRef } from 'react';
import { usePreviewStore, type SignalType, type GatePattern } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import * as previewApi from '../../api/preview';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FrequencySelector } from './FrequencySelector';
import { LevelMeters } from './LevelMeters';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';
import { WaveformDisplay } from './WaveformDisplay';
import { LiveInputControls } from './LiveInputControls';
import { InstrumentControls } from './InstrumentControls';

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
    masterVolume,
    setMasterVolume,
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
  const [displayInputDb, setDisplayInputDb] = useState({ left: -60, right: -60 });
  const dbUpdateRef = useRef<{ left: number; right: number }>({ left: -60, right: -60 });
  const inputDbUpdateRef = useRef<{ left: number; right: number }>({ left: -60, right: -60 });
  // Animated spectrum, waveform, and levels for buttery smooth 60fps rendering
  // Using refs for interpolation + single consolidated state to minimize re-renders
  const animatedSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const animatedWaveformRef = useRef<number[]>(new Array(256).fill(0));
  const animatedLevelsRef = useRef({ left: 0, right: 0 });
  const animatedInputLevelsRef = useRef({ left: 0, right: 0 });
  // Single state object for all animations - triggers one re-render per frame instead of 4
  const [animationState, setAnimationState] = useState({
    spectrum: new Array(32).fill(0) as number[],
    waveform: new Array(256).fill(0) as number[],
    levels: { left: 0, right: 0 },
    inputLevels: { left: 0, right: 0 },
  });
  // Destructure for component usage (maintains backward compatibility)
  const animatedSpectrum = animationState.spectrum;
  const animatedWaveform = animationState.waveform;
  const animatedLevels = animationState.levels;
  const animatedInputLevels = animationState.inputLevels;
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
      // Output levels
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

      // Input levels (same logic)
      const newInputLeft = meteringRef.current.inputLeftDb;
      const newInputRight = meteringRef.current.inputRightDb;
      const currentInputLeft = inputDbUpdateRef.current.left;
      const currentInputRight = inputDbUpdateRef.current.right;

      const inputLeftDiff = Math.abs(newInputLeft - currentInputLeft);
      const inputRightDiff = Math.abs(newInputRight - currentInputRight);

      if (inputLeftDiff > 1 || inputRightDiff > 1 || newInputLeft < currentInputLeft - 3 || newInputRight < currentInputRight - 3) {
        inputDbUpdateRef.current = { left: newInputLeft, right: newInputRight };
        setDisplayInputDb({ left: newInputLeft, right: newInputRight });
      }
    }, 100); // Update at most 10 times per second

    return () => clearInterval(interval);
  }, [isOpen]); // Only run when panel is open

  // Smooth animation loop for spectrum, waveform, and levels at 60fps
  useEffect(() => {
    if (!isOpen) return;

    const smoothingFactor = 0.25; // Lower = smoother but more laggy, higher = snappier
    const waveformSmoothing = 0.5; // Faster response for time-domain

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

      // Interpolate waveform
      const targetWaveform = meteringRef.current.waveform;
      const currentWaveform = animatedWaveformRef.current;
      const numSamples = Math.min(currentWaveform.length, targetWaveform?.length || 0);
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

      // Interpolate output levels
      const currentLevels = animatedLevelsRef.current;
      const leftDiff = (targetLeft || 0) - currentLevels.left;
      const rightDiff = (targetRight || 0) - currentLevels.right;
      let levelsChanged = false;
      if (Math.abs(leftDiff) > 0.0001 || Math.abs(rightDiff) > 0.0001) {
        currentLevels.left += leftDiff * smoothingFactor;
        currentLevels.right += rightDiff * smoothingFactor;
        levelsChanged = true;
      }

      // Interpolate input levels
      const targetInputLeft = meteringRef.current.inputLeft;
      const targetInputRight = meteringRef.current.inputRight;
      const currentInputLevels = animatedInputLevelsRef.current;
      const inputLeftDiff = (targetInputLeft || 0) - currentInputLevels.left;
      const inputRightDiff = (targetInputRight || 0) - currentInputLevels.right;
      let inputLevelsChanged = false;
      if (Math.abs(inputLeftDiff) > 0.0001 || Math.abs(inputRightDiff) > 0.0001) {
        currentInputLevels.left += inputLeftDiff * smoothingFactor;
        currentInputLevels.right += inputRightDiff * smoothingFactor;
        inputLevelsChanged = true;
      }

      // Update React state at 60fps - single setState call for all animations
      // Only update if something changed to avoid unnecessary re-renders
      if (spectrumChanged || waveformChanged || levelsChanged || inputLevelsChanged) {
        setAnimationState({
          spectrum: spectrumChanged ? [...currentSpectrum] : animatedSpectrumRef.current,
          waveform: waveformChanged ? [...currentWaveform] : animatedWaveformRef.current,
          levels: levelsChanged ? { ...currentLevels } : animatedLevelsRef.current,
          inputLevels: inputLevelsChanged ? { ...currentInputLevels } : animatedInputLevelsRef.current,
        });
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

        // Listen for combined metering data (levels + dB + spectrum + waveform + clipping + input)
        const unlisten = await previewApi.onMeteringUpdate((data) => {
          setMetering({
            left: data.left,
            right: data.right,
            leftDb: data.left_db,
            rightDb: data.right_db,
            inputLeft: data.input_left,
            inputRight: data.input_right,
            inputLeftDb: data.input_left_db,
            inputRightDb: data.input_right_db,
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
    }, 100); // ~10fps - sufficient for GUI parameter sync, reduces IPC overhead

    return () => {
      clearInterval(intervalId);
    };
  }, [isOpen, engineInitialized, loadedPlugin.status]);

  // Listen for build completion: update plugin availability AND trigger hot reload if active
  // Combined into single listener to avoid duplicate event handlers
  useEffect(() => {
    if (!isOpen || !activeProject) return;

    const handleBuildComplete = async (event: { payload: BuildStreamEvent }) => {
      const data = event.payload;

      // Only act on successful build completions
      if (data.type !== 'done' || !data.success) return;

      try {
        // Get the current version
        const version = await invoke<number>('get_current_version', {
          projectPath: activeProject.path,
        });

        // Check if plugin file exists
        const pluginPath = await previewApi.getProjectPluginPath(activeProject.name, version);
        if (!pluginPath) {
          return;
        }

        // Always update plugin availability state
        setPluginAvailable(true);
        setCurrentVersion(version);
        setBuildStatus('ready');
        setWebviewNeedsFreshBuild(false);

        // If plugin is active, trigger hot reload
        if (loadedPlugin.status === 'active') {
          // Check if editor was open before reload (so we can re-open it)
          let editorWasOpen = false;
          try {
            editorWasOpen = await previewApi.pluginIsEditorOpen();
          } catch {
            // Ignore error
          }

          // Trigger hot reload
          setLoadedPlugin({ status: 'reloading', path: pluginPath });
          await previewApi.pluginReload(activeProject.name, version);

          // Re-open editor if it was open before
          if (editorWasOpen) {
            setTimeout(async () => {
              try {
                const state = await previewApi.pluginGetState();
                if (state.status === 'active') {
                  const hasEditor = await previewApi.pluginHasEditor();
                  if (hasEditor) {
                    await previewApi.pluginOpenEditor();
                  }
                }
              } catch (err) {
                console.error('Failed to re-open editor after hot reload:', err);
              }
            }, 200);
          }
        }
      } catch (err) {
        console.error('Build completion handler failed:', err);
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
            // Reset instrument flag when unloading
            await previewApi.setPluginIsInstrument(false);
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
        } else if (inputSource.type === 'live') {
          // Set up live input source with chunk size for latency control
          console.log('Setting up live input:', inputSource.liveDeviceId || 'default', 'chunk size:', inputSource.liveChunkSize || 128);
          await previewApi.previewSetLiveInput(inputSource.liveDeviceId || null, inputSource.liveChunkSize);
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

  // Update master volume
  const handleMasterVolumeChange = useCallback(async (volume: number) => {
    setMasterVolume(volume);
    if (engineInitialized) {
      try {
        await previewApi.previewSetMasterVolume(volume);
      } catch (err) {
        console.error('Failed to set master volume:', err);
      }
    }
  }, [setMasterVolume, engineInitialized]);

  // Switch input source type (samples <-> signals <-> live) - stops playback and clears demo sample selection
  // Custom sample path is preserved across switches
  const handleInputTypeChange = useCallback(async (type: 'sample' | 'signal' | 'live') => {
    const { setLivePaused } = usePreviewStore.getState();

    // Stop playback when switching modes
    if (isPlaying && engineInitialized) {
      try {
        await previewApi.previewStop();
        setPlaying(false);
      } catch (err) {
        console.error('Failed to stop playback:', err);
      }
    }

    // Reset live paused state when switching to live mode to avoid desync
    if (type === 'live') {
      setLivePaused(false);
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
      className="w-full flex items-center justify-between py-1.5 text-xs font-medium text-text-primary hover:text-accent transition-colors group"
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span>{title}</span>
      </div>
      <svg
        className={`w-3.5 h-3.5 text-text-muted group-hover:text-accent transition-transform duration-200 ${
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
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            <h2 className="text-sm font-semibold text-text-primary">Preview</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
              {/* Plugin Viewer - at top for quick access */}
              <div className="border-b border-border pb-2">
                {renderSectionHeader('plugin', 'Plugin Viewer',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                )}
                {!collapsedSections.plugin && (
                <div className="pt-1.5">
                  {/* Compact plugin toggle with inline status */}
                  <div className="flex items-center justify-between gap-3 p-2 bg-bg-tertiary rounded-lg border border-border">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Status indicator dot */}
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        loadedPlugin.status === 'active' ? 'bg-green-400' :
                        loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading' ? 'bg-amber-400 animate-pulse' :
                        loadedPlugin.status === 'error' ? 'bg-error' :
                        'bg-text-muted'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-text-primary truncate">
                          {loadedPlugin.status === 'active'
                            ? loadedPlugin.name
                            : loadedPlugin.status === 'loading'
                              ? 'Loading...'
                              : loadedPlugin.status === 'reloading'
                                ? 'Hot reloading...'
                                : loadedPlugin.status === 'error'
                                  ? 'Error'
                                  : !pluginAvailable
                                    ? 'No build available'
                                    : `${activeProject?.name} v${currentVersion}`}
                        </div>
                      </div>
                      {/* Open editor button (only when active and has editor) */}
                      {loadedPlugin.status === 'active' && loadedPlugin.has_editor && !(webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview') && (
                        <button
                          onClick={handleOpenEditor}
                          className="px-1.5 py-1 rounded text-xs text-text-muted hover:text-accent hover:bg-accent/10 transition-colors flex-shrink-0 flex items-center gap-1"
                          title="Open Plugin Window"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          <span>Reopen</span>
                        </button>
                      )}
                    </div>
                    {/* Toggle switch */}
                    <button
                      onClick={async () => {
                        if (loadedPlugin.status === 'active') {
                          try {
                            await previewApi.pluginCloseEditor();
                            await previewApi.pluginUnload();
                            await previewApi.setPluginIsInstrument(false);
                            if (activeProject?.uiFramework === 'webview') {
                              setWebviewNeedsFreshBuild(true);
                            }
                          } catch (err) {
                            console.error('Failed to disable plugin viewer:', err);
                          }
                        } else if (loadedPlugin.status === 'unloaded' && pluginAvailable && activeProject) {
                          setPluginLoading(true);
                          try {
                            await previewApi.pluginLoadForProject(activeProject.name, currentVersion);
                            await previewApi.setPluginIsInstrument(activeProject.template === 'instrument');
                            if (!webviewNeedsFreshBuild || activeProject.uiFramework !== 'webview') {
                              setTimeout(async () => {
                                try {
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
                      disabled={!engineInitialized || pluginLoading || loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading' || (webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' && loadedPlugin.status === 'unloaded') || !pluginAvailable}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                        loadedPlugin.status === 'active'
                          ? 'bg-accent'
                          : 'bg-bg-elevated border border-border'
                      } ${(!engineInitialized || pluginLoading || loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading' || (webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' && loadedPlugin.status === 'unloaded') || !pluginAvailable) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                          loadedPlugin.status === 'active' ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                  {/* Error message */}
                  {loadedPlugin.status === 'error' && (
                    <div className="mt-1.5 text-xs text-error">
                      {loadedPlugin.message}
                    </div>
                  )}
                  {/* WebView warning */}
                  {webviewNeedsFreshBuild && activeProject?.uiFramework === 'webview' && loadedPlugin.status === 'unloaded' && pluginAvailable && (
                    <div className="mt-1.5 text-xs text-amber-400">
                      Fresh build required for WebView plugins
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Plugin Type Badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Type:</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  effectivePluginType === 'instrument'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-blue-500/15 text-blue-400'
                }`}>
                  {effectivePluginType === 'instrument' ? 'Instrument' : 'Effect'}
                </span>
              </div>

              {/* Input Source Section */}
              <div className="border-b border-border pb-2">
                {renderSectionHeader('input', 'Input Source',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                )}
                {!collapsedSections.input && (
                <div className="space-y-3 pt-1.5">

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
                      <button
                        onClick={() => handleInputTypeChange('live')}
                        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                          inputSource.type === 'live'
                            ? 'bg-bg-primary text-text-primary shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Live
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

                        {/* Custom File Loader + Transport Controls */}
                        <div className={demoSamples.length > 0 ? "pt-2 border-t border-border" : ""}>
                          <div className="flex items-center gap-2">
                            {/* Play/Stop button */}
                            <button
                              onClick={handleTogglePlaying}
                              disabled={!engineInitialized}
                              className={`p-2 rounded-lg transition-all duration-200 ${
                                !engineInitialized
                                  ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                                  : isPlaying
                                    ? 'bg-error text-white hover:bg-error/90'
                                    : 'bg-accent text-white hover:bg-accent-hover'
                              }`}
                              title={isPlaying ? 'Stop' : 'Play'}
                            >
                              {isPlaying ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <rect x="6" y="4" width="4" height="16" rx="1" />
                                  <rect x="14" y="4" width="4" height="16" rx="1" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5.14v14l11-7-11-7z" />
                                </svg>
                              )}
                            </button>
                            {/* Loop toggle */}
                            <button
                              onClick={() => handleLoopingChange(!isLooping)}
                              className={`p-2 rounded-lg border transition-colors ${
                                isLooping
                                  ? 'bg-accent/10 border-accent/30 text-accent'
                                  : 'bg-bg-tertiary border-border text-text-muted hover:text-text-primary hover:border-border-hover'
                              }`}
                              title={isLooping ? 'Looping enabled' : 'Looping disabled'}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            {/* File loader / file display */}
                            {inputSource.customPath ? (
                              <>
                                <div className="flex-1 px-2.5 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs truncate">
                                  {inputSource.customPath.split('/').pop()}
                                </div>
                                <button
                                  onClick={handleLoadCustomFile}
                                  className="p-2 rounded-lg bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
                                  title="Replace audio file"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={handleLoadCustomFile}
                                className="flex-1 px-2.5 py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 bg-bg-tertiary border border-dashed border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Load Audio File
                              </button>
                            )}
                          </div>
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

                        {/* Transport Controls */}
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center gap-2">
                            {/* Play/Stop button */}
                            <button
                              onClick={handleTogglePlaying}
                              disabled={!engineInitialized}
                              className={`p-2 rounded-lg transition-all duration-200 ${
                                !engineInitialized
                                  ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                                  : isPlaying
                                    ? 'bg-error text-white hover:bg-error/90'
                                    : 'bg-accent text-white hover:bg-accent-hover'
                              }`}
                              title={isPlaying ? 'Stop' : 'Play'}
                            >
                              {isPlaying ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <rect x="6" y="4" width="4" height="16" rx="1" />
                                  <rect x="14" y="4" width="4" height="16" rx="1" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5.14v14l11-7-11-7z" />
                                </svg>
                              )}
                            </button>
                            {/* Loop toggle */}
                            <button
                              onClick={() => handleLoopingChange(!isLooping)}
                              className={`p-2 rounded-lg border transition-colors ${
                                isLooping
                                  ? 'bg-accent/10 border-accent/30 text-accent'
                                  : 'bg-bg-tertiary border-border text-text-muted hover:text-text-primary hover:border-border-hover'
                              }`}
                              title={isLooping ? 'Looping enabled' : 'Looping disabled'}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            <span className="flex-1 text-xs text-text-muted">Test Signal</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Live Input Controls */}
                    {inputSource.type === 'live' && (
                      <LiveInputControls
                        engineInitialized={engineInitialized}
                        isPlaying={isPlaying}
                        onPlay={handleTogglePlaying}
                        animatedInputLevels={animatedInputLevels}
                        displayInputDb={displayInputDb}
                      />
                    )}
                  </>
                )}

                {effectivePluginType === 'instrument' && (
                  <InstrumentControls
                    pluginLoaded={loadedPlugin.status === 'active'}
                  />
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

              {/* Output Meter & Spectrum */}
              <div className="border-b border-border pb-2">
                {renderSectionHeader('output', 'Output',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                )}
                {!collapsedSections.output && (
                <div className="space-y-3 pt-1.5">
                  {/* Master Volume */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        <span className="text-xs text-text-muted font-medium">Master Volume</span>
                      </div>
                      <span className="text-xs text-accent font-medium tabular-nums">
                        {Math.round(masterVolume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={masterVolume}
                      onChange={(e) => handleMasterVolumeChange(Number(e.target.value))}
                      className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>

                  <LevelMeters
                    animatedLevels={animatedLevels}
                    metering={{ leftDb: metering.leftDb, rightDb: metering.rightDb }}
                    displayDb={displayDb}
                    clipHold={clipHold}
                  />
                  <SpectrumAnalyzer
                    animatedSpectrum={animatedSpectrum}
                    showSpectrum={showSpectrum}
                    onToggle={() => setShowSpectrum(!showSpectrum)}
                  />
                  <WaveformDisplay
                    animatedWaveform={animatedWaveform}
                    showWaveform={showWaveform}
                    onToggle={() => setShowWaveform(!showWaveform)}
                  />
                </div>
                )}
              </div>

              {/* Build Status */}
              <div className="pb-2">
                {renderSectionHeader('build', 'Build Status',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                  </svg>
                )}
                {!collapsedSections.build && (
                <div className="space-y-3 pt-1.5">
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
