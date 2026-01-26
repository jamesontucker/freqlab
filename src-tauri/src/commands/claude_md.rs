//! CLAUDE.md generation for audio plugin projects
//!
//! Generates a project-specific guidance file that Claude reads when helping
//! users develop their plugins. Core guides (basics + UI framework) are inlined
//! for immediate access. Additional guides are available on-demand in .claude/commands/.
//!
//! This module is framework-aware and generates language-appropriate examples.

/// Framework information for CLAUDE.md generation
pub struct FrameworkInfo {
    #[allow(dead_code)] // May be used in future for framework-specific logic
    pub id: String,
    pub display_name: String,
    pub language: String,
}

impl Default for FrameworkInfo {
    fn default() -> Self {
        Self {
            id: "nih-plug".to_string(),
            display_name: "nih-plug (Rust)".to_string(),
            language: "rust".to_string(),
        }
    }
}

/// Guide content to inline into CLAUDE.md
pub struct InlinedGuides {
    /// Framework basics guide (e.g., nih-plug-basics.md content)
    pub basics: Option<String>,
    /// UI framework guide (e.g., webview-ui.md content)
    pub ui_framework: Option<String>,
}

impl Default for InlinedGuides {
    fn default() -> Self {
        Self {
            basics: None,
            ui_framework: None,
        }
    }
}

/// Generate CLAUDE.md with explicit framework information and inlined guides
pub fn generate_claude_md_with_framework(
    project_name: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
    framework: &FrameworkInfo,
    guides: &InlinedGuides,
) -> String {
    let mut content = String::new();

    // Header and config
    content.push_str(&generate_header(project_name, template, ui_framework, components, framework));

    // Guide manifest - tells Claude what on-demand guides are available
    content.push_str(&generate_guide_manifest(template, components));

    // Inlined basics guide (if provided)
    if let Some(ref basics) = guides.basics {
        content.push_str("---\n\n");
        content.push_str(&strip_frontmatter(basics));
        content.push('\n');
    } else {
        // Fallback: generate minimal quick reference
        content.push_str(&generate_quick_reference(framework));
    }

    // Inlined UI framework guide (if provided)
    if let Some(ref ui_guide) = guides.ui_framework {
        content.push_str("---\n\n");
        content.push_str(&strip_frontmatter(ui_guide));
        content.push('\n');
    }

    // Critical safety reminders (always included as final reminder)
    content.push_str(&generate_critical_safety(framework));

    content
}

/// Strip YAML frontmatter from markdown content
fn strip_frontmatter(content: &str) -> String {
    if content.starts_with("---") {
        // Find the closing ---
        if let Some(end_pos) = content[3..].find("\n---") {
            // Skip past the closing --- and any following newline
            let start = 3 + end_pos + 4;
            return content[start..].trim_start_matches('\n').to_string();
        }
    }
    content.to_string()
}

fn generate_header(
    project_name: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
    framework: &FrameworkInfo,
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

> This is a **{framework_display_name}** audio plugin project. Detailed implementation patterns
> are available as guides in `.claude/commands/`. Invoke them with `/guide-name` when you need
> specific guidance.

## Project Configuration

- **Framework**: {framework_display_name}
- **Language**: {language}
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

"#,
        project_name = project_name,
        framework_display_name = framework.display_name,
        language = framework.language,
        template = template,
        ui_framework = ui_framework,
        components_str = components_str
    )
}

