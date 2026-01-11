import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { usePreviewStore } from '../../stores/previewStore';

type DisplayMode = 'waveform' | 'lissajous';
type TimeScale = '1ms' | '5ms' | '10ms' | '25ms' | '50ms' | '85ms';
type ChannelMode = 'L/R' | 'L' | 'R' | 'M';

interface WaveformDisplayProps {
  /** Whether the waveform display is enabled */
  showWaveform: boolean;
  /** Whether the parent section is active (panel open and section visible) */
  isActive: boolean;
  /** Toggle visibility */
  onToggle: () => void;
  /** Hide input-related features (for instruments) */
  hideInput?: boolean;
}

// Time scale to sample count mapping (at 48kHz)
// Backend buffer is 4096 samples = ~85ms
const TIME_SCALE_SAMPLES: Record<TimeScale, number> = {
  '1ms': 48,
  '5ms': 240,
  '10ms': 480,
  '25ms': 1200,
  '50ms': 2400,
  '85ms': 4096, // Full buffer
};

// Reusable buffers for mono channel mixing to avoid allocating new arrays every frame
// These are module-level to persist across renders and avoid GC pressure at 60fps
let monoBuffer: number[] = new Array(4096).fill(0);
let monoInputBuffer: number[] = new Array(4096).fill(0);

/**
 * Advanced waveform display with stereo overlay, triggered mode, zoom, peaks, and Lissajous.
 *
 * Features:
 * - Stereo L/R overlay with different colors
 * - Triggered/sync mode for stable waveform viewing
 * - Time scale controls (zoom)
 * - Peak hold markers
 * - Lissajous X/Y mode
 */
