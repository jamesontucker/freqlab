# MIDI Instrument Controls Design

## Overview

Add MIDI input capabilities for instrument plugins in the preview panel, including pattern presets, MIDI file playback, live MIDI device input, and a virtual piano keyboard.

## UI Structure

### Tab Layout
Four tabs:
- **Piano** - Virtual piano keyboard for direct note input (standalone tab)
- **Patterns** - Preset musical patterns with playback controls
- **MIDI File** - Load and play .mid files
- **Live** - Connect MIDI keyboard/controller

### Virtual Piano Keyboard
- Full 4-octave piano displayed in Piano tab
- Clickable with mouse to trigger notes (supports drag for glissando)
- Highlights keys when notes play
- Octave shift control: -2 to +2 (shifts entire keyboard range)
- Panic button to stop all notes
- Also available as compact display in other tabs to show active notes

### Patterns Tab
- Category pills: "Melodic" | "Bass" | "Drums"
- Preset grid/list with selectable patterns
- BPM control: 20-400 (default 120)
- Octave shift: -2 to +2 pills (default 0)
- Loop toggle (default on)
- Play/Stop button

### MIDI File Tab
- "Load MIDI File" button + filename display
- Track selector dropdown (for multi-track files)
- BPM display with override option
- Loop toggle
- Play/Stop button

### Live Tab
- MIDI device selector dropdown
- Connection status indicator
- Activity indicator (last note played)
- Passes notes + CC messages (sustain, mod wheel, pitch bend)

## Pattern Presets

### Structure
```rust
struct PatternNote {
    beat: f32,      // When to play (0.0 = start)
    note: u8,       // MIDI note number
    velocity: u8,   // 0-127
    duration: f32,  // Length in beats
}
```

### Initial Presets (~12 total)

**Melodic:**
- Arpeggio Up (C-E-G-C quarter notes)
- Arpeggio Down
- Scale Run (C major ascending/descending)
- Chord Stabs (triads on beats)
- Lead Line (simple melodic phrase)

**Bass:**
- Root Pulse (steady quarter notes)
- Octave Bounce (root alternating with octave)
- Walking Bass (simple jazz walk)

**Drums:**
- Four on Floor (kick every beat)
- Basic Beat (kick, snare, hat)
- Breakbeat (syncopated)

## Backend Architecture

### New Module: `src-tauri/src/audio/midi/`
- `mod.rs` - Module exports
- `patterns.rs` - Hardcoded pattern presets
- `file.rs` - MIDI file parsing (using `midly` crate)
- `device.rs` - MIDI device I/O (using `midir` crate)
- `player.rs` - Scheduled playback engine
- `events.rs` - MIDI event types and queue

### Dependencies
```toml
midly = "0.5"  # MIDI file parsing
midir = "0.9"  # MIDI device I/O
```

### Data Flow
```
Patterns/MIDI File → Player (scheduled by BPM) → Event Queue → Plugin
Live Device → midir callback → Event Queue → Plugin (immediate)
Piano Click → Tauri IPC → Event Queue → Plugin (immediate)
```

### CLAP MIDI Integration
Currently `clap_host.rs` passes empty input events. Need to:
1. Add MIDI event queue to `ClapHost`
2. Implement `input_events_size` and `input_events_get` that return queued events
3. Format notes as `CLAP_EVENT_NOTE_ON` / `CLAP_EVENT_NOTE_OFF`

### Tauri Commands
```rust
// Playback
midi_play_pattern(pattern_id, bpm, octave_shift, loop_enabled)
midi_stop()

// MIDI File
midi_load_file(path) -> Vec<TrackInfo>
midi_play_file(track_index, bpm_override, loop_enabled)

// Piano/Direct
midi_note_on(note, velocity)
midi_note_off(note)

// Device
midi_list_devices() -> Vec<String>
midi_connect_device(device_name)
midi_disconnect_device()
```

## Error Handling

