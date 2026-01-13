import { memo, useState, useEffect, useRef } from 'react';
import { usePreviewStore } from '../../stores/previewStore';

interface SpectrumAnalyzerProps {
  isOpen: boolean;
  isVisible: boolean;
  hideInput?: boolean;                // Hide input-related features (for instruments)
}

// Spectrum tilt/slope options (dB per octave)
// Tilt compensates for the natural roll-off of audio, tilting around 1kHz reference
// - 0: Flat/accurate - white noise appears flat, shows true magnitude
// - 3: Pink noise reference - pink noise appears flat, classic mixing standard
// - 4.5: Human perception (Pro-Q/SPAN default) - modern music appears balanced
// - 6: Steep tilt - for sawtooth/synth analysis
type TiltOption = 0 | 3 | 4.5 | 6;

const TILT_OPTIONS: { value: TiltOption; label: string; description: string }[] = [
  { value: 0, label: 'Flat', description: 'Accurate magnitude (0 dB/oct)' },
  { value: 3, label: 'Pink', description: 'Pink noise flat (3 dB/oct)' },
  { value: 4.5, label: 'Default', description: 'Pro-Q style (4.5 dB/oct)' },
  { value: 6, label: 'Steep', description: 'Maximum tilt (6 dB/oct)' },
];

// Reference frequency for tilt calculation (1kHz is standard)
const TILT_REFERENCE_FREQ = 1000;

// Vertical range options for spectrum display
// Each range has: total dB range, max dB (top), min dB (bottom), and label positions
// Calculated to place 0dB at ~32% from top (68% from bottom) to match Pro-Q style
// Formula: dbMax = 0.32 × range, dbMin = -0.68 × range
type RangeOption = 6 | 12 | 30 | 60 | 90 | 120;

interface RangeConfig {
  value: RangeOption;
  label: string;
  dbMax: number;
  dbMin: number;
  dbLabels: number[];
}

const RANGE_OPTIONS: RangeConfig[] = [
  { value: 6, label: '6dB', dbMax: 2, dbMin: -4, dbLabels: [0, -3] },
  { value: 12, label: '12dB', dbMax: 4, dbMin: -8, dbLabels: [3, 0, -3, -6] },
  { value: 30, label: '30dB', dbMax: 10, dbMin: -20, dbLabels: [6, 0, -6, -12, -18] },
  { value: 60, label: '60dB', dbMax: 20, dbMin: -40, dbLabels: [18, 12, 6, 0, -12, -24, -36] },
  { value: 90, label: '90dB', dbMax: 30, dbMin: -60, dbLabels: [24, 12, 0, -18, -36, -54] },
  { value: 120, label: '120dB', dbMax: 40, dbMin: -80, dbLabels: [36, 18, 0, -24, -48, -72] },
];

// SVG dimensions - spectrum area plus margins for labels
const SPECTRUM_WIDTH = 370;   // Width of actual spectrum display
const SPECTRUM_HEIGHT = 120;  // Height of actual spectrum display
const LEFT_MARGIN = 0;        // Space for left labels (none needed)
const RIGHT_MARGIN = 30;      // Space for dB labels on right
const TOP_MARGIN = 8;         // Space for top dB label padding
const BOTTOM_MARGIN = 14;     // Space for frequency labels at bottom
const SVG_WIDTH = LEFT_MARGIN + SPECTRUM_WIDTH + RIGHT_MARGIN;
const SVG_HEIGHT = TOP_MARGIN + SPECTRUM_HEIGHT + BOTTOM_MARGIN;

// Frequency labels with mathematically accurate logarithmic positions
// Formula: pos = ln(freq/10) / ln(20000/10) = ln(freq/10) / ln(2000)
// The spectrum backend uses the same log spacing for 32 bands from 10Hz-20kHz
const FREQ_LABELS = [
  { freq: '10', pos: 0 },
  { freq: '20', pos: 9.1 },
  { freq: '50', pos: 21.2 },
  { freq: '100', pos: 30.3 },
  { freq: '200', pos: 39.4 },
  { freq: '500', pos: 51.5 },
  { freq: '1k', pos: 60.6 },
  { freq: '2k', pos: 69.7 },
  { freq: '5k', pos: 81.8 },
  { freq: '10k', pos: 90.9 },
  { freq: '20k', pos: 100 },
];

