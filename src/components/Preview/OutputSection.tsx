import { memo, useState } from 'react';
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

  // Local UI state for waveform and stereo imager toggles
  // Note: LevelMeters and SpectrumAnalyzer manage their own state internally
  const [showWaveform, setShowWaveform] = useState(false);
  const [showStereoImager, setShowStereoImager] = useState(false);

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
        isOpen={isOpen}
        isVisible={isVisible}
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
