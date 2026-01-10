import { useState, memo } from 'react';

// Common frequency notches for the slider (logarithmic scale)
const FREQ_NOTCHES = [
  { value: 20, label: '20' },
  { value: 100, label: '100' },
  { value: 440, label: '440' },
  { value: 1000, label: '1k' },
  { value: 5000, label: '5k' },
  { value: 10000, label: '10k' },
  { value: 20000, label: '20k' },
];

// Musical notes
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVES = [2, 3, 4, 5, 6];

// Convert MIDI note number to frequency (A4 = 69 = 440Hz)
function midiToFreq(midiNote: number): number {
  return Math.round(440 * Math.pow(2, (midiNote - 69) / 12));
}

// Convert note name and octave to MIDI note number
function noteToMidi(note: string, octave: number): number {
  const noteIndex = NOTE_NAMES.indexOf(note);
  return (octave + 1) * 12 + noteIndex;
}

// Get closest note name and octave from frequency
function freqToNote(freq: number): { note: string; octave: number } | null {
  if (freq < 20 || freq > 20000) return null;
  const midiNote = 69 + 12 * Math.log2(freq / 440);
  const roundedMidi = Math.round(midiNote);
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteIndex = roundedMidi % 12;
  return { note: NOTE_NAMES[noteIndex], octave };
}

// Convert linear slider value (0-1) to frequency (20-20000 Hz, logarithmic)
function sliderToFreq(value: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const freq = Math.pow(10, minLog + value * (maxLog - minLog));
  return Math.round(freq);
}

// Convert frequency to linear slider value (0-1)
function freqToSlider(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return (Math.log10(freq) - minLog) / (maxLog - minLog);
}

interface FrequencySelectorProps {
  frequency: number;
  onChange: (freq: number) => void;
}

export const FrequencySelector = memo(function FrequencySelector({ frequency, onChange }: FrequencySelectorProps) {
  const [mode, setMode] = useState<'slider' | 'note'>('slider');
  const [selectedOctave, setSelectedOctave] = useState(4);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);

  const currentNote = freqToNote(frequency);

  const handleNoteClick = (note: string) => {
    setSelectedNote(note);
    const freq = midiToFreq(noteToMidi(note, selectedOctave));
    onChange(freq);
  };

  const handleOctaveChange = (octave: number) => {
    setSelectedOctave(octave);
    // If a note is selected, update frequency with new octave
    if (selectedNote) {
      const freq = midiToFreq(noteToMidi(selectedNote, octave));
      onChange(freq);
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-0.5 bg-bg-primary rounded-md">
          <button
            onClick={() => setMode('slider')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              mode === 'slider'
                ? 'bg-bg-tertiary text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Frequency
          </button>
          <button
            onClick={() => setMode('note')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              mode === 'note'
                ? 'bg-bg-tertiary text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Note
          </button>
        </div>
        <span className="text-sm font-medium text-accent">
          {frequency} Hz
          {currentNote && (
            <span className="text-text-muted ml-1">
              ({currentNote.note}{currentNote.octave})
            </span>
          )}
        </span>
      </div>

      {mode === 'slider' ? (
        <>
          {/* Frequency Slider */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={freqToSlider(frequency)}
            onChange={(e) => onChange(sliderToFreq(Number(e.target.value)))}
            className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
          />
          <div className="flex justify-between px-0.5">
            {FREQ_NOTCHES.map((notch) => (
              <button
                key={notch.value}
                onClick={() => onChange(notch.value)}
                className={`text-[10px] transition-colors ${
                  Math.abs(frequency - notch.value) < notch.value * 0.1
                    ? 'text-accent font-medium'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {notch.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Octave Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Octave:</span>
            <div className="flex gap-1">
              {OCTAVES.map((oct) => (
                <button
                  key={oct}
                  onClick={() => handleOctaveChange(oct)}
                  className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                    selectedOctave === oct
                      ? 'bg-accent text-white'
                      : 'bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  {oct}
                </button>
              ))}
            </div>
          </div>

          {/* Note Grid */}
          <div className="grid grid-cols-6 gap-1">
            {NOTE_NAMES.map((note) => {
              const isSharp = note.includes('#');
              const isSelected = selectedNote === note;
              return (
                <button
                  key={note}
                  onClick={() => handleNoteClick(note)}
                  className={`py-2 rounded text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-accent text-white'
                      : isSharp
                        ? 'bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                        : 'bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                  }`}
                >
                  {note}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
