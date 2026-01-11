import { memo, useRef, useEffect, useCallback } from 'react';
import { usePreviewStore } from '../../stores/previewStore';

interface StereoImagerProps {
  /** Whether the stereo imager is enabled */
  showStereoImager: boolean;
  /** Whether the parent section is active (panel open and section visible) */
  isActive: boolean;
  /** Toggle visibility */
  onToggle: () => void;
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
}: StereoImagerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastCorrelationRef = useRef<number>(1);

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

    // Layout: main area for semicircle, narrow strip on right for correlation
    const correlationWidth = 28;
    const padding = 10;
    const semicircleWidth = width - correlationWidth - padding * 2;
    const semicircleHeight = height - padding * 2 - 15; // Leave room for L/R labels
    const radius = Math.min(semicircleWidth / 2, semicircleHeight) - 5;
    const centerX = padding + semicircleWidth / 2;
    const centerY = height - padding - 12;

    // Slow fade for persistence - lets samples accumulate over multiple frames
    // Lower alpha = more persistence = denser cloud
    ctx.fillStyle = 'rgba(26, 26, 30, 0.15)';
    ctx.fillRect(0, 0, width, height);

    // Read current stereo data from store
    const metering = usePreviewStore.getState().metering;
    const positions = metering.stereoPositions || [];
    const correlation = metering.stereoCorrelation ?? 1;

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

    // Draw particles with age-based opacity for cloud gradient effect
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

    // Correlation bar from center
    const centerMeterY = meterY + meterHeight / 2;
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

    // Continue animation
    animationRef.current = requestAnimationFrame(draw);
  }, []);

  // Start/stop animation when visibility changes
  useEffect(() => {
    const shouldAnimate = showStereoImager && isActive;

    if (shouldAnimate) {
      // Clear any existing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Start animation
      animationRef.current = requestAnimationFrame(draw);
    } else {
      // Stop animation
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
  }, [showStereoImager, isActive, draw]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {/* Stereo field icon */}
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Stereo Field</span>
        </div>
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
      {showStereoImager && (
        <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: '150px' }}
          />
        </div>
      )}
    </div>
  );
});
