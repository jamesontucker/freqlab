import { useState, useEffect, useCallback, useRef } from 'react';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTourStore } from '../../stores/tourStore';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';
import * as previewApi from '../../api/preview';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LiveInputControls } from './LiveInputControls';
import { InstrumentControls } from './InstrumentControls';
import { SampleInputControls } from './SampleInputControls';
import { SignalInputControls } from './SignalInputControls';
import { OutputSection } from './OutputSection';
import PerformanceMonitor from './PerformanceMonitor';
import { TransportBar } from './TransportBar';
import { useShallow } from 'zustand/react/shallow';

interface BuildStreamEvent {
  type: 'start' | 'output' | 'error' | 'done';
  line?: string;
  message?: string;
  success?: boolean;
  output_path?: string;
}

// Helper to extract folder name from project path
// e.g., "/Users/x/VSTWorkshop/projects/my_plugin" -> "my_plugin"
function getFolderName(projectPath: string): string {
  return projectPath.split('/').pop() || '';
}

// Output Volume Control - styled to match Input/Output sections
function OutputVolumeControl() {
  const masterVolume = usePreviewStore((s) => s.masterVolume);
  const setMasterVolume = usePreviewStore.getState().setMasterVolume;

  const handleVolumeChange = useCallback(async (volume: number) => {
    setMasterVolume(volume);
    if (usePreviewStore.getState().engineInitialized) {
      try {
        await previewApi.previewSetMasterVolume(volume);
      } catch (err) {
        console.error('Failed to set master volume:', err);
      }
    }
  }, [setMasterVolume]);

  return (
    <div className="space-y-1.5 pb-3 border-b border-border mb-2" title="Preview output volume - controls how loud audio plays through your speakers">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Output Volume</span>
        </div>
        <span className="text-xs text-text-muted font-medium tabular-nums">
          {Math.round(masterVolume * 100)}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={masterVolume}
        onChange={(e) => handleVolumeChange(Number(e.target.value))}
        className="w-full h-2 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent"
      />
    </div>
  );
}

