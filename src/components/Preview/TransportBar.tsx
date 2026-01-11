import { memo, useCallback, useRef, useEffect } from 'react';
import { usePreviewStore, type SignalType } from '../../stores/previewStore';
import { useShallow } from 'zustand/react/shallow';
import * as previewApi from '../../api/preview';
import { Tooltip } from '../Common/Tooltip';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';

interface TransportBarProps {
  pluginType: 'effect' | 'instrument';
  onPlay: () => void;
  /** For instruments: current MIDI source tab */
  midiSource?: 'piano' | 'patterns' | 'midi' | 'live';
  /** For instruments with patterns: current pattern info */
  patternInfo?: { name: string; bpm: number } | null;
  /** For instruments with MIDI file: current file name */
  midiFileName?: string | null;
}

// Human-readable signal type names
const SIGNAL_NAMES: Record<SignalType, string> = {
  sine: 'Sine',
  white_noise: 'White Noise',
  pink_noise: 'Pink Noise',
  impulse: 'Impulse',
  sweep: 'Sweep',
  square: 'Square',
};

export const TransportBar = memo(function TransportBar({
  pluginType,
  onPlay,
  midiSource = 'piano',
  patternInfo,
  midiFileName,
}: TransportBarProps) {
  // Tour ref for play button
  const playButtonRef = useRef<HTMLButtonElement>(null);

  // Register tour ref
  useEffect(() => {
    registerTourRef('play-button', playButtonRef);
    return () => unregisterTourRef('play-button');
  }, []);

  // Subscribe to playback state
  const { isPlaying, isLooping, engineInitialized, inputSource, demoSamples } = usePreviewStore(
    useShallow((s) => ({
      isPlaying: s.isPlaying,
      isLooping: s.isLooping,
      engineInitialized: s.engineInitialized,
      inputSource: s.inputSource,
      demoSamples: s.demoSamples,
    }))
  );

  // Get setters via getState to avoid re-renders
  const setLooping = usePreviewStore.getState().setLooping;

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

  // Build input indicator text
  const getInputIndicator = (): { icon: React.ReactNode; label: string } => {
    if (pluginType === 'instrument') {
      // Instrument mode - show MIDI source
      switch (midiSource) {
        case 'piano':
          return {
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
              </svg>
            ),
            label: 'Piano Keyboard',
          };
        case 'patterns':
          if (patternInfo) {
            return {
              icon: (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                </svg>
              ),
              label: `${patternInfo.name} ${patternInfo.bpm} BPM`,
            };
          }
          return {
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
            ),
            label: 'Patterns',
          };
        case 'midi':
          if (midiFileName) {
            return {
              icon: (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              ),
              label: midiFileName,
            };
          }
          return {
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            ),
            label: 'MIDI File',
          };
        case 'live':
          return {
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            ),
            label: 'Live MIDI',
          };
      }
    }

    // Effect mode - show audio input source
    if (inputSource.type === 'signal') {
      const signalType = inputSource.signalType || 'sine';
      const signalName = SIGNAL_NAMES[signalType];
      // Show frequency for tonal signals
      const showFreq = ['sine', 'square', 'impulse'].includes(signalType);
      const freqLabel = showFreq && inputSource.signalFrequency
        ? ` ${inputSource.signalFrequency}Hz`
        : '';

      return {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        ),
        label: `${signalName}${freqLabel}`,
      };
    }

    if (inputSource.type === 'live') {
      const deviceName = inputSource.liveDeviceId || 'Default';
      return {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        ),
        label: `Live: ${deviceName.length > 20 ? deviceName.slice(0, 20) + '...' : deviceName}`,
      };
    }

    // Sample mode
    if (inputSource.customPath) {
      const fileName = inputSource.customPath.split('/').pop() || 'Custom File';
      return {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        ),
        label: fileName.length > 25 ? fileName.slice(0, 22) + '...' : fileName,
      };
    }

    if (inputSource.sampleId) {
      const sample = demoSamples.find(s => s.id === inputSource.sampleId);
      return {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
          </svg>
        ),
        label: sample?.name || 'Demo Sample',
      };
    }

    // Default - no source selected
    return {
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      ),
      label: 'No source selected',
    };
  };

  const indicator = getInputIndicator();

  // For instruments, only show the MIDI source indicator (no play/stop/loop)
  if (pluginType === 'instrument') {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-bg-tertiary/50 rounded-lg border border-border">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-tertiary text-text-secondary text-xs">
          <span className="text-text-muted flex-shrink-0">{indicator.icon}</span>
          <span className="truncate">{indicator.label}</span>
        </div>
      </div>
    );
  }

  // For effects, show full transport controls + input indicator
  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-bg-tertiary/50 rounded-lg border border-border">
      {/* Play/Stop button */}
      <Tooltip content={!engineInitialized ? 'Waiting for audio engine...' : isPlaying ? 'Stop' : 'Play'}>
        <button
          ref={playButtonRef}
          onClick={onPlay}
          disabled={!engineInitialized}
          className={`p-2.5 rounded-lg transition-all duration-200 ${
            !engineInitialized
              ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              : isPlaying
                ? 'bg-error text-white hover:bg-error/90'
                : 'bg-accent text-white hover:bg-accent-hover'
          }`}
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
      </Tooltip>

      {/* Loop toggle */}
      <Tooltip content={isLooping ? 'Looping enabled' : 'Looping disabled'}>
        <button
          onClick={() => handleLoopingChange(!isLooping)}
          className={`p-2 rounded-lg border transition-colors ${
            isLooping
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-bg-tertiary border-border text-text-muted hover:text-text-primary hover:border-border-hover'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </Tooltip>

      {/* Divider */}
      <div className="w-px h-6 bg-border" />

      {/* Input indicator */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-tertiary text-text-secondary text-xs truncate">
        <span className="text-text-muted flex-shrink-0">{indicator.icon}</span>
        <span className="truncate">{indicator.label}</span>
      </div>
    </div>
  );
});
