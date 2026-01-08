import { memo } from 'react';

interface WaveformDisplayProps {
  animatedWaveform: number[];
  showWaveform: boolean;
  onToggle: () => void;
}

export const WaveformDisplay = memo(function WaveformDisplay({
  animatedWaveform,
  showWaveform,
  onToggle,
}: WaveformDisplayProps) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h2l3-9 4 18 4-12 3 6h4" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Waveform</span>
        </div>
        <button
          onClick={onToggle}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            showWaveform
              ? 'bg-accent/20 text-accent'
              : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
          }`}
        >
          {showWaveform ? 'On' : 'Off'}
        </button>
      </div>
      {showWaveform && (
        <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
          {/* Time-domain waveform display */}
          <svg
            viewBox="0 0 400 100"
            className="w-full h-28"
            preserveAspectRatio="none"
          >
            {/* Grid lines */}
            <defs>
              <linearGradient id="waveformGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.3" />
                <stop offset="50%" stopColor="#2DA86E" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="waveformStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.7" />
                <stop offset="50%" stopColor="#36C07E" stopOpacity="1" />
                <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.7" />
              </linearGradient>
            </defs>
            {/* Center line (0 amplitude) */}
            <line x1="0" y1="50" x2="400" y2="50" stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5" />
            {/* Amplitude grid lines (+/-0.5) */}
            <line x1="0" y1="25" x2="400" y2="25" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            <line x1="0" y1="75" x2="400" y2="75" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            {/* Clipping threshold lines */}
            <line x1="0" y1="5" x2="400" y2="5" stroke="#ef4444" strokeOpacity="0.2" strokeWidth="0.5" />
            <line x1="0" y1="95" x2="400" y2="95" stroke="#ef4444" strokeOpacity="0.2" strokeWidth="0.5" />

            {/* Waveform path */}
            {renderWaveformPath(animatedWaveform)}
          </svg>
          {/* Amplitude labels */}
          <div className="flex justify-between px-2 py-1 border-t border-border/50 bg-bg-primary/30">
            <span className="text-[9px] text-text-muted">Time →</span>
            <span className="text-[9px] text-text-muted">-1.0 to +1.0</span>
          </div>
        </div>
      )}
    </div>
  );
});

function renderWaveformPath(animatedWaveform: number[]) {
  if (!animatedWaveform || animatedWaveform.length < 2) {
    return null;
  }

  const numSamples = animatedWaveform.length;
  const width = 400;

  // Convert samples to Y positions (samples are -1 to 1, center is 0.5)
  const points = animatedWaveform.map((sample, i) => {
    const safeSample = (typeof sample === 'number' && !isNaN(sample)) ? sample : 0;
    // Clamp to -1, 1 and convert to y position (center = 50)
    const clampedSample = Math.max(-1, Math.min(1, safeSample));
    const x = (i / (numSamples - 1)) * width;
    const y = 50 - (clampedSample * 45); // 45 gives a bit of padding from edges
    return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? 50 : y };
  });

  // Create polyline path (faster than bezier for waveform)
  const pathD = `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')}`;

  // Create filled area (from center line)
  const areaD = `M 0 50 L ${points.map(p => `${p.x} ${p.y}`).join(' L ')} L ${width} 50 Z`;

  return (
    <>
      {/* Filled area */}
      <path
        d={areaD}
        fill="url(#waveformGradient)"
      />
      {/* Waveform line */}
      <path
        d={pathD}
        fill="none"
        stroke="url(#waveformStroke)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </>
  );
}