fn generate_guide_manifest(
    template: &str,
    components: Option<&Vec<String>>,
) -> String {
    // Only list on-demand guides here - basics and UI framework are inlined above
    let mut content = String::from(r#"## On-Demand Guides

Additional guides are available in `.claude/commands/`. Invoke with `/guide-name`:

| Guide | Purpose |
|-------|---------|
| `/dsp-safety` | Critical DSP safety rules, anti-hallucination guardrails |
"#);

    // Plugin type guide
    match template {
        "effect" => {
            content.push_str("| `/effect-patterns` | Dry/wet mixing, delay lines, dynamics, distortion, reverb |\n");
        }
        "instrument" => {
            content.push_str("| `/instrument-patterns` | MIDI handling, voice management, ADSR, oscillators |\n");
        }
        _ => {}
    }

    // Component guides (if any)
    if let Some(comps) = components {
        for component in comps {
            let (guide_name, description) = match component.as_str() {
                "preset_system" => ("preset-system", "Preset save/load, factory presets"),
                "param_smoothing" => ("param-smoothing", "Advanced parameter smoothing"),
                "sidechain_input" => ("sidechain-input", "Aux input, sidechain processing"),
                "oversampling" => ("oversampling", "Oversampling for nonlinear processing"),
                "polyphony" => ("polyphony", "Voice management, allocation, stealing"),
                "velocity_layers" => ("velocity-layers", "Velocity layer selection"),
                "adsr_envelope" => ("adsr-envelope", "ADSR envelope implementation"),
                "lfo" => ("lfo", "LFO implementation, tempo sync"),
                _ => continue,
            };
            content.push_str(&format!("| `/{}` | {} |\n", guide_name, description));
        }
    }

    content.push('\n');
    content
}

fn generate_critical_safety(framework: &FrameworkInfo) -> String {
    match framework.language.as_str() {
        "rust" => generate_rust_safety(),
        "cpp" | "c++" => generate_cpp_safety(),
        _ => generate_rust_safety(), // Default to Rust
    }
}

fn generate_rust_safety() -> String {
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

fn generate_cpp_safety() -> String {
    r#"## Critical Safety Rules

**ALWAYS protect against NaN/Inf** (crashes DAWs):
```cpp
// In processBlock() - after all DSP processing:
if (!std::isfinite(sample)) {
    sample = 0.0f;
}
```

**NEVER allocate in processBlock()** - pre-allocate in `prepareToPlay()`:
```cpp
void prepareToPlay(double sampleRate, int samplesPerBlock) override {
    buffer.resize(MAX_SIZE);  // OK here
}

void processBlock(AudioBuffer<float>& buffer, MidiBuffer& midi) override {
    // NO: buffer.push_back(x);  // Allocates!
    // YES: buffer[idx] = x;
}
```

**NEVER invent filter coefficients** - use juce::dsp::IIR or Audio EQ Cookbook.

For detailed safety rules, invoke `/dsp-safety`.

"#
    .to_string()
}

fn generate_quick_reference(framework: &FrameworkInfo) -> String {
    match framework.language.as_str() {
        "rust" => generate_rust_reference(),
        "cpp" | "c++" => generate_cpp_reference(),
        _ => generate_rust_reference(), // Default to Rust
    }
}

fn generate_rust_reference() -> String {
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

fn generate_cpp_reference() -> String {
    r#"## Quick Reference

### Parameter Setup
```cpp
addParameter(gain = new AudioParameterFloat(
    "gain",           // parameterID
    "Gain",           // name
    NormalisableRange<float>(-30.0f, 30.0f, 0.1f, // skew for dB
        [](float start, float end, float v) { return juce::jmap(v, start, end); },
        [](float start, float end, float v) { return juce::jmap(v, start, end, 0.0f, 1.0f); }),
    0.0f              // default value
));
```

### Process Loop
```cpp
void processBlock(AudioBuffer<float>& buffer, MidiBuffer& midiMessages) override {
    auto gainValue = gain->get();

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel) {
        auto* channelData = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample) {
            channelData[sample] *= Decibels::decibelsToGain(gainValue);
            if (!std::isfinite(channelData[sample])) channelData[sample] = 0.0f;
        }
    }
}
```

### Files to Modify
| Task | File(s) |
|------|---------|
| Add parameter | `PluginProcessor.cpp` (constructor) |
| DSP logic | `PluginProcessor.cpp` (processBlock) |
| UI controls | `PluginEditor.cpp` |

"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_guides() -> InlinedGuides {
        InlinedGuides {
            basics: Some("# Test Basics\n\nThis is the basics guide.\n\n```rust\nfn process() {}\n```".to_string()),
            ui_framework: Some("# Test UI\n\nThis is the UI guide.".to_string()),
        }
    }

    #[test]
    fn test_claude_md_without_inlined_guides() {
        let framework = FrameworkInfo::default();
        let guides = InlinedGuides::default();
        let content = generate_claude_md_with_framework(
            "test-plugin",
            "effect",
            "webview",
            None,
            &framework,
            &guides,
        );

        // Without inlined guides, should have fallback quick reference
        assert!(content.contains("## Quick Reference"));
        assert!(content.contains("nih-plug (Rust)"));
    }

    #[test]
    fn test_claude_md_with_inlined_guides() {
        let framework = FrameworkInfo::default();
        let guides = make_test_guides();
        let content = generate_claude_md_with_framework(
            "test-plugin",
            "effect",
            "webview",
            None,
            &framework,
            &guides,
        );

        // With inlined guides, should contain the guide content
        assert!(content.contains("# Test Basics"));
        assert!(content.contains("# Test UI"));
        // Should NOT have fallback quick reference when guides are provided
        assert!(!content.contains("## Quick Reference"));
    }

    #[test]
    fn test_frontmatter_stripped() {
        let guides = InlinedGuides {
            basics: Some("---\nname: test\ndescription: foo\n---\n\n# Actual Content".to_string()),
            ui_framework: None,
        };
        let framework = FrameworkInfo::default();
        let content = generate_claude_md_with_framework(
            "test",
            "effect",
            "native",
            None,
            &framework,
            &guides,
        );

        // Frontmatter should be stripped
        assert!(!content.contains("name: test"));
        assert!(content.contains("# Actual Content"));
    }

    #[test]
    fn test_effect_patterns_in_manifest() {
        let framework = FrameworkInfo::default();
        let guides = InlinedGuides::default();
        let content = generate_claude_md_with_framework(
            "test",
            "effect",
            "webview",
            None,
            &framework,
            &guides,
        );

        // Effect should have effect-patterns in on-demand section
        assert!(content.contains("/effect-patterns"));
        assert!(!content.contains("/instrument-patterns"));
    }

    #[test]
    fn test_instrument_patterns_in_manifest() {
        let framework = FrameworkInfo::default();
        let guides = InlinedGuides::default();
        let content = generate_claude_md_with_framework(
            "test",
            "instrument",
            "egui",
            None,
            &framework,
            &guides,
        );

        // Instrument should have instrument-patterns
        assert!(content.contains("/instrument-patterns"));
        assert!(!content.contains("/effect-patterns"));
    }

    #[test]
    fn test_component_guides_in_manifest() {
        let components = vec![
            "polyphony".to_string(),
            "adsr_envelope".to_string(),
        ];
        let framework = FrameworkInfo::default();
        let guides = InlinedGuides::default();
        let content = generate_claude_md_with_framework(
            "test",
            "instrument",
            "egui",
            Some(&components),
            &framework,
            &guides,
        );

        // Should list component guides in on-demand section
        assert!(content.contains("/polyphony"));
        assert!(content.contains("/adsr-envelope"));
    }

    #[test]
    fn test_critical_safety_always_included() {
        let framework = FrameworkInfo::default();
        let guides = make_test_guides();
        let content = generate_claude_md_with_framework(
            "test",
            "effect",
            "native",
            None,
            &framework,
            &guides,
        );

        // Safety rules must always be present
        assert!(content.contains("is_finite"));
        assert!(content.contains("NaN/Inf"));
    }

    #[test]
    fn test_cpp_framework_safety() {
        let framework = FrameworkInfo {
            id: "juce".to_string(),
            display_name: "JUCE (C++)".to_string(),
            language: "cpp".to_string(),
        };
        let guides = InlinedGuides::default();
        let content = generate_claude_md_with_framework(
            "test",
            "effect",
            "native",
            None,
            &framework,
            &guides,
        );

        // Should have C++ safety rules
        assert!(content.contains("```cpp"));
        assert!(content.contains("std::isfinite"));
        assert!(content.contains("JUCE (C++)"));
    }
}
