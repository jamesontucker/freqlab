import { memo, useState, useEffect, useRef } from 'react';
import { usePreviewStore } from '../../stores/previewStore';
import { LevelMeters } from './LevelMeters';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';
import { WaveformDisplay } from './WaveformDisplay';
import { StereoImager } from './StereoImager';

interface OutputSectionProps {
  isOpen: boolean;
  isVisible: boolean; // Whether the section is expanded (not collapsed)
  pluginType: 'effect' | 'instrument'; // Plugin type - instruments don't have audio input
}

export const OutputSection = memo(function OutputSection({ isOpen, isVisible, pluginType }: OutputSectionProps) {
  // Instruments use MIDI input, not audio - hide input meters/analysis
  const isInstrument = pluginType === 'instrument';

  // Subscribe to clipping state for the clip hold indicator
  const clippingLeft = usePreviewStore((s) => s.metering.clippingLeft);
  const clippingRight = usePreviewStore((s) => s.metering.clippingRight);

  // Local UI state
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [showPrePost, setShowPrePost] = useState(false);  // Pre/post spectrum comparison toggle
  const [showPeaks, setShowPeaks] = useState(false);  // Peak hold markers on spectrum
  const [showInputMeters, setShowInputMeters] = useState(false);  // Toggleable input level meters
  const [showOutputMeters, setShowOutputMeters] = useState(true);  // Toggleable output level meters (on by default)
  const [showWaveform, setShowWaveform] = useState(false);
  const [showStereoImager, setShowStereoImager] = useState(false);

  // Refs for animation loop access (to avoid stale closures)
  const showSpectrumRef = useRef(showSpectrum);
  showSpectrumRef.current = showSpectrum;
  const showPrePostRef = useRef(showPrePost);
  showPrePostRef.current = showPrePost;
  const showPeaksRef = useRef(showPeaks);
  showPeaksRef.current = showPeaks;
  const showInputMetersRef = useRef(showInputMeters);
  showInputMetersRef.current = showInputMeters;

  // Reset spectrum peaks when disabled so stale peaks don't appear when re-enabled
  useEffect(() => {
    if (!showPeaks) {
      peakSpectrumRef.current = new Array(32).fill(0);
    }
  }, [showPeaks]);

  // Debounced dB values for smoother display (text only)
  const [displayDb, setDisplayDb] = useState({ left: -60, right: -60 });
  const [displayInputDb, setDisplayInputDb] = useState({ left: -60, right: -60 });
  const dbUpdateRef = useRef<{ left: number; right: number }>({ left: -60, right: -60 });
  const dbInputUpdateRef = useRef<{ left: number; right: number }>({ left: -60, right: -60 });

  // Animated spectrum and levels for buttery smooth 60fps rendering
  // Note: Waveform now handles its own animation internally
  const animatedSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const animatedSpectrumInputRef = useRef<number[]>(new Array(32).fill(0));  // Pre-FX input spectrum
  const peakSpectrumRef = useRef<number[]>(new Array(32).fill(0));  // Peak hold values
  const peakDecayCounterRef = useRef(0);  // Counter for peak decay timing
  const animatedLevelsRef = useRef({ left: 0, right: 0 });
  const animatedInputLevelsRef = useRef({ left: 0, right: 0 });  // Pre-FX input levels

  // Single state object for all animations - triggers one re-render per frame
  const [animationState, setAnimationState] = useState({
    spectrum: new Array(32).fill(0) as number[],
    spectrumInput: new Array(32).fill(0) as number[],  // Pre-FX input spectrum
    peakSpectrum: new Array(32).fill(0) as number[],  // Peak hold values
    levels: { left: 0, right: 0 },
    inputLevels: { left: 0, right: 0 },  // Pre-FX input levels
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

      // Output levels (post-FX)
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

      // Input levels (pre-FX) - only update when input meters visible
      if (showInputMetersRef.current) {
        const newInputLeft = metering.inputLeftDb;
        const newInputRight = metering.inputRightDb;
        const currentInputLeft = dbInputUpdateRef.current.left;
        const currentInputRight = dbInputUpdateRef.current.right;

        const inputLeftDiff = Math.abs(newInputLeft - currentInputLeft);
        const inputRightDiff = Math.abs(newInputRight - currentInputRight);

        if (inputLeftDiff > 1 || inputRightDiff > 1 || newInputLeft < currentInputLeft - 3 || newInputRight < currentInputRight - 3) {
          dbInputUpdateRef.current = { left: newInputLeft, right: newInputRight };
          setDisplayInputDb({ left: newInputLeft, right: newInputRight });
        }
      }
    }, 100); // Update at most 10 times per second

    return () => clearInterval(interval);
  }, [isOpen, isVisible]);

  // Smooth animation loop for spectrum, waveform, and levels at 60fps
  // Only run when panel is open AND section is expanded
  useEffect(() => {
    if (!isOpen || !isVisible) return;

    const smoothingFactor = 0.25; // Lower = smoother but more laggy

    const animate = () => {
      const metering = usePreviewStore.getState().metering;
      const targetLeft = metering.left;
      const targetRight = metering.right;

      // Skip spectrum interpolation when hidden (saves ~32-64 calculations per frame)
      let spectrumChanged = false;
      let spectrumInputChanged = false;
      if (showSpectrumRef.current) {
        // Interpolate output spectrum (post-FX) - always needed when spectrum is visible
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

        // Only interpolate input spectrum when pre/post comparison is active
        // This saves ~32 calculations per frame when not needed
        if (showPrePostRef.current) {
          const targetSpectrumInput = metering.spectrumInput;
          const currentSpectrumInput = animatedSpectrumInputRef.current;
          const numBandsInput = Math.min(currentSpectrumInput.length, targetSpectrumInput?.length || 0);
          for (let i = 0; i < numBandsInput; i++) {
            const target = targetSpectrumInput[i] || 0;
            const current = currentSpectrumInput[i];
            const diff = target - current;
            if (Math.abs(diff) > 0.0001) {
              currentSpectrumInput[i] = current + diff * smoothingFactor;
              spectrumInputChanged = true;
            }
          }
        }
      }

      // Track peaks when peak hold is enabled
      let peaksChanged = false;
      if (showPeaksRef.current && showSpectrumRef.current) {
        const currentSpectrum = animatedSpectrumRef.current;
        const peaks = peakSpectrumRef.current;
        const numBands = currentSpectrum.length;

        // Update peak hold values - capture new peaks, apply slow decay
        for (let i = 0; i < numBands; i++) {
          const currentValue = currentSpectrum[i] || 0;
          const currentPeak = peaks[i] || 0;

          if (currentValue > currentPeak) {
            // New peak detected
            peaks[i] = currentValue;
            peaksChanged = true;
          }
        }

        // Apply decay every ~30 frames (0.5 seconds at 60fps)
        peakDecayCounterRef.current++;
        if (peakDecayCounterRef.current >= 30) {
          peakDecayCounterRef.current = 0;
          const decayFactor = 0.85; // Slow decay
          for (let i = 0; i < numBands; i++) {
            const decayedPeak = peaks[i] * decayFactor;
            if (decayedPeak > 0.001) {
              peaks[i] = decayedPeak;
              peaksChanged = true;
            } else if (peaks[i] > 0) {
              peaks[i] = 0;
              peaksChanged = true;
            }
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

      // Interpolate input levels (only when input meters visible)
      let inputLevelsChanged = false;
      if (showInputMetersRef.current) {
        const targetInputLeft = metering.inputLeft;
        const targetInputRight = metering.inputRight;
        const currentInputLevels = animatedInputLevelsRef.current;
        const inputLeftDiff = (targetInputLeft || 0) - currentInputLevels.left;
        const inputRightDiff = (targetInputRight || 0) - currentInputLevels.right;
        if (Math.abs(inputLeftDiff) > 0.0001 || Math.abs(inputRightDiff) > 0.0001) {
          currentInputLevels.left += inputLeftDiff * smoothingFactor;
          currentInputLevels.right += inputRightDiff * smoothingFactor;
          inputLevelsChanged = true;
        }
      }

      // Only update if something changed to avoid unnecessary re-renders
      if (spectrumChanged || spectrumInputChanged || peaksChanged || levelsChanged || inputLevelsChanged) {
        setAnimationState(prev => ({
          spectrum: spectrumChanged ? [...animatedSpectrumRef.current] : prev.spectrum,
          spectrumInput: spectrumInputChanged ? [...animatedSpectrumInputRef.current] : prev.spectrumInput,
          peakSpectrum: peaksChanged ? [...peakSpectrumRef.current] : prev.peakSpectrum,
          levels: levelsChanged ? { ...currentLevels } : prev.levels,
          inputLevels: inputLevelsChanged ? { ...animatedInputLevelsRef.current } : prev.inputLevels,
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
  // Only clears after 1 second of no new clips, not on every state change
  useEffect(() => {
    if (clippingLeft) {
      setClipHold(prev => ({ ...prev, left: true }));
      // Clear any existing timeout before starting a new one
      if (clipTimeoutRef.current.left) clearTimeout(clipTimeoutRef.current.left);
      clipTimeoutRef.current.left = setTimeout(() => {
        setClipHold(prev => ({ ...prev, left: false }));
        clipTimeoutRef.current.left = null;
      }, 1000);
    }
    // Don't clear timeout in cleanup - let it run to completion
    // Only clear on unmount via the separate cleanup effect below
  }, [clippingLeft]);

  // Handle clipping indicator with hold time - right channel
  useEffect(() => {
    if (clippingRight) {
      setClipHold(prev => ({ ...prev, right: true }));
      // Clear any existing timeout before starting a new one
      if (clipTimeoutRef.current.right) clearTimeout(clipTimeoutRef.current.right);
      clipTimeoutRef.current.right = setTimeout(() => {
        setClipHold(prev => ({ ...prev, right: false }));
        clipTimeoutRef.current.right = null;
      }, 1000);
    }
    // Don't clear timeout in cleanup - let it run to completion
  }, [clippingRight]);

  // Cleanup timeouts on unmount only
  useEffect(() => {
    return () => {
      if (clipTimeoutRef.current.left) clearTimeout(clipTimeoutRef.current.left);
      if (clipTimeoutRef.current.right) clearTimeout(clipTimeoutRef.current.right);
    };
  }, []);

  return (
    <div className="space-y-3 pt-1.5">
      {/* Safety limiter note */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-accent/5 border border-accent/20 rounded text-[10px] text-text-muted">
        <svg className="w-3 h-3 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span>Output is safety-limited to prevent speaker damage — clipping shown here won't harm your audio system.</span>
      </div>
      <LevelMeters
        animatedLevels={animationState.levels}
        animatedInputLevels={animationState.inputLevels}
        displayDb={displayDb}
        displayInputDb={displayInputDb}
        clipHold={clipHold}
        showInputMeters={showInputMeters && !isInstrument}
        showOutputMeters={showOutputMeters}
        onToggleInputMeters={() => setShowInputMeters(!showInputMeters)}
        onToggleOutputMeters={() => setShowOutputMeters(!showOutputMeters)}
        hideInput={isInstrument}
      />
      <SpectrumAnalyzer
        animatedSpectrum={animationState.spectrum}
        animatedSpectrumInput={animationState.spectrumInput}
        peakSpectrum={animationState.peakSpectrum}
        showSpectrum={showSpectrum}
        showPrePost={showPrePost && !isInstrument}
        showPeaks={showPeaks}
        onToggle={() => setShowSpectrum(!showSpectrum)}
        onTogglePrePost={() => setShowPrePost(!showPrePost)}
        onTogglePeaks={() => setShowPeaks(!showPeaks)}
        hideInput={isInstrument}
      />
      <WaveformDisplay
        showWaveform={showWaveform}
        isActive={isOpen && isVisible}
        onToggle={() => setShowWaveform(!showWaveform)}
        hideInput={isInstrument}
      />
      <StereoImager
        showStereoImager={showStereoImager}
        isActive={isOpen && isVisible}
        onToggle={() => setShowStereoImager(!showStereoImager)}
        hideInput={isInstrument}
      />
    </div>
  );
});
