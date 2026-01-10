import { useState, useEffect, useCallback, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  type MidiFileInfo,
  midiFileLoad,
  midiFileUnload,
  midiFilePlay,
  midiFileStop,
  midiFileSetTempoAutomation,
  midiFileGetPosition,
  midiFileSeek,
  patternSetBpm,
  patternSetOctaveShift,
} from '../../api/preview';
import { Tooltip } from '../Common/Tooltip';

interface MidiFileControlsProps {
  pluginLoaded: boolean;
}

const OCTAVE_OPTIONS = [
  { value: -2, label: '-2' },
  { value: -1, label: '-1' },
  { value: 0, label: '0' },
  { value: 1, label: '+1' },
  { value: 2, label: '+2' },
];

export function MidiFileControls({ pluginLoaded }: MidiFileControlsProps) {
  const [fileInfo, setFileInfo] = useState<MidiFileInfo | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [originalBpm, setOriginalBpm] = useState(120);
  const [octaveShift, setOctaveShift] = useState(0);
  const [useTempoAutomation, setUseTempoAutomation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);

  const playbackStartedRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isSwitchingTrackRef = useRef(false);
  const isMountedRef = useRef(true);
  const isPollInFlightRef = useRef(false);

  // Track mounted state and stop playback on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (playbackStartedRef.current) {
        midiFileStop().catch(err => {
          console.error('Failed to stop MIDI file on unmount:', err);
        });
      }
    };
  }, []);

  // Poll playback position while playing (with guards against overlapping calls)
  useEffect(() => {
    if (!isPlaying) return;

    const pollPosition = async () => {
      // Skip if previous poll is still in flight or component unmounted
      if (isPollInFlightRef.current || !isMountedRef.current) return;

      isPollInFlightRef.current = true;
      try {
        const posInfo = await midiFileGetPosition();
        if (!isMountedRef.current) return;

        setPlaybackPosition(posInfo.position);
        setPlaybackDuration(posInfo.duration);
        // Sync playing state in case playback ended (but not during track switch)
        if (!posInfo.is_playing && isPlaying && !isSwitchingTrackRef.current) {
          setIsPlaying(false);
          playbackStartedRef.current = false;
        }
      } catch {
        // Ignore errors during polling
      } finally {
        isPollInFlightRef.current = false;
      }
    };

    // Poll at 10Hz (100ms) - plenty fast for position display, reduces IPC overhead
    const interval = setInterval(pollPosition, 100);
    pollPosition(); // Initial poll

    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleLoadFile = useCallback(async () => {
    try {
      // Stop any current playback
      if (isPlaying) {
        await midiFileStop();
        if (isMountedRef.current) {
          setIsPlaying(false);
          playbackStartedRef.current = false;
        }
      }

      const path = await open({
        multiple: false,
        filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }],
      });

      if (!path || !isMountedRef.current) return;

      setLoading(true);
      setError(null);

      const info = await midiFileLoad(path as string);
      if (!isMountedRef.current) return;

      setFileInfo(info);
      setSelectedTrack(0);
      setOctaveShift(0);
      setPlaybackPosition(0);
      setPlaybackDuration(info.duration_beats);
      // Set BPM from file and remember as original
      const fileBpm = Math.round(info.bpm);
      setBpm(fileBpm);
      setOriginalBpm(fileBpm);
      // Auto-enable tempo automation if file has it
      setUseTempoAutomation(info.has_tempo_automation);
    } catch (err) {
      console.error('Failed to load MIDI file:', err);
      if (isMountedRef.current) {
        setError(String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [isPlaying]);

  const handleUnloadFile = useCallback(async () => {
    try {
      await midiFileUnload();
      if (isMountedRef.current) {
        setFileInfo(null);
        setSelectedTrack(0);
        setIsPlaying(false);
        playbackStartedRef.current = false;
      }
    } catch (err) {
      console.error('Failed to unload MIDI file:', err);
    }
  }, []);

  const handleTrackSelect = useCallback(async (trackIndex: number) => {
    if (!isMountedRef.current) return;
    setSelectedTrack(trackIndex);

    // If already playing, switch to new track while preserving position
    if (isPlaying && pluginLoaded && fileInfo) {
      try {
        // Mark that we're switching tracks (prevents polling from setting isPlaying=false)
        isSwitchingTrackRef.current = true;

        // Get current position before switching
        const currentPos = playbackPosition;
        // Clamp position to new track's duration
        const newTrackDuration = fileInfo.tracks[trackIndex]?.duration_beats ?? 0;
        const seekPos = Math.min(currentPos, newTrackDuration);

        // Start new track playback
        await midiFilePlay(trackIndex, bpm, octaveShift, true, useTempoAutomation);

        // Seek to preserved position (only if we had meaningful progress)
        if (seekPos > 0.5) {
          await midiFileSeek(seekPos);
        }
      } catch (err) {
        console.error('Failed to switch track:', err);
      } finally {
        isSwitchingTrackRef.current = false;
      }
    }
  }, [isPlaying, pluginLoaded, bpm, octaveShift, useTempoAutomation, fileInfo, playbackPosition]);

  const handlePlay = useCallback(async () => {
    if (!fileInfo || !pluginLoaded) return;

    try {
      await midiFilePlay(selectedTrack, bpm, octaveShift, true, useTempoAutomation);
      if (isMountedRef.current) {
        setIsPlaying(true);
        playbackStartedRef.current = true;
      }
    } catch (err) {
      console.error('Failed to play MIDI file:', err);
    }
  }, [fileInfo, selectedTrack, bpm, octaveShift, pluginLoaded, useTempoAutomation]);

  const handleStop = useCallback(async () => {
    try {
      await midiFileStop();
      if (isMountedRef.current) {
        setIsPlaying(false);
        playbackStartedRef.current = false;
      }
    } catch (err) {
      console.error('Failed to stop MIDI file:', err);
    }
  }, []);

  const handleBpmChange = useCallback(async (newBpm: number) => {
    setBpm(newBpm);
    if (isPlaying && !useTempoAutomation) {
      try {
        await patternSetBpm(newBpm);
      } catch (err) {
        console.error('Failed to set BPM:', err);
      }
    }
  }, [isPlaying, useTempoAutomation]);

  const handleResetBpm = useCallback(() => {
    handleBpmChange(originalBpm);
  }, [originalBpm, handleBpmChange]);

  const handleOctaveChange = useCallback(async (newOctave: number) => {
    setOctaveShift(newOctave);
    if (isPlaying) {
      try {
        await patternSetOctaveShift(newOctave);
      } catch (err) {
        console.error('Failed to set octave shift:', err);
      }
    }
  }, [isPlaying]);

  const handleTempoAutomationToggle = useCallback(async () => {
    const newValue = !useTempoAutomation;
    setUseTempoAutomation(newValue);

    // If currently playing, update immediately
    if (isPlaying) {
      try {
        await midiFileSetTempoAutomation(newValue);
      } catch (err) {
        console.error('Failed to toggle tempo automation:', err);
      }
    }
  }, [useTempoAutomation, isPlaying]);

  const handleSeek = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !fileInfo) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const duration = fileInfo.tracks[selectedTrack]?.duration_beats ?? fileInfo.duration_beats;
    const newPosition = percentage * duration;

    try {
      await midiFileSeek(newPosition);
      setPlaybackPosition(newPosition);
    } catch (err) {
      console.error('Failed to seek:', err);
    }
  }, [fileInfo, selectedTrack]);

  const hasTempoAutomation = fileInfo?.has_tempo_automation ?? false;
  const trackDuration = fileInfo?.tracks[selectedTrack]?.duration_beats ?? playbackDuration;
  const progressPercentage = trackDuration > 0 ? (playbackPosition / trackDuration) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* File Loading */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleLoadFile}
          disabled={loading}
          className="flex-1 px-3 py-2 bg-bg-tertiary hover:bg-bg-tertiary/80 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : fileInfo ? 'Load Different File' : 'Load MIDI File'}
        </button>
        {fileInfo && (
          <button
            onClick={handleUnloadFile}
            className="px-3 py-2 bg-bg-tertiary hover:bg-error/20 rounded-lg text-sm text-text-secondary hover:text-error transition-colors"
            title="Unload MIDI file"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-error">{error}</p>
      )}

      {fileInfo && (
        <>
          {/* File Info */}
          <div className="px-3 py-2 bg-bg-tertiary/50 rounded-lg">
            <p className="text-sm font-medium text-text-primary truncate" title={fileInfo.filename}>
              {fileInfo.filename}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {fileInfo.tracks.length} track{fileInfo.tracks.length !== 1 ? 's' : ''} &middot; {Math.round(fileInfo.duration_beats)} beats
              {hasTempoAutomation && ' \u00B7 tempo changes'}
            </p>
          </div>

          {/* Track Selection */}
          {fileInfo.tracks.length > 1 && (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              <p className="text-xs text-text-muted mb-1">Select Track</p>
              {fileInfo.tracks.map((track, index) => (
                <button
                  key={track.index}
                  onClick={() => handleTrackSelect(index)}
                  className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    selectedTrack === index
                      ? 'bg-accent/10 border border-accent/30 text-accent'
                      : 'bg-bg-tertiary border border-transparent text-text-secondary hover:text-text-primary hover:border-border'
                  }`}
                >
                  <span className="font-medium">
                    {track.name || `Track ${track.index + 1}`}
                  </span>
                  <span className="text-xs text-text-muted ml-2">
                    {track.note_count} notes
                    {track.channel !== null && ` (Ch ${track.channel + 1})`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Octave Shift */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Octave</span>
            <div className="flex gap-1">
              {OCTAVE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleOctaveChange(opt.value)}
                  className={`
                    px-2 py-1 text-xs font-medium rounded transition-colors
                    ${octaveShift === opt.value
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tempo Automation Toggle (only show if file has tempo changes) */}
          {hasTempoAutomation && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Follow tempo changes</span>
              <button
                onClick={handleTempoAutomationToggle}
                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                  useTempoAutomation ? 'bg-accent' : 'bg-bg-tertiary border border-border'
                }`}
              >
                <span
                  className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                    useTempoAutomation ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          )}

          {/* Playback Progress Bar */}
          <div className="space-y-1">
            <div
              ref={progressBarRef}
              onClick={handleSeek}
              className="relative h-2 bg-bg-tertiary rounded-full cursor-pointer group"
              title="Click to seek"
            >
              <div
                className="absolute inset-y-0 left-0 bg-accent rounded-full transition-all duration-75"
                style={{ width: `${Math.min(100, progressPercentage)}%` }}
              />
              {/* Hover indicator */}
              <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 bg-white/10 transition-opacity" />
            </div>
            <div className="flex justify-between text-xs text-text-muted tabular-nums">
              <span>{playbackPosition.toFixed(1)} beats</span>
              <span>{trackDuration.toFixed(1)} beats</span>
            </div>
          </div>

          {/* Tempo Control */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Tempo</span>
              {useTempoAutomation ? (
                <span className="text-xs text-text-muted italic">Following file</span>
              ) : (
                <>
                  <span className="text-xs font-medium text-accent tabular-nums">{bpm} BPM</span>
                  {bpm !== originalBpm && (
                    <button
                      onClick={handleResetBpm}
                      className="text-xs text-text-muted hover:text-text-primary transition-colors"
                      title={`Reset to original (${originalBpm} BPM)`}
                    >
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {originalBpm}
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
            {!useTempoAutomation && (
              <input
                type="range"
                min={Math.min(40, originalBpm)}
                max={Math.max(200, originalBpm)}
                value={bpm}
                onChange={(e) => handleBpmChange(Number(e.target.value))}
                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
              />
            )}
          </div>

          {/* Transport Controls */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <Tooltip content={!pluginLoaded ? 'Launch your plugin to play MIDI files' : isPlaying ? 'Stop' : 'Play MIDI File'}>
                <button
                  onClick={isPlaying ? handleStop : handlePlay}
                  disabled={!pluginLoaded}
                  className={`p-2 rounded-lg transition-all duration-200 ${
                    !pluginLoaded
                      ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                      : isPlaying
                        ? 'bg-error text-white hover:bg-error/90'
                        : 'bg-accent text-white hover:bg-accent-hover'
                  }`}
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
              </Tooltip>
              <span className="flex-1 text-xs text-text-muted">MIDI Playback</span>
            </div>
          </div>
        </>
      )}

      {!fileInfo && !loading && (
        <p className="text-xs text-text-muted text-center py-2">
          Load a MIDI file to play through the instrument
        </p>
      )}

    </div>
  );
}
