import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePreviewStore, type AudioDevice } from '../../stores/previewStore';
import { useShallow } from 'zustand/react/shallow';
import { useToastStore } from '../../stores/toastStore';
import * as previewApi from '../../api/preview';

const LATENCY_OPTIONS = [
  { value: 32, label: '32', description: '~1ms' },
  { value: 64, label: '64', description: '~3ms' },
  { value: 128, label: '128', description: '~5ms' },
  { value: 256, label: '256', description: '~11ms' },
  { value: 512, label: '512', description: '~21ms' },
];

interface LiveInputControlsProps {
  onPlay: () => void;
  isOpen: boolean;
}

export const LiveInputControls = memo(function LiveInputControls({
  onPlay,
  isOpen,
}: LiveInputControlsProps) {
  // Use selectors to prevent unnecessary re-renders
  const { isPlaying, isLivePaused } = usePreviewStore(
    useShallow((s) => ({
      isPlaying: s.isPlaying,
      isLivePaused: s.isLivePaused,
    }))
  );

  const inputSource = usePreviewStore((s) => s.inputSource);
  const availableInputDevices = usePreviewStore((s) => s.availableInputDevices);

  // Get setters via getState to avoid re-renders
  // Zustand setters are stable references
  const {
    setInputSource,
    setLivePaused,
    setAvailableInputDevices,
  } = usePreviewStore.getState();

  const { addToast } = useToastStore();

  // Animation state for input levels
  const [animatedLevels, setAnimatedLevels] = useState({ left: 0, right: 0 });
  const [displayDb, setDisplayDb] = useState({ left: -60, right: -60 });
  const animatedLevelsRef = useRef({ left: 0, right: 0 });
  const dbUpdateRef = useRef({ left: -60, right: -60 });
  const rafIdRef = useRef<number | null>(null);

  // Debounce dB display updates
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      const metering = usePreviewStore.getState().metering;
      const newLeft = metering.inputLeftDb;
      const newRight = metering.inputRightDb;
      const currentLeft = dbUpdateRef.current.left;
      const currentRight = dbUpdateRef.current.right;

      const leftDiff = Math.abs(newLeft - currentLeft);
      const rightDiff = Math.abs(newRight - currentRight);

      if (leftDiff > 1 || rightDiff > 1 || newLeft < currentLeft - 3 || newRight < currentRight - 3) {
        dbUpdateRef.current = { left: newLeft, right: newRight };
        setDisplayDb({ left: newLeft, right: newRight });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Smooth animation loop for input levels at 60fps
  useEffect(() => {
    if (!isOpen) return;

    const smoothingFactor = 0.25;

    const animate = () => {
      const metering = usePreviewStore.getState().metering;
      const targetLeft = metering.inputLeft;
      const targetRight = metering.inputRight;
      const currentLevels = animatedLevelsRef.current;

      const leftDiff = (targetLeft || 0) - currentLevels.left;
      const rightDiff = (targetRight || 0) - currentLevels.right;

      if (Math.abs(leftDiff) > 0.0001 || Math.abs(rightDiff) > 0.0001) {
        currentLevels.left += leftDiff * smoothingFactor;
        currentLevels.right += rightDiff * smoothingFactor;
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

  // Load available input devices when component mounts
  useEffect(() => {
    async function loadDevices() {
      try {
        const devices = await previewApi.getInputDevices();
        const mapped: AudioDevice[] = devices.map(d => ({
          name: d.name,
          is_default: d.is_default,
        }));
        setAvailableInputDevices(mapped);

        if (mapped.length === 0) {
          addToast({
            type: 'warning',
            message: 'No input devices found. Check your audio settings.',
          });
        }
      } catch (err) {
        console.error('Failed to load input devices:', err);
        addToast({
          type: 'error',
          message: 'Failed to load input devices',
        });
      }
    }
    loadDevices();
  }, [setAvailableInputDevices, addToast]);

  // Handle device selection
  const handleDeviceChange = useCallback(async (deviceName: string | undefined) => {
    const currentInputSource = usePreviewStore.getState().inputSource;
    setInputSource({
      ...currentInputSource,
      liveDeviceId: deviceName,
    });

    const state = usePreviewStore.getState();
    if (state.engineInitialized && state.isPlaying) {
      try {
        await previewApi.previewSetLiveInput(deviceName || null);
      } catch (err) {
        console.error('Failed to set live input device:', err);
        addToast({
          type: 'error',
          message: `Failed to start input device: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    }
  }, [setInputSource, addToast]);

  // Handle monitoring toggle
  const handleMonitoringToggle = useCallback(async () => {
    const state = usePreviewStore.getState();
    const isShowingStart = state.isLivePaused || !state.isPlaying;

    if (isShowingStart) {
      setLivePaused(false);

      if (state.engineInitialized) {
        try {
          await previewApi.previewSetLivePaused(false);
        } catch (err) {
          console.error('Failed to start monitoring:', err);
          addToast({ type: 'error', message: 'Failed to start monitoring' });
          return;
        }
      }

      if (!state.isPlaying) {
        onPlay();
      }
    } else {
      setLivePaused(true);

      if (state.engineInitialized) {
        try {
          await previewApi.previewSetLivePaused(true);
        } catch (err) {
          console.error('Failed to pause monitoring:', err);
          setLivePaused(false);
          addToast({ type: 'error', message: 'Failed to pause monitoring' });
        }
      }
    }
  }, [setLivePaused, onPlay, addToast]);

  // Handle chunk size change
  const handleChunkSizeChange = useCallback(async (chunkSize: number) => {
    const currentInputSource = usePreviewStore.getState().inputSource;
    setInputSource({
      ...currentInputSource,
      liveChunkSize: chunkSize,
    });

    const state = usePreviewStore.getState();
    if (state.engineInitialized && state.isPlaying && !state.isLivePaused) {
      try {
        await previewApi.previewSetLiveInput(currentInputSource.liveDeviceId || null, chunkSize);
      } catch (err) {
        console.error('Failed to update chunk size:', err);
        addToast({ type: 'error', message: 'Failed to update latency setting' });
      }
    }
  }, [setInputSource, addToast]);

  // Compute meter values with useMemo
  const meterValues = useMemo(() => {
    const animLeftDb = animatedLevels.left > 0 ? Math.max(-60, 20 * Math.log10(animatedLevels.left)) : -60;
    const animRightDb = animatedLevels.right > 0 ? Math.max(-60, 20 * Math.log10(animatedLevels.right)) : -60;
    return {
      leftWidth: Math.max(0, (animLeftDb + 60) / 60 * 100),
      rightWidth: Math.max(0, (animRightDb + 60) / 60 * 100),
      leftColor: getMeterColor(animLeftDb),
      rightColor: getMeterColor(animRightDb),
    };
  }, [animatedLevels.left, animatedLevels.right]);

  const selectedDevice = inputSource.liveDeviceId;
  const defaultDevice = availableInputDevices.find(d => d.is_default);

  return (
    <div className="space-y-4">
      {/* DAW Conflict Warning */}
      <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
        <svg className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-[10px] text-yellow-500/90 leading-tight">
          Live input may conflict with DAWs using the same audio device. Close other audio apps or use a different input device.
        </p>
      </div>

      {/* Device Selector */}
      <div className="space-y-2">
        <label className="text-xs text-text-secondary font-medium">Input Device</label>
        {availableInputDevices.length === 0 ? (
          <div className="text-xs text-text-muted py-2">
            No input devices found
          </div>
        ) : (
          <select
            value={selectedDevice || ''}
            onChange={(e) => handleDeviceChange(e.target.value || undefined)}
            className="w-full bg-bg-primary text-text-primary text-sm rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">
              System Default{defaultDevice ? ` (${defaultDevice.name})` : ''}
            </option>
            {availableInputDevices.map((device) => (
              <option key={device.name} value={device.name}>
                {device.name}
                {device.is_default ? ' (Default)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Input Level Meters */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Input Level</span>
        </div>

        {/* Left channel */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted w-3 font-mono">L</span>
          <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
            <div
              className={`h-full ${meterValues.leftColor}`}
              style={{ width: `${meterValues.leftWidth}%` }}
            />
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-[50%] w-px h-full bg-white/20" title="-30dB" />
              <div className="absolute left-[70%] w-px h-full bg-white/20" title="-18dB" />
              <div className="absolute left-[80%] w-px h-full bg-white/25" title="-12dB" />
              <div className="absolute left-[90%] w-px h-full bg-yellow-400/40" title="-6dB" />
              <div className="absolute left-[100%] w-px h-full bg-red-400/50" title="0dB" />
            </div>
          </div>
          <span className="text-[10px] text-text-muted w-14 text-right font-mono tabular-nums">
            {displayDb.left > -60 ? `${displayDb.left.toFixed(1)}` : '-∞'} dB
          </span>
        </div>

        {/* Right channel */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted w-3 font-mono">R</span>
          <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
            <div
              className={`h-full ${meterValues.rightColor}`}
              style={{ width: `${meterValues.rightWidth}%` }}
            />
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-[50%] w-px h-full bg-white/20" title="-30dB" />
              <div className="absolute left-[70%] w-px h-full bg-white/20" title="-18dB" />
              <div className="absolute left-[80%] w-px h-full bg-white/25" title="-12dB" />
              <div className="absolute left-[90%] w-px h-full bg-yellow-400/40" title="-6dB" />
              <div className="absolute left-[100%] w-px h-full bg-red-400/50" title="0dB" />
            </div>
          </div>
          <span className="text-[10px] text-text-muted w-14 text-right font-mono tabular-nums">
            {displayDb.right > -60 ? `${displayDb.right.toFixed(1)}` : '-∞'} dB
          </span>
        </div>

        {/* dB scale labels */}
        <div className="flex items-center gap-2">
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

      {/* Latency Control */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Buffer Size</span>
          <span className="text-[9px] text-text-muted/60 ml-1">(samples)</span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {LATENCY_OPTIONS.map((option) => {
            const isSelected = (inputSource.liveChunkSize || 128) === option.value;
            return (
              <button
                key={option.value}
                onClick={() => handleChunkSizeChange(option.value)}
                className={`flex flex-col items-center py-1 px-0.5 rounded text-xs transition-colors ${
                  isSelected
                    ? 'bg-accent text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                }`}
              >
                <span className="font-medium text-[9px] leading-tight">{option.label}</span>
                <span className="text-[8px] opacity-70">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Monitoring Toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleMonitoringToggle}
          disabled={availableInputDevices.length === 0}
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            isLivePaused || !isPlaying
              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
              : 'bg-accent/20 text-accent'
          } ${availableInputDevices.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isLivePaused || !isPlaying ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Start Monitoring</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
              <span>Pause</span>
            </>
          )}
        </button>

        {/* Headphone warning */}
        <div className="flex items-center gap-1.5 text-text-muted" title="Use headphones to avoid feedback">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
          <span className="text-[10px]">Use headphones</span>
        </div>
      </div>
    </div>
  );
});

// Helper function outside component to avoid recreation
function getMeterColor(db: number): string {
  if (db > -1) return 'bg-gradient-to-r from-orange-500 to-red-500';
  if (db > -3) return 'bg-gradient-to-r from-yellow-500 to-orange-500';
  if (db > -6) return 'bg-gradient-to-r from-accent to-yellow-500';
  return 'bg-gradient-to-r from-blue-500 to-blue-400';
}