export const SpectrumAnalyzer = memo(function SpectrumAnalyzer({
  isOpen,
  isVisible,
  hideInput = false,
}: SpectrumAnalyzerProps) {
  // Local UI toggle state
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [showPrePost, setShowPrePost] = useState(false);
  const [showPeaks, setShowPeaks] = useState(false);

  // Tilt/slope setting for spectrum display (default to 4.5 dB/oct like Pro-Q)
  const [tilt, setTilt] = useState<TiltOption>(4.5);
  const [showTiltMenu, setShowTiltMenu] = useState(false);

  // Vertical range setting (default to 60dB)
  const [range, setRange] = useState<RangeOption>(60);
  const [showRangeMenu, setShowRangeMenu] = useState(false);

  // Animation state
  const [spectrumState, setSpectrumState] = useState({
    spectrum: new Array(32).fill(0) as number[],
    spectrumInput: new Array(32).fill(0) as number[],
    peakSpectrum: new Array(32).fill(0) as number[],
  });

  // Refs for animation loop
  const rafIdRef = useRef<number | null>(null);
  const animatedSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const animatedSpectrumInputRef = useRef<number[]>(new Array(32).fill(0));
  const peakSpectrumRef = useRef<number[]>(new Array(32).fill(0));
  const peakDecayCounterRef = useRef(0);
  const showPrePostRef = useRef(showPrePost);
  showPrePostRef.current = showPrePost;
  const showPeaksRef = useRef(showPeaks);
  showPeaksRef.current = showPeaks;

  // Reset spectrum peaks when disabled
  useEffect(() => {
    if (!showPeaks) {
      peakSpectrumRef.current = new Array(32).fill(0);
    }
  }, [showPeaks]);

  // Animation loop - runs at 60fps when visible and spectrum is on
  useEffect(() => {
    if (!isOpen || !isVisible || !showSpectrum) return;

    const smoothingFactor = 0.25;

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

        // Update peak hold values - capture new peaks
        for (let i = 0; i < numBands; i++) {
          const currentValue = currentSpectrum[i] || 0;
          const currentPeak = peaks[i] || 0;

          if (currentValue > currentPeak) {
            peaks[i] = currentValue;
            peaksChanged = true;
          }
        }

        // Apply decay every ~30 frames (0.5 seconds at 60fps)
        peakDecayCounterRef.current++;
        if (peakDecayCounterRef.current >= 30) {
          peakDecayCounterRef.current = 0;
          const decayFactor = 0.85;
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

      // Only update if something changed
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

  const currentTiltOption = TILT_OPTIONS.find(o => o.value === tilt) || TILT_OPTIONS[2];
  const currentRangeConfig = RANGE_OPTIONS.find(o => o.value === range) || RANGE_OPTIONS[3];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h2v8H3v-8zm6-5h2v13H9V8zm6-5h2v18h-2V3zm6 9h2v6h-2v-6z" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Spectrum</span>
        </div>
        <div className="flex items-center gap-1.5">
          {showSpectrum && (
            <>
              {/* Range/Zoom dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowRangeMenu(!showRangeMenu)}
                  onBlur={() => setTimeout(() => setShowRangeMenu(false), 150)}
                  className="text-xs px-2 py-0.5 rounded transition-colors bg-bg-tertiary text-text-muted hover:text-text-primary flex items-center gap-1"
                  title="Vertical range (zoom)"
                >
                  <span>{currentRangeConfig.label}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showRangeMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg z-10 py-1 min-w-[80px]">
                    {RANGE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setRange(option.value);
                          setShowRangeMenu(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                          range === option.value
                            ? 'bg-accent/20 text-accent'
                            : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Tilt/Slope dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowTiltMenu(!showTiltMenu)}
                  onBlur={() => setTimeout(() => setShowTiltMenu(false), 150)}
                  className="text-xs px-2 py-0.5 rounded transition-colors bg-bg-tertiary text-text-muted hover:text-text-primary flex items-center gap-1"
                  title={currentTiltOption.description}
                >
                  <span>{currentTiltOption.label}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTiltMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
                    {TILT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setTilt(option.value);
                          setShowTiltMenu(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                          tilt === option.value
                            ? 'bg-accent/20 text-accent'
                            : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                        }`}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="text-[10px] text-text-muted">{option.description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Peak hold toggle */}
              <button
                onClick={() => setShowPeaks(!showPeaks)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  showPeaks
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                title="Show peak hold markers"
              >
                Peaks
              </button>
              {!hideInput && (
                <button
                  onClick={() => setShowPrePost(!showPrePost)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${
                    showPrePost
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                  }`}
                  title="Show pre/post FX comparison"
                >
                  Pre/Post
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setShowSpectrum(!showSpectrum)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              showSpectrum
                ? 'bg-accent/20 text-accent'
                : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
            }`}
          >
            {showSpectrum ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      {showSpectrum && (
        <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className="w-full"
            style={{ height: '156px' }}
            preserveAspectRatio="none"
          >
            <defs>
              {/* Output spectrum gradient (green - post-FX) */}
              <linearGradient id="spectrumGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2DA86E" stopOpacity="0.7" />
                <stop offset="50%" stopColor="#2DA86E" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.05" />
              </linearGradient>
              <linearGradient id="spectrumStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#36C07E" stopOpacity="1" />
                <stop offset="100%" stopColor="#2DA86E" stopOpacity="0.7" />
              </linearGradient>
              {/* Input spectrum gradient (blue/purple - pre-FX) */}
              <linearGradient id="spectrumInputGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                <stop offset="50%" stopColor="#6366f1" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="spectrumInputStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.5" />
              </linearGradient>

              {/* Clip path to contain spectrum within the chart area */}
              <clipPath id="spectrumClip">
                <rect x={LEFT_MARGIN} y={TOP_MARGIN} width={SPECTRUM_WIDTH} height={SPECTRUM_HEIGHT} />
              </clipPath>
            </defs>

            {/* Horizontal grid lines at each dB level */}
            {currentRangeConfig.dbLabels.map((db) => {
              const y = dbToY(db, currentRangeConfig);
              // 0dB line is more prominent (reference level)
              const is0dB = db === 0;
              return (
                <line
                  key={db}
                  x1={LEFT_MARGIN}
                  y1={y}
                  x2={LEFT_MARGIN + SPECTRUM_WIDTH}
                  y2={y}
                  stroke={is0dB ? "#f59e0b" : "currentColor"}
                  strokeOpacity={is0dB ? "0.5" : "0.08"}
                  strokeWidth={is0dB ? "1.5" : "0.5"}
                />
              );
            })}

            {/* Vertical grid lines at frequency positions */}
            {FREQ_LABELS.filter(f => f.pos > 0 && f.pos < 100).map(({ freq, pos }) => {
              const x = LEFT_MARGIN + (pos / 100) * SPECTRUM_WIDTH;
              return (
                <line
                  key={freq}
                  x1={x}
                  y1={TOP_MARGIN}
                  x2={x}
                  y2={TOP_MARGIN + SPECTRUM_HEIGHT}
                  stroke="currentColor"
                  strokeOpacity="0.06"
                  strokeWidth="0.5"
                />
              );
            })}

            {/* Spectrum curves clipped to chart area */}
            <g clipPath="url(#spectrumClip)">
              {/* Input spectrum curve (pre-FX) - rendered behind output */}
              {showPrePost && renderSpectrumCurve(spectrumState.spectrumInput, 'input', tilt, currentRangeConfig)}

              {/* Output spectrum curve (post-FX) - rendered on top */}
              {renderSpectrumCurve(spectrumState.spectrum, 'output', tilt, currentRangeConfig)}

              {/* Peak hold markers */}
              {showPeaks && renderPeakMarkers(spectrumState.peakSpectrum, tilt, currentRangeConfig)}
            </g>

            {/* Right border of spectrum area */}
            <line
              x1={LEFT_MARGIN + SPECTRUM_WIDTH}
              y1={TOP_MARGIN}
              x2={LEFT_MARGIN + SPECTRUM_WIDTH}
              y2={TOP_MARGIN + SPECTRUM_HEIGHT}
              stroke="currentColor"
              strokeOpacity="0.1"
              strokeWidth="0.5"
            />

            {/* Bottom border line for chart area */}
            <line
              x1={LEFT_MARGIN}
              y1={TOP_MARGIN + SPECTRUM_HEIGHT}
              x2={LEFT_MARGIN + SPECTRUM_WIDTH}
              y2={TOP_MARGIN + SPECTRUM_HEIGHT}
              stroke="currentColor"
              strokeOpacity="0.15"
              strokeWidth="0.5"
            />

            {/* dB labels on right side - positioned to align with grid lines */}
            {currentRangeConfig.dbLabels.map((db) => {
              const y = dbToY(db, currentRangeConfig);
              return (
                <text
                  key={db}
                  x={LEFT_MARGIN + SPECTRUM_WIDTH + 4}
                  y={y + 3} // +3 for vertical centering of text
                  textAnchor="start"
                  className="fill-current text-text-muted"
                  style={{ fontSize: '8px' }}
                >
                  {db}
                </text>
              );
            })}

            {/* Frequency labels at bottom - positioned to align with grid lines */}
            {FREQ_LABELS.map(({ freq, pos }) => {
              const x = LEFT_MARGIN + (pos / 100) * SPECTRUM_WIDTH;
              const textAnchor = pos === 0 ? 'start' : pos === 100 ? 'end' : 'middle';
              const xOffset = pos === 0 ? 2 : pos === 100 ? -2 : 0;
              return (
                <text
                  key={freq}
                  x={x + xOffset}
                  y={TOP_MARGIN + SPECTRUM_HEIGHT + 10}
                  textAnchor={textAnchor}
                  className="fill-current text-text-muted"
                  style={{ fontSize: '8px' }}
                >
                  {freq}
                </text>
              );
            })}

            {/* Pre/Post legend (if active) - positioned at top-left to avoid Hz labels */}
            {showPrePost && (
              <g>
                <rect x={LEFT_MARGIN + 4} y={TOP_MARGIN + 4} width="60" height="14" rx="3" fill="rgba(26, 26, 30, 0.8)" />
                <circle cx={LEFT_MARGIN + 12} cy={TOP_MARGIN + 11} r="3" fill="#818cf8" fillOpacity="0.7" />
                <text x={LEFT_MARGIN + 18} y={TOP_MARGIN + 14} className="fill-current text-text-muted" style={{ fontSize: '8px' }}>Pre</text>
                <circle cx={LEFT_MARGIN + 42} cy={TOP_MARGIN + 11} r="3" className="fill-accent" />
                <text x={LEFT_MARGIN + 48} y={TOP_MARGIN + 14} className="fill-current text-text-muted" style={{ fontSize: '8px' }}>Post</text>
              </g>
            )}
          </svg>
        </div>
      )}
    </div>
  );
});

// Convert dB value to Y coordinate (dbMax = top, dbMin = bottom)
// Uses SPECTRUM_HEIGHT for accurate positioning within the spectrum area
// Accounts for TOP_MARGIN offset
function dbToY(db: number, rangeConfig: RangeConfig): number {
  const dbRange = rangeConfig.dbMax - rangeConfig.dbMin;
  // Normalize: dbMax maps to 1.0 (top), dbMin maps to 0.0 (bottom)
  const normalized = (db - rangeConfig.dbMin) / dbRange;
  return TOP_MARGIN + SPECTRUM_HEIGHT - (normalized * SPECTRUM_HEIGHT);
}

type SpectrumType = 'input' | 'output';

// Calculate frequency for a given band index (logarithmically spaced from 10Hz to 20kHz)
// This matches the backend's band_frequencies calculation
function getBandFrequency(bandIndex: number, numBands: number): number {
  const minFreq = 10;
  const maxFreq = 20000;
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const t = bandIndex / (numBands - 1);
  return Math.exp(logMin + t * (logMax - logMin));
}

// Calculate tilt compensation in dB for a given frequency
// Tilt is applied relative to the reference frequency (1kHz)
// Formula: tiltDb = slope * log2(freq / refFreq)
function getTiltCompensation(freq: number, slopeDbPerOctave: number): number {
  if (slopeDbPerOctave === 0) return 0;
  const octavesFromRef = Math.log2(freq / TILT_REFERENCE_FREQ);
  return slopeDbPerOctave * octavesFromRef;
}

// Renders spectrum curve within the spectrum area
// The curve uses the same coordinate system as the grid (LEFT_MARGIN offset, SPECTRUM_WIDTH, SPECTRUM_HEIGHT)
// Accounts for TOP_MARGIN offset
function renderSpectrumCurve(animatedSpectrum: number[], type: SpectrumType, tilt: TiltOption, rangeConfig: RangeConfig) {
  // Safety check for empty or too-small spectrum
  if (!animatedSpectrum || animatedSpectrum.length < 2) {
    return null;
  }

  const numBands = animatedSpectrum.length;
  const dbRange = rangeConfig.dbMax - rangeConfig.dbMin;

  // Convert magnitudes to Y positions (using animated values for smooth 60fps)
  // X positions are within the spectrum area (LEFT_MARGIN to LEFT_MARGIN + SPECTRUM_WIDTH)
  const points = animatedSpectrum.map((mag, i) => {
    // Handle edge cases: NaN, undefined, negative
    const safeMag = (typeof mag === 'number' && !isNaN(mag) && mag > 0) ? mag : 0;
    // Convert linear magnitude to dB (can go above 0dB for clipping)
    let db = safeMag > 0 ? 20 * Math.log10(safeMag) : rangeConfig.dbMin;

    // Apply tilt compensation based on frequency
    // This tilts the spectrum around 1kHz by the specified dB/octave
    // Higher frequencies get boosted, lower frequencies get cut
    const freq = getBandFrequency(i, numBands);
    db += getTiltCompensation(freq, tilt);

    // Normalize dB to 0-1 range for Y positioning
    // dbMax maps to 1.0 (top), dbMin maps to 0.0 (bottom)
    const normalizedDb = Math.max(0, Math.min(1, (db - rangeConfig.dbMin) / dbRange));
    // X position: map band index to spectrum width
    const x = LEFT_MARGIN + (i / (numBands - 1)) * SPECTRUM_WIDTH;
    // Y position: dbMax at top (y=TOP_MARGIN), dbMin at bottom (y=TOP_MARGIN+SPECTRUM_HEIGHT)
    const y = TOP_MARGIN + SPECTRUM_HEIGHT - (normalizedDb * SPECTRUM_HEIGHT);
    return { x: isNaN(x) ? LEFT_MARGIN : x, y: isNaN(y) ? TOP_MARGIN + SPECTRUM_HEIGHT : y };
  });

  // Create smooth bezier curve path using Catmull-Rom spline
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

  // Create filled area path (close at bottom of spectrum area)
  const areaD = pathD + ` L ${LEFT_MARGIN + SPECTRUM_WIDTH} ${TOP_MARGIN + SPECTRUM_HEIGHT} L ${LEFT_MARGIN} ${TOP_MARGIN + SPECTRUM_HEIGHT} Z`;

  // Use different gradients based on type
  const fillGradient = type === 'input' ? 'url(#spectrumInputGradient)' : 'url(#spectrumGradient)';
  const strokeGradient = type === 'input' ? 'url(#spectrumInputStroke)' : 'url(#spectrumStroke)';
  const strokeWidth = type === 'input' ? '1' : '1.5';

  return (
    <>
      {/* Filled area under curve */}
      <path
        d={areaD}
        fill={fillGradient}
      />
      {/* Curve line */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeGradient}
        strokeWidth={strokeWidth}
      />
    </>
  );
}

// Renders peak hold markers as small horizontal lines at each band's peak
function renderPeakMarkers(peakSpectrum: number[], tilt: TiltOption, rangeConfig: RangeConfig) {
  if (!peakSpectrum || peakSpectrum.length < 2) {
    return null;
  }

  const numBands = peakSpectrum.length;
  const dbRange = rangeConfig.dbMax - rangeConfig.dbMin;

  // Convert peak magnitudes to positions
  const markers = peakSpectrum.map((mag, i) => {
    const safeMag = (typeof mag === 'number' && !isNaN(mag) && mag > 0) ? mag : 0;
    if (safeMag < 0.001) return null; // Skip very low peaks

    // Convert linear magnitude to dB
    let db = safeMag > 0 ? 20 * Math.log10(safeMag) : rangeConfig.dbMin;

    // Apply tilt compensation
    const freq = getBandFrequency(i, numBands);
    db += getTiltCompensation(freq, tilt);

    // Skip if below visible range
    if (db < rangeConfig.dbMin) return null;

    // Normalize dB to Y position
    const normalizedDb = Math.max(0, Math.min(1, (db - rangeConfig.dbMin) / dbRange));
    const x = LEFT_MARGIN + (i / (numBands - 1)) * SPECTRUM_WIDTH;
    const y = TOP_MARGIN + SPECTRUM_HEIGHT - (normalizedDb * SPECTRUM_HEIGHT);

    // Calculate marker width (wider for bands with more frequency range)
    const bandWidth = SPECTRUM_WIDTH / (numBands - 1);
    const markerWidth = Math.max(4, bandWidth * 0.6);

    return { x, y, markerWidth };
  }).filter(Boolean);

  return (
    <g>
      {markers.map((marker, i) => marker && (
        <line
          key={i}
          x1={marker.x - marker.markerWidth / 2}
          y1={marker.y}
          x2={marker.x + marker.markerWidth / 2}
          y2={marker.y}
          stroke="#fbbf24"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.8"
        />
      ))}
    </g>
  );
}
