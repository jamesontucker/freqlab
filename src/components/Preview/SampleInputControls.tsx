import { memo, useCallback } from 'react';
import { usePreviewStore, type DemoSample } from '../../stores/previewStore';
import { useShallow } from 'zustand/react/shallow';
import { open } from '@tauri-apps/plugin-dialog';
import * as previewApi from '../../api/preview';

interface SampleInputControlsProps {
  onPlay: () => void;
}

export const SampleInputControls = memo(function SampleInputControls({
  onPlay,
}: SampleInputControlsProps) {
  // Subscribe only to what we need
  const { isPlaying, isLooping, engineInitialized } = usePreviewStore(
    useShallow((s) => ({
      isPlaying: s.isPlaying,
      isLooping: s.isLooping,
      engineInitialized: s.engineInitialized,
    }))
  );

  const inputSource = usePreviewStore((s) => s.inputSource);
  const demoSamples = usePreviewStore((s) => s.demoSamples);

  // Get setters via getState to avoid re-renders
  const setLooping = usePreviewStore.getState().setLooping;
  const setInputSource = usePreviewStore.getState().setInputSource;

  // Handle looping change
  const handleLoopingChange = useCallback(async (looping: boolean) => {
    setLooping(looping);
    if (usePreviewStore.getState().engineInitialized) {
      try {
        await previewApi.previewSetLooping(looping);
      } catch (err) {
        console.error('Failed to set looping:', err);
      }
    }
  }, [setLooping]);

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
        const currentInputSource = usePreviewStore.getState().inputSource;
        setInputSource({ ...currentInputSource, customPath: selected, sampleId: undefined });

        // Load the sample into the engine
        if (usePreviewStore.getState().engineInitialized) {
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
  }, [setInputSource]);

  return (
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
            onClick={onPlay}
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
  );
});