export const WaveformDisplay = memo(function WaveformDisplay({
  showWaveform,
  isActive,
  onToggle,
  hideInput = false,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);  // Flag to prevent orphaned animation frames

  // Local state for waveform options
  const [displayMode, setDisplayMode] = useState<DisplayMode>('waveform');
  const [timeScale, setTimeScale] = useState<TimeScale>('25ms');
  const [triggered, setTriggered] = useState(true);
  const [channelMode, setChannelMode] = useState<ChannelMode>('L/R');
  const [showPrePost, setShowPrePost] = useState(false);  // Pre/post FX comparison toggle

  // Reset showPrePost when hideInput becomes true (instruments don't have audio input)
  useEffect(() => {
    if (hideInput) {
      setShowPrePost(false);
    }
  }, [hideInput]);

  // Peak hold values (refs for animation loop, state for display)
  const peakLeftRef = useRef(0);
  const peakRightRef = useRef(0);
  const peakDecayRef = useRef(0);
  const [displayPeaks, setDisplayPeaks] = useState({ left: 0, right: 0 });
  const peakDisplayUpdateRef = useRef(0); // Counter for throttled display updates

  // Trigger position history for stability
  const lastTriggerPosRef = useRef(0);

  // Ref for animation loop access (to avoid stale closures)
  const showPrePostRef = useRef(showPrePost);
  showPrePostRef.current = showPrePost;

  // Draw function - reads directly from store to avoid re-renders
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Get device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Set canvas size accounting for device pixel ratio
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const width = rect.width;
    const height = rect.height;

    // Clear background
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(0, 0, width, height);

    // Read current waveform data from store
    const metering = usePreviewStore.getState().metering;
    // Output waveform (post-FX)
    const waveformLeft = metering.waveformLeft || [];
    const waveformRight = metering.waveformRight || [];
    const waveformPeakLeft = metering.waveformPeakLeft || 0;
    const waveformPeakRight = metering.waveformPeakRight || 0;
    // Input waveform (pre-FX) for comparison
    const waveformInputLeft = metering.waveformInputLeft || [];
    const waveformInputRight = metering.waveformInputRight || [];

    // Update peak hold (decay slowly)
    peakDecayRef.current += 1;
    if (peakDecayRef.current >= 30) { // Decay every half second at 60fps
      peakDecayRef.current = 0;
      peakLeftRef.current = Math.max(peakLeftRef.current * 0.95, waveformPeakLeft);
      peakRightRef.current = Math.max(peakRightRef.current * 0.95, waveformPeakRight);
    }
    peakLeftRef.current = Math.max(peakLeftRef.current, waveformPeakLeft);
    peakRightRef.current = Math.max(peakRightRef.current, waveformPeakRight);

    // Update display state for legend (throttled to 10fps to avoid re-render spam)
    peakDisplayUpdateRef.current += 1;
    if (peakDisplayUpdateRef.current >= 6) {
      peakDisplayUpdateRef.current = 0;
      setDisplayPeaks({ left: peakLeftRef.current, right: peakRightRef.current });
    }

    if (displayMode === 'lissajous') {
      drawLissajous(
        ctx,
        waveformLeft,
        waveformRight,
        width,
        height,
        showPrePostRef.current,
        waveformInputLeft,
        waveformInputRight
      );
    } else {
      drawWaveform(
        ctx,
        waveformLeft,
        waveformRight,
        width,
        height,
        triggered,
        channelMode,
        TIME_SCALE_SAMPLES[timeScale],
        lastTriggerPosRef,
        peakLeftRef.current,
        peakRightRef.current,
        showPrePostRef.current,
        waveformInputLeft,
        waveformInputRight
      );
    }

    // Continue animation only if still animating (prevents orphaned frames after cleanup)
    if (isAnimatingRef.current) {
      animationRef.current = requestAnimationFrame(draw);
    }
  }, [displayMode, timeScale, triggered, channelMode]);

  // Start/stop animation when visibility changes
  useEffect(() => {
    const shouldAnimate = showWaveform && isActive;

    if (shouldAnimate) {
      // Set flag BEFORE starting animation
      isAnimatingRef.current = true;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = requestAnimationFrame(draw);
    } else {
      // Clear flag BEFORE canceling to prevent race condition
      isAnimatingRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }

    return () => {
      // Clear flag BEFORE canceling to prevent race condition
      isAnimatingRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [showWaveform, isActive, draw]);

  // Time scale options for the dropdown
  const timeScaleOptions: TimeScale[] = ['1ms', '5ms', '10ms', '25ms', '50ms', '85ms'];

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
          {/* Controls bar */}
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/50 bg-bg-primary/30">
            {/* Mode toggle */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDisplayMode('waveform')}
                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                  displayMode === 'waveform'
                    ? 'bg-accent/30 text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Wave
              </button>
              <button
                onClick={() => setDisplayMode('lissajous')}
                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                  displayMode === 'lissajous'
                    ? 'bg-accent/30 text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                X/Y
              </button>
            </div>

            {/* Waveform-specific controls */}
            {displayMode === 'waveform' && (
              <div className="flex items-center gap-2">
                {/* Time scale */}
                <select
                  value={timeScale}
                  onChange={(e) => setTimeScale(e.target.value as TimeScale)}
                  className="text-[9px] bg-bg-secondary border border-border rounded px-1 py-0.5 text-text-primary"
                >
                  {timeScaleOptions.map((scale) => (
                    <option key={scale} value={scale}>
                      {scale}
                    </option>
                  ))}
                </select>

                {/* Trigger button */}
                <button
                  onClick={() => setTriggered(!triggered)}
                  className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                    triggered
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                  title="Trigger sync (stabilize waveform)"
                >
                  Trig
                </button>

                {/* Channel mode selector */}
                <select
                  value={channelMode}
                  onChange={(e) => setChannelMode(e.target.value as ChannelMode)}
                  className="text-[9px] bg-bg-secondary border border-border rounded px-1 py-0.5 text-text-primary"
                  title="Channel display mode"
                >
                  <option value="L/R">L/R</option>
                  <option value="L">L</option>
                  <option value="R">R</option>
                  <option value="M">Mono</option>
                </select>

                {/* Pre/Post comparison toggle - hidden for instruments */}
                {!hideInput && (
                  <button
                    onClick={() => setShowPrePost(!showPrePost)}
                    className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                      showPrePost
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                    title="Show pre/post FX waveform comparison"
                  >
                    Pre/Post
                  </button>
                )}
              </div>
            )}

            {/* Lissajous-specific controls */}
            {displayMode === 'lissajous' && !hideInput && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPrePost(!showPrePost)}
                  className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                    showPrePost
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                  title="Show pre/post FX comparison"
                >
                  Pre/Post
                </button>
              </div>
            )}
          </div>

          {/* Canvas display - taller when showing pre/post split view */}
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: showPrePost ? '200px' : '120px' }}
          />

          {/* Legend */}
          <div className="flex items-center justify-between px-2 py-1 border-t border-border/50 bg-bg-primary/30">
            {displayMode === 'waveform' ? (
              <>
                <div className="flex items-center gap-2">
                  {channelMode === 'L/R' && (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-0.5 bg-green-400 rounded"></span>
                        <span className="text-[9px] text-text-muted">L</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-0.5 bg-blue-400 rounded"></span>
                        <span className="text-[9px] text-text-muted">R</span>
                      </span>
                    </>
                  )}
                  {channelMode === 'L' && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-0.5 bg-green-400 rounded"></span>
                      <span className="text-[9px] text-text-muted">Left</span>
                    </span>
                  )}
                  {channelMode === 'R' && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-0.5 bg-blue-400 rounded"></span>
                      <span className="text-[9px] text-text-muted">Right</span>
                    </span>
                  )}
                  {channelMode === 'M' && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-0.5 bg-accent rounded"></span>
                      <span className="text-[9px] text-text-muted">Mono (L+R)</span>
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-text-muted">
                  Peak L:{(displayPeaks.left * 100).toFixed(0)}% R:{(displayPeaks.right * 100).toFixed(0)}%
                </span>
              </>
            ) : (
              <>
                <span className="text-[9px] text-text-muted">X: Left, Y: Right</span>
                <span className="text-[9px] text-text-muted">Phase correlation</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Draw a single waveform panel (used for both input and output in split view)
 */
function drawWaveformPanel(
  ctx: CanvasRenderingContext2D,
  waveformLeft: number[],
  waveformRight: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  channelMode: ChannelMode,
  startIndex: number,
  numSamples: number,
  colorScheme: 'output' | 'input',
  label?: string
) {
  const padding = 4;
  const plotHeight = height - padding * 2;
  const centerY = y + height / 2;

  // Draw label if provided
  if (label) {
    ctx.font = '9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = colorScheme === 'input' ? 'rgba(129, 140, 248, 0.8)' : 'rgba(45, 168, 110, 0.8)';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 4, y + 12);
  }

  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.5;

  // Center line
  ctx.beginPath();
  ctx.moveTo(x, centerY);
  ctx.lineTo(x + width, centerY);
  ctx.stroke();

  // +/- 0.5 lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.beginPath();
  ctx.moveTo(x, centerY - plotHeight / 4);
  ctx.lineTo(x + width, centerY - plotHeight / 4);
  ctx.moveTo(x, centerY + plotHeight / 4);
  ctx.lineTo(x + width, centerY + plotHeight / 4);
  ctx.stroke();

  // Clipping threshold lines
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
  ctx.beginPath();
  ctx.moveTo(x, y + padding);
  ctx.lineTo(x + width, y + padding);
  ctx.moveTo(x, y + height - padding);
  ctx.lineTo(x + width, y + height - padding);
  ctx.stroke();

  // Draw waveform channel with clamping to prevent bleed outside panel
  const drawChannel = (data: number[], color: string, alpha: number) => {
    if (data.length < 2 || numSamples < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    for (let i = 0; i < numSamples; i++) {
      const dataIndex = startIndex + i;
      if (dataIndex >= data.length) break;

      // Clamp sample to ±1.0 to prevent bleed outside panel bounds
      const sample = Math.max(-1, Math.min(1, data[dataIndex]));
      const px = x + (i / (numSamples - 1)) * width;
      const py = centerY - (sample * plotHeight / 2 * 0.9);

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // Color schemes
  const colors = colorScheme === 'output' ? {
    left: 'rgba(74, 222, 128, 1)',
    right: 'rgba(96, 165, 250, 0.8)',
    mono: 'rgba(45, 168, 110, 1)',
  } : {
    left: 'rgba(165, 180, 252, 1)',
    right: 'rgba(192, 168, 252, 0.8)',
    mono: 'rgba(129, 140, 248, 1)',
  };

  // Draw channels based on mode
  switch (channelMode) {
    case 'L/R':
      drawChannel(waveformRight, colors.right, colorScheme === 'output' ? 0.7 : 0.6);
      drawChannel(waveformLeft, colors.left, 1);
      break;
    case 'L':
      drawChannel(waveformLeft, colors.left, 1);
      break;
    case 'R':
      drawChannel(waveformRight, colors.right, 1);
      break;
    case 'M':
      // Create mono mix
      const endIndex = Math.min(startIndex + numSamples, waveformLeft.length);
      const buffer = colorScheme === 'output' ? monoBuffer : monoInputBuffer;
      if (buffer.length < endIndex) {
        if (colorScheme === 'output') {
          monoBuffer = new Array(endIndex).fill(0);
        } else {
          monoInputBuffer = new Array(endIndex).fill(0);
        }
      }
      const targetBuffer = colorScheme === 'output' ? monoBuffer : monoInputBuffer;
      for (let i = startIndex; i < endIndex; i++) {
        targetBuffer[i] = (waveformLeft[i] + (waveformRight[i] ?? 0)) * 0.5;
      }
      drawChannel(targetBuffer, colors.mono, 1);
      break;
  }
}

/**
 * Draw the waveform display with channel mode selection and pre/post split view
 */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveformLeft: number[],
  waveformRight: number[],
  width: number,
  height: number,
  triggered: boolean,
  channelMode: ChannelMode,
  sampleCount: number,
  lastTriggerPosRef: React.MutableRefObject<number>,
  peakLeft: number,
  peakRight: number,
  showPrePost: boolean = false,
  waveformInputLeft: number[] = [],
  waveformInputRight: number[] = []
) {
  // Find trigger position if enabled
  let startIndex = 0;
  const numSamples = Math.min(sampleCount, waveformLeft.length);

  // Guard against division by zero (numSamples - 1) in x coordinate calculation
  if (numSamples < 2) {
    return;
  }

  if (triggered && waveformLeft.length > sampleCount) {
    // Find zero crossing with positive slope (rising edge trigger)
    const searchEnd = waveformLeft.length - sampleCount;
    const searchStart = Math.max(0, searchEnd - sampleCount);

    let foundTrigger = false;
    for (let i = searchEnd - 1; i >= searchStart; i--) {
      if (i + 1 >= waveformLeft.length) continue;

      const curr = waveformLeft[i];
      const next = waveformLeft[i + 1];
      if (curr <= 0 && next > 0) {
        startIndex = i;
        lastTriggerPosRef.current = i;
        foundTrigger = true;
        break;
      }
    }

    if (!foundTrigger) {
      startIndex = Math.max(0, waveformLeft.length - numSamples);
    }
  } else {
    startIndex = Math.max(0, waveformLeft.length - numSamples);
  }

  if (showPrePost) {
    // Split view: input on top, output on bottom
    const panelHeight = height / 2;
    const dividerY = panelHeight;

    // Draw input (pre-FX) panel - top half
    drawWaveformPanel(
      ctx,
      waveformInputLeft,
      waveformInputRight,
      0,
      0,
      width,
      panelHeight - 1,
      channelMode,
      startIndex,
      numSamples,
      'input',
      'Pre-FX (Input)'
    );

    // Draw divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, dividerY);
    ctx.lineTo(width, dividerY);
    ctx.stroke();

    // Draw output (post-FX) panel - bottom half
    drawWaveformPanel(
      ctx,
      waveformLeft,
      waveformRight,
      0,
      dividerY + 1,
      width,
      panelHeight - 1,
      channelMode,
      startIndex,
      numSamples,
      'output',
      'Post-FX (Output)'
    );
  } else {
    // Single panel: output only (full height)
    const padding = 4;
    const plotHeight = height - padding * 2;
    const centerY = height / 2;

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // +/- 0.5 lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(0, centerY - plotHeight / 4);
    ctx.lineTo(width, centerY - plotHeight / 4);
    ctx.moveTo(0, centerY + plotHeight / 4);
    ctx.lineTo(width, centerY + plotHeight / 4);
    ctx.stroke();

    // Clipping threshold lines
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, padding);
    ctx.lineTo(width, padding);
    ctx.moveTo(0, height - padding);
    ctx.lineTo(width, height - padding);
    ctx.stroke();

    // Draw peak hold markers
    if (peakLeft > 0 || peakRight > 0) {
      let peakMax: number;
      switch (channelMode) {
        case 'L': peakMax = peakLeft; break;
        case 'R': peakMax = peakRight; break;
        case 'M': peakMax = Math.max(peakLeft, peakRight); break;
        default: peakMax = Math.max(peakLeft, peakRight); break;
      }
      const peakY = centerY - (peakMax * plotHeight / 2 * 0.9);
      const peakYNeg = centerY + (peakMax * plotHeight / 2 * 0.9);

      ctx.strokeStyle = 'rgba(255, 200, 50, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, peakY);
      ctx.lineTo(width, peakY);
      ctx.moveTo(0, peakYNeg);
      ctx.lineTo(width, peakYNeg);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw output waveform panel
    drawWaveformPanel(
      ctx,
      waveformLeft,
      waveformRight,
      0,
      0,
      width,
      height,
      channelMode,
      startIndex,
      numSamples,
      'output'
    );
  }
}

/**
 * Draw a single Lissajous panel (used for side-by-side comparison)
 */
function drawLissajousPanel(
  ctx: CanvasRenderingContext2D,
  waveformLeft: number[],
  waveformRight: number[],
  offsetX: number,
  panelWidth: number,
  height: number,
  particleColor: string,
  label?: string
) {
  const centerX = offsetX + panelWidth / 2;
  const centerY = height / 2;
  const radius = Math.min(panelWidth, height) / 2 - 10;

  // Draw background circle
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw inner circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // Draw crosshairs
  ctx.beginPath();
  ctx.moveTo(centerX - radius, centerY);
  ctx.lineTo(centerX + radius, centerY);
  ctx.moveTo(centerX, centerY - radius);
  ctx.lineTo(centerX, centerY + radius);
  ctx.stroke();

  // Draw +45° and -45° lines
  ctx.strokeStyle = 'rgba(45, 168, 110, 0.2)';
  ctx.beginPath();
  ctx.moveTo(centerX - radius * 0.7, centerY - radius * 0.7);
  ctx.lineTo(centerX + radius * 0.7, centerY + radius * 0.7);
  ctx.moveTo(centerX - radius * 0.7, centerY + radius * 0.7);
  ctx.lineTo(centerX + radius * 0.7, centerY - radius * 0.7);
  ctx.stroke();

  // Draw label in top-left corner to avoid overlap with L label
  if (label) {
    ctx.font = '9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = particleColor.includes('165, 180, 252') ? 'rgba(165, 180, 252, 0.8)' : 'rgba(74, 222, 128, 0.8)';
    ctx.textAlign = 'left';
    ctx.fillText(label, offsetX + 4, 12);
  }

  // Draw L/R labels
  ctx.font = '8px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.textAlign = 'center';
  ctx.fillText('L', centerX, centerY - radius - 4);
  ctx.fillText('R', centerX + radius + 6, centerY + 3);

  // Draw particles
  if (waveformLeft.length < 2 || waveformRight.length < 2) return;

  const numPoints = Math.min(waveformLeft.length, waveformRight.length, 512);

  for (let i = 0; i < numPoints - 1; i++) {
    // Clamp values to prevent drawing outside panel
    const left = Math.max(-1, Math.min(1, waveformLeft[i]));
    const right = Math.max(-1, Math.min(1, waveformRight[i]));

    if (typeof left !== 'number' || typeof right !== 'number') continue;
    if (!isFinite(left) || !isFinite(right)) continue;

    const x = centerX + left * radius * 0.9;
    const y = centerY - right * radius * 0.9;

    const age = i / numPoints;
    const opacity = 0.15 + age * 0.85;

    ctx.fillStyle = particleColor.replace('OPACITY', opacity.toString());
    ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
  }
}

/**
 * Draw Lissajous X/Y phase display
 * With Pre/Post side-by-side comparison support
 */
function drawLissajous(
  ctx: CanvasRenderingContext2D,
  waveformLeft: number[],
  waveformRight: number[],
  width: number,
  height: number,
  showPrePost: boolean = false,
  waveformInputLeft: number[] = [],
  waveformInputRight: number[] = []
) {
  // Side-by-side mode when Pre/Post is enabled
  if (showPrePost) {
    const dividerWidth = 1;
    const panelWidth = (width - dividerWidth) / 2;

    // Draw divider
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(panelWidth, 0, dividerWidth, height);

    // Draw input panel (left) - indigo
    drawLissajousPanel(
      ctx,
      waveformInputLeft,
      waveformInputRight,
      0,
      panelWidth,
      height,
      'rgba(165, 180, 252, OPACITY)',
      'Pre-FX'
    );

    // Draw output panel (right) - green
    drawLissajousPanel(
      ctx,
      waveformLeft,
      waveformRight,
      panelWidth + dividerWidth,
      panelWidth,
      height,
      'rgba(74, 222, 128, OPACITY)',
      'Post-FX'
    );
    return;
  }

  // Single panel mode (no Pre/Post)
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 10;

  // Draw background circle
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw inner circles
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // Draw crosshairs
  ctx.beginPath();
  ctx.moveTo(centerX - radius, centerY);
  ctx.lineTo(centerX + radius, centerY);
  ctx.moveTo(centerX, centerY - radius);
  ctx.lineTo(centerX, centerY + radius);
  ctx.stroke();

  // Draw +45° and -45° lines (mono correlation guides)
  ctx.strokeStyle = 'rgba(45, 168, 110, 0.2)';
  ctx.beginPath();
  ctx.moveTo(centerX - radius * 0.7, centerY - radius * 0.7);
  ctx.lineTo(centerX + radius * 0.7, centerY + radius * 0.7);
  ctx.moveTo(centerX - radius * 0.7, centerY + radius * 0.7);
  ctx.lineTo(centerX + radius * 0.7, centerY - radius * 0.7);
  ctx.stroke();

  // Draw L/R labels
  ctx.font = '9px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.textAlign = 'center';
  ctx.fillText('L', centerX, centerY - radius - 3);
  ctx.fillText('R', centerX + radius + 8, centerY + 3);

  // Draw OUTPUT Lissajous pattern (X = Left, Y = Right)
  if (waveformLeft.length < 2 || waveformRight.length < 2) return;

  const numPoints = Math.min(waveformLeft.length, waveformRight.length, 512);

  // Draw with fading trail effect
  for (let i = 0; i < numPoints - 1; i++) {
    // Clamp values to prevent drawing outside bounds
    const left = Math.max(-1, Math.min(1, waveformLeft[i]));
    const right = Math.max(-1, Math.min(1, waveformRight[i]));

    if (typeof left !== 'number' || typeof right !== 'number') continue;
    if (!isFinite(left) || !isFinite(right)) continue;

    // X = Left channel (horizontal), Y = Right channel (vertical)
    const x = centerX + left * radius * 0.9;
    const y = centerY - right * radius * 0.9;

    // Age-based opacity
    const age = i / numPoints;
    const opacity = 0.2 + age * 0.8;

    ctx.fillStyle = `rgba(74, 222, 128, ${opacity})`;
    ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
  }
}
