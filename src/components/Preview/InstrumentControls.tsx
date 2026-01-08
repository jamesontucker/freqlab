import { useState, useCallback } from 'react';
import { PianoKeyboard } from './PianoKeyboard';
import { midiAllNotesOff } from '../../api/preview';

interface InstrumentControlsProps {
  /** Whether a plugin is loaded */
  pluginLoaded: boolean;
  /** Set of currently active notes (from pattern playback, MIDI input, etc.) */
  activeNotes?: Set<number>;
}

// Octave shift options
const OCTAVE_OPTIONS = [
  { value: -2, label: '-2' },
  { value: -1, label: '-1' },
  { value: 0, label: '0' },
  { value: 1, label: '+1' },
  { value: 2, label: '+2' },
];

export function InstrumentControls({
  pluginLoaded,
  activeNotes = new Set(),
}: InstrumentControlsProps) {
  const [octaveShift, setOctaveShift] = useState(0);
  // Key to force PianoKeyboard remount (clears pressed state)
  const [keyboardKey, setKeyboardKey] = useState(0);

  // Calculate starting note based on octave shift
  // Base: C2 (36), shift by 12 semitones per octave
  const baseStartNote = 36;
  const startNote = baseStartNote + (octaveShift * 12);

  // Handle panic button
  const handlePanic = useCallback(async () => {
    try {
      await midiAllNotesOff();
    } catch (err) {
      console.error('Failed to send all notes off:', err);
    }
  }, []);

  // Handle octave change - send all notes off to prevent stuck notes
  const handleOctaveChange = useCallback(async (newOctave: number) => {
    if (newOctave === octaveShift) return;

    // Send all notes off before changing octave (in case any notes are held)
    try {
      await midiAllNotesOff();
    } catch (err) {
      console.error('Failed to send all notes off on octave change:', err);
    }

    setOctaveShift(newOctave);
    // Force keyboard remount to clear pressed state
    setKeyboardKey(k => k + 1);
  }, [octaveShift]);

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Octave shift */}
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

        {/* Panic button */}
        <button
          onClick={handlePanic}
          disabled={!pluginLoaded}
          className={`
            px-3 py-1.5 text-xs font-medium rounded transition-colors
            ${pluginLoaded
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            }
          `}
          title="Stop all notes (panic)"
        >
          Panic
        </button>
      </div>

      {/* Piano keyboard */}
      <div className="bg-bg-secondary rounded-lg p-3">
        <PianoKeyboard
          key={keyboardKey}
          startNote={startNote}
          octaves={4}
          activeNotes={activeNotes}
          disabled={!pluginLoaded}
        />
      </div>

      {/* Help text */}
      {!pluginLoaded && (
        <p className="text-xs text-text-muted text-center">
          Load an instrument plugin to play notes
        </p>
      )}
    </div>
  );
}
