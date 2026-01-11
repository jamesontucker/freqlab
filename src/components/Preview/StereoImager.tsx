import { memo, useRef, useEffect, useCallback, useState } from 'react';
import { usePreviewStore } from '../../stores/previewStore';

interface StereoImagerProps {
  /** Whether the stereo imager is enabled */
  showStereoImager: boolean;
  /** Whether the parent section is active (panel open and section visible) */
  isActive: boolean;
  /** Toggle visibility */
  onToggle: () => void;
  /** Hide input-related features (for instruments) */
  hideInput?: boolean;
}

/**
 * Stereo field analyzer visualization similar to iZotope Insight's Sound Field.
 * Shows audio stereo width as a semicircular particle cloud with correlation meter.
 *
 * Based on iZotope's Polar Sample mode:
 * - Plots a dot for each sample pair
 * - Dots within ±45° from center indicate in-phase signals
 * - History fades over time for persistence effect
 * - Correlation meter shows -1 (out of phase) to +1 (mono)
 *
 * Sources:
 * - https://s3.amazonaws.com/izotopedownloads/docs/insight200/en/sound-field/index.html
 * - https://www.izotope.com/en/products/insight/features/sound-field.html
 */
export const StereoImager = memo(function StereoImager({
  showStereoImager,
  isActive,
  onToggle,
  hideInput = false,
}: StereoImagerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);  // Flag to prevent orphaned animation frames
  const lastCorrelationRef = useRef<number>(1);
  const lastCorrelationInputRef = useRef<number>(1);

  // Pre/Post comparison toggle (overlay mode - particles shown together)
  const [showPrePost, setShowPrePost] = useState(false);
  const showPrePostRef = useRef(showPrePost);
  showPrePostRef.current = showPrePost;

  // Compare mode toggle (side-by-side with separate meters)
  const [compareMode, setCompareMode] = useState(false);
  const compareModeRef = useRef(compareMode);
  compareModeRef.current = compareMode;

  // Reset modes when hideInput becomes true (instruments don't have audio input)
  useEffect(() => {
    if (hideInput) {
      setShowPrePost(false);
      setCompareMode(false);
    }
  }, [hideInput]);

  // Helper to draw a single stereo field panel (semicircle + meter)
  const drawPanel = useCallback((
    ctx: CanvasRenderingContext2D,
    positions: number[][],
    correlation: number,
    lastCorrelation: { current: number },
    offsetX: number,
    panelWidth: number,
    height: number,
    particleColor: string,
    label?: string
  ) => {
    const correlationWidth = 24;
    const padding = 8;
    const semicircleWidth = panelWidth - correlationWidth - padding * 2;
    const semicircleHeight = height - padding * 2 - 15;
    const radius = Math.min(semicircleWidth / 2, semicircleHeight) - 5;
    const centerX = offsetX + padding + semicircleWidth / 2;
    const centerY = height - padding - 12;

    // Draw semicircle outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
    ctx.stroke();

    // Draw inner arc at 50% radius
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.5, Math.PI, 0, false);
    ctx.stroke();

    // Draw center line (mono reference)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, centerY - radius);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    // Draw ±45° safe zone lines
    ctx.strokeStyle = 'rgba(45, 168, 110, 0.3)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX - radius * Math.cos(Math.PI / 4), centerY - radius * Math.sin(Math.PI / 4));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + radius * Math.cos(Math.PI / 4), centerY - radius * Math.sin(Math.PI / 4));
    ctx.stroke();

    // Draw L and R labels
    ctx.font = '8px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('L', centerX - radius, centerY + 9);
    ctx.fillText('R', centerX + radius, centerY + 9);

    // Draw panel label if provided
    if (label) {
      ctx.font = '9px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.textAlign = 'center';
      ctx.fillText(label, centerX, padding + 6);
    }

    // Draw particles
    const numPositions = positions.length;
    for (let i = 0; i < numPositions; i++) {
      const pos = positions[i];
      if (!pos) continue;

      const angle = Array.isArray(pos) ? pos[0] : 0;
      const posRadius = Array.isArray(pos) ? pos[1] : 0;

      if (typeof angle !== 'number' || typeof posRadius !== 'number') continue;
      if (!isFinite(angle) || !isFinite(posRadius)) continue;
      if (posRadius < 0.005) continue;

      const x = centerX + Math.cos(angle) * posRadius * radius;
      const y = centerY - Math.sin(angle) * posRadius * radius;

      const age = i / numPositions;
      const opacity = 0.15 + age * 0.85;

      ctx.fillStyle = particleColor.replace('OPACITY', opacity.toString());
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }

    // Draw correlation meter
    const meterX = offsetX + panelWidth - correlationWidth + 2;
    const meterY = padding + 14;
    const meterHeight = height - padding * 2 - 28;
    const meterWidth = 8;

    // Meter background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(meterX, meterY, meterWidth, meterHeight);

    // Smooth correlation
    const smoothCorrelation = lastCorrelation.current + (correlation - lastCorrelation.current) * 0.15;
    lastCorrelation.current = smoothCorrelation;

    // Scale labels
    ctx.font = '7px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('+1', meterX + meterWidth + 1, meterY + 3);
    ctx.fillText('0', meterX + meterWidth + 1, meterY + meterHeight / 2 + 2);
    ctx.fillText('-1', meterX + meterWidth + 1, meterY + meterHeight - 1);

    // Scale tick marks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(meterX, meterY);
    ctx.lineTo(meterX + meterWidth, meterY);
    ctx.moveTo(meterX, meterY + meterHeight / 2);
    ctx.lineTo(meterX + meterWidth, meterY + meterHeight / 2);
    ctx.moveTo(meterX, meterY + meterHeight);
    ctx.lineTo(meterX + meterWidth, meterY + meterHeight);
    ctx.stroke();

    const centerMeterY = meterY + meterHeight / 2;
    const indicatorY = centerMeterY - (smoothCorrelation * meterHeight / 2);
    const isPositive = smoothCorrelation >= 0;

    // Fill bar from center to current value
    ctx.fillStyle = isPositive ? 'rgba(45, 168, 110, 0.4)' : 'rgba(239, 68, 68, 0.4)';
    if (isPositive) {
      ctx.fillRect(meterX, indicatorY, meterWidth, centerMeterY - indicatorY);
    } else {
      ctx.fillRect(meterX, centerMeterY, meterWidth, indicatorY - centerMeterY);
    }

    // Indicator line
    ctx.fillStyle = isPositive ? '#2DA86E' : '#ef4444';
    ctx.fillRect(meterX, indicatorY - 1, meterWidth, 2);
  }, []);

  // Refs for compare mode correlation smoothing
  const lastCorrelationCompareInputRef = useRef<number>(1);

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
      // Fill background after resize
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(0, 0, rect.width, rect.height);
    }

    const width = rect.width;
    const height = rect.height;

    // Read current stereo data from store
    const metering = usePreviewStore.getState().metering;
    const positions = metering.stereoPositions || [];
    const correlation = metering.stereoCorrelation ?? 1;
    const positionsInput = metering.stereoPositionsInput || [];
    const correlationInput = metering.stereoCorrelationInput ?? 1;
    const showingPrePost = showPrePostRef.current;
    const isCompareMode = compareModeRef.current;

    // Slow fade for persistence
    ctx.fillStyle = 'rgba(26, 26, 30, 0.15)';
    ctx.fillRect(0, 0, width, height);

    // Compare mode: side-by-side panels
    if (isCompareMode) {
      const dividerWidth = 1;
      const panelWidth = (width - dividerWidth) / 2;

      // Draw divider
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(panelWidth, 0, dividerWidth, height);

      // Draw input panel (left) - indigo particles
      drawPanel(
        ctx,
        positionsInput,
        correlationInput,
        lastCorrelationCompareInputRef,
        0,
        panelWidth,
        height,
        'rgba(165, 180, 252, OPACITY)',
        'Pre-FX'
      );

      // Draw output panel (right) - white particles
      drawPanel(
        ctx,
        positions,
        correlation,
        lastCorrelationRef,
        panelWidth + dividerWidth,
        panelWidth,
        height,
        'rgba(255, 255, 255, OPACITY)',
        'Post-FX'
      );

      // Continue animation
      if (isAnimatingRef.current) {
        animationRef.current = requestAnimationFrame(draw);
      }
      return;
    }

    // Standard mode: single panel layout
    const correlationWidth = 28;
    const padding = 10;
    const semicircleWidth = width - correlationWidth - padding * 2;
    const semicircleHeight = height - padding * 2 - 15;
    const radius = Math.min(semicircleWidth / 2, semicircleHeight) - 5;
    const centerX = padding + semicircleWidth / 2;
    const centerY = height - padding - 12;

    // Draw semicircle outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
    ctx.stroke();

    // Draw inner arc at 50% radius
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.5, Math.PI, 0, false);
    ctx.stroke();

    // Draw center line (mono reference)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, centerY - radius);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    // Draw ±45° safe zone lines (in-phase boundary)
    ctx.strokeStyle = 'rgba(45, 168, 110, 0.3)'; // Accent color
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX - radius * Math.cos(Math.PI / 4), centerY - radius * Math.sin(Math.PI / 4));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + radius * Math.cos(Math.PI / 4), centerY - radius * Math.sin(Math.PI / 4));
    ctx.stroke();

    // Draw L and R labels
    ctx.font = '9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('L', centerX - radius, centerY + 10);
    ctx.fillText('R', centerX + radius, centerY + 10);

    // Draw particles as discrete dots (Polar Sample mode)
    // Each position is [angle, radius] where:
    // - angle: 0 = right edge, PI/2 = top center (mono), PI = left edge
    // - radius: 0-1 based on M/S amplitude

    // Draw INPUT particles first (behind output) when Pre/Post mode is enabled
    if (showingPrePost && positionsInput.length > 0) {
      const numInputPositions = positionsInput.length;
      for (let i = 0; i < numInputPositions; i++) {
        const pos = positionsInput[i];
        if (!pos) continue;

        const angle = Array.isArray(pos) ? pos[0] : 0;
        const posRadius = Array.isArray(pos) ? pos[1] : 0;

        if (typeof angle !== 'number' || typeof posRadius !== 'number') continue;
        if (!isFinite(angle) || !isFinite(posRadius)) continue;

        // Skip silent samples
        if (posRadius < 0.005) continue;

        // Convert polar to cartesian for semicircle display
        const x = centerX + Math.cos(angle) * posRadius * radius;
        const y = centerY - Math.sin(angle) * posRadius * radius;

        // Age-based opacity for input (indigo/purple color)
        // Higher opacity range for better visibility on dark background
        const age = i / numInputPositions;
        const opacity = 0.25 + age * 0.55; // Range: 0.25 to 0.8

        ctx.fillStyle = `rgba(165, 180, 252, ${opacity})`; // Lighter indigo for better contrast
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }

    // Draw OUTPUT particles with age-based opacity for cloud gradient effect
    // Older particles (lower index) are dimmer, newer particles are brighter
    const numPositions = positions.length;

    for (let i = 0; i < numPositions; i++) {
      const pos = positions[i];
      if (!pos) continue;

      const angle = Array.isArray(pos) ? pos[0] : 0;
      const posRadius = Array.isArray(pos) ? pos[1] : 0;

      if (typeof angle !== 'number' || typeof posRadius !== 'number') continue;
      if (!isFinite(angle) || !isFinite(posRadius)) continue;

      // Skip silent samples
      if (posRadius < 0.005) continue;

      // Convert polar to cartesian for semicircle display
      const x = centerX + Math.cos(angle) * posRadius * radius;
      const y = centerY - Math.sin(angle) * posRadius * radius;

      // Age-based opacity: oldest (i=0) → dim, newest (i=length-1) → bright
      // This creates the cloud gradient effect like iZotope
      const age = i / numPositions; // 0 = oldest, 1 = newest
      const opacity = 0.15 + age * 0.85; // Range from 0.15 to 1.0

      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }

    // Draw correlation meter (right side)
    const meterX = width - correlationWidth + 4;
    const meterY = padding + 10;
    const meterHeight = height - padding * 2 - 25;
    const meterWidth = 10;

    // Meter background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(meterX, meterY, meterWidth, meterHeight);

    // Smooth correlation for display
    const smoothCorrelation = lastCorrelationRef.current + (correlation - lastCorrelationRef.current) * 0.15;
    lastCorrelationRef.current = smoothCorrelation;

    const smoothCorrelationInput = lastCorrelationInputRef.current + (correlationInput - lastCorrelationInputRef.current) * 0.15;
    lastCorrelationInputRef.current = smoothCorrelationInput;

    // Scale labels
    ctx.font = '8px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('+1', meterX + meterWidth + 2, meterY + 3);
    ctx.fillText('0', meterX + meterWidth + 2, meterY + meterHeight / 2 + 3);
    ctx.fillText('-1', meterX + meterWidth + 2, meterY + meterHeight);

    // Scale tick marks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(meterX, meterY);
    ctx.lineTo(meterX + meterWidth, meterY);
    ctx.moveTo(meterX, meterY + meterHeight / 2);
    ctx.lineTo(meterX + meterWidth, meterY + meterHeight / 2);
    ctx.moveTo(meterX, meterY + meterHeight);
    ctx.lineTo(meterX + meterWidth, meterY + meterHeight);
    ctx.stroke();

    const centerMeterY = meterY + meterHeight / 2;

    // Draw INPUT correlation indicator first (behind output) when Pre/Post is enabled
    if (showingPrePost) {
      const inputIndicatorY = centerMeterY - (smoothCorrelationInput * meterHeight / 2);
      const isInputPositive = smoothCorrelationInput >= 0;

      // Fill bar from center to current value (lighter indigo for visibility)
      ctx.fillStyle = 'rgba(165, 180, 252, 0.35)';
      if (isInputPositive) {
        ctx.fillRect(meterX, inputIndicatorY, meterWidth, centerMeterY - inputIndicatorY);
      } else {
        ctx.fillRect(meterX, centerMeterY, meterWidth, inputIndicatorY - centerMeterY);
      }

      // Input indicator line (lighter indigo)
      ctx.fillStyle = 'rgba(165, 180, 252, 0.85)';
      ctx.fillRect(meterX, inputIndicatorY - 1, meterWidth, 2);
    }

    // Draw OUTPUT correlation bar from center
    const indicatorY = centerMeterY - (smoothCorrelation * meterHeight / 2);

    // Color based on correlation: green for positive, red for negative
    const isPositive = smoothCorrelation >= 0;

    // Fill bar from center to current value
    ctx.fillStyle = isPositive ? 'rgba(45, 168, 110, 0.4)' : 'rgba(239, 68, 68, 0.4)';
    if (isPositive) {
      ctx.fillRect(meterX, indicatorY, meterWidth, centerMeterY - indicatorY);
    } else {
      ctx.fillRect(meterX, centerMeterY, meterWidth, indicatorY - centerMeterY);
    }

    // Indicator line
    ctx.fillStyle = isPositive ? '#2DA86E' : '#ef4444';
    ctx.fillRect(meterX, indicatorY - 1, meterWidth, 3);

    // Continue animation only if still animating (prevents orphaned frames after cleanup)
    if (isAnimatingRef.current) {
      animationRef.current = requestAnimationFrame(draw);
    }
  }, [drawPanel]);

  // Start/stop animation when visibility changes
  useEffect(() => {
    const shouldAnimate = showStereoImager && isActive;

    if (shouldAnimate) {
      // Set flag BEFORE starting animation
      isAnimatingRef.current = true;
      // Reset correlation smoothing when becoming visible to avoid stale values
      lastCorrelationRef.current = 1;
      lastCorrelationInputRef.current = 1;
      // Clear any existing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Start animation
      animationRef.current = requestAnimationFrame(draw);
    } else {
      // Clear flag BEFORE canceling to prevent race condition
      isAnimatingRef.current = false;
      // Stop animation
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
  }, [showStereoImager, isActive, draw]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {/* Stereo field icon - semicircle with L/R */}
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 18 A 8 8 0 0 1 20 18" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" />
            <circle cx="20" cy="18" r="1.5" fill="currentColor" />
            <line x1="12" y1="18" x2="12" y2="10" strokeOpacity="0.5" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Stereo Field</span>
        </div>
        <div className="flex items-center gap-2">
          {showStereoImager && !hideInput && (
            <>
              <button
                onClick={() => {
                  setShowPrePost(!showPrePost);
                  if (!showPrePost) setCompareMode(false); // Disable compare when enabling pre/post
                }}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  showPrePost
                    ? 'bg-indigo-500/20 text-indigo-400'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                title="Overlay pre-FX stereo field for comparison"
              >
                Pre/Post
              </button>
              <button
                onClick={() => {
                  setCompareMode(!compareMode);
                  if (!compareMode) setShowPrePost(false); // Disable pre/post when enabling compare
                }}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  compareMode
                    ? 'bg-indigo-500/20 text-indigo-400'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                title="Side-by-side comparison with separate meters"
              >
                Compare
              </button>
            </>
          )}
          <button
            onClick={onToggle}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              showStereoImager
                ? 'bg-accent/20 text-accent'
                : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
            }`}
          >
            {showStereoImager ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      {showStereoImager && (
        <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: compareMode ? '170px' : '150px' }}
          />
          {/* Pre/Post legend when enabled (overlay mode) */}
          {showPrePost && (
            <div className="flex items-center justify-center gap-4 py-1.5 px-2 border-t border-border/50 bg-bg-secondary/30">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-indigo-300/80"></div>
                <span className="text-[10px] text-text-muted">Pre-FX</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-white/80"></div>
                <span className="text-[10px] text-text-muted">Post-FX</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
