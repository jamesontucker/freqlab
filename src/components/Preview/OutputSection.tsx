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

  // Local UI state for spectrum analyzer only (LevelMeters manages its own state now)
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [showPrePost, setShowPrePost] = useState(false);  // Pre/post spectrum comparison toggle
  const [showPeaks, setShowPeaks] = useState(false);  // Peak hold markers on spectrum
  const [showWaveform, setShowWaveform] = useState(false);
  const [showStereoImager, setShowStereoImager] = useState(false);

  // Refs for animation loop access (to avoid stale closures)
  const showSpectrumRef = useRef(showSpectrum);
  showSpectrumRef.current = showSpectrum;
  const showPrePostRef = useRef(showPrePost);
  showPrePostRef.current = showPrePost;
  const showPeaksRef = useRef(showPeaks);
  showPeaksRef.current = showPeaks;

  // Reset spectrum peaks when disabled so stale peaks don't appear when re-enabled
  useEffect(() => {
    if (!showPeaks) {
      peakSpectrumRef.current = new Array(32).fill(0);
    }
  }, [showPeaks]);

  // Animated spectrum for buttery smooth 60fps rendering
  // Note: LevelMeters, WaveformDisplay, and StereoImager handle their own animation internally
  const animatedSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const animatedSpectrumInputRef = useRef<number[]>(new Array(32).fill(0));  // Pre-FX input spectrum
  const peakSpectrumRef = useRef<number[]>(new Array(32).fill(0));  // Peak hold values
  const peakDecayCounterRef = useRef(0);  // Counter for peak decay timing

  // Single state object for spectrum animations - triggers one re-render per frame
  const [spectrumState, setSpectrumState] = useState({
    spectrum: new Array(32).fill(0) as number[],
    spectrumInput: new Array(32).fill(0) as number[],  // Pre-FX input spectrum
    peakSpectrum: new Array(32).fill(0) as number[],  // Peak hold values
  });

  const rafIdRef = useRef<number | null>(null);

  // Smooth animation loop for spectrum at 60fps
  // Only run when panel is open AND section is expanded AND spectrum is visible
  useEffect(() => {
    if (!isOpen || !isVisible || !showSpectrum) return;

    const smoothingFactor = 0.25; // Lower = smoother but more laggy

    const animate = () => {
      const metering = usePreviewStore.getState().metering;

      // Interpolate output spectrum (post-FX)
      let spectrumChanged = false;
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
      let spectrumInputChanged = false;
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

      // Track peaks when peak hold is enabled
      let peaksChanged = false;
      if (showPeaksRef.current) {
        const peaks = peakSpectrumRef.current;

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

      // Only update if something changed to avoid unnecessary re-renders
      if (spectrumChanged || spectrumInputChanged || peaksChanged) {
        setSpectrumState(prev => ({
          spectrum: spectrumChanged ? [...animatedSpectrumRef.current] : prev.spectrum,
          spectrumInput: spectrumInputChanged ? [...animatedSpectrumInputRef.current] : prev.spectrumInput,
          peakSpectrum: peaksChanged ? [...peakSpectrumRef.current] : prev.peakSpectrum,
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
  }, [isOpen, isVisible, showSpectrum]);

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
        isOpen={isOpen}
        isVisible={isVisible}
        hideInput={isInstrument}
      />
      <SpectrumAnalyzer
        animatedSpectrum={spectrumState.spectrum}
        animatedSpectrumInput={spectrumState.spectrumInput}
        peakSpectrum={spectrumState.peakSpectrum}
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
