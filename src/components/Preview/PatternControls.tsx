import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type PatternCategory,
  type PatternInfo,
  patternList,
  patternPlay,
  patternStop,
  patternSetBpm,
} from '../../api/preview';

interface PatternControlsProps {
  pluginLoaded: boolean;
}

const CATEGORIES: { id: PatternCategory; label: string }[] = [
  { id: 'Melodic', label: 'Melodic' },
  { id: 'Bass', label: 'Bass' },
  { id: 'Drums', label: 'Drums' },
];

export function PatternControls({ pluginLoaded }: PatternControlsProps) {
  const [patterns, setPatterns] = useState<PatternInfo[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<PatternCategory>('Melodic');
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [loading, setLoading] = useState(true);

  // Use ref to track if we started playback (to know when to show stop button)
  const playbackStartedRef = useRef(false);

  // Load patterns once on mount
  useEffect(() => {
    let cancelled = false;

    const loadPatterns = async () => {
      try {
        const allPatterns = await patternList();
        if (!cancelled) {
          setPatterns(allPatterns);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load patterns:', err);
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPatterns();

    return () => {
      cancelled = true;
    };
  }, []);

  // Stop playback when component unmounts
  useEffect(() => {
    return () => {
      if (playbackStartedRef.current) {
        patternStop().catch(err => {
          console.error('Failed to stop pattern on unmount:', err);
        });
      }
    };
  }, []);

  const filteredPatterns = patterns.filter(p => p.category === selectedCategory);

  const handlePlay = useCallback(async () => {
    if (!selectedPattern || !pluginLoaded) return;

    try {
      await patternPlay(selectedPattern, bpm, 0, true);
      setIsPlaying(true);
      playbackStartedRef.current = true;
    } catch (err) {
      console.error('Failed to play pattern:', err);
    }
  }, [selectedPattern, bpm, pluginLoaded]);

  const handleStop = useCallback(async () => {
    try {
      await patternStop();
      setIsPlaying(false);
      playbackStartedRef.current = false;
    } catch (err) {
      console.error('Failed to stop pattern:', err);
    }
  }, []);

  const handleBpmChange = useCallback(async (newBpm: number) => {
    setBpm(newBpm);
    if (isPlaying) {
      try {
        await patternSetBpm(newBpm);
      } catch (err) {
        console.error('Failed to set BPM:', err);
      }
    }
  }, [isPlaying]);

  if (loading) {
    return (
      <div className="py-8 text-center">
        <div className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-muted mt-2">Loading patterns...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category Tabs */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
              selectedCategory === cat.id
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Pattern List */}
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {filteredPatterns.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-4">
            No patterns in this category
          </p>
        ) : (
          filteredPatterns.map(pattern => (
            <button
              key={pattern.id}
              onClick={() => setSelectedPattern(pattern.id)}
              className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                selectedPattern === pattern.id
                  ? 'bg-accent/10 border border-accent/30 text-accent'
                  : 'bg-bg-tertiary border border-transparent text-text-secondary hover:text-text-primary hover:border-border'
              }`}
            >
              <span className="font-medium">{pattern.name}</span>
              <span className="text-xs text-text-muted ml-2">
                {pattern.length_beats} beats
              </span>
            </button>
          ))
        )}
      </div>

      {/* Tempo & Play Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-text-muted">Tempo</span>
            <span className="text-xs font-medium text-accent tabular-nums">{bpm} BPM</span>
          </div>
          {/* Play/Stop Button */}
          <button
            onClick={isPlaying ? handleStop : handlePlay}
            disabled={!pluginLoaded || (!isPlaying && !selectedPattern)}
            className={`p-2 rounded-lg transition-all duration-200 ${
              !pluginLoaded || (!isPlaying && !selectedPattern)
                ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                : isPlaying
                  ? 'bg-error text-white hover:bg-error/90'
                  : 'bg-accent text-white hover:bg-accent-hover'
            }`}
            title={isPlaying ? 'Stop' : 'Play Pattern'}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
            )}
          </button>
        </div>
        <input
          type="range"
          min={40}
          max={200}
          value={bpm}
          onChange={(e) => handleBpmChange(Number(e.target.value))}
          className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
        />
      </div>

      {!pluginLoaded && (
        <p className="text-xs text-text-muted text-center">
          Enable Plugin Viewer to play patterns
        </p>
      )}
    </div>
  );
}