### MIDI File
- Invalid/corrupt file → Toast error, clear state
- Empty file (no notes) → Toast warning
- No tempo in file → Default to 120 BPM

### MIDI Device
- No devices found → Show message in dropdown
- Device disconnected → Toast warning, reset state
- Device fails to open → Toast error

### Playback
- No plugin loaded → Toast "Load a plugin first"
- Plugin unloaded during playback → Stop, send all-notes-off

### All-Notes-Off
Send note-off for all 128 notes when:
- Stopping playback
- Switching patterns
- Disconnecting device
- Plugin unloads

## State Management

### Stored in previewStore (session only)
- BPM value
- Octave shift
- Loop toggle
- Selected pattern category
- Selected pattern

### Not persisted
- Selected MIDI device (changes between sessions)
- Loaded MIDI file (may not exist)

## Latency Considerations

- Lock-free ringbuf queue for MIDI events (same pattern as audio)
- Live device input: latency = audio buffer size (~10ms at 512/48kHz)
- Piano clicks: +5-15ms IPC overhead (acceptable for casual use)
- Pattern/file playback: scheduled ahead, no latency concern

## Implementation Phases

### Phase 1: CLAP MIDI + Piano Keyboard ✅ COMPLETE
- [x] Add MIDI event queue to ClapHost (lock-free ringbuf)
- [x] Implement CLAP note events (CLAP_EVENT_NOTE_ON/OFF)
- [x] Create InstrumentControls component with piano keyboard
- [x] Add midi_note_on/off/all_notes_off commands
- [x] Add is_instrument_plugin flag for proper audio callback behavior
- [x] Fix stuck notes on octave change
- **Result:** Click piano key → hear sound from instrument plugin ✓

### Phase 2: Patterns + Playback
- Implement pattern presets in Rust
- Add player with BPM-based scheduling
- Create PatternControls UI
- BPM, octave shift, loop controls
- **Goal:** Select pattern → plays through instrument

### Phase 3: MIDI File Loading
- Add midly for file parsing
- Implement track listing and selection
- Create MidiFileControls UI
- **Goal:** Load .mid file → plays through instrument

### Phase 4: Live MIDI Device Input
- Add midir for device I/O
- Implement device enumeration and connection
- Create MidiLiveControls UI
- Pass CC messages (sustain, mod wheel, pitch bend)
- **Goal:** Play MIDI keyboard → hear instrument in real-time

## Frontend Components

```
src/components/Preview/
  InstrumentControls.tsx    # Main container with tabs (Piano tab currently active)
  PianoKeyboard.tsx         # Virtual piano keyboard ✅ DONE
  PatternControls.tsx       # Pattern selection and playback (Phase 2)
  MidiFileControls.tsx      # File loading and track selection (Phase 3)
  MidiLiveControls.tsx      # Device connection (Phase 4)
```

## Files to Create/Modify

### Create
- `src-tauri/src/audio/midi/mod.rs`
- `src-tauri/src/audio/midi/events.rs`
- `src-tauri/src/audio/midi/patterns.rs`
- `src-tauri/src/audio/midi/file.rs`
- `src-tauri/src/audio/midi/device.rs`
- `src-tauri/src/audio/midi/player.rs`
- `src/components/Preview/InstrumentControls.tsx`
- `src/components/Preview/PianoKeyboard.tsx`
- `src/components/Preview/PatternControls.tsx`
- `src/components/Preview/MidiFileControls.tsx`
- `src/components/Preview/MidiLiveControls.tsx`
- `src/api/midi.ts`

### Modify
- `src-tauri/Cargo.toml` - Add midly, midir
- `src-tauri/src/audio/mod.rs` - Export midi module
- `src-tauri/src/audio/plugin/clap_host.rs` - MIDI event handling
- `src-tauri/src/lib.rs` - Register MIDI commands
- `src/stores/previewStore.ts` - MIDI state
- `src/components/Preview/PreviewPanel.tsx` - Use InstrumentControls
