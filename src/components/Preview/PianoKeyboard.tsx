import { useCallback, useRef, useEffect, useMemo } from 'react';
import { midiNoteOn, midiNoteOff } from '../../api/preview';

interface PianoKeyboardProps {
  /** Starting MIDI note (default: 36 = C2) */
  startNote?: number;
  /** Number of octaves to display (default: 4) */
  octaves?: number;
  /** Set of currently active/pressed notes (for highlighting from patterns) */
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

// Empty set for default prop (stable reference)
const EMPTY_SET = new Set<number>();

export function PianoKeyboard({
  startNote = 36, // C2
  octaves = 4,
  activeNotes = EMPTY_SET,
  onNoteOn,
  onNoteOff,
  disabled = false,
}: PianoKeyboardProps) {
  // Use refs instead of state to avoid re-renders on every note
  const containerRef = useRef<HTMLDivElement>(null);
  const pressedNotesRef = useRef<Set<number>>(new Set());
  const isMouseDownRef = useRef(false);
  const lastNoteRef = useRef<number | null>(null);
  const isPrewarmedRef = useRef(false);

  // Calculate total notes
  const totalNotes = octaves * 12 + 1; // +1 for final C
  const endNote = startNote + totalNotes - 1;

  // Generate array of notes (memoized)
  const notes = useMemo(() => {
    const arr: number[] = [];
    for (let i = startNote; i <= endNote; i++) {
      arr.push(i);
    }
    return arr;
  }, [startNote, endNote]);

  // Calculate white keys for positioning (memoized)
  const whiteKeys = useMemo(() => notes.filter(n => !isBlackKey(n)), [notes]);
  const whiteKeyWidth = 100 / whiteKeys.length;

  // Get white key index for positioning black keys (memoized map)
  const blackKeyPositions = useMemo(() => {
    const positions = new Map<number, number>();
    let whiteCount = 0;
    for (let i = startNote; i <= endNote; i++) {
      if (isBlackKey(i)) {
        positions.set(i, (whiteCount - 0.35) * whiteKeyWidth);
      } else {
        whiteCount++;
      }
    }
    return positions;
  }, [startNote, endNote, whiteKeyWidth]);

  // Direct DOM manipulation for visual feedback (no React re-render)
  const setKeyPressed = useCallback((note: number, pressed: boolean) => {
    const container = containerRef.current;
    if (!container) return;

    const keyEl = container.querySelector(`[data-note="${note}"]`) as HTMLElement;
    if (!keyEl) return;

    if (pressed) {
      keyEl.classList.add('key-pressed');
      pressedNotesRef.current.add(note);
    } else {
      keyEl.classList.remove('key-pressed');
      pressedNotesRef.current.delete(note);
    }
  }, []);

  // Fire-and-forget note on - no await, no React state update
  const fireNoteOn = useCallback((note: number) => {
    if (disabled) return;
    const velocity = 100;

    // Direct DOM update for visual feedback
    setKeyPressed(note, true);

    // Fire-and-forget MIDI event - no promise, no IPC response tracking
    midiNoteOn(note, velocity);

    onNoteOn?.(note, velocity);
  }, [disabled, onNoteOn, setKeyPressed]);

  // Fire-and-forget note off - no await, no React state update
  const fireNoteOff = useCallback((note: number) => {
    if (disabled) return;

    // Direct DOM update for visual feedback
    setKeyPressed(note, false);

    // Fire-and-forget MIDI event - no promise, no IPC response tracking
    midiNoteOff(note);

    onNoteOff?.(note);
  }, [disabled, onNoteOff, setKeyPressed]);

  // Handle mouse down on a key
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const noteStr = (e.target as HTMLElement).dataset.note;
    if (!noteStr) return;

    const note = parseInt(noteStr, 10);
    isMouseDownRef.current = true;
    lastNoteRef.current = note;
    fireNoteOn(note);
  }, [fireNoteOn]);

  // Handle mouse entering a key (for drag playing)
  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (!isMouseDownRef.current) return;

    const noteStr = (e.target as HTMLElement).dataset.note;
    if (!noteStr) return;

    const note = parseInt(noteStr, 10);
    if (lastNoteRef.current === note) return;

    // Release previous note
    if (lastNoteRef.current !== null) {
      fireNoteOff(lastNoteRef.current);
    }

    // Press new note
    lastNoteRef.current = note;
    fireNoteOn(note);
  }, [fireNoteOn, fireNoteOff]);

  // Global mouse up - release current note
  const handleGlobalMouseUp = useCallback(() => {
    if (!isMouseDownRef.current) return;

    isMouseDownRef.current = false;
    if (lastNoteRef.current !== null) {
      fireNoteOff(lastNoteRef.current);
      lastNoteRef.current = null;
    }
  }, [fireNoteOff]);

  // Pre-warm JavaScript/V8 JIT by exercising code paths on mount
  // This triggers JIT compilation before user interaction
  useEffect(() => {
    if (isPrewarmedRef.current || disabled) return;
    isPrewarmedRef.current = true;

    // Schedule pre-warming after a short delay to not block initial render
    const timeoutId = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      // Exercise the hot code paths many times to trigger V8 JIT optimization
      // We do this without actually sending MIDI (just exercise JS code paths)
      const warmupIterations = 500;
      const testNote = 60; // Middle C - fixed value to avoid re-running on octave change

      for (let i = 0; i < warmupIterations; i++) {
        // Exercise DOM query (use any key that exists)
        const keyEl = container.querySelector('[data-note]');
        if (keyEl) {
          // Exercise class manipulation
          keyEl.classList.add('key-pressed');
          keyEl.classList.remove('key-pressed');
        }

        // Exercise Set operations
        pressedNotesRef.current.add(testNote);
        pressedNotesRef.current.delete(testNote);
        pressedNotesRef.current.has(testNote);

        // Exercise parseInt (commonly used in handlers)
        parseInt(String(testNote), 10);
      }

      // Now send a few silent MIDI events to warm up the IPC/batching path
      // These use velocity 0 so no sound is produced
      for (let i = 0; i < 20; i++) {
        midiNoteOn(testNote, 0);
        midiNoteOff(testNote);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [disabled]);

  // Update visual state when activeNotes changes (for pattern playback highlighting)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Update all keys based on activeNotes
    notes.forEach(note => {
      const keyEl = container.querySelector(`[data-note="${note}"]`) as HTMLElement;
      if (!keyEl) return;

      const isActive = activeNotes.has(note) || pressedNotesRef.current.has(note);
      if (isActive) {
        keyEl.classList.add('key-active');
      } else {
        keyEl.classList.remove('key-active');
      }
    });
  }, [activeNotes, notes]);

  return (
    <div
      ref={containerRef}
      className="relative select-none piano-keyboard"
      onMouseUp={handleGlobalMouseUp}
      onMouseLeave={handleGlobalMouseUp}
      title={disabled ? 'Launch your plugin to play notes' : undefined}
    >
      {/* Inline styles for key states - avoids CSS file dependency */}
      <style>{`
        .piano-keyboard .key-pressed,
        .piano-keyboard .key-active {
          background-color: rgba(var(--color-accent-rgb, 99, 102, 241), 0.8) !important;
        }
        .piano-keyboard .white-key.key-pressed span,
        .piano-keyboard .white-key.key-active span {
          color: white !important;
        }
      `}</style>

      {/* White keys */}
      <div className="flex h-24 relative">
        {whiteKeys.map((note) => {
          const { name, octave } = getNoteName(note);
          const isC = note % 12 === 0;

          return (
            <div
              key={note}
              data-note={note}
              className={`
                white-key relative flex-1 border border-bg-tertiary rounded-b cursor-pointer
                bg-white hover:bg-gray-100
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              onMouseDown={handleMouseDown}
              onMouseEnter={handleMouseEnter}
            >
              {/* Note label on C keys */}
              {isC && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-mono pointer-events-none text-gray-400">
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
          const leftPercent = blackKeyPositions.get(note) ?? 0;

          return (
            <div
              key={note}
              data-note={note}
              className={`
                black-key absolute w-[3%] h-full rounded-b pointer-events-auto cursor-pointer
                z-10 bg-gray-900 hover:bg-gray-700
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              style={{ left: `${leftPercent}%` }}
              onMouseDown={handleMouseDown}
              onMouseEnter={handleMouseEnter}
            />
          );
        })}
      </div>
    </div>
  );
}
