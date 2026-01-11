import { memo, useMemo } from 'react';

interface LevelMetersProps {
  animatedLevels: { left: number; right: number };
  animatedInputLevels: { left: number; right: number };
  displayDb: { left: number; right: number };
  displayInputDb: { left: number; right: number };
  clipHold: { left: boolean; right: boolean };
  showInputMeters: boolean;
  showOutputMeters: boolean;
  onToggleInputMeters: () => void;
  onToggleOutputMeters: () => void;
  hideInput?: boolean; // Hide input meters entirely (for instruments)
}

// Meter scale: -60dB to +6dB (66dB range with headroom to show clipping)
const DB_MIN = -60;
const DB_MAX = 6;
const DB_RANGE = DB_MAX - DB_MIN; // 66dB

// Output meter color (green to red)
const getMeterColor = (db: number) => {
  if (db > 0) return 'bg-gradient-to-r from-red-500 to-red-600';         // Clipping!
  if (db > -1) return 'bg-gradient-to-r from-orange-500 to-red-500';    // Near clipping
  if (db > -3) return 'bg-gradient-to-r from-yellow-500 to-orange-500'; // Hot
  if (db > -6) return 'bg-gradient-to-r from-accent to-yellow-500';     // Warm
  return 'bg-gradient-to-r from-accent to-accent-hover';                 // Normal
};

// Input meter color (blue/indigo tint)
const getInputMeterColor = (db: number) => {
  if (db > 0) return 'bg-gradient-to-r from-red-500 to-red-600';
  if (db > -1) return 'bg-gradient-to-r from-purple-500 to-red-500';
  if (db > -3) return 'bg-gradient-to-r from-indigo-500 to-purple-500';
  if (db > -6) return 'bg-gradient-to-r from-blue-500 to-indigo-500';
  return 'bg-gradient-to-r from-indigo-400 to-indigo-500';
};

// Convert dB to percentage width (with +6dB headroom)
const dbToWidth = (db: number) => {
  const clampedDb = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clampedDb - DB_MIN) / DB_RANGE) * 100;
};

// Reusable meter bar component
const MeterBar = memo(function MeterBar({
  label,
  width,
  color,
  clipHold,
  displayDb,
  showNotches = true,
}: {
  label: string;
  width: number;
  color: string;
  clipHold?: boolean;
  displayDb: number;
  showNotches?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-muted w-3 font-mono">{label}</span>
      <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
        <div
          className={`h-full ${color} relative`}
          style={{ width: `${width}%` }}
        />
        {/* dB notches */}
        {showNotches && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-[45.5%] w-px h-full bg-white/20" title="-30dB" />
            <div className="absolute left-[63.6%] w-px h-full bg-white/20" title="-18dB" />
            <div className="absolute left-[72.7%] w-px h-full bg-white/25" title="-12dB" />
            <div className="absolute left-[81.8%] w-px h-full bg-yellow-400/40" title="-6dB" />
            <div className="absolute left-[90.9%] w-0.5 h-full bg-red-500/70" title="0dB" />
          </div>
        )}
      </div>
      <span className={`text-[10px] w-14 text-right font-mono tabular-nums ${(clipHold || displayDb > 0) ? 'text-red-500 font-bold' : 'text-text-muted'}`}>
        {displayDb > -60 ? `${displayDb > 0 ? '+' : ''}${displayDb.toFixed(1)}` : '-∞'} dB
      </span>
    </div>
  );
});

// dB scale labels component
const DbScale = memo(function DbScale() {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3"></span>
      <div className="flex-1 relative text-[8px] text-text-muted/60 h-3">
        <span className="absolute left-0">-60</span>
        <span className="absolute left-[45.5%] -translate-x-1/2">-30</span>
        <span className="absolute left-[63.6%] -translate-x-1/2">-18</span>
        <span className="absolute left-[72.7%] -translate-x-1/2">-12</span>
        <span className="absolute left-[81.8%] -translate-x-1/2">-6</span>
        <span className="absolute left-[90.9%] -translate-x-1/2 text-red-400/80 font-medium">0</span>
        <span className="absolute right-0">+6</span>
      </div>
      <span className="w-14"></span>
    </div>
  );
});

export const LevelMeters = memo(function LevelMeters({
  animatedLevels,
  animatedInputLevels,
  displayDb,
  displayInputDb,
  clipHold,
  showInputMeters,
  showOutputMeters,
  onToggleInputMeters,
  onToggleOutputMeters,
  hideInput = false,
}: LevelMetersProps) {
  // Convert animated linear levels to dB for smooth bar rendering
  const outputMetrics = useMemo(() => {
    const leftDb = animatedLevels.left > 0 ? 20 * Math.log10(animatedLevels.left) : DB_MIN;
    const rightDb = animatedLevels.right > 0 ? 20 * Math.log10(animatedLevels.right) : DB_MIN;
    return {
      leftWidth: dbToWidth(leftDb),
      rightWidth: dbToWidth(rightDb),
      leftColor: getMeterColor(leftDb),
      rightColor: getMeterColor(rightDb),
    };
  }, [animatedLevels.left, animatedLevels.right]);

  // Input levels (pre-FX)
  const inputMetrics = useMemo(() => {
    const leftDb = animatedInputLevels.left > 0 ? 20 * Math.log10(animatedInputLevels.left) : DB_MIN;
    const rightDb = animatedInputLevels.right > 0 ? 20 * Math.log10(animatedInputLevels.right) : DB_MIN;
    return {
      leftWidth: dbToWidth(leftDb),
      rightWidth: dbToWidth(rightDb),
      leftColor: getInputMeterColor(leftDb),
      rightColor: getInputMeterColor(rightDb),
    };
  }, [animatedInputLevels.left, animatedInputLevels.right]);

  return (
    <div className="space-y-2">
      {/* Input Meters (Pre-FX) - toggleable, hidden for instruments */}
      {!hideInput && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-xs text-indigo-400 font-medium">Input (Pre-FX)</span>
            </div>
            <button
              onClick={onToggleInputMeters}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                showInputMeters
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
              }`}
              title="Show input level meters"
            >
              {showInputMeters ? 'On' : 'Off'}
            </button>
          </div>

          {showInputMeters && (
            <div className="space-y-1">
              <MeterBar
                label="L"
                width={inputMetrics.leftWidth}
                color={inputMetrics.leftColor}
                displayDb={displayInputDb.left}
              />
              <MeterBar
                label="R"
                width={inputMetrics.rightWidth}
                color={inputMetrics.rightColor}
                displayDb={displayInputDb.right}
              />
            </div>
          )}
        </div>
      )}

      {/* Output Meters (Post-FX) - toggleable, on by default */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <span className="text-xs text-accent font-medium">Output (Post-FX)</span>
          </div>
          <button
            onClick={onToggleOutputMeters}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              showOutputMeters
                ? 'bg-accent/20 text-accent'
                : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
            }`}
            title="Show output level meters"
          >
            {showOutputMeters ? 'On' : 'Off'}
          </button>
        </div>

        {showOutputMeters && (
          <>
            <div className="space-y-1">
              <MeterBar
                label="L"
                width={outputMetrics.leftWidth}
                color={outputMetrics.leftColor}
                clipHold={clipHold.left}
                displayDb={displayDb.left}
              />
              <MeterBar
                label="R"
                width={outputMetrics.rightWidth}
                color={outputMetrics.rightColor}
                clipHold={clipHold.right}
                displayDb={displayDb.right}
              />
            </div>
            {/* dB scale labels */}
            <DbScale />
          </>
        )}
      </div>
    </div>
  );
});
