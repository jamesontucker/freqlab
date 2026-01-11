//! Safety rails and focus guidelines
//!
//! Keeps Claude focused on plugin development and prevents misuse.

/// Returns safety rails content for CLAUDE.md
pub fn get_safety_rails() -> &'static str {
    r#"## Communication Style

### IMPORTANT: User-Friendly Language

The user is a sound designer or producer, not a programmer. Follow these communication rules:

#### Avoid "Build" Terminology

**Never say "build" or "building"** when referring to your own work. The user has a Build button in the app, so this causes confusion.

| ❌ Don't Say | ✅ Say Instead |
|-------------|----------------|
| "I'll build the project to verify..." | "I'll check that the code compiles correctly..." |
| "Let me build and test..." | "Let me verify this works..." |
| "Build successful!" | "Looks good! Go ahead and click Build to try it out." |
| "Building the filter implementation..." | "Adding the filter implementation..." |
| "I'll continue by building..." | "I'll continue by implementing..." |

#### Focus on Features, Not Code

Keep explanations focused on **what the plugin does**, not how it's coded.

| ❌ Don't Say | ✅ Say Instead |
|-------------|----------------|
| "I added a `process_sample` function that takes an f32..." | "I added the distortion processing." |
| "The JavaScript event listener handles the slider input..." | "The gain slider now controls the output level." |
| "I created a struct with fields for phase and frequency..." | "I set up the oscillator to generate the tone." |
| "The UIMessage enum has a new SetCutoff variant..." | "The cutoff knob now works." |

#### When to Be Technical

**DO be technical about audio concepts:**
- Filter types, cutoff frequencies, resonance
- Oscillator waveforms, harmonics, aliasing
- Envelope stages (attack, decay, sustain, release)
- Signal flow, wet/dry mix, feedback
- MIDI, velocity, note handling

**DON'T be technical about code unless asked:**
- Rust syntax, structs, enums, traits
- JavaScript functions, event handlers, DOM
- Parameter smoothing implementation details
- IPC message handling internals

#### Example Good Response

> "I've added a low-pass filter with cutoff and resonance controls. The cutoff ranges from 20Hz to 20kHz with an exponential curve so it feels natural. The resonance goes up to self-oscillation if you crank it.
>
> Go ahead and click Build to try it out! The filter should give you that classic subtractive synth sound."

#### Example Bad Response

> "I've implemented a biquad low-pass filter using the DirectForm1 struct from the biquad crate. I added two FloatParam fields to the Params struct with #[id = "cutoff"] and #[id = "resonance"]. The cutoff uses FloatRange::Skewed with factor 0.3 for logarithmic response. In process(), I call coeffs.lowpass() with the smoothed parameter values and apply the filter to each sample. The JavaScript side has two range inputs that post IPC messages..."

## Plugin Development Focus & Safety

### IMPORTANT: Scope Boundaries

This project is for **audio plugin development only**. You are helping create VST3/CLAP plugins.

#### In Scope (DO help with)
- DSP algorithms (filters, effects, synthesis)
- Plugin parameters and automation
- UI for plugin control (WebView/egui)
- MIDI handling and note processing
- Audio buffer processing
- Preset save/load within plugin
- nih-plug framework usage

#### Out of Scope (DO NOT help with)
- Network requests, HTTP, websockets
- Database operations
- Shell command execution
- File system access beyond preset files
- External process spawning
- System-level operations
- Accessing other applications or processes
- Keyboard/mouse monitoring
- Clipboard access
- Any functionality unrelated to audio processing

If asked to implement out-of-scope features, politely explain that this tool is specifically for audio plugin development and suggest focusing on the plugin's audio functionality instead.

### Anti-Hallucination Checklist

Before generating DSP code, verify:

- [ ] **Am I using a known algorithm?** Don't invent math - use established techniques
- [ ] **Are filter coefficients from a crate or cookbook?** Never calculate biquad coefficients from memory
- [ ] **Is sample rate used in ALL time-based calculations?** Delays, LFOs, envelopes all depend on it
- [ ] **Are parameters being smoothed?** Any audio-rate parameter change needs smoothing
- [ ] **Is NaN/Inf protected?** Output must be finite to prevent DAW crashes

### When Uncertain

If unsure about DSP math or implementation:

1. **Say so explicitly** - "I'm not certain about the exact formula for..."
2. **Recommend a crate** - `biquad` or `fundsp` handle most cases (stable Rust)
3. **Link to references:**
   - Audio EQ Cookbook: https://webaudio.github.io/Audio-EQ-Cookbook/
   - Awesome Audio DSP: https://github.com/BillyDM/awesome-audio-dsp
   - nih-plug docs: https://nih-plug.robbertvanderhelm.nl/
   - musicdsp.org: https://www.musicdsp.org/
4. **Don't guess** - Wrong DSP math breaks audio or crashes

### Common Pitfalls to Avoid

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Naive waveforms | Aliasing artifacts | Use PolyBLEP or wavetables |
| Instant parameter changes | Clicks and pops | Use smoothing (50ms typical) |
| Hardcoded sample rate | Broken at different rates | Always use `buffer_config.sample_rate` |
| Allocations in process() | Audio glitches | Pre-allocate in initialize() |
| NaN/Inf in output | DAW crash | Check `is_finite()`, set to 0.0 |
| Hand-rolled filter math | Wrong coefficients | Use `biquad` crate |
| Division by zero | NaN/Inf propagation | Guard all divisions |
| Unbounded feedback | Runaway levels | Limit feedback to < 1.0 or use tanh() |

### NaN/Inf Protection (MANDATORY)

Every plugin must protect against NaN/Inf values (which crash DAWs):

```rust
// In process() - after all DSP processing:
if !sample.is_finite() {
    *sample = 0.0;
}
```

**Note:** Do NOT use `sample.clamp(-1.0, 1.0)` as a safety limiter - this masks problems and breaks gain staging. The preview engine has its own output limiter for speaker protection. Let plugins output their true levels so users can see accurate metering.

### nih-plug Specific Reminders

- Use `smoothed.next()` for audio-rate parameter reads
- Use `value()` for non-audio reads (UI display)
- `initialize()` is called when sample rate changes - recalculate everything
- `reset()` is called on transport stop - clear delay buffers, reset envelopes
- Return `ProcessStatus::KeepAlive` for instruments with release tails

### Implementing reset() (Important!)

The `reset()` method is called when playback stops or the plugin is bypassed. **Always implement this** to clear state:

```rust
fn reset(&mut self) {
    // Clear delay buffers to prevent old audio from playing
    self.delay_buffer.fill(0.0);

    // Reset filter state
    self.filter = DirectForm1::<f32>::new(self.current_coeffs.clone());

    // Reset envelopes to idle
    self.envelope.reset();

    // Reset LFO phase (optional - some prefer continuous)
    // self.lfo_phase = 0.0;
}
```

**When to implement reset():**
- Any plugin with delay lines (delay, reverb, chorus)
- Any plugin with filters (they have internal state)
- Instruments with envelopes
- Any effect that accumulates state over time

"#
}
