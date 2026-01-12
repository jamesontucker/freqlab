import { memo, useState, useEffect, useRef } from 'react';
import { usePreviewStore } from '../../stores/previewStore';

interface LevelMetersProps {
  isOpen: boolean;
  isVisible: boolean;
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
  displayDb,
  showNotches = true,
}: {
  label: string;
  width: number;
  color: string;
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
      <span className={`text-[10px] w-14 text-right font-mono tabular-nums ${displayDb > 0 ? 'text-red-500 font-bold' : 'text-text-muted'}`}>
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
  isOpen,
  isVisible,
  hideInput = false,
}: LevelMetersProps) {
  // Local UI toggle state
  const [showInputMeters, setShowInputMeters] = useState(false);
  const [showOutputMeters, setShowOutputMeters] = useState(true);

  // Animation state - all meter data in one object for single re-render per frame
  const [meterState, setMeterState] = useState({
    outputLeft: { width: 0, color: getMeterColor(DB_MIN), displayDb: DB_MIN },
    outputRight: { width: 0, color: getMeterColor(DB_MIN), displayDb: DB_MIN },
    inputLeft: { width: 0, color: getInputMeterColor(DB_MIN), displayDb: DB_MIN },
    inputRight: { width: 0, color: getInputMeterColor(DB_MIN), displayDb: DB_MIN },
  });

  // Refs for animation loop
  const rafIdRef = useRef<number | null>(null);
  const animatedLevelsRef = useRef({ left: 0, right: 0 });
  const animatedInputLevelsRef = useRef({ left: 0, right: 0 });
  const displayDbRef = useRef({ left: DB_MIN, right: DB_MIN });
  const displayInputDbRef = useRef({ left: DB_MIN, right: DB_MIN });
  const showInputMetersRef = useRef(showInputMeters);
  showInputMetersRef.current = showInputMeters;

  // Animation loop - runs at 60fps when visible
  useEffect(() => {
    if (!isOpen || !isVisible) return;

    const smoothingFactor = 0.25;

    const animate = () => {
      const metering = usePreviewStore.getState().metering;

      // Interpolate output levels
      const targetLeft = metering.left;
      const targetRight = metering.right;
      const currentLeft = animatedLevelsRef.current.left;
      const currentRight = animatedLevelsRef.current.right;

      const newLeft = currentLeft + (targetLeft - currentLeft) * smoothingFactor;
      const newRight = currentRight + (targetRight - currentRight) * smoothingFactor;
      animatedLevelsRef.current = { left: newLeft, right: newRight };

      // Calculate output dB and metrics
      const outputLeftDb = newLeft > 0 ? 20 * Math.log10(newLeft) : DB_MIN;
      const outputRightDb = newRight > 0 ? 20 * Math.log10(newRight) : DB_MIN;

      // Update display dB with debouncing (only update if change > 1dB or dropping significantly)
      const currentDisplayLeft = displayDbRef.current.left;
      const currentDisplayRight = displayDbRef.current.right;
      const leftDiff = Math.abs(metering.leftDb - currentDisplayLeft);
      const rightDiff = Math.abs(metering.rightDb - currentDisplayRight);

      if (leftDiff > 1 || rightDiff > 1 || metering.leftDb < currentDisplayLeft - 3 || metering.rightDb < currentDisplayRight - 3) {
        displayDbRef.current = { left: metering.leftDb, right: metering.rightDb };
      }

      // Interpolate input levels if input meters are visible
      let inputLeftDb = DB_MIN;
      let inputRightDb = DB_MIN;
      if (showInputMetersRef.current) {
        const targetInputLeft = metering.inputLeft;
        const targetInputRight = metering.inputRight;
        const currentInputLeft = animatedInputLevelsRef.current.left;
        const currentInputRight = animatedInputLevelsRef.current.right;

        const newInputLeft = currentInputLeft + (targetInputLeft - currentInputLeft) * smoothingFactor;
        const newInputRight = currentInputRight + (targetInputRight - currentInputRight) * smoothingFactor;
        animatedInputLevelsRef.current = { left: newInputLeft, right: newInputRight };

        inputLeftDb = newInputLeft > 0 ? 20 * Math.log10(newInputLeft) : DB_MIN;
        inputRightDb = newInputRight > 0 ? 20 * Math.log10(newInputRight) : DB_MIN;

        // Update input display dB
        const currentInputDisplayLeft = displayInputDbRef.current.left;
        const currentInputDisplayRight = displayInputDbRef.current.right;
        const inputLeftDiff = Math.abs(metering.inputLeftDb - currentInputDisplayLeft);
        const inputRightDiff = Math.abs(metering.inputRightDb - currentInputDisplayRight);

        if (inputLeftDiff > 1 || inputRightDiff > 1 || metering.inputLeftDb < currentInputDisplayLeft - 3 || metering.inputRightDb < currentInputDisplayRight - 3) {
          displayInputDbRef.current = { left: metering.inputLeftDb, right: metering.inputRightDb };
        }
      }

      // Update state with all meter data
      setMeterState({
        outputLeft: {
          width: dbToWidth(outputLeftDb),
          color: getMeterColor(outputLeftDb),
          displayDb: displayDbRef.current.left,
        },
        outputRight: {
          width: dbToWidth(outputRightDb),
          color: getMeterColor(outputRightDb),
          displayDb: displayDbRef.current.right,
        },
        inputLeft: {
          width: dbToWidth(inputLeftDb),
          color: getInputMeterColor(inputLeftDb),
          displayDb: displayInputDbRef.current.left,
        },
        inputRight: {
          width: dbToWidth(inputRightDb),
          color: getInputMeterColor(inputRightDb),
          displayDb: displayInputDbRef.current.right,
        },
      });

      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isOpen, isVisible]);

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
              onClick={() => setShowInputMeters(!showInputMeters)}
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
                width={meterState.inputLeft.width}
                color={meterState.inputLeft.color}
                displayDb={meterState.inputLeft.displayDb}
              />
              <MeterBar
                label="R"
                width={meterState.inputRight.width}
                color={meterState.inputRight.color}
                displayDb={meterState.inputRight.displayDb}
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
            onClick={() => setShowOutputMeters(!showOutputMeters)}
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
                width={meterState.outputLeft.width}
                color={meterState.outputLeft.color}
                displayDb={meterState.outputLeft.displayDb}
              />
              <MeterBar
                label="R"
                width={meterState.outputRight.width}
                color={meterState.outputRight.color}
                displayDb={meterState.outputRight.displayDb}
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
