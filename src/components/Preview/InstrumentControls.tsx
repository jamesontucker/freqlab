import { useState, useCallback, memo } from 'react';
import { PianoKeyboard } from './PianoKeyboard';
import { PatternControls } from './PatternControls';
import { MidiFileControls } from './MidiFileControls';
import { MidiLiveControls } from './MidiLiveControls';
import { midiAllNotesOff } from '../../api/preview';
import { Tooltip } from '../Common/Tooltip';

interface InstrumentControlsProps {
  /** Whether a plugin is loaded */
  pluginLoaded: boolean;
  /** Set of currently active notes (from pattern playback, MIDI input, etc.) */
  activeNotes?: Set<number>;
  /** Callback when the active MIDI source tab changes */
  onTabChange?: (tab: 'piano' | 'patterns' | 'midi' | 'live') => void;
}

// Tab definitions - Piano 3rd to reduce exposure to warm-up lag
type TabId = 'patterns' | 'midi' | 'piano' | 'live';

const TABS: { id: TabId; label: string; enabled: boolean }[] = [
  { id: 'patterns', label: 'Patterns', enabled: true },
  { id: 'midi', label: 'MIDI File', enabled: true },
  { id: 'piano', label: 'Piano', enabled: true },
  { id: 'live', label: 'Live', enabled: true },
];

// Octave shift options
const OCTAVE_OPTIONS = [
  { value: -2, label: '-2' },
  { value: -1, label: '-1' },
  { value: 0, label: '0' },
  { value: 1, label: '+1' },
  { value: 2, label: '+2' },
];

export const InstrumentControls = memo(function InstrumentControls({
  pluginLoaded,
  activeNotes = new Set(),
  onTabChange,
}: InstrumentControlsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('patterns');

  // Notify parent when tab changes
  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);
  const [octaveShift, setOctaveShift] = useState(0);
  const [keyboardKey, setKeyboardKey] = useState(0);

  const baseStartNote = 36;
  const startNote = baseStartNote + (octaveShift * 12);

  const handlePanic = useCallback(async () => {
    try {
      await midiAllNotesOff();
    } catch (err) {
      console.error('Failed to send all notes off:', err);
    }
  }, []);

  const handleOctaveChange = useCallback(async (newOctave: number) => {
    if (newOctave === octaveShift) return;
    try {
      await midiAllNotesOff();
    } catch (err) {
      console.error('Failed to send all notes off on octave change:', err);
    }
    setOctaveShift(newOctave);
    setKeyboardKey(k => k + 1);
  }, [octaveShift]);

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => tab.enabled && handleTabChange(tab.id)}
            disabled={!tab.enabled}
            className={`
              flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors
              ${!tab.enabled
                ? 'text-text-muted cursor-not-allowed'
                : activeTab === tab.id
                  ? 'bg-bg-primary text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Piano Tab */}
      {activeTab === 'piano' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
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
            <Tooltip content={!pluginLoaded ? 'Launch your plugin first' : 'Stop all notes (All Notes Off)'}>
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
              >
                Panic
              </button>
            </Tooltip>
          </div>
          <div className="bg-bg-secondary rounded-lg p-3">
            <PianoKeyboard
              key={keyboardKey}
              startNote={startNote}
              octaves={4}
              activeNotes={activeNotes}
              disabled={!pluginLoaded}
            />
          </div>
          {pluginLoaded && (
            <p className="text-xs text-text-muted text-center italic">
              Note: Piano may be briefly laggy on first use while the system warms up
            </p>
          )}
        </div>
      )}

      {/* Patterns Tab */}
      {activeTab === 'patterns' && (
        <PatternControls pluginLoaded={pluginLoaded} />
      )}

      {/* MIDI File Tab */}
      {activeTab === 'midi' && (
        <MidiFileControls pluginLoaded={pluginLoaded} />
      )}

      {/* Live Tab */}
      {activeTab === 'live' && (
        <MidiLiveControls pluginLoaded={pluginLoaded} />
      )}
    </div>
  );
});