export function PreviewPanel() {
  // Use selectors to prevent unnecessary re-renders
  // Group 1: Panel visibility (rarely changes)
  const isOpen = usePreviewStore((s) => s.isOpen);

  // Group 2: Playback state (changes on user action)
  const isPlaying = usePreviewStore((s) => s.isPlaying);

  // Group 3: Input source (changes on user interaction)
  const inputSource = usePreviewStore((s) => s.inputSource);

  // Group 4: Plugin state (changes on plugin load/unload)
  const { loadedPlugin, webviewNeedsFreshBuild, engineInitialized } = usePreviewStore(
    useShallow((s) => ({
      loadedPlugin: s.loadedPlugin,
      webviewNeedsFreshBuild: s.webviewNeedsFreshBuild,
      engineInitialized: s.engineInitialized,
    }))
  );

  // Group 6: Demo samples (changes once on load)
  const demoSamples = usePreviewStore((s) => s.demoSamples);

  // Get setters via getState() to avoid subscribing to changes
  // Zustand setters are stable references that don't change between renders
  const {
    setOpen,
    setPlaying,
    setInputSource,
    setMetering,
    setDemoSamples,
    setLoadedPlugin,
    setPluginAvailable,
    setCurrentPluginVersion,
    setWebviewNeedsFreshBuild,
    setPluginLoading,
    setEngineInitialized,
  } = usePreviewStore.getState();

  const activeProject = useProjectStore((s) => s.activeProject);
  const { audioSettings, markAudioSettingsApplied } = useSettingsStore();
  const [engineError, setEngineError] = useState<string | null>(null);
  // Collapsible section state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    input: false,
    transport: false,
    output: false,  // Open by default (contains spectrum analyzer)
    performance: false,  // Open by default
    plugin: false,
    build: true,    // Collapsed by default
  });
  // Performance monitoring state
  const [showPerformance, setShowPerformance] = useState(false);
  const showPerformanceRef = useRef(false);
  showPerformanceRef.current = showPerformance;

  // Toggle performance monitoring - calls backend to enable/disable timing
  const handleTogglePerformance = useCallback(async () => {
    const newEnabled = !showPerformance;
    setShowPerformance(newEnabled);
    try {
      await previewApi.enablePerformanceMonitoring(newEnabled);
    } catch (error) {
      console.error('Failed to toggle performance monitoring:', error);
      // Revert state on error
      setShowPerformance(!newEnabled);
    }
  }, [showPerformance]);

  // Disable backend performance monitoring when component unmounts (project switch, panel close)
  useEffect(() => {
    return () => {
      if (showPerformanceRef.current) {
        previewApi.enablePerformanceMonitoring(false).catch(() => {
          // Ignore errors during cleanup
        });
      }
    };
  }, []);

  // Track current MIDI source tab for instruments (for TransportBar indicator)
  const [instrumentMidiSource, setInstrumentMidiSource] = useState<'piano' | 'patterns' | 'midi' | 'live'>('patterns');
  const levelListenerRef = useRef<(() => void) | null>(null);
  const pluginListenersRef = useRef<(() => void)[]>([]);

  // Tour ref for the preview panel
  const previewPanelRef = useRef<HTMLDivElement>(null);

  // Tour state
  const tourActive = useTourStore((s) => s.isActive);
  const currentTourStep = useTourStore((s) => s.currentStep);
  const previewPanelBlocked = tourActive && currentTourStep === 'introduce-preview-panel';

  // Register tour ref
  useEffect(() => {
    registerTourRef('preview-panel', previewPanelRef);
    return () => unregisterTourRef('preview-panel');
  }, []);
  // Refs to avoid stale closure issues in project-switching cleanup and build handlers
  const isPlayingRef = useRef(isPlaying);
  const engineInitializedRef = useRef(engineInitialized);
  const loadedPluginRef = useRef(loadedPlugin);
  const webviewNeedsFreshBuildRef = useRef(webviewNeedsFreshBuild);

  // Keep refs in sync
  isPlayingRef.current = isPlaying;
  engineInitializedRef.current = engineInitialized;
  loadedPluginRef.current = loadedPlugin;
  webviewNeedsFreshBuildRef.current = webviewNeedsFreshBuild;

  // Initialize audio engine when panel opens
  useEffect(() => {
    if (!isOpen) return;

    // Cancellation flag to prevent race conditions when effect cleanup runs
    // while async initialization is still in progress
    let isCancelled = false;

    const initEngine = async () => {
      try {
        // Initialize audio engine first (required for other operations)
        await previewApi.initAudioEngine(
          audioSettings.outputDevice,
          audioSettings.sampleRate,
          audioSettings.bufferSize
        );

        if (isCancelled) return;

        setEngineInitialized(true);
        setEngineError(null);
        markAudioSettingsApplied();

        // Run independent operations in parallel for faster startup
        const [meteringUnlisten, samples, pluginState, pluginListeners] = await Promise.all([
          // Start level meter and set up listener
          previewApi.startLevelMeter().then(async () => {
            if (isCancelled) return null;
            return previewApi.onMeteringUpdate((data) => {
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
                spectrumInput: data.spectrum_input,
                // Output waveform (post-FX)
                waveformLeft: data.waveform_left,
                waveformRight: data.waveform_right,
                waveformPeakLeft: data.waveform_peak_left,
                waveformPeakRight: data.waveform_peak_right,
                // Input waveform (pre-FX)
                waveformInputLeft: data.waveform_input_left,
                waveformInputRight: data.waveform_input_right,
                waveformInputPeakLeft: data.waveform_input_peak_left,
                waveformInputPeakRight: data.waveform_input_peak_right,
                clippingLeft: data.clipping_left,
                clippingRight: data.clipping_right,
                // Output stereo (post-FX)
                stereoPositions: data.stereo_positions,
                stereoCorrelation: data.stereo_correlation,
                // Input stereo (pre-FX)
                stereoPositionsInput: data.stereo_positions_input,
                stereoCorrelationInput: data.stereo_correlation_input,
                // Plugin performance (only when monitoring enabled)
                pluginPerformance: data.plugin_performance,
              });
            });
          }),

          // Load demo samples (independent of metering)
          previewApi.getDemoSamples(),

          // Get initial plugin state
          previewApi.pluginGetState(),

          // Set up all plugin event listeners in parallel
          Promise.all([
            previewApi.onPluginLoading(() => setPluginLoading(true)),
            previewApi.onPluginLoaded((state) => {
              setLoadedPlugin(state);
              setPluginLoading(false);
            }),
            previewApi.onPluginError((error) => {
              setLoadedPlugin({ status: 'error', message: error });
              setPluginLoading(false);
            }),
            previewApi.onPluginUnloaded(() => {
              setLoadedPlugin({ status: 'unloaded' });
              setPluginLoading(false);
            }),
          ]),
        ]);

        if (isCancelled) {
          // Clean up all listeners if cancelled
          meteringUnlisten?.();
          pluginListeners.forEach(l => l());
          return;
        }

        // Store listener cleanup functions
        if (meteringUnlisten) {
          levelListenerRef.current = meteringUnlisten;
        }
        setDemoSamples(samples);
        // Only set loadedPlugin from backend state if we don't already have an active plugin
        // This prevents overwriting the toggle's state when panel opens/closes
        const currentStatus = usePreviewStore.getState().loadedPlugin.status;
        if (currentStatus !== 'active') {
          setLoadedPlugin(pluginState);
        }
        pluginListenersRef.current = pluginListeners;
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

  // Cleanup plugin when project is deleted/deselected (activeProject becomes null)
  useEffect(() => {
    if (!activeProject) {
      // Close editor and unload plugin from backend
      previewApi.pluginCloseEditor().catch(() => {});
      previewApi.pluginUnload().catch(() => {});
      previewApi.setPluginIsInstrument(false).catch(() => {});
      // Reset store state
      setLoadedPlugin({ status: 'unloaded' });
      usePreviewStore.getState().setEditorOpen(false);
      setPluginAvailable(false);
      setCurrentPluginVersion(0);
    }
  }, [activeProject, setLoadedPlugin, setPluginAvailable]);

  // Check if plugin is available when project changes
  // Note: We check even when panel is closed so the build button reflects correct state
  useEffect(() => {
    if (!activeProject) {
      return;
    }

    // Reset version immediately to prevent stale values during async fetch
    setCurrentPluginVersion(0);
    setPluginAvailable(false);

    const checkPluginAvailability = async () => {
      try {
        // Get current version for this project
        const version = await invoke<number>('get_current_version', {
          projectPath: activeProject.path,
        });
        setCurrentPluginVersion(version);

        // Check if a .clap plugin exists for this version
        // Use folder name from path, not display name, for filesystem operations
        const folderName = getFolderName(activeProject.path);
        const pluginPath = await previewApi.getProjectPluginPath(folderName, version);
        setPluginAvailable(!!pluginPath);
      } catch (err) {
        console.error('Failed to check plugin availability:', err);
        setPluginAvailable(false);
      }
    };

    checkPluginAvailability();
  }, [activeProject]);

  // Plugin idle loop: Call pluginIdle() periodically when plugin is active
  // This ensures GUI parameter changes are processed even without audio playing
  // Also polls editor status to detect manual window close
  const setEditorOpen = usePreviewStore.getState().setEditorOpen;
  useEffect(() => {
    if (!isOpen || !engineInitialized || loadedPlugin.status !== 'active') return;

    const intervalId = setInterval(async () => {
      try {
        await previewApi.pluginIdle();
        // Check if editor window was closed by user
        const isEditorOpen = await previewApi.pluginIsEditorOpen();
        const currentEditorOpen = usePreviewStore.getState().editorOpen;
        if (currentEditorOpen !== isEditorOpen) {
          setEditorOpen(isEditorOpen);
        }
      } catch (err) {
        // Silently ignore errors - plugin may have been unloaded
      }
    }, 100); // ~10fps - sufficient for GUI parameter sync, reduces IPC overhead

    return () => {
      clearInterval(intervalId);
    };
  }, [isOpen, engineInitialized, loadedPlugin.status, setEditorOpen]);

  // Listen for build completion: update plugin availability AND trigger hot reload if active
  // Runs regardless of panel open state so hot reload works when plugin is launched from header
  useEffect(() => {
    if (!activeProject) return;

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
        // Use folder name from path, not display name, for filesystem operations
        const folderName = getFolderName(activeProject.path);
        const pluginPath = await previewApi.getProjectPluginPath(folderName, version);
        if (!pluginPath) {
          return;
        }

        // Always update plugin availability state
        setPluginAvailable(true);
        setCurrentPluginVersion(version);

        // For webview projects, check if this was a "fresh build" (first build after switching projects)
        // If so, DON'T do hot reload - require manual toggle instead
        // Use ref to get current value - closure might have stale value
        const isWebviewFreshBuild = activeProject?.uiFramework === 'webview' && webviewNeedsFreshBuildRef.current;

        // Clear webview fresh build flag after ANY successful build
        // This enables the toggle for manual loading
        if (activeProject?.uiFramework === 'webview') {
          setWebviewNeedsFreshBuild(false);
        }

        // If plugin is active, trigger hot reload
        // Use ref to get current status - closure might have stale value after project switch
        // Skip hot reload for webview fresh builds - these should require manual toggle
        if (loadedPluginRef.current.status === 'active' && !isWebviewFreshBuild) {
          // Check if editor was open before reload (so we can re-open it)
          let editorWasOpen = false;
          try {
            editorWasOpen = await previewApi.pluginIsEditorOpen();
          } catch {
            // Ignore error
          }

          // Trigger hot reload
          setLoadedPlugin({ status: 'reloading', path: pluginPath });
          // Use folder name from path for reload
          const reloadFolderName = getFolderName(activeProject.path);
          await previewApi.pluginReload(reloadFolderName, version);

          // Update state after reload (event listeners may not be active when panel is closed)
          const newState = await previewApi.pluginGetState();
          setLoadedPlugin(newState);

          // Re-open editor if it was open before
          // Position is stored at engine level, so it will restore to same position
          if (editorWasOpen && newState.status === 'active') {
            setTimeout(async () => {
              try {
                const hasEditor = await previewApi.pluginHasEditor();
                if (hasEditor) {
                  await previewApi.pluginOpenEditor();
                  setEditorOpen(true);
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
  }, [activeProject, setLoadedPlugin]);

  // Handle project switching - stop playback and set webview flag
  // Plugin unloading is handled by PluginViewerToggle component
  const prevProjectNameRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Detect actual project change (not initial mount, not brief null states)
    // Requires BOTH old and new names to be defined and different
    const currentName = activeProject?.name;
    const projectChanged = prevProjectNameRef.current !== undefined &&
                           currentName !== undefined &&
                           prevProjectNameRef.current !== currentName;

    // Only update ref when we have an actual project name (prevents null/undefined from corrupting the ref)
    if (currentName !== undefined) {
      prevProjectNameRef.current = currentName;
    }

    // Only act on actual project changes, not every render
    if (!projectChanged) return;

    // Always stop playback on project switch (unconditionally, regardless of React state)
    // This ensures audio stops even if isPlayingRef is out of sync
    setPlaying(false);
    if (engineInitializedRef.current) {
      previewApi.previewStop().catch(err => {
        console.error('Failed to stop playback on project switch:', err);
      });
    }

    // Reset plugin state - actual unloading handled by PluginViewerToggle
    setLoadedPlugin({ status: 'unloaded' });
    setEditorOpen(false);

    // Close editor and unload from backend to ensure clean state
    previewApi.pluginCloseEditor().catch(() => {});
    previewApi.pluginUnload().catch(() => {});
    previewApi.setPluginIsInstrument(false).catch(() => {});

    // Only set webview flag when switching TO a webview project
    if (activeProject?.uiFramework === 'webview') {
      setWebviewNeedsFreshBuild(true);
    } else {
      setWebviewNeedsFreshBuild(false);
    }
  }, [activeProject?.name, activeProject?.uiFramework, setPlaying, setLoadedPlugin, setWebviewNeedsFreshBuild, setEditorOpen]);

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
      ref={previewPanelRef}
      className={`fixed top-14 right-0 bottom-0 w-[480px] bg-bg-secondary border-l border-border shadow-2xl z-40 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Blocking overlay during tour introduction */}
      {previewPanelBlocked && (
        <div className="absolute inset-0 z-50 pointer-events-auto" />
      )}
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            <h2 className="text-sm font-semibold text-text-primary">Plugin Controls</h2>
            {activeProject && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                effectivePluginType === 'instrument'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-blue-500/15 text-blue-400'
              }`}>
                {effectivePluginType === 'instrument' ? 'Instrument' : 'Effect'}
              </span>
            )}
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

          {/* Output Volume - always visible at top when engine is initialized */}
          {engineInitialized && <OutputVolumeControl />}

          {activeProject && (
            <>
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
                      <SampleInputControls />
                    )}

                    {/* Signal Selection */}
                    {inputSource.type === 'signal' && (
                      <SignalInputControls />
                    )}

                    {/* Live Input Controls */}
                    {inputSource.type === 'live' && (
                      <LiveInputControls
                        onPlay={handleTogglePlaying}
                        isOpen={isOpen}
                      />
                    )}
                  </>
                )}

                {effectivePluginType === 'instrument' && (
                  <InstrumentControls
                    pluginLoaded={loadedPlugin.status === 'active'}
                    onTabChange={setInstrumentMidiSource}
                  />
                )}
                </div>
                )}
              </div>

              {/* Transport Bar - always visible when a project is active */}
              <TransportBar
                pluginType={effectivePluginType}
                onPlay={handleTogglePlaying}
                midiSource={instrumentMidiSource}
              />

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

              {/* Monitoring Section (Level Meters, Spectrum, Waveform, Stereo) */}
              <div className="border-b border-border pb-2">
                {renderSectionHeader('output', 'Monitoring',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                )}
                {!collapsedSections.output && (
                  <OutputSection isOpen={isOpen} isVisible={!collapsedSections.output} pluginType={effectivePluginType} />
                )}
              </div>

              {/* Performance Section (Plugin CPU monitoring) */}
              <div className="border-b border-border pb-2">
                {renderSectionHeader('performance', 'Performance',
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    {/* Speedometer/gauge icon */}
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                  </svg>
                )}
                {!collapsedSections.performance && (
                  <PerformanceMonitor
                    enabled={showPerformance}
                    onToggle={handleTogglePerformance}
                  />
                )}
              </div>

              {/* Engine Status - only show when initializing or on error */}
              {!engineInitialized && (
                <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 ${
                      engineError ? 'bg-error' : 'bg-amber-400 animate-pulse'
                    }`} />
                    <div>
                      <p className="text-sm text-text-secondary">
                        {engineError
                          ? 'Audio engine failed to initialize'
                          : 'Initializing audio engine...'}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        Setting up audio output...
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
