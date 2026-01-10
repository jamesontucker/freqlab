import { memo, useMemo } from 'react';

interface LevelMetersProps {
  animatedLevels: { left: number; right: number };
  displayDb: { left: number; right: number };
  clipHold: { left: boolean; right: boolean };
}

// Check from hottest to coolest (order matters!)
const getMeterColor = (db: number) => {
  if (db > -1) return 'bg-gradient-to-r from-orange-500 to-red-500';    // Near clipping
  if (db > -3) return 'bg-gradient-to-r from-yellow-500 to-orange-500'; // Hot
  if (db > -6) return 'bg-gradient-to-r from-accent to-yellow-500';     // Warm
  return 'bg-gradient-to-r from-accent to-accent-hover';                 // Normal
};

export const LevelMeters = memo(function LevelMeters({
  animatedLevels,
  displayDb,
  clipHold,
}: LevelMetersProps) {
  // Convert animated linear levels to dB for smooth bar rendering
  // Use useMemo to avoid recalculating on every render when values haven't changed
  const { leftWidth, rightWidth, leftColor, rightColor } = useMemo(() => {
    const leftDb = animatedLevels.left > 0 ? Math.max(-60, 20 * Math.log10(animatedLevels.left)) : -60;
    const rightDb = animatedLevels.right > 0 ? Math.max(-60, 20 * Math.log10(animatedLevels.right)) : -60;
    return {
      leftWidth: Math.max(0, (leftDb + 60) / 60 * 100),
      rightWidth: Math.max(0, (rightDb + 60) / 60 * 100),
      leftColor: getMeterColor(leftDb),
      rightColor: getMeterColor(rightDb),
    };
  }, [animatedLevels.left, animatedLevels.right]);

  return (
    <div className="space-y-2">
      {/* Left channel */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted w-3 font-mono">L</span>
        <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
          <div
            className={`h-full ${leftColor}`}
            style={{ width: `${leftWidth}%` }}
          />
          {/* dB notches */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-[50%] w-px h-full bg-white/20" title="-30dB" />
            <div className="absolute left-[70%] w-px h-full bg-white/20" title="-18dB" />
            <div className="absolute left-[80%] w-px h-full bg-white/25" title="-12dB" />
            <div className="absolute left-[90%] w-px h-full bg-yellow-400/40" title="-6dB" />
            <div className="absolute left-[100%] w-px h-full bg-red-400/50" title="0dB" />
          </div>
        </div>
        {clipHold.left ? (
          <span className="text-[10px] text-red-500 w-14 text-right font-mono font-bold animate-pulse">
            CLIP
          </span>
        ) : (
          <span className="text-[10px] text-text-muted w-14 text-right font-mono tabular-nums">
            {displayDb.left > -60 ? `${displayDb.left.toFixed(1)}` : '-∞'} dB
          </span>
        )}
      </div>

      {/* Right channel */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted w-3 font-mono">R</span>
        <div className="flex-1 h-2.5 bg-bg-tertiary rounded-full overflow-hidden relative">
          <div
            className={`h-full ${rightColor}`}
            style={{ width: `${rightWidth}%` }}
          />
          {/* dB notches */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-[50%] w-px h-full bg-white/20" title="-30dB" />
            <div className="absolute left-[70%] w-px h-full bg-white/20" title="-18dB" />
            <div className="absolute left-[80%] w-px h-full bg-white/25" title="-12dB" />
            <div className="absolute left-[90%] w-px h-full bg-yellow-400/40" title="-6dB" />
            <div className="absolute left-[100%] w-px h-full bg-red-400/50" title="0dB" />
          </div>
        </div>
        {clipHold.right ? (
          <span className="text-[10px] text-red-500 w-14 text-right font-mono font-bold animate-pulse">
            CLIP
          </span>
        ) : (
          <span className="text-[10px] text-text-muted w-14 text-right font-mono tabular-nums">
            {displayDb.right > -60 ? `${displayDb.right.toFixed(1)}` : '-∞'} dB
          </span>
        )}
      </div>

      {/* dB scale labels */}
      <div className="flex items-center gap-2 mt-1">
        <span className="w-3"></span>
        <div className="flex-1 flex justify-between text-[8px] text-text-muted/60 px-0.5">
          <span>-60</span>
          <span>-30</span>
          <span>-18</span>
          <span>-12</span>
          <span>-6</span>
          <span>0</span>
        </div>
        <span className="w-14"></span>
      </div>
    </div>
  );
});
