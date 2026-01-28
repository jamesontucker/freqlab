import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { usePreviewStore, type DemoSample } from '../../stores/previewStore';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as previewApi from '../../api/preview';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';

// Supported audio file extensions
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a'];

function isAudioFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.includes(ext);
}

export const SampleInputControls = memo(function SampleInputControls() {
  const inputSource = usePreviewStore((s) => s.inputSource);
  const demoSamples = usePreviewStore((s) => s.demoSamples);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Ref to track drop zone bounds for position-based drop handling
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Tour ref for drums sample button (preferred for tour demo)
  const drumsSampleRef = useRef<HTMLButtonElement>(null);

  // Register tour ref when samples are available - prefer Drums sample
  useEffect(() => {
    if (demoSamples.length > 0) {
      registerTourRef('sample-select', drumsSampleRef);
      return () => unregisterTourRef('sample-select');
    }
  }, [demoSamples.length]);

  // Get setters via getState to avoid re-renders
  const setInputSource = usePreviewStore.getState().setInputSource;

  // Load audio file (from dialog or drag-drop)
  const loadAudioFile = useCallback(async (filePath: string) => {
    const currentInputSource = usePreviewStore.getState().inputSource;
    setInputSource({ ...currentInputSource, customPath: filePath, sampleId: undefined });

    // Load the sample into the engine
    if (usePreviewStore.getState().engineInitialized) {
      try {
        await previewApi.previewLoadSample(filePath);
        console.log('Loaded custom sample:', filePath);
      } catch (err) {
        console.error('Failed to load sample into engine:', err);
      }
    }
  }, [setInputSource]);

  // Check if a position is within an element's bounds
  const isPositionInElement = useCallback((position: { x: number; y: number }, element: HTMLElement | null): boolean => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return (
      position.x >= rect.left &&
      position.x <= rect.right &&
      position.y >= rect.top &&
      position.y <= rect.bottom
    );
  }, []);

  // Listen for drag-drop events from Tauri
  useEffect(() => {
    let mounted = true;
    let unlistenEnter: UnlistenFn | undefined;
    let unlistenLeave: UnlistenFn | undefined;
    let unlistenDrop: UnlistenFn | undefined;

    async function setupListeners() {
      unlistenEnter = await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-enter', (event) => {
        if (!mounted) return;
        // Only show drag state if dragging audio files
        const hasAudioFile = event.payload.paths?.some(isAudioFile);
        if (hasAudioFile) {
          setIsDraggingOver(true);
        }
      });

      unlistenLeave = await listen('tauri://drag-leave', () => {
        if (mounted) setIsDraggingOver(false);
      });

      unlistenDrop = await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
        if (!mounted) return;
        setIsDraggingOver(false);

        // Only handle drop if it's within this component's bounds
        if (!isPositionInElement(event.payload.position, dropZoneRef.current)) {
          return;
        }

        // Find the first audio file in the dropped files
        const audioFile = event.payload.paths?.find(isAudioFile);
        if (audioFile) {
          loadAudioFile(audioFile);
        }
      });
    }

    setupListeners();

    return () => {
      mounted = false;
      unlistenEnter?.();
      unlistenLeave?.();
      unlistenDrop?.();
    };
  }, [loadAudioFile, isPositionInElement]);

  // Select a demo sample
  const handleSampleSelect = useCallback(async (sampleId: string) => {
    const currentInputSource = usePreviewStore.getState().inputSource;
    setInputSource({ ...currentInputSource, sampleId, customPath: undefined });

    // If playing, load and start playing the new sample
    const state = usePreviewStore.getState();
    if (state.isPlaying && state.engineInitialized) {
      const samples = state.demoSamples;
      const sample = samples.find((s: DemoSample) => s.id === sampleId);
      if (sample) {
        try {
          await previewApi.previewLoadSample(sample.path);
        } catch (err) {
          console.error('Failed to load sample:', err);
        }
      }
    }
  }, [setInputSource]);

  // Open file dialog to load a custom audio file
  const handleLoadCustomFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio Files',
          extensions: AUDIO_EXTENSIONS
        }]
      });

      if (selected && typeof selected === 'string') {
        await loadAudioFile(selected);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  }, [loadAudioFile]);

  return (
    <div ref={dropZoneRef} className="space-y-3">
      {/* Demo Samples */}
      {demoSamples.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {demoSamples.map((sample) => (
            <button
              key={sample.id}
              ref={sample.id === 'drums' || sample.name.toLowerCase() === 'drums' ? drumsSampleRef : undefined}
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

      {/* Custom File Loader / Drop Zone */}
      <div className={demoSamples.length > 0 ? "pt-2 border-t border-border" : ""}>
        {inputSource.customPath ? (
          <div
            className={`flex items-center gap-2 p-1 rounded-lg transition-all ${
              isDraggingOver ? 'bg-accent/10 ring-2 ring-accent ring-offset-2 ring-offset-bg-secondary' : ''
            }`}
          >
            <div className="flex-1 px-2.5 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs truncate">
              {isDraggingOver ? 'Drop to replace' : inputSource.customPath.split(/[/\\]/).pop()}
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
          </div>
        ) : (
          <button
            onClick={handleLoadCustomFile}
            className={`w-full px-2.5 py-3 rounded-lg text-xs flex flex-col items-center justify-center gap-1 border border-dashed transition-all ${
              isDraggingOver
                ? 'bg-accent/10 border-accent text-accent scale-[1.02]'
                : 'bg-bg-tertiary border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
            </svg>
            <span>{isDraggingOver ? 'Drop audio file here' : 'Drop or click to load audio'}</span>
          </button>
        )}
      </div>
    </div>
  );
});
