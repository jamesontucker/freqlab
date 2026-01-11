import { memo, useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  // Local state for waveform options
  const [displayMode, setDisplayMode] = useState<DisplayMode>('waveform');
  const [timeScale, setTimeScale] = useState<TimeScale>('25ms');
  const [triggered, setTriggered] = useState(true);
  const [channelMode, setChannelMode] = useState<ChannelMode>('L/R');

  // Peak hold values
  const peakLeftRef = useRef(0);
  const peakRightRef = useRef(0);
  const peakDecayRef = useRef(0);

  // Trigger position history for stability
  const lastTriggerPosRef = useRef(0);

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
    const waveformLeft = metering.waveformLeft || [];
    const waveformRight = metering.waveformRight || [];
    const waveformPeakLeft = metering.waveformPeakLeft || 0;
    const waveformPeakRight = metering.waveformPeakRight || 0;

    // Update peak hold (decay slowly)
    peakDecayRef.current += 1;
    if (peakDecayRef.current >= 30) { // Decay every half second at 60fps
      peakDecayRef.current = 0;
      peakLeftRef.current = Math.max(peakLeftRef.current * 0.95, waveformPeakLeft);
      peakRightRef.current = Math.max(peakRightRef.current * 0.95, waveformPeakRight);
    }
    peakLeftRef.current = Math.max(peakLeftRef.current, waveformPeakLeft);
    peakRightRef.current = Math.max(peakRightRef.current, waveformPeakRight);

    if (displayMode === 'lissajous') {
      drawLissajous(ctx, waveformLeft, waveformRight, width, height);
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
        peakRightRef.current
      );
    }

    // Continue animation
    animationRef.current = requestAnimationFrame(draw);
  }, [displayMode, timeScale, triggered, channelMode]);

  // Start/stop animation when visibility changes
  useEffect(() => {
    const shouldAnimate = showWaveform && isActive;

    if (shouldAnimate) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = requestAnimationFrame(draw);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }

    return () => {
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
              </div>
            )}
          </div>

          {/* Canvas display */}
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: '120px' }}
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
                  Peak L:{(peakLeftRef.current * 100).toFixed(0)}% R:{(peakRightRef.current * 100).toFixed(0)}%
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
 * Draw the waveform display with channel mode selection
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
  peakRight: number
) {
  const padding = 4;
  const plotHeight = height - padding * 2;
  const centerY = height / 2;

  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.5;

  // Center line
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

  // Find trigger position if enabled
  let startIndex = 0;
  const numSamples = Math.min(sampleCount, waveformLeft.length);

  if (triggered && waveformLeft.length > sampleCount) {
    // Find zero crossing with positive slope (rising edge trigger)
    // Search backwards from most recent data to find a stable trigger point
    const searchEnd = waveformLeft.length - sampleCount;
    const searchStart = Math.max(0, searchEnd - sampleCount);

    let foundTrigger = false;
    for (let i = searchEnd - 1; i >= searchStart; i--) {
      const curr = waveformLeft[i];
      const next = waveformLeft[i + 1];
      // Rising edge: crosses from negative/zero to positive
      if (curr <= 0 && next > 0) {
        startIndex = i;
        lastTriggerPosRef.current = i;
        foundTrigger = true;
        break;
      }
    }

    // If no trigger found, use free-running mode for this frame
    if (!foundTrigger) {
      startIndex = Math.max(0, waveformLeft.length - numSamples);
    }
  } else {
    // Free-running mode: show most recent samples
    startIndex = Math.max(0, waveformLeft.length - numSamples);
  }

  // Draw peak hold markers
  if (peakLeft > 0 || peakRight > 0) {
    let peakMax: number;
    switch (channelMode) {
      case 'L': peakMax = peakLeft; break;
      case 'R': peakMax = peakRight; break;
      case 'M': peakMax = Math.max(peakLeft, peakRight); break; // Approximate for mono
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

  // Draw waveforms
  const drawChannel = (data: number[], color: string, alpha: number) => {
    if (data.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    for (let i = 0; i < numSamples; i++) {
      const dataIndex = startIndex + i;
      if (dataIndex >= data.length) break;

      const sample = data[dataIndex];
      const x = (i / (numSamples - 1)) * width;
      const y = centerY - (sample * plotHeight / 2 * 0.9);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // Draw based on channel mode
  switch (channelMode) {
    case 'L/R':
      // Draw right channel first (blue, behind)
      drawChannel(waveformRight, 'rgba(96, 165, 250, 0.8)', 0.7);
      // Draw left channel on top (green)
      drawChannel(waveformLeft, 'rgba(74, 222, 128, 1)', 1);
      break;
    case 'L':
      // Left channel only (green)
      drawChannel(waveformLeft, 'rgba(74, 222, 128, 1)', 1);
      break;
    case 'R':
      // Right channel only (blue)
      drawChannel(waveformRight, 'rgba(96, 165, 250, 1)', 1);
      break;
    case 'M':
      // Mono: sum L+R and scale by 0.5 to prevent clipping
      const monoData = waveformLeft.map((l, i) => {
        const r = waveformRight[i] ?? 0;
        return (l + r) * 0.5;
      });
      drawChannel(monoData, 'rgba(45, 168, 110, 1)', 1);
      break;
  }
}

/**
 * Draw Lissajous X/Y phase display
 */
function drawLissajous(
  ctx: CanvasRenderingContext2D,
  waveformLeft: number[],
  waveformRight: number[],
  width: number,
  height: number
) {
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

  // Draw Lissajous pattern (X = Left, Y = Right)
  if (waveformLeft.length < 2 || waveformRight.length < 2) return;

  const numPoints = Math.min(waveformLeft.length, waveformRight.length, 512);

  // Draw with fading trail effect
  for (let i = 0; i < numPoints - 1; i++) {
    const left = waveformLeft[i];
    const right = waveformRight[i];

    if (typeof left !== 'number' || typeof right !== 'number') continue;
    if (!isFinite(left) || !isFinite(right)) continue;

    // X = Left channel (horizontal), Y = Right channel (vertical)
    // Note: positive up for Y
    const x = centerX + left * radius * 0.9;
    const y = centerY - right * radius * 0.9;

    // Age-based opacity
    const age = i / numPoints;
    const opacity = 0.2 + age * 0.8;

    ctx.fillStyle = `rgba(74, 222, 128, ${opacity})`;
    ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
  }
}
