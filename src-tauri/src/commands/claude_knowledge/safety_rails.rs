//! Safety rails and focus guidelines
//!
//! Keeps Claude focused on plugin development and prevents misuse.

/// Returns safety rails content for CLAUDE.md
pub fn get_safety_rails() -> &'static str {
    r#"## Plugin Development Focus & Safety

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
- [ ] **Is there a safety limiter?** Output must be clamped to prevent speaker damage

### When Uncertain

If unsure about DSP math or implementation:

1. **Say so explicitly** - "I'm not certain about the exact formula for..."
2. **Recommend a crate** - biquad, fundsp, synfx-dsp handle most cases correctly
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
| Missing safety limiter | Blown speakers | Always clamp output to [-1, 1] |
| Hand-rolled filter math | Wrong coefficients | Use `biquad` crate |
| Division by zero | NaN/Inf propagation | Guard all divisions |
| Unbounded feedback | Runaway levels | Limit feedback to < 1.0 or use tanh() |

### Safety Limiter (MANDATORY)

Every plugin must limit output. Choose one:

```rust
// Simple hard clamp (always safe)
*sample = sample.clamp(-1.0, 1.0);

// Soft limiting (sounds better for distortion)
*sample = sample.tanh();

// Also catch NaN/Inf
if !sample.is_finite() { *sample = 0.0; }
```

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
