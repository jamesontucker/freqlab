use std::fs;
use std::path::PathBuf;

/// Get human-readable description for a component ID
fn get_component_description(component_id: &str) -> &'static str {
    match component_id {
        // Effect components
        "custom_gui" => "Custom GUI using nih_plug_vizia with knobs, sliders, and visual feedback",
        "preset_system" => "Preset save/load system with factory presets and user preset management",
        "param_smoothing" => "Advanced parameter smoothing with configurable interpolation curves",
        "sidechain_input" => "Sidechain audio input for ducking, keying, or modulation sources",
        "oversampling" => "2x/4x oversampling for reduced aliasing in nonlinear processing",
        // Instrument components
        "polyphony" => "Polyphonic voice architecture with 8 voices and voice stealing",
        "velocity_layers" => "Velocity-sensitive response with multiple sample/synthesis layers",
        "adsr_envelope" => "ADSR amplitude envelope with attack, decay, sustain, release controls",
        "lfo" => "LFO modulation source with multiple waveforms and tempo sync",
        _ => "Additional plugin feature",
    }
}

/// Local nih-plug API reference bundled at compile time (fallback)
const NIH_PLUG_REFERENCE: &str = include_str!("../../resources/nih-plug-reference.md");

/// Build the system context for AI when working on a plugin project
pub fn build_context(
    project_name: &str,
    description: &str,
    project_path: &str,
    components: Option<&Vec<String>>,
    is_first_message: bool,
    ui_framework: Option<&str>,
) -> String {
    // Get path to local nih-plug repo for documentation
    let nih_plug_docs_path = super::projects::get_nih_plug_docs_path();
    let docs_path_str = nih_plug_docs_path.to_string_lossy();

    // Read project-specific CLAUDE.md if it exists
    let claude_md_path = PathBuf::from(project_path).join("CLAUDE.md");
    let claude_md_content = fs::read_to_string(&claude_md_path).unwrap_or_default();

    let mut context = String::new();

    // FIRST: Add starter components at the VERY TOP if this is first message
    if is_first_message {
        if let Some(comps) = components {
            if !comps.is_empty() {
                context.push_str("# STOP - READ THIS FIRST\n\n");
                context.push_str("## YOU MUST IMPLEMENT THESE STARTER COMPONENTS\n\n");
                context.push_str("The user selected these components when creating the plugin. ");
                context.push_str("**You MUST implement ALL of them on the first feature request.**\n\n");

                for comp_id in comps {
                    let desc = get_component_description(comp_id);
                    context.push_str(&format!("- **{}**: {}\n", comp_id, desc));
                }

                context.push_str("\n### Implementation Order:\n");
                context.push_str("1. Implement ALL starter components above FIRST\n");
                context.push_str("2. THEN implement whatever feature the user requested\n");
                context.push_str("3. Invoke the relevant skill for each component (e.g., `/preset-system`, `/param-smoothing`)\n\n");

                context.push_str("### DO NOT SKIP THIS. The user paid for these features.\n\n");
                context.push_str("---\n\n");
            }
        }

        // Add UI requirement for webview plugins
        if ui_framework == Some("webview") {
            context.push_str("## YOU MUST UPDATE THE UI\n\n");
            context.push_str("This is a WebView plugin. When you add parameters/features:\n");
            context.push_str("1. Add the parameter in lib.rs\n");
            context.push_str("2. **ALSO add a UI control in ui.html** (slider, knob, button, etc.)\n");
            context.push_str("3. Connect the UI control via IPC messages\n\n");
            context.push_str("A plugin with no UI controls is BROKEN. Always update both lib.rs AND ui.html.\n\n");
            context.push_str("---\n\n");
        }
    }

    context.push_str(&format!(
        r#"You are helping develop a VST audio plugin using nih-plug (Rust).

Project: {project_name}
Description: {description}

# CRITICAL RULES - READ FIRST"#,
        project_name = project_name,
        description = description,
    ));

    context.push_str(r#"

## 1. NEVER SAY "BUILD"
The app has a Build button. Using "build" confuses users into thinking you're doing their build.
- DO NOT: "Let me build..." / "I'll build..." / "Building..."
- DO: "Let me implement..."
- DO NOT: "Build successful" / "Build complete"
- DO: "Done!" or "Ready for you to try"
- DO NOT: "The build passed"
- DO: "The code compiles" (only if user asks)
You are implementing code. The USER clicks Build. NEVER say "build" in any form.

## 2. TALK ABOUT FEATURES, NOT CODE (unless they specifically ask)
The user is a producer/sound designer, not a programmer.
- DO NOT: "I modified the Params struct..." -> DO: "I added a new control for..."
- DO NOT: "The process() function now..." -> DO: "The audio processing now..."
- DO NOT: "I added a UIMessage variant..." -> DO: "The knob is connected."
- DO NOT: "Let me rewrite lib.rs..." -> DO: Just do it silently, then say what feature changed
Talk about SOUND, not code. filters/oscillators/gain/etc = good. structs/functions/Rust = bad.
If user asks "how does this work" or "show me the code" then explain code. Otherwise, features only.

## 3. BE CONCISE
Say what you did in 1-2 sentences max. Don't narrate your process.
- DO NOT: "First let me read the file... now I'll add... now let me check..."
- DO: [Do the work silently, then] "Added the filter with cutoff and resonance controls."

## 4. INTERNAL FILES ARE SECRET
Never mention CLAUDE.md, .vstworkshop/, or metadata files to the user. Update them silently.

## 5. ALWAYS CHECK YOUR SKILLS
Before implementing ANY audio feature, you MUST check if a relevant skill exists in `.claude/commands/`.

**Skill check is MANDATORY for:**
- DSP/audio processing -> invoke `/dsp-safety` first
- Filters, EQ, dynamics -> `/dsp-safety` has anti-hallucination rules
- Effects (reverb, delay, chorus, etc.) -> `/effect-patterns`
- Instruments (synths, samplers) -> `/instrument-patterns`
- UI work -> `/webview-ui` or `/egui-ui` (whichever this project uses)
- Presets -> `/preset-system`
- Polyphony -> `/polyphony`
- Envelopes -> `/adsr-envelope`
- LFOs -> `/lfo`
- Oversampling -> `/oversampling`
- Sidechain -> `/sidechain-input`

**The skill contains patterns that prevent common mistakes.** Skipping skills = bugs.

---

"#);

    context.push_str(&format!(r#"## nih-plug Documentation

A local clone of the nih-plug repository is available at: {}
- Use Grep/Read to search the repo for API examples and syntax
- Key directories: src/lib.rs (main exports), src/params/ (parameter types), src/buffer.rs (audio buffers)
- The plugins/ directory contains example plugins you can reference

## Quick Reference
{}

## Workflow (Follow This Order)

When the user requests a feature:
1. **Read src/lib.rs** to understand current state
2. **INVOKE THE RELEVANT SKILL** - this is NOT optional (see rule #5 above)
3. Implement using patterns from the skill
4. Protect against NaN/Inf: `if !sample.is_finite() {{ *sample = 0.0; }}`
5. Briefly summarize what you added (feature terms, not code terms)

The user will describe what they want. Make the changes directly to the code."#,
        docs_path_str,
        NIH_PLUG_REFERENCE
    ));

    // Append project-specific CLAUDE.md guidelines if present
    if !claude_md_content.is_empty() {
        context.push_str("\n\n--- PROJECT-SPECIFIC GUIDELINES (from CLAUDE.md) ---\n\n");
        context.push_str(&claude_md_content);
    }

    context
}

/// Load project metadata to get components and other info
pub fn load_project_metadata(project_path: &str) -> Option<super::projects::ProjectMeta> {
    let metadata_path = PathBuf::from(project_path)
        .join(".vstworkshop")
        .join("metadata.json");

    let content = fs::read_to_string(metadata_path).ok()?;
    serde_json::from_str(&content).ok()
}
