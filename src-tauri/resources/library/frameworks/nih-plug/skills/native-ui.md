---
name: native-ui
description: Native plugin patterns (no custom GUI). DAW generic interface, automation, parameter naming. Invoke when working on native/no-UI plugins.
internal: true
---

# Native Plugin (No Custom UI)

This plugin has no custom graphical interface. Users interact through:
- DAW's generic parameter interface
- Automation lanes
- MIDI CC mapping (if enabled)

## Best Practices for Native Plugins

1. **Clear parameter names**: Users only see the name in their DAW
2. **Sensible ranges**: Make defaults useful, ranges intuitive
3. **Good presets**: Consider adding factory presets for common use cases
4. **Proper units**: Use `formatters::v2s_f32_hz_then_khz` etc. for display

## Parameter Naming Guidelines

Since users can't see a custom UI, parameter names are critical:

```rust
// Good - clear, descriptive names
FloatParam::new("Filter Cutoff", ...)
FloatParam::new("Attack Time", ...)
FloatParam::new("Output Gain", ...)

// Bad - unclear names
FloatParam::new("Param1", ...)
FloatParam::new("Freq", ...)
FloatParam::new("Amt", ...)
```

## Using Formatters for Display

```rust
use nih_plug::prelude::formatters;

FloatParam::new("Cutoff", 1000.0, FloatRange::Skewed { ... })
    .with_value_to_string(formatters::v2s_f32_hz_then_khz(0))
    .with_string_to_value(formatters::s2v_f32_hz_then_khz())
    .with_unit("")  // Formatter already includes Hz/kHz
```

## Consider Adding

- Preset system for quick configuration
- Parameter groups for organization in DAW

## Feature Completion Checklist (Native)

- [ ] Parameter added to `Params` struct with `#[id = "..."]`
- [ ] DSP code uses the parameter via `.smoothed.next()` or `.value()`
- [ ] Parameter has clear, descriptive name
- [ ] Parameter has appropriate unit and formatter
- [ ] Default value is sensible
