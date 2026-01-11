import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { usePreviewStore } from '../../stores/previewStore';
import * as previewApi from '../../api/preview';
import { LevelMeters } from './LevelMeters';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';
import { WaveformDisplay } from './WaveformDisplay';
import { StereoImager } from './StereoImager';

interface OutputSectionProps {
  isOpen: boolean;
  isVisible: boolean; // Whether the section is expanded (not collapsed)
}

export const OutputSection = memo(function OutputSection({ isOpen, isVisible }: OutputSectionProps) {
  // Subscribe only to master volume
  const masterVolume = usePreviewStore((s) => s.masterVolume);

  // Subscribe to clipping state for the clip hold indicator
  const clippingLeft = usePreviewStore((s) => s.metering.clippingLeft);
  const clippingRight = usePreviewStore((s) => s.metering.clippingRight);

  // Get setter via getState to avoid re-renders
  const setMasterVolume = usePreviewStore.getState().setMasterVolume;

  // Local UI state
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [showWaveform, setShowWaveform] = useState(false);
  const [showStereoImager, setShowStereoImager] = useState(false);

  // Refs for animation loop access (to avoid stale closures)
  const showSpectrumRef = useRef(showSpectrum);
  const showWaveformRef = useRef(showWaveform);
  showSpectrumRef.current = showSpectrum;
  showWaveformRef.current = showWaveform;

  // Debounced dB values for smoother display (text only)
  const [displayDb, setDisplayDb] = useState({ left: -60, right: -60 });
  const dbUpdateRef = useRef<{ left: number; right: number }>({ left: -60, right: -60 });

  // Animated spectrum, waveform, and levels for buttery smooth 60fps rendering
  const animatedSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const animatedWaveformRef = useRef<number[]>(new Array(256).fill(0));
  const animatedLevelsRef = useRef({ left: 0, right: 0 });

  // Single state object for all animations - triggers one re-render per frame
  const [animationState, setAnimationState] = useState({
    spectrum: new Array(32).fill(0) as number[],
    waveform: new Array(256).fill(0) as number[],
    levels: { left: 0, right: 0 },
  });

  const rafIdRef = useRef<number | null>(null);

  // Clipping indicator with hold (stays lit for 1 second after clip)
  const [clipHold, setClipHold] = useState({ left: false, right: false });
  const clipTimeoutRef = useRef<{ left: NodeJS.Timeout | null; right: NodeJS.Timeout | null }>({ left: null, right: null });

  // Debounce dB display updates - only update when change is significant
  // Only run when panel is open AND section is expanded
  useEffect(() => {
    if (!isOpen || !isVisible) return;

    const interval = setInterval(() => {
      const metering = usePreviewStore.getState().metering;
      const newLeft = metering.leftDb;
      const newRight = metering.rightDb;
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
  }, [isOpen, isVisible]);

  // Smooth animation loop for spectrum, waveform, and levels at 60fps
  // Only run when panel is open AND section is expanded
  useEffect(() => {
    if (!isOpen || !isVisible) return;

    const smoothingFactor = 0.25; // Lower = smoother but more laggy
    const waveformSmoothing = 0.5; // Faster response for time-domain

    const animate = () => {
      const metering = usePreviewStore.getState().metering;
      const targetLeft = metering.left;
      const targetRight = metering.right;

      // Skip spectrum interpolation when hidden (saves ~32 calculations per frame)
      let spectrumChanged = false;
      if (showSpectrumRef.current) {
        const targetSpectrum = metering.spectrum;
        const currentSpectrum = animatedSpectrumRef.current;
        const numBands = Math.min(currentSpectrum.length, targetSpectrum?.length || 0);
        for (let i = 0; i < numBands; i++) {
          const target = targetSpectrum[i] || 0;
          const current = currentSpectrum[i];
          const diff = target - current;
          if (Math.abs(diff) > 0.0001) {
            currentSpectrum[i] = current + diff * smoothingFactor;
            spectrumChanged = true;
          }
        }
      }

      // Skip waveform interpolation when hidden (saves ~256 calculations per frame)
      let waveformChanged = false;
      if (showWaveformRef.current) {
        const targetWaveform = metering.waveform;
        const currentWaveform = animatedWaveformRef.current;
        const numSamples = Math.min(currentWaveform.length, targetWaveform?.length || 0);
        for (let i = 0; i < numSamples; i++) {
          const target = targetWaveform[i] || 0;
          const current = currentWaveform[i];
          const diff = target - current;
          if (Math.abs(diff) > 0.0001) {
            currentWaveform[i] = current + diff * waveformSmoothing;
            waveformChanged = true;
          }
        }
      }

      // Interpolate output levels (always visible)
      const currentLevels = animatedLevelsRef.current;
      const leftDiff = (targetLeft || 0) - currentLevels.left;
      const rightDiff = (targetRight || 0) - currentLevels.right;
      let levelsChanged = false;
      if (Math.abs(leftDiff) > 0.0001 || Math.abs(rightDiff) > 0.0001) {
        currentLevels.left += leftDiff * smoothingFactor;
        currentLevels.right += rightDiff * smoothingFactor;
        levelsChanged = true;
      }

      // Only update if something changed to avoid unnecessary re-renders
      if (spectrumChanged || waveformChanged || levelsChanged) {
        setAnimationState(prev => ({
          spectrum: spectrumChanged ? [...animatedSpectrumRef.current] : prev.spectrum,
          waveform: waveformChanged ? [...animatedWaveformRef.current] : prev.waveform,
          levels: levelsChanged ? { ...currentLevels } : prev.levels,
        }));
      }

      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isOpen, isVisible]);

  // Handle clipping indicator with hold time - left channel
  useEffect(() => {
    if (clippingLeft) {
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
  }, [clippingLeft]);

  // Handle clipping indicator with hold time - right channel
  useEffect(() => {
    if (clippingRight) {
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
  }, [clippingRight]);

  // Update master volume
  const handleMasterVolumeChange = useCallback(async (volume: number) => {
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
        animatedLevels={animationState.levels}
        displayDb={displayDb}
        clipHold={clipHold}
      />
      <SpectrumAnalyzer
        animatedSpectrum={animationState.spectrum}
        showSpectrum={showSpectrum}
        onToggle={() => setShowSpectrum(!showSpectrum)}
      />
      <WaveformDisplay
        animatedWaveform={animationState.waveform}
        showWaveform={showWaveform}
        onToggle={() => setShowWaveform(!showWaveform)}
      />
      <StereoImager
        showStereoImager={showStereoImager}
        isActive={isOpen && isVisible}
        onToggle={() => setShowStereoImager(!showStereoImager)}
      />
    </div>
  );
});
