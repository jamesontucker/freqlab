import { memo } from 'react';

interface SpectrumAnalyzerProps {
  animatedSpectrum: number[];
  showSpectrum: boolean;
  onToggle: () => void;
}

export const SpectrumAnalyzer = memo(function SpectrumAnalyzer({
  animatedSpectrum,
  showSpectrum,
  onToggle,
}: SpectrumAnalyzerProps) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h2v8H3v-8zm6-5h2v13H9V8zm6-5h2v18h-2V3zm6 9h2v6h-2v-6z" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Spectrum</span>
        </div>
        <button
          onClick={onToggle}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            showSpectrum
              ? 'bg-accent/20 text-accent'
              : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
          }`}
        >
          {showSpectrum ? 'On' : 'Off'}
        </button>
      </div>
      {showSpectrum && (
        <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
          {/* Smooth curve spectrum like FabFilter Pro-Q */}
          <svg
            viewBox="0 0 400 100"
            className="w-full h-28"
            preserveAspectRatio="none"
          >
            {/* Grid lines */}
            <defs>
              {/* Using accent color #2DA86E directly since CSS vars don't work in SVG */}
              <linearGradient id="spectrumGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.7" />
                <stop offset="50%" stopColor="#2DA86E" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.05" />
              </linearGradient>
              <linearGradient id="spectrumStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#36C07E" stopOpacity="1" />
                <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.7" />
              </linearGradient>
            </defs>
            {/* Horizontal grid lines for dB */}
            <line x1="0" y1="16.67" x2="400" y2="16.67" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            <line x1="0" y1="50" x2="400" y2="50" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            <line x1="0" y1="83.33" x2="400" y2="83.33" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            {/* Vertical grid lines for frequencies */}
            <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            <line x1="125" y1="0" x2="125" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            <line x1="225" y1="0" x2="225" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
            <line x1="325" y1="0" x2="325" y2="100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />

            {/* Spectrum curve - smooth bezier path */}
            {renderSpectrumCurve(animatedSpectrum)}
          </svg>
          {/* Frequency labels */}
          <div className="flex justify-between px-2 py-1 border-t border-border/50 bg-bg-primary/30">
            <span className="text-[9px] text-text-muted">20Hz</span>
            <span className="text-[9px] text-text-muted">100</span>
            <span className="text-[9px] text-text-muted">1k</span>
            <span className="text-[9px] text-text-muted">10k</span>
            <span className="text-[9px] text-text-muted">20k</span>
          </div>
        </div>
      )}
    </div>
  );
});

function renderSpectrumCurve(animatedSpectrum: number[]) {
  // Safety check for empty or too-small spectrum
  if (!animatedSpectrum || animatedSpectrum.length < 2) {
    return null;
  }

  const numBands = animatedSpectrum.length;
  const width = 400;
  const height = 100;

  // Convert magnitudes to Y positions (using animated values for smooth 60fps)
  const points = animatedSpectrum.map((mag, i) => {
    // Handle edge cases: NaN, undefined, negative
    const safeMag = (typeof mag === 'number' && !isNaN(mag) && mag > 0) ? mag : 0;
    const db = safeMag > 0 ? 20 * Math.log10(safeMag) : -60;
    const normalizedDb = Math.max(0, Math.min(1, (db + 60) / 60));
    const x = (i / (numBands - 1)) * width;
    const y = height - (normalizedDb * height);
    return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? height : y };
  });

  // Create smooth bezier curve path
  let pathD = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to Bezier conversion
    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  // Create filled area path
  const areaD = pathD + ` L ${width} ${height} L 0 ${height} Z`;

  return (
    <>
      {/* Filled area under curve */}
      <path
        d={areaD}
        fill="url(#spectrumGradient)"
      />
      {/* Curve line */}
      <path
        d={pathD}
        fill="none"
        stroke="url(#spectrumStroke)"
        strokeWidth="1.5"
      />
    </>
  );
}
