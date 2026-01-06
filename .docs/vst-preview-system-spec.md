# Freqlab VST Preview System Spec

## Overview

A hot-reloadable VST preview system that allows real-time iteration on plugins without exporting to a DAW. The system handles both instrument (synth) and effect plugins with appropriate input sources for each.

## Goals

- Preview VST builds instantly within Freqlab
- Hot reload on code changes without audio interruption
- Support both synth plugins (MIDI input) and effect plugins (audio input)
- Provide various test inputs (demo samples, test signals, live audio, virtual keyboard)
- Maintain audio state across reloads where possible

---

## Hot Reload Approaches

### Approach 1: Dynamic Library Reloading (Recommended for NIH-plug)

Compile the plugin as a dynamic library, watch for changes, unload and reload on rebuild.

**How it works:**
- Watch source files with filesystem watcher
- Trigger cargo rebuild on change
- Fade out audio briefly
- Unload old dynamic library
- Load new dynamic library
- Fade audio back in

**Pros:**
- Works directly with existing NIH-plug output
- No architectural changes needed to DSP code
- Straightforward implementation

**Cons:**
- Brief audio interruption on reload (mitigated by crossfade)
- State inside the plugin is lost on reload

**Suggested crates:**
- `notify` - filesystem watching
- `libloading` - dynamic library loading
- `parking_lot` - fast RwLock for safe hot swapping

---

### Approach 2: WASM-Based DSP

Compile DSP logic to WebAssembly, host WASM runtime, swap modules seamlessly.

**How it works:**
- DSP core compiles to WASM
- Thin NIH-plug wrapper loads WASM and delegates processing
- WASM modules can be swapped near-instantly
- Wrapper remains stable, only DSP reloads

**Project structure:**
```
project/
├── dsp-core/          # WASM hot-reloadable DSP
├── plugin-wrapper/    # NIH-plug wrapper (stable)
└── preview-host/      # Freqlab preview system
```

**Pros:**
- Cleanest reload story (near-instant, no audio glitch)
- Clear separation between DSP and plugin infrastructure
- WASM boundary enforces clean architecture

**Cons:**
- More complex initial setup
- WASM has some limitations (no SIMD in all runtimes, memory model)
- Two compilation targets to manage

**Suggested crates:**
- `wasmtime` - WASM runtime
- `wasmer` - alternative WASM runtime

---

### Approach 3: hot-lib-reloader Crate

Purpose-built crate for hot reloading Rust code.

**How it works:**
- Mark functions as hot-reloadable with attributes
- Crate handles the reloading mechanics automatically
- Call functions normally, get latest code

**Pros:**
- Minimal boilerplate
- Designed for this exact use case

**Cons:**
- Less control over reload timing
- May need adjustment for audio-specific requirements

**Suggested crates:**
- `hot-lib-reloader`

---

## Input System Architecture

The preview system needs different inputs depending on plugin type.

### Plugin Types

| Type | Audio Input | MIDI Input |
|------|-------------|------------|
| Instrument (Synth) | None/Silent | Yes - required |
| Effect | Yes - required | Optional (for MIDI-controlled effects) |

---

### Audio Input Sources (for Effects)

#### Demo Samples
Pre-loaded audio files bundled with Freqlab for quick testing.

Suggested samples:
- Drums (good for dynamics/transients)
- Vocals (good for pitch effects, formants)
- Guitar (good for amp sims, distortion)
- Piano (good for reverb, dynamics)
- Full mix (good for master bus effects)
- Synth loops (good for filters, modulation)

#### Test Signals
Programmatically generated signals for precise testing.

| Signal | Use Case |
|--------|----------|
| Sine wave (various frequencies) | Frequency response, distortion analysis |
| White noise | Full spectrum response |
| Pink noise | Perceptually balanced noise |
| Impulse | Reverb/delay tail capture |
| Sweep (sine) | Frequency response over time |
| Square wave | Harmonic content testing |

#### Audio File Loading
User loads any audio file from disk.

**Suggested crates:**
- `symphonia` - decode any audio format
- `hound` - simple WAV reading

#### Live Input
Real-time audio from system input (mic/interface).

**Suggested crates:**
- `cpal` - cross-platform audio I/O

---

### MIDI Input Sources (for Synths)

#### Virtual Keyboard
On-screen keyboard in Freqlab UI, sends MIDI to plugin.

