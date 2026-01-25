//! CLAUDE.md generation for VST plugin projects
//!
//! Generates a minimal project-specific guidance file that Claude reads when helping
//! users develop their plugins. Detailed patterns are now available as on-demand skills
//! in .claude/commands/ for better context management.

/// Generate the minimal CLAUDE.md content for a project
/// Detailed patterns are available via skills in .claude/commands/
pub fn generate_claude_md(
    project_name: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> String {
    let mut content = String::new();

    // Header and config
    content.push_str(&generate_header(project_name, template, ui_framework, components));

    // Skill manifest - tells Claude what skills are available
    content.push_str(&generate_skill_manifest(template, ui_framework, components));

    // Critical safety reminders (brief)
    content.push_str(&generate_critical_safety());

    // Quick reference (essential patterns only)
    content.push_str(&generate_quick_reference());

    content
}

fn generate_header(
    project_name: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> String {
    let components_str = components
        .map(|c| {
            if c.is_empty() {
                "None".to_string()
            } else {
                c.join(", ")
            }
        })
        .unwrap_or_else(|| "None".to_string());

    format!(
        r#"# {project_name} - Plugin Development Context

> This is a nih-plug audio plugin project. Detailed implementation patterns are available
> as skills in `.claude/commands/`. Invoke them with `/skill-name` when you need specific guidance.

## Project Configuration

- **Type**: {template}
- **UI Framework**: {ui_framework}
- **Components**: {components_str}

## Current Implementation

Update this section **once per completed feature** (not every turn). This is your memory across sessions.

### Parameters
<!-- - `param_name`: description (range) -->

### Features
<!-- - Feature name: brief description -->

### Notes
<!-- Key decisions: filter topology, voice count, etc. -->

## User Notes

Your private observations about working with this user. Update as you notice patterns.

### Explicit Preferences
<!-- Rules they've stated: "always X", "never Y", "I prefer Z" -->

### Observed Patterns
<!-- Things you've noticed: their aesthetic taste, complexity comfort level, communication style, what makes them happy/frustrated -->

"#
    )
}

fn generate_skill_manifest(
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> String {
    let mut content = String::from(
        r#"## Available Skills

Invoke these skills when you need detailed implementation patterns:

### Core (Always Available)
| Skill | Purpose |
|-------|---------|
| `/dsp-safety` | Critical DSP safety rules, anti-hallucination guardrails, NaN/Inf protection |
| `/nih-plug-basics` | Framework essentials, parameter setup, process loop, plugin lifecycle |

"#,
    );

    // UI Framework skill
    content.push_str("### UI Framework\n");
    content.push_str("| Skill | Purpose |\n");
    content.push_str("|-------|---------|\n");
    match ui_framework {
        "webview" => {
            content.push_str("| `/webview-ui` | WebView IPC patterns, AtomicBool sync, HTML/JS integration |\n");
        }
        "egui" => {
            content.push_str("| `/egui-ui` | egui widget patterns, ParamSlider, EguiState, layout |\n");
        }
        "native" => {
            content.push_str("| `/native-ui` | Native plugin patterns (DAW controls only), parameter naming |\n");
        }
        _ => {}
    }
    content.push('\n');

    // Plugin type skill
    content.push_str("### Plugin Type\n");
    content.push_str("| Skill | Purpose |\n");
    content.push_str("|-------|---------|\n");
    match template {
        "effect" => {
            content.push_str("| `/effect-patterns` | Dry/wet mixing, delay lines, dynamics, distortion, reverb, limiters |\n");
        }
        "instrument" => {
            content.push_str("| `/instrument-patterns` | MIDI handling, voice management, ADSR, oscillators, samplers |\n");
        }
        _ => {}
    }
    content.push('\n');

    // Component skills (if any)
    if let Some(comps) = components {
        if !comps.is_empty() {
            content.push_str("### Components\n");
            content.push_str("| Skill | Purpose |\n");
            content.push_str("|-------|---------|\n");
            for component in comps {
                let (skill_name, description) = match component.as_str() {
                    "preset_system" => ("preset-system", "Preset save/load, factory presets, user presets"),
                    "param_smoothing" => ("param-smoothing", "Advanced parameter smoothing techniques"),
                    "sidechain_input" => ("sidechain-input", "Aux input configuration, sidechain processing"),
                    "oversampling" => ("oversampling", "Oversampling for nonlinear processing"),
                    "polyphony" => ("polyphony", "Voice management, allocation, stealing"),
                    "velocity_layers" => ("velocity-layers", "Velocity layer selection, crossfading"),
                    "adsr_envelope" => ("adsr-envelope", "ADSR envelope implementation"),
                    "lfo" => ("lfo", "LFO implementation, tempo sync, modulation"),
                    _ => continue,
                };
                content.push_str(&format!("| `/{}` | {} |\n", skill_name, description));
            }
            content.push('\n');
        }
    }

    content
}

fn generate_critical_safety() -> String {
    r#"## Critical Safety Rules

**ALWAYS protect against NaN/Inf** (crashes DAWs):
```rust
// In process() - after all DSP processing:
if !sample.is_finite() {
    *sample = 0.0;
}
```

**NEVER allocate in process()** - pre-allocate in `initialize()`:
```rust
fn initialize(&mut self, ...) -> bool {
    self.buffer = vec![0.0; MAX_SIZE];  // OK here
    true
}

fn process(&mut self, ...) {
    // NO: self.buffer.push(x);  // Allocates!
    // YES: self.buffer[idx] = x;
}
```

**NEVER invent filter coefficients** - use the `biquad` crate or Audio EQ Cookbook.

For detailed safety rules, invoke `/dsp-safety`.

"#
    .to_string()
}

fn generate_quick_reference() -> String {
    r#"## Quick Reference

### Parameter Setup
```rust
FloatParam::new("Gain", util::db_to_gain(0.0), FloatRange::Skewed {
    min: util::db_to_gain(-30.0),
    max: util::db_to_gain(30.0),
    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
})
.with_smoother(SmoothingStyle::Logarithmic(50.0))
.with_unit(" dB")
```

### Process Loop
```rust
fn process(&mut self, buffer: &mut Buffer, ...) -> ProcessStatus {
    for channel_samples in buffer.iter_samples() {
        let gain = self.params.gain.smoothed.next();  // Call ONCE per sample
        for sample in channel_samples {
            *sample *= gain;
            if !sample.is_finite() { *sample = 0.0; }  // Safety
        }
    }
    ProcessStatus::Normal
}
```

### Files to Modify
| Task | File(s) |
|------|---------|
| Add parameter | `src/lib.rs` (Params struct) |
| DSP logic | `src/lib.rs` (process function) |
| UI controls | `src/ui.html` (WebView) or `src/lib.rs` editor() (egui) |

"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minimal_claude_md_size() {
        let content = generate_claude_md("test-plugin", "effect", "webview", None);

        // Should be much smaller than the old 52KB+ monolithic version
        // Target is ~2-3KB
        let size_kb = content.len() as f64 / 1024.0;
        assert!(
            size_kb < 5.0,
            "CLAUDE.md should be under 5KB, got {:.1}KB",
            size_kb
        );
        println!("Generated CLAUDE.md size: {:.1}KB", size_kb);
    }

    #[test]
    fn test_effect_webview_skills() {
        let content = generate_claude_md("test-effect", "effect", "webview", None);

        // Should have core skills
        assert!(content.contains("/dsp-safety"));
        assert!(content.contains("/nih-plug-basics"));

        // Should have webview skill (not egui)
        assert!(content.contains("/webview-ui"));
        assert!(!content.contains("/egui-ui"));

        // Should have effect patterns (not instrument)
        assert!(content.contains("/effect-patterns"));
        assert!(!content.contains("/instrument-patterns"));
    }

    #[test]
    fn test_instrument_egui_with_components() {
        let components = vec![
            "polyphony".to_string(),
            "adsr_envelope".to_string(),
            "lfo".to_string(),
        ];
        let content =
            generate_claude_md("test-synth", "instrument", "egui", Some(&components));

        // Should have egui skill
        assert!(content.contains("/egui-ui"));

        // Should have instrument patterns
        assert!(content.contains("/instrument-patterns"));

        // Should have component skills
        assert!(content.contains("/polyphony"));
        assert!(content.contains("/adsr-envelope"));
        assert!(content.contains("/lfo"));

        // Should NOT have effect-only components
        assert!(!content.contains("/sidechain-input"));
    }

    #[test]
    fn test_critical_safety_included() {
        let content = generate_claude_md("test", "effect", "native", None);

        // Must always include critical safety rules
        assert!(content.contains("is_finite"));
        assert!(content.contains("NaN/Inf"));
        assert!(content.contains("NEVER allocate in process()"));
    }
}
