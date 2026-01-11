import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { usePreviewStore } from '../../stores/previewStore';

interface PerformanceMonitorProps {
  enabled: boolean;
  onToggle: () => void;
}

// Color thresholds for CPU usage
const getCpuColor = (percent: number): string => {
  if (percent >= 80) return 'bg-red-500';
  if (percent >= 50) return 'bg-yellow-500';
  return 'bg-accent';
};

const getCpuTextColor = (percent: number): string => {
  if (percent >= 80) return 'text-red-500';
  if (percent >= 50) return 'text-yellow-500';
  return 'text-accent';
};

// Format microseconds for display
const formatMicroseconds = (ns: number): string => {
  const us = ns / 1000;
  if (us >= 1000) {
    return `${(us / 1000).toFixed(2)} ms`;
  }
  return `${us.toFixed(0)} \u00B5s`;
};

// Format nanoseconds per sample
const formatPerSampleNs = (ns: number): string => {
  if (ns >= 1000) {
    return `${(ns / 1000).toFixed(2)} \u00B5s`;
  }
  return `${ns.toFixed(1)} ns`;
};

// Format buffer duration for display
const formatBufferDuration = (ns: number, samples: number, sampleRate: number): string => {
  const us = ns / 1000;
  return `${us.toFixed(0)} \u00B5s (${(sampleRate / 1000).toFixed(0)}kHz @ ${samples})`;
};

const PerformanceMonitor = memo(function PerformanceMonitor({
  enabled,
  onToggle,
}: PerformanceMonitorProps) {
  const [expanded, setExpanded] = useState(false);

  // Subscribe to performance data ONLY when enabled
  // This prevents OutputSection from re-rendering when performance data changes
  const performance = usePreviewStore((s) =>
    enabled ? s.metering.pluginPerformance : undefined
  );

  // Smoothed CPU percentage for display (prevents jitter)
  const [smoothedCpu, setSmoothedCpu] = useState(0);
  const smoothedCpuRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Use requestAnimationFrame for smooth updates instead of useEffect on every data change
  useEffect(() => {
    if (!enabled) {
      setSmoothedCpu(0);
      smoothedCpuRef.current = 0;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    const smoothingFactor = 0.15; // Lower = smoother

    const animate = () => {
      // Get current performance data from store (avoiding stale closure)
      const currentPerf = usePreviewStore.getState().metering.pluginPerformance;

      if (currentPerf) {
        const targetCpu = Math.min(currentPerf.cpu_percent, 100);
        const current = smoothedCpuRef.current;
        const diff = targetCpu - current;

        // Only update state if change is significant (reduces renders)
        if (Math.abs(diff) > 0.1) {
          smoothedCpuRef.current = current + diff * smoothingFactor;
          setSmoothedCpu(smoothedCpuRef.current);
        }
      } else {
        // No data - decay to zero
        if (smoothedCpuRef.current > 0.1) {
          smoothedCpuRef.current *= 0.9;
          setSmoothedCpu(smoothedCpuRef.current);
        } else if (smoothedCpuRef.current !== 0) {
          smoothedCpuRef.current = 0;
          setSmoothedCpu(0);
        }
      }

      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled]);

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  const cpuPercent = smoothedCpu;
  const cpuColor = getCpuColor(cpuPercent);
  const cpuTextColor = getCpuTextColor(cpuPercent);

  return (
    <div className="mt-3">
      {/* Header row - matches other analysis sections */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {/* Lightning bolt icon for performance/speed */}
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          <span className="text-xs text-text-muted font-medium">Plugin CPU</span>
        </div>
        <div className="flex items-center gap-1.5">
          {enabled && (
            <button
              onClick={toggleExpanded}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                expanded
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
              }`}
              title={expanded ? 'Hide details' : 'Show details'}
            >
              Details
            </button>
          )}
          <button
            onClick={onToggle}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              enabled
                ? 'bg-accent/20 text-accent'
                : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
            }`}
          >
            {enabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Content - only shown when enabled */}
      {enabled && (
        <div className="bg-bg-tertiary rounded-lg border border-border p-3 space-y-2">
          {/* Performance guide note */}
          <div className="flex items-start gap-1.5 px-2 py-1.5 bg-accent/5 border border-accent/20 rounded text-[10px] text-text-muted">
            <svg className="w-3 h-3 text-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              <span className="text-accent">Under 50%</span> = good headroom •
              <span className="text-yellow-400"> 50-80%</span> = moderate load •
              <span className="text-red-400"> Over 80%</span> = risk of audio dropouts
            </span>
          </div>

          {/* CPU bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted w-8">CPU</span>
            <div className="flex-1 h-3 bg-bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full ${cpuColor} transition-all duration-100`}
                style={{ width: `${Math.min(cpuPercent, 100)}%` }}
              />
            </div>
            <span className={`text-xs font-mono tabular-nums w-12 text-right ${cpuTextColor}`}>
              {cpuPercent.toFixed(1)}%
            </span>
          </div>

          {/* Expanded details */}
          {expanded && performance && (
            <div className="pt-2 border-t border-bg-secondary space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Process Time:</span>
                <span className="font-mono tabular-nums text-text-secondary">
                  {formatMicroseconds(performance.process_time_ns)} / {performance.samples_processed} frames
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Per Sample:</span>
                <span className="font-mono tabular-nums text-text-secondary">
                  {formatPerSampleNs(performance.per_sample_ns)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Buffer Budget:</span>
                <span className="font-mono tabular-nums text-text-secondary">
                  {formatBufferDuration(performance.buffer_duration_ns, performance.samples_processed, performance.sample_rate)}
                </span>
              </div>
            </div>
          )}

          {/* Show placeholder when enabled but no data */}
          {expanded && !performance && (
            <div className="pt-2 border-t border-bg-secondary">
              <span className="text-xs text-text-muted">Waiting for plugin data...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default PerformanceMonitor;
