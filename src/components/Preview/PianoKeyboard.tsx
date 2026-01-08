import { useCallback, useRef, useState } from 'react';
import { midiNoteOn, midiNoteOff } from '../../api/preview';

interface PianoKeyboardProps {
  /** Starting MIDI note (default: 36 = C2) */
  startNote?: number;
  /** Number of octaves to display (default: 4) */
  octaves?: number;
  /** Set of currently active/pressed notes (for highlighting) */
  activeNotes?: Set<number>;
  /** Callback when a note is pressed */
  onNoteOn?: (note: number, velocity: number) => void;
  /** Callback when a note is released */
  onNoteOff?: (note: number) => void;
  /** Whether the keyboard is disabled */
  disabled?: boolean;
}

// Note names for labeling C keys
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Check if a note is a black key
const isBlackKey = (note: number): boolean => {
  const noteInOctave = note % 12;
  return [1, 3, 6, 8, 10].includes(noteInOctave);
};

// Get note name and octave
const getNoteName = (note: number): { name: string; octave: number } => {
  const noteInOctave = note % 12;
  const octave = Math.floor(note / 12) - 1; // MIDI octave (C4 = 60)
  return { name: NOTE_NAMES[noteInOctave], octave };
};

export function PianoKeyboard({
  startNote = 36, // C2
  octaves = 4,
  activeNotes = new Set(),
  onNoteOn,
  onNoteOff,
  disabled = false,
}: PianoKeyboardProps) {
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());
  const isMouseDownRef = useRef(false);
  const lastNoteRef = useRef<number | null>(null);

  // Calculate total notes
  const totalNotes = octaves * 12 + 1; // +1 for final C
  const endNote = startNote + totalNotes - 1;

  // Generate array of notes
  const notes: number[] = [];
  for (let i = startNote; i <= endNote; i++) {
    notes.push(i);
  }

  // Handle note press
  const handleNoteOn = useCallback(async (note: number) => {
    if (disabled) return;

    const velocity = 100; // Default velocity
    setPressedNotes(prev => new Set(prev).add(note));

    try {
      await midiNoteOn(note, velocity);
      onNoteOn?.(note, velocity);
    } catch (err) {
      console.error('Failed to send note on:', err);
    }
  }, [disabled, onNoteOn]);

  // Handle note release
  const handleNoteOff = useCallback(async (note: number) => {
    if (disabled) return;

    setPressedNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });

    try {
      await midiNoteOff(note);
      onNoteOff?.(note);
    } catch (err) {
      console.error('Failed to send note off:', err);
    }
  }, [disabled, onNoteOff]);

  // Mouse handlers for drag playing
  const handleMouseDown = useCallback((note: number) => {
    isMouseDownRef.current = true;
    lastNoteRef.current = note;
    handleNoteOn(note);
  }, [handleNoteOn]);

  const handleMouseUp = useCallback(() => {
    isMouseDownRef.current = false;
    if (lastNoteRef.current !== null) {
      handleNoteOff(lastNoteRef.current);
      lastNoteRef.current = null;
    }
  }, [handleNoteOff]);

  const handleMouseEnter = useCallback((note: number) => {
    if (isMouseDownRef.current && lastNoteRef.current !== note) {
      // Release previous note
      if (lastNoteRef.current !== null) {
        handleNoteOff(lastNoteRef.current);
      }
      // Press new note
      lastNoteRef.current = note;
      handleNoteOn(note);
    }
  }, [handleNoteOn, handleNoteOff]);

  // Note: handleMouseLeave intentionally does nothing - we don't release notes
  // when leaving a key, only when entering another key or mouse up

  // Global mouse up listener
  const handleGlobalMouseUp = useCallback(() => {
    if (isMouseDownRef.current) {
      handleMouseUp();
    }
  }, [handleMouseUp]);

  // Calculate white keys for positioning
  const whiteKeys = notes.filter(n => !isBlackKey(n));
  const whiteKeyWidth = 100 / whiteKeys.length;

  // Get white key index for a note (for positioning black keys)
  const getWhiteKeyIndex = (note: number): number => {
    let count = 0;
    for (let i = startNote; i < note; i++) {
      if (!isBlackKey(i)) count++;
    }
    return count;
  };

  return (
    <div
      className="relative select-none"
      onMouseUp={handleGlobalMouseUp}
      onMouseLeave={handleGlobalMouseUp}
    >
      {/* White keys */}
      <div className="flex h-24 relative">
        {notes.filter(n => !isBlackKey(n)).map((note, idx) => {
          const { name, octave } = getNoteName(note);
          const isActive = activeNotes.has(note) || pressedNotes.has(note);
          const isC = note % 12 === 0;

          return (
            <div
              key={note}
              className={`
                relative flex-1 border border-bg-tertiary rounded-b cursor-pointer
                transition-colors duration-75
                ${isActive
                  ? 'bg-accent/80'
                  : 'bg-white hover:bg-gray-100'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              onMouseDown={() => handleMouseDown(note)}
              onMouseUp={() => handleMouseUp()}
              onMouseEnter={() => handleMouseEnter(note)}
            >
              {/* Note label on C keys */}
              {isC && (
                <span className={`
                  absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-mono
                  ${isActive ? 'text-white' : 'text-gray-400'}
                `}>
                  {name}{octave}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Black keys (absolute positioned) */}
      <div className="absolute top-0 left-0 right-0 h-14 pointer-events-none">
        {notes.filter(n => isBlackKey(n)).map(note => {
          const isActive = activeNotes.has(note) || pressedNotes.has(note);
          const whiteKeyIdx = getWhiteKeyIndex(note);

          // Position black key between white keys
          // Black keys are positioned at 70% of the way through the white key
          const leftPercent = (whiteKeyIdx + 0.65) * whiteKeyWidth;

          return (
            <div
              key={note}
              className={`
                absolute w-[3%] h-full rounded-b pointer-events-auto cursor-pointer
                transition-colors duration-75 z-10
                ${isActive
                  ? 'bg-accent'
                  : 'bg-gray-900 hover:bg-gray-700'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              style={{ left: `${leftPercent}%` }}
              onMouseDown={() => handleMouseDown(note)}
              onMouseUp={() => handleMouseUp()}
              onMouseEnter={() => handleMouseEnter(note)}
            />
          );
        })}
      </div>
    </div>
  );
}