- Mouse click / touch for notes
- Computer keyboard mapping (QWERTY to piano keys)
- Velocity control (fixed or based on click position)

#### Hardware MIDI
Connect physical MIDI controller.

**Suggested crates:**
- `midir` - cross-platform MIDI I/O

#### MIDI Sequence Playback
Pre-programmed patterns for automated testing.

- Simple arpeggio patterns
- Chord progressions
- User-loadable MIDI files

---

## Audio Engine

### Core Requirements

- Low latency audio I/O
- Configurable sample rate and buffer size
- Crossfade capability for smooth reloads
- Ring buffers for thread-safe audio passing

### Suggested Stack

| Component | Crate |
|-----------|-------|
| Audio I/O | `cpal` |
| Ring buffers | `ringbuf` |
| MIDI I/O | `midir` |
| Sample rate conversion | `rubato` or `dasp` |
| Thread-safe state | `parking_lot` |

---

## Reload Behavior

### On Source File Change

1. Detect change via filesystem watcher
2. Trigger cargo build (release mode for performance)
3. Wait for build completion
4. Begin audio crossfade out (50-100ms)
5. Unload current plugin instance
6. Short delay to ensure file handle released (~100ms)
7. Load new plugin binary
8. Initialize with same sample rate / buffer size
9. Restore parameters if possible
10. Crossfade audio back in

### State Preservation

Some state can survive reloads:
- Parameter values (stored in host, restored after load)
- Current input source selection
- Playback position in demo samples

State that cannot survive:
- Internal plugin state (delay lines, filter history)
- Any runtime-computed data

---

## Tauri Integration Points

### Commands needed:

- `set_plugin_type(type: "instrument" | "effect")`
- `set_audio_input(source: string, data: Option<string>)`
- `send_midi_note(note: u8, velocity: u8, on: bool)`
- `set_parameter(index: u32, value: f32)`
- `get_parameter(index: u32) -> f32`
- `start_preview()`
- `stop_preview()`
- `reload_plugin()`
- `set_auto_reload(enabled: bool)`

### Events to emit:

- `plugin-reloaded`
- `plugin-error(message: string)`
- `build-started`
- `build-completed`
- `build-failed(error: string)`

---

## UI Suggestions

### For Effects Mode
- Demo sample buttons (quick access)
- Test signal selector with frequency control
- File picker for custom audio
- Live input toggle
- Loop toggle for samples
- Waveform display of input

### For Instrument Mode
- Virtual piano keyboard
- Octave selector
- Velocity slider
- MIDI device selector dropdown
- MIDI activity indicator

### Common Elements
- Play/Stop button
- Auto-reload toggle
- Manual reload button
- Build status indicator
- Parameter list from plugin
- Output level meter

---

## Fun/Experimental Feature Suggestions

Based on our conversation, these could enhance the experience:

### Vibe Check Button
Play a sound effect based on build result:
- Success: Applause, air horn, or pleasant chime
- Compile error: Sad trombone, error buzzer

### Achievement System
Track milestones for fun:
- "First Build" - compiled your first plugin
- "Speed Demon" - 10 builds in one session
- "Night Owl" - building past midnight
- "Oops" - first segfault
- "Sounds Scary" - output clipped to max

### Plugin Roast Mode
Ask Claude to humorously critique the DSP code.

### Cursed Mode
Intentionally generate chaotic/broken plugins for experimental sound design.

### Name Generator
Auto-generate absurd plugin names:
- "Anxious Tape Wobble"
- "Crunchy Grandfather Reverb"
- "Suspicious Harmonic Thickener"

---

## Performance Considerations

- Release builds only for preview (debug too slow for real-time audio)
- Buffer sizes: 256-512 samples for low latency, 1024+ for stability
- Crossfade duration: 50-100ms is usually imperceptible
- File watcher debouncing: wait 100-200ms after last change before rebuilding

---

## Open Questions for Implementation

1. Should parameter state persist across reloads, and if so, how to handle parameter count/order changes?
2. What's the preferred crossfade curve (linear, equal power, etc.)?
3. Should there be a "safe mode" that stops audio completely during reload vs crossfade approach?
4. How to handle plugins that crash during load - sandboxing?
5. Multiple plugin preview simultaneously or single only?
6. Should demo samples be bundled or downloaded on first use?
