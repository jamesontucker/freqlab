use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub template: Option<String>, // "effect" or "instrument"
    #[serde(rename = "uiFramework")]
    pub ui_framework: Option<String>, // "webview", "egui", or "native"
    pub components: Option<Vec<String>>, // Starter components selected
    pub created_at: String,
    pub updated_at: String,
    pub path: String,
}

#[derive(Deserialize)]
pub struct CreateProjectInput {
    pub name: String,                     // Folder-safe name (my_cool_plugin)
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,     // User-friendly name (My Cool Plugin)
    pub description: String,
    pub template: String, // "effect" or "instrument"
    #[serde(rename = "uiFramework")]
    pub ui_framework: String, // "webview", "egui", or "native"
    #[serde(rename = "vendorName")]
    pub vendor_name: Option<String>,
    #[serde(rename = "vendorUrl")]
    pub vendor_url: Option<String>,
    #[serde(rename = "vendorEmail")]
    pub vendor_email: Option<String>,
    pub components: Option<Vec<String>>, // Starter components to include
}

pub fn get_workspace_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join("VSTWorkshop")
}

pub fn get_output_path() -> PathBuf {
    get_workspace_path().join("output")
}

fn get_projects_path() -> PathBuf {
    get_workspace_path().join("projects")
}

/// Get path to local nih-plug documentation repo
pub fn get_nih_plug_docs_path() -> PathBuf {
    get_workspace_path().join(".nih-plug-docs")
}

/// Clone or update the nih-plug repo for local documentation
fn ensure_nih_plug_docs() -> Result<(), String> {
    let docs_path = get_nih_plug_docs_path();

    if docs_path.exists() {
        // Repo already cloned - optionally pull updates (skip for now to avoid slowdown)
        return Ok(());
    }

    // Clone the nih-plug repo (shallow clone for speed)
    eprintln!("[INFO] Cloning nih-plug repo for local documentation...");
    let output = std::process::Command::new("git")
        .args([
            "clone",
            "--depth", "1",
            "--single-branch",
            "https://github.com/robbert-vdh/nih-plug.git",
            docs_path.to_str().unwrap_or(".nih-plug-docs"),
        ])
        .env("PATH", super::get_extended_path())
        .output()
        .map_err(|e| format!("Failed to clone nih-plug repo: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't fail workspace init if clone fails - just warn
        eprintln!("[WARN] Could not clone nih-plug docs: {}", stderr);
    } else {
        eprintln!("[INFO] nih-plug repo cloned successfully");
    }

    Ok(())
}

/// Ensure the workspace directories exist and workspace Cargo.toml is set up
pub fn ensure_workspace() -> Result<(), String> {
    let workspace = get_workspace_path();
    let projects = get_projects_path();
    let output = workspace.join("output");
    let xtask_dir = workspace.join("xtask/src");

    fs::create_dir_all(&projects).map_err(|e| format!("Failed to create projects dir: {}", e))?;
    fs::create_dir_all(&output).map_err(|e| format!("Failed to create output dir: {}", e))?;
    fs::create_dir_all(&xtask_dir).map_err(|e| format!("Failed to create xtask dir: {}", e))?;

    // Create or update workspace root Cargo.toml
    let workspace_cargo = workspace.join("Cargo.toml");
    let cargo_content = r#"[workspace]
members = ["projects/*", "xtask"]
resolver = "2"
"#;
    fs::write(&workspace_cargo, cargo_content)
        .map_err(|e| format!("Failed to create workspace Cargo.toml: {}", e))?;

    // Create shared xtask Cargo.toml if it doesn't exist
    let xtask_cargo = workspace.join("xtask/Cargo.toml");
    if !xtask_cargo.exists() {
        let xtask_content = r#"[package]
name = "xtask"
version = "0.1.0"
edition = "2021"

[dependencies]
nih_plug_xtask = { git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }
"#;
        fs::write(&xtask_cargo, xtask_content)
            .map_err(|e| format!("Failed to create xtask Cargo.toml: {}", e))?;
    }

    // Create shared xtask main.rs if it doesn't exist
    let xtask_main = workspace.join("xtask/src/main.rs");
    if !xtask_main.exists() {
        let main_content = r#"use std::time::{SystemTime, UNIX_EPOCH};

fn main() -> nih_plug_xtask::Result<()> {
    // Set unique build suffix for wry class names (enables hot reload of webview plugins)
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let suffix = format!("{}", timestamp % 100_000_000);
    std::env::set_var("WRY_BUILD_SUFFIX", &suffix);

    nih_plug_xtask::main()
}
"#;
        fs::write(&xtask_main, main_content)
            .map_err(|e| format!("Failed to create xtask main.rs: {}", e))?;
    }

    // Create .cargo/config.toml with xtask alias if it doesn't exist
    let cargo_config_dir = workspace.join(".cargo");
    fs::create_dir_all(&cargo_config_dir)
        .map_err(|e| format!("Failed to create .cargo dir: {}", e))?;

    let cargo_config = cargo_config_dir.join("config.toml");
    if !cargo_config.exists() {
        let config_content = r#"[alias]
xtask = "run --package xtask --release --"
"#;
        fs::write(&cargo_config, config_content)
            .map_err(|e| format!("Failed to create cargo config: {}", e))?;
    }

    // Clone nih-plug repo for local documentation (non-blocking on failure)
    let _ = ensure_nih_plug_docs();

    Ok(())
}

/// Validate plugin name (lowercase, no spaces, valid Rust identifier)
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.len() > 50 {
        return Err("Name too long (max 50 chars)".to_string());
    }
    if !name.chars().next().unwrap().is_ascii_lowercase() {
        return Err("Name must start with a lowercase letter".to_string());
    }
    if !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-') {
        return Err("Name can only contain lowercase letters, numbers, hyphens, and underscores".to_string());
    }
    Ok(())
}

/// Convert name to valid Rust identifier (snake_case)
fn to_snake_case(name: &str) -> String {
    name.replace('-', "_")
}

/// Convert name to PascalCase for struct names
fn to_pascal_case(name: &str) -> String {
    name.split(|c| c == '-' || c == '_')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        })
        .collect()
}

/// Generate a unique VST3 class ID from the plugin name
fn generate_vst3_id(name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    name.hash(&mut hasher);
    let hash = hasher.finish();

    // Create a 16-byte ID string
    format!("VSTWorkshop{:05}", hash % 100000)
        .chars()
        .take(16)
        .collect()
}

/// Generate .claude/commands/ with project-specific skills
/// Skills are generated based on the project's template, UI framework, and components
fn generate_project_skills(
    project_path: &std::path::Path,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> Result<(), String> {
    use super::claude_skills;

    let commands_dir = project_path.join(".claude/commands");
    fs::create_dir_all(&commands_dir)
        .map_err(|e| format!("Failed to create .claude/commands: {}", e))?;

    // Always generate core skills (DSP safety, nih-plug basics)
    fs::write(commands_dir.join("dsp-safety.md"), claude_skills::DSP_SAFETY)
        .map_err(|e| format!("Failed to write dsp-safety.md: {}", e))?;
    fs::write(commands_dir.join("nih-plug-basics.md"), claude_skills::NIH_PLUG_BASICS)
        .map_err(|e| format!("Failed to write nih-plug-basics.md: {}", e))?;

    // Generate UI framework skill based on selection (only one)
    match ui_framework {
        "webview" => {
            fs::write(commands_dir.join("webview-ui.md"), claude_skills::WEBVIEW_UI)
                .map_err(|e| format!("Failed to write webview-ui.md: {}", e))?;
        }
        "egui" => {
            fs::write(commands_dir.join("egui-ui.md"), claude_skills::EGUI_UI)
                .map_err(|e| format!("Failed to write egui-ui.md: {}", e))?;
        }
        "native" => {
            fs::write(commands_dir.join("native-ui.md"), claude_skills::NATIVE_UI)
                .map_err(|e| format!("Failed to write native-ui.md: {}", e))?;
        }
        _ => {}
    }

    // Generate plugin type skill based on template (only one)
    match template {
        "effect" => {
            fs::write(commands_dir.join("effect-patterns.md"), claude_skills::EFFECT_PATTERNS)
                .map_err(|e| format!("Failed to write effect-patterns.md: {}", e))?;
        }
        "instrument" => {
            fs::write(commands_dir.join("instrument-patterns.md"), claude_skills::INSTRUMENT_PATTERNS)
                .map_err(|e| format!("Failed to write instrument-patterns.md: {}", e))?;
        }
        _ => {}
    }

    // Generate component skills if any were selected
    if let Some(comps) = components {
        for component in comps {
            if let Some(skill_content) = claude_skills::get_component_skill(component) {
                let filename = format!("{}.md", component.replace('_', "-"));
                fs::write(commands_dir.join(&filename), skill_content)
                    .map_err(|e| format!("Failed to write {}: {}", filename, e))?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn create_project(input: CreateProjectInput) -> Result<ProjectMeta, String> {
    validate_name(&input.name)?;
    ensure_workspace()?;

    let project_path = get_projects_path().join(&input.name);

    if project_path.exists() {
        return Err(format!("Project '{}' already exists", input.name));
    }

    // Create directory structure
    fs::create_dir_all(project_path.join("src"))
        .map_err(|e| format!("Failed to create src dir: {}", e))?;
    fs::create_dir_all(project_path.join(".vstworkshop"))
        .map_err(|e| format!("Failed to create .vstworkshop dir: {}", e))?;

    let snake_name = to_snake_case(&input.name);
    let pascal_name = to_pascal_case(&input.name);
    let vst3_id = generate_vst3_id(&input.name);

    // Generate dependencies based on UI framework
    let ui_deps = match input.ui_framework.as_str() {
        "webview" => r#"# Forked nih-plug-webview with Tauri compatibility and hot reload support
nih_plug_webview = { git = "https://github.com/jamesontucker/nih-plug-webview" }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0""#,
        "egui" => r#"nih_plug_egui = { git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }
egui = "0.24""#,
        _ => "", // native - no additional deps
    };

    // Write Cargo.toml (project is a workspace member, no [workspace] section needed)
    let cargo_toml = if ui_deps.is_empty() {
        format!(
            r#"[package]
name = "{snake_name}"
version = "0.1.0"
edition = "2021"
license = "GPL-3.0-only"
description = "{description}"

[lib]
crate-type = ["cdylib"]

[dependencies]
nih_plug = {{ git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }}

[profile.release]
lto = "thin"
strip = "symbols"
"#,
            snake_name = snake_name,
            description = input.description.replace('"', "\\\"")
        )
    } else {
        format!(
            r#"[package]
name = "{snake_name}"
version = "0.1.0"
edition = "2021"
license = "GPL-3.0-only"
description = "{description}"

[lib]
crate-type = ["cdylib"]

[dependencies]
nih_plug = {{ git = "https://github.com/robbert-vdh/nih-plug.git", rev = "28b149ec" }}
{ui_deps}

[profile.release]
lto = "thin"
strip = "symbols"
"#,
            snake_name = snake_name,
            description = input.description.replace('"', "\\\""),
            ui_deps = ui_deps
        )
    };
    fs::write(project_path.join("Cargo.toml"), cargo_toml)
        .map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;

    // Generate template based on type and UI framework
    let vendor_name = input.vendor_name.as_deref().unwrap_or("freqlab");
    let vendor_id: String = vendor_name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let vendor_url = input.vendor_url.as_deref().unwrap_or("");
    let vendor_email = input.vendor_email.as_deref().unwrap_or("");
    let description_escaped = input.description.replace('"', "\\\"");

    // Select template based on plugin type and UI framework
    let lib_rs = match (input.template.as_str(), input.ui_framework.as_str()) {
        ("instrument", "webview") => generate_instrument_webview_template(
            &pascal_name, &snake_name, &description_escaped, &vst3_id,
            vendor_name, &vendor_id, vendor_url, vendor_email,
        ),
        ("instrument", "egui") => generate_instrument_egui_template(
            &pascal_name, &snake_name, &description_escaped, &vst3_id,
            vendor_name, &vendor_id, vendor_url, vendor_email,
        ),
        ("instrument", _) => generate_instrument_native_template(
            &pascal_name, &snake_name, &description_escaped, &vst3_id,
            vendor_name, &vendor_id, vendor_url, vendor_email,
        ),
        ("effect", "webview") => generate_effect_webview_template(
            &pascal_name, &snake_name, &description_escaped, &vst3_id,
            vendor_name, &vendor_id, vendor_url, vendor_email,
        ),
        ("effect", "egui") => generate_effect_egui_template(
            &pascal_name, &snake_name, &description_escaped, &vst3_id,
            vendor_name, &vendor_id, vendor_url, vendor_email,
        ),
        _ => generate_effect_native_template(
            &pascal_name, &snake_name, &description_escaped, &vst3_id,
            vendor_name, &vendor_id, vendor_url, vendor_email,
        ),
    };

    fs::write(project_path.join("src/lib.rs"), lib_rs)
        .map_err(|e| format!("Failed to write lib.rs: {}", e))?;

    // Create ui.html for webview projects
    if input.ui_framework == "webview" {
        let ui_html = generate_webview_ui_html(&pascal_name);
        fs::write(project_path.join("src/ui.html"), ui_html)
            .map_err(|e| format!("Failed to write ui.html: {}", e))?;
    }

    // Create metadata
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    // Use display_name if provided, otherwise use folder name
    let display_name = input
        .display_name
        .as_ref()
        .filter(|n| !n.is_empty())
        .cloned()
        .unwrap_or_else(|| input.name.clone());

    let metadata = ProjectMeta {
        id: id.clone(),
        name: display_name.clone(),
        description: input.description.clone(),
        template: Some(input.template.clone()),
        ui_framework: Some(input.ui_framework.clone()),
        components: input.components.clone(),
        created_at: now.clone(),
        updated_at: now,
        path: project_path.to_string_lossy().to_string(),
    };

    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(project_path.join(".vstworkshop/metadata.json"), metadata_json)
        .map_err(|e| format!("Failed to write metadata.json: {}", e))?;

    // Generate CLAUDE.md for project-specific Claude guidance (uses display name for header)
    let claude_md_content = super::claude_md::generate_claude_md(
        &display_name,
        &input.template,
        &input.ui_framework,
        input.components.as_ref(),
    );
    fs::write(project_path.join("CLAUDE.md"), claude_md_content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

    // Generate .claude/commands/ with project-specific skills
    generate_project_skills(&project_path, &input.template, &input.ui_framework, input.components.as_ref())?;

    // Initialize git repository for version control
    // These operations now run on a blocking thread pool to avoid UI freezes
    let project_path_str = project_path.to_string_lossy().to_string();
    super::git::init_repo(&project_path_str).await?;
    super::git::create_gitignore(&project_path_str)?;
    super::git::commit_changes(&project_path_str, "Initial plugin template").await?;

    Ok(metadata)
}

#[tauri::command]
pub async fn list_projects() -> Result<Vec<ProjectMeta>, String> {
    ensure_workspace()?;

    let projects_dir = get_projects_path();
    let mut projects = Vec::new();

    let entries = fs::read_dir(&projects_dir)
        .map_err(|e| format!("Failed to read projects dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let metadata_path = path.join(".vstworkshop/metadata.json");
        if metadata_path.exists() {
            let content = fs::read_to_string(&metadata_path)
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            let meta: ProjectMeta = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse metadata: {}", e))?;
            projects.push(meta);
        }
    }

    // Sort by updated_at descending (most recent first)
    projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(projects)
}

#[tauri::command]
pub async fn get_project(name: String) -> Result<ProjectMeta, String> {
    let project_path = get_projects_path().join(&name);
    let metadata_path = project_path.join(".vstworkshop/metadata.json");

    if !metadata_path.exists() {
        return Err(format!("Project '{}' not found", name));
    }

    let content = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let meta: ProjectMeta = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;

    Ok(meta)
}

#[tauri::command]
pub async fn delete_project(name: String) -> Result<(), String> {
    let project_path = get_projects_path().join(&name);

    if !project_path.exists() {
        return Err(format!("Project '{}' not found", name));
    }

    // Delete the project source folder
    fs::remove_dir_all(&project_path)
        .map_err(|e| format!("Failed to delete project: {}", e))?;

    // Also clean up the output folder for this project (output/{name}/)
    let output_folder = get_output_path().join(&name);
    if output_folder.exists() {
        // Don't fail if output cleanup fails - project is already deleted
        let _ = fs::remove_dir_all(&output_folder);
    }

    Ok(())
}

#[tauri::command]
pub async fn update_project(
    project_path: String,
    name: String,
    description: String,
) -> Result<ProjectMeta, String> {
    // Validate description length
    if description.len() > 280 {
        return Err("Description must be 280 characters or less".to_string());
    }

    let path = PathBuf::from(&project_path);
    let metadata_path = path.join(".vstworkshop/metadata.json");

    if !metadata_path.exists() {
        return Err("Project metadata not found".to_string());
    }

    // Read existing metadata
    let content = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let mut meta: ProjectMeta = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;

    // Update fields
    meta.name = name;
    meta.description = description;
    meta.updated_at = chrono::Utc::now().to_rfc3339();

    // Write back
    let metadata_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    Ok(meta)
}

#[tauri::command]
pub async fn open_project_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_in_editor(path: String, editor: Option<String>) -> Result<(), String> {
    let editor_cmd = editor.unwrap_or_else(|| "code".to_string());

    std::process::Command::new(&editor_cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open in {}: {}. Make sure it's installed and in your PATH.", editor_cmd, e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_workspace_path_string() -> String {
    get_workspace_path().to_string_lossy().to_string()
}

/// Generate a native effect plugin template (no custom UI)
fn generate_effect_native_template(
    pascal_name: &str,
    snake_name: &str,
    description: &str,
    vst3_id: &str,
    vendor_name: &str,
    vendor_id: &str,
    vendor_url: &str,
    vendor_email: &str,
) -> String {
    format!(
        r#"use nih_plug::prelude::*;
use std::sync::Arc;

/// {description}
struct {pascal_name} {{
    params: Arc<{pascal_name}Params>,
}}

#[derive(Params)]
struct {pascal_name}Params {{
    #[id = "gain"]
    pub gain: FloatParam,
}}

impl Default for {pascal_name} {{
    fn default() -> Self {{
        Self {{
            params: Arc::new({pascal_name}Params::default()),
        }}
    }}
}}

impl Default for {pascal_name}Params {{
    fn default() -> Self {{
        Self {{
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(0.0),
                FloatRange::Skewed {{
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(30.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
                }},
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db()),
        }}
    }}
}}

impl Plugin for {pascal_name} {{
    const NAME: &'static str = "{pascal_name}";
    const VENDOR: &'static str = "{vendor_name}";
    const URL: &'static str = "{vendor_url}";
    const EMAIL: &'static str = "{vendor_email}";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {{
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }}];

    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {{
        self.params.clone()
    }}

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {{
        for channel_samples in buffer.iter_samples() {{
            let gain = self.params.gain.smoothed.next();
            for sample in channel_samples {{
                *sample *= gain;
                // Protect against NaN/Inf (can crash DAWs)
                if !sample.is_finite() {{
                    *sample = 0.0;
                }}
            }}
        }}
        ProcessStatus::Normal
    }}
}}

impl ClapPlugin for {pascal_name} {{
    const CLAP_ID: &'static str = "com.{vendor_id}.{snake_name}";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("{description}");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::AudioEffect, ClapFeature::Stereo];
}}

impl Vst3Plugin for {pascal_name} {{
    const VST3_CLASS_ID: [u8; 16] = *b"{vst3_id}";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx];
}}

nih_export_clap!({pascal_name});
nih_export_vst3!({pascal_name});
"#,
        pascal_name = pascal_name,
        snake_name = snake_name,
        description = description,
        vst3_id = vst3_id,
        vendor_name = vendor_name,
        vendor_id = vendor_id,
        vendor_url = vendor_url,
        vendor_email = vendor_email
    )
}

/// Generate a native instrument plugin template (no custom UI)
fn generate_instrument_native_template(
    pascal_name: &str,
    snake_name: &str,
    description: &str,
    vst3_id: &str,
    vendor_name: &str,
    vendor_id: &str,
    vendor_url: &str,
    vendor_email: &str,
) -> String {
    format!(
        r#"use nih_plug::prelude::*;
use std::sync::Arc;

/// {description}
struct {pascal_name} {{
    params: Arc<{pascal_name}Params>,
    sample_rate: f32,
    /// Current phase of the oscillator (0.0 to 1.0)
    phase: f32,
    /// Current note frequency (0 if no note playing)
    note_freq: f32,
    /// Current note velocity (0.0 to 1.0)
    velocity: f32,
}}

#[derive(Params)]
struct {pascal_name}Params {{
    #[id = "gain"]
    pub gain: FloatParam,
}}

impl Default for {pascal_name} {{
    fn default() -> Self {{
        Self {{
            params: Arc::new({pascal_name}Params::default()),
            sample_rate: 44100.0,
            phase: 0.0,
            note_freq: 0.0,
            velocity: 0.0,
        }}
    }}
}}

impl Default for {pascal_name}Params {{
    fn default() -> Self {{
        Self {{
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(-6.0),
                FloatRange::Skewed {{
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(6.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 6.0),
                }},
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db()),
        }}
    }}
}}

impl {pascal_name} {{
    /// Convert MIDI note number to frequency in Hz
    fn midi_note_to_freq(note: u8) -> f32 {{
        440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
    }}
}}

impl Plugin for {pascal_name} {{
    const NAME: &'static str = "{pascal_name}";
    const VENDOR: &'static str = "{vendor_name}";
    const URL: &'static str = "{vendor_url}";
    const EMAIL: &'static str = "{vendor_email}";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    // Instrument: no audio input, stereo output
    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {{
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }}];

    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {{
        self.params.clone()
    }}

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {{
        self.sample_rate = buffer_config.sample_rate;
        true
    }}

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {{
        // Process MIDI events
        while let Some(event) = context.next_event() {{
            match event {{
                NoteEvent::NoteOn {{ note, velocity, .. }} => {{
                    self.note_freq = Self::midi_note_to_freq(note);
                    self.velocity = velocity;
                }}
                NoteEvent::NoteOff {{ note, .. }} => {{
                    // Only stop if it's the same note
                    if Self::midi_note_to_freq(note) == self.note_freq {{
                        self.note_freq = 0.0;
                        self.velocity = 0.0;
                    }}
                }}
                _ => {{}}
            }}
        }}

        // Generate audio
        let gain = self.params.gain.smoothed.next();
        let phase_delta = self.note_freq / self.sample_rate;

        for channel_samples in buffer.iter_samples() {{
            // Simple sine wave oscillator
            let sample = if self.note_freq > 0.0 {{
                let sine = (self.phase * std::f32::consts::TAU).sin();
                self.phase = (self.phase + phase_delta) % 1.0;
                sine * self.velocity * gain
            }} else {{
                0.0
            }};

            for output_sample in channel_samples {{
                // Protect against NaN/Inf (can crash DAWs)
                *output_sample = if sample.is_finite() {{ sample }} else {{ 0.0 }};
            }}
        }}

        ProcessStatus::Normal
    }}
}}

impl ClapPlugin for {pascal_name} {{
    const CLAP_ID: &'static str = "com.{vendor_id}.{snake_name}";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("{description}");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::Instrument, ClapFeature::Synthesizer, ClapFeature::Stereo];
}}

impl Vst3Plugin for {pascal_name} {{
    const VST3_CLASS_ID: [u8; 16] = *b"{vst3_id}";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Synth, Vst3SubCategory::Instrument];
}}

nih_export_clap!({pascal_name});
nih_export_vst3!({pascal_name});
"#,
        pascal_name = pascal_name,
        snake_name = snake_name,
        description = description,
        vst3_id = vst3_id,
        vendor_name = vendor_name,
        vendor_id = vendor_id,
        vendor_url = vendor_url,
        vendor_email = vendor_email
    )
}

/// Generate an effect plugin template with WebView UI
fn generate_effect_webview_template(
    pascal_name: &str,
    snake_name: &str,
    description: &str,
    vst3_id: &str,
    vendor_name: &str,
    vendor_id: &str,
    vendor_url: &str,
    vendor_email: &str,
) -> String {
    format!(
        r#"use nih_plug::prelude::*;
use nih_plug_webview::{{WebViewEditor, HTMLSource}};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{{AtomicBool, Ordering}};

/// Messages from the WebView UI
#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {{
    Init,
    SetGain {{ value: f32 }},
}}

/// {description}
struct {pascal_name} {{
    params: Arc<{pascal_name}Params>,
}}

#[derive(Params)]
struct {pascal_name}Params {{
    #[id = "gain"]
    pub gain: FloatParam,
    /// Flag to notify UI when gain changes from host automation
    #[persist = "gain-dirty"]
    gain_changed: Arc<AtomicBool>,
}}

impl Default for {pascal_name} {{
    fn default() -> Self {{
        Self {{
            params: Arc::new({pascal_name}Params::default()),
        }}
    }}
}}

impl Default for {pascal_name}Params {{
    fn default() -> Self {{
        let gain_changed = Arc::new(AtomicBool::new(false));
        let gain_changed_clone = gain_changed.clone();

        Self {{
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(0.0),
                FloatRange::Skewed {{
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(30.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
                }},
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db())
            .with_callback(Arc::new(move |_| {{
                gain_changed_clone.store(true, Ordering::Relaxed);
            }})),
            gain_changed,
        }}
    }}
}}

impl Plugin for {pascal_name} {{
    const NAME: &'static str = "{pascal_name}";
    const VENDOR: &'static str = "{vendor_name}";
    const URL: &'static str = "{vendor_url}";
    const EMAIL: &'static str = "{vendor_email}";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {{
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }}];

    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {{
        self.params.clone()
    }}

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {{
        let params = self.params.clone();
        let gain_changed = self.params.gain_changed.clone();

        let editor = WebViewEditor::new(HTMLSource::String(include_str!("ui.html")), (400, 300))
            .with_background_color((26, 26, 46, 255))
            .with_developer_mode(true)
            .with_event_loop(move |ctx, setter, _window| {{
                // Handle messages from WebView
                while let Ok(msg) = ctx.next_event() {{
                    if let Ok(ui_msg) = serde_json::from_value::<UIMessage>(msg) {{
                        match ui_msg {{
                            UIMessage::Init => {{
                                // Send initial state to UI
                                ctx.send_json(json!({{
                                    "type": "param_change",
                                    "param": "gain",
                                    "value": params.gain.unmodulated_normalized_value(),
                                    "text": params.gain.to_string()
                                }}));
                            }}
                            UIMessage::SetGain {{ value }} => {{
                                setter.begin_set_parameter(&params.gain);
                                setter.set_parameter_normalized(&params.gain, value);
                                setter.end_set_parameter(&params.gain);
                            }}
                        }}
                    }}
                }}

                // Sync UI when parameter changes from host automation
                if gain_changed.swap(false, Ordering::Relaxed) {{
                    ctx.send_json(json!({{
                        "type": "param_change",
                        "param": "gain",
                        "value": params.gain.unmodulated_normalized_value(),
                        "text": params.gain.to_string()
                    }}));
                }}
            }});

        Some(Box::new(editor))
    }}

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {{
        for channel_samples in buffer.iter_samples() {{
            let gain = self.params.gain.smoothed.next();
            for sample in channel_samples {{
                *sample *= gain;
                // Protect against NaN/Inf (can crash DAWs)
                if !sample.is_finite() {{
                    *sample = 0.0;
                }}
            }}
        }}
        ProcessStatus::Normal
    }}
}}

impl ClapPlugin for {pascal_name} {{
    const CLAP_ID: &'static str = "com.{vendor_id}.{snake_name}";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("{description}");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::AudioEffect, ClapFeature::Stereo];
}}

impl Vst3Plugin for {pascal_name} {{
    const VST3_CLASS_ID: [u8; 16] = *b"{vst3_id}";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx];
}}

nih_export_clap!({pascal_name});
nih_export_vst3!({pascal_name});
"#,
        pascal_name = pascal_name,
        snake_name = snake_name,
        description = description,
        vst3_id = vst3_id,
        vendor_name = vendor_name,
        vendor_id = vendor_id,
        vendor_url = vendor_url,
        vendor_email = vendor_email
    )
}

/// Generate an effect plugin template with egui UI
fn generate_effect_egui_template(
    pascal_name: &str,
    snake_name: &str,
    description: &str,
    vst3_id: &str,
    vendor_name: &str,
    vendor_id: &str,
    vendor_url: &str,
    vendor_email: &str,
) -> String {
    format!(
        r#"use nih_plug::prelude::*;
use nih_plug_egui::{{create_egui_editor, egui, widgets, EguiState}};
use std::sync::Arc;

/// {description}
struct {pascal_name} {{
    params: Arc<{pascal_name}Params>,
}}

#[derive(Params)]
struct {pascal_name}Params {{
    #[persist = "editor-state"]
    editor_state: Arc<EguiState>,

    #[id = "gain"]
    pub gain: FloatParam,
}}

impl Default for {pascal_name} {{
    fn default() -> Self {{
        Self {{
            params: Arc::new({pascal_name}Params::default()),
        }}
    }}
}}

impl Default for {pascal_name}Params {{
    fn default() -> Self {{
        Self {{
            editor_state: EguiState::from_size(400, 300),
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(0.0),
                FloatRange::Skewed {{
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(30.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
                }},
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db()),
        }}
    }}
}}

impl Plugin for {pascal_name} {{
    const NAME: &'static str = "{pascal_name}";
    const VENDOR: &'static str = "{vendor_name}";
    const URL: &'static str = "{vendor_url}";
    const EMAIL: &'static str = "{vendor_email}";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {{
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }}];

    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {{
        self.params.clone()
    }}

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {{
        let params = self.params.clone();
        create_egui_editor(
            self.params.editor_state.clone(),
            (),
            |_, _| {{}},
            move |egui_ctx, setter, _state| {{
                egui::CentralPanel::default().show(egui_ctx, |ui| {{
                    ui.heading("{pascal_name}");
                    ui.add_space(10.0);

                    ui.label("Gain");
                    ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
                }});
            }},
        )
    }}

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {{
        for channel_samples in buffer.iter_samples() {{
            let gain = self.params.gain.smoothed.next();
            for sample in channel_samples {{
                *sample *= gain;
                // Protect against NaN/Inf (can crash DAWs)
                if !sample.is_finite() {{
                    *sample = 0.0;
                }}
            }}
        }}
        ProcessStatus::Normal
    }}
}}

impl ClapPlugin for {pascal_name} {{
    const CLAP_ID: &'static str = "com.{vendor_id}.{snake_name}";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("{description}");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::AudioEffect, ClapFeature::Stereo];
}}

impl Vst3Plugin for {pascal_name} {{
    const VST3_CLASS_ID: [u8; 16] = *b"{vst3_id}";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx];
}}

nih_export_clap!({pascal_name});
nih_export_vst3!({pascal_name});
"#,
        pascal_name = pascal_name,
        snake_name = snake_name,
        description = description,
        vst3_id = vst3_id,
        vendor_name = vendor_name,
        vendor_id = vendor_id,
        vendor_url = vendor_url,
        vendor_email = vendor_email
    )
}

/// Generate an instrument plugin template with WebView UI
fn generate_instrument_webview_template(
    pascal_name: &str,
    snake_name: &str,
    description: &str,
    vst3_id: &str,
    vendor_name: &str,
    vendor_id: &str,
    vendor_url: &str,
    vendor_email: &str,
) -> String {
    format!(
        r#"use nih_plug::prelude::*;
use nih_plug_webview::{{WebViewEditor, HTMLSource}};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{{AtomicBool, Ordering}};

/// Messages from the WebView UI
#[derive(Deserialize)]
#[serde(tag = "type")]
enum UIMessage {{
    Init,
    SetGain {{ value: f32 }},
}}

/// {description}
struct {pascal_name} {{
    params: Arc<{pascal_name}Params>,
    sample_rate: f32,
    phase: f32,
    note_freq: f32,
    velocity: f32,
}}

#[derive(Params)]
struct {pascal_name}Params {{
    #[id = "gain"]
    pub gain: FloatParam,
    /// Flag to notify UI when gain changes from host automation
    #[persist = "gain-dirty"]
    gain_changed: Arc<AtomicBool>,
}}

impl Default for {pascal_name} {{
    fn default() -> Self {{
        Self {{
            params: Arc::new({pascal_name}Params::default()),
            sample_rate: 44100.0,
            phase: 0.0,
            note_freq: 0.0,
            velocity: 0.0,
        }}
    }}
}}

impl Default for {pascal_name}Params {{
    fn default() -> Self {{
        let gain_changed = Arc::new(AtomicBool::new(false));
        let gain_changed_clone = gain_changed.clone();

        Self {{
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(-6.0),
                FloatRange::Skewed {{
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(6.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 6.0),
                }},
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db())
            .with_callback(Arc::new(move |_| {{
                gain_changed_clone.store(true, Ordering::Relaxed);
            }})),
            gain_changed,
        }}
    }}
}}

impl {pascal_name} {{
    fn midi_note_to_freq(note: u8) -> f32 {{
        440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
    }}
}}

impl Plugin for {pascal_name} {{
    const NAME: &'static str = "{pascal_name}";
    const VENDOR: &'static str = "{vendor_name}";
    const URL: &'static str = "{vendor_url}";
    const EMAIL: &'static str = "{vendor_email}";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {{
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }}];

    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {{
        self.params.clone()
    }}

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {{
        let params = self.params.clone();
        let gain_changed = self.params.gain_changed.clone();

        let editor = WebViewEditor::new(HTMLSource::String(include_str!("ui.html")), (400, 300))
            .with_background_color((26, 26, 46, 255))
            .with_developer_mode(true)
            .with_event_loop(move |ctx, setter, _window| {{
                // Handle messages from WebView
                while let Ok(msg) = ctx.next_event() {{
                    if let Ok(ui_msg) = serde_json::from_value::<UIMessage>(msg) {{
                        match ui_msg {{
                            UIMessage::Init => {{
                                // Send initial state to UI
                                ctx.send_json(json!({{
                                    "type": "param_change",
                                    "param": "gain",
                                    "value": params.gain.unmodulated_normalized_value(),
                                    "text": params.gain.to_string()
                                }}));
                            }}
                            UIMessage::SetGain {{ value }} => {{
                                setter.begin_set_parameter(&params.gain);
                                setter.set_parameter_normalized(&params.gain, value);
                                setter.end_set_parameter(&params.gain);
                            }}
                        }}
                    }}
                }}

                // Sync UI when parameter changes from host automation
                if gain_changed.swap(false, Ordering::Relaxed) {{
                    ctx.send_json(json!({{
                        "type": "param_change",
                        "param": "gain",
                        "value": params.gain.unmodulated_normalized_value(),
                        "text": params.gain.to_string()
                    }}));
                }}
            }});

        Some(Box::new(editor))
    }}

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {{
        self.sample_rate = buffer_config.sample_rate;
        true
    }}

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {{
        // Process MIDI events
        while let Some(event) = context.next_event() {{
            match event {{
                NoteEvent::NoteOn {{ note, velocity, .. }} => {{
                    self.note_freq = Self::midi_note_to_freq(note);
                    self.velocity = velocity;
                }}
                NoteEvent::NoteOff {{ note, .. }} => {{
                    if Self::midi_note_to_freq(note) == self.note_freq {{
                        self.note_freq = 0.0;
                        self.velocity = 0.0;
                    }}
                }}
                _ => {{}}
            }}
        }}

        // Generate audio
        let gain = self.params.gain.smoothed.next();
        let phase_delta = self.note_freq / self.sample_rate;

        for channel_samples in buffer.iter_samples() {{
            let sample = if self.note_freq > 0.0 {{
                let sine = (self.phase * std::f32::consts::TAU).sin();
                self.phase = (self.phase + phase_delta) % 1.0;
                sine * self.velocity * gain
            }} else {{
                0.0
            }};

            for output_sample in channel_samples {{
                // Protect against NaN/Inf (can crash DAWs)
                *output_sample = if sample.is_finite() {{ sample }} else {{ 0.0 }};
            }}
        }}

        ProcessStatus::Normal
    }}
}}

impl ClapPlugin for {pascal_name} {{
    const CLAP_ID: &'static str = "com.{vendor_id}.{snake_name}";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("{description}");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::Instrument, ClapFeature::Synthesizer, ClapFeature::Stereo];
}}

impl Vst3Plugin for {pascal_name} {{
    const VST3_CLASS_ID: [u8; 16] = *b"{vst3_id}";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Synth, Vst3SubCategory::Instrument];
}}

nih_export_clap!({pascal_name});
nih_export_vst3!({pascal_name});
"#,
        pascal_name = pascal_name,
        snake_name = snake_name,
        description = description,
        vst3_id = vst3_id,
        vendor_name = vendor_name,
        vendor_id = vendor_id,
        vendor_url = vendor_url,
        vendor_email = vendor_email
    )
}

/// Generate an instrument plugin template with egui UI
fn generate_instrument_egui_template(
    pascal_name: &str,
    snake_name: &str,
    description: &str,
    vst3_id: &str,
    vendor_name: &str,
    vendor_id: &str,
    vendor_url: &str,
    vendor_email: &str,
) -> String {
    format!(
        r#"use nih_plug::prelude::*;
use nih_plug_egui::{{create_egui_editor, egui, widgets, EguiState}};
use std::sync::Arc;

/// {description}
struct {pascal_name} {{
    params: Arc<{pascal_name}Params>,
    sample_rate: f32,
    phase: f32,
    note_freq: f32,
    velocity: f32,
}}

#[derive(Params)]
struct {pascal_name}Params {{
    #[persist = "editor-state"]
    editor_state: Arc<EguiState>,

    #[id = "gain"]
    pub gain: FloatParam,
}}

impl Default for {pascal_name} {{
    fn default() -> Self {{
        Self {{
            params: Arc::new({pascal_name}Params::default()),
            sample_rate: 44100.0,
            phase: 0.0,
            note_freq: 0.0,
            velocity: 0.0,
        }}
    }}
}}

impl Default for {pascal_name}Params {{
    fn default() -> Self {{
        Self {{
            editor_state: EguiState::from_size(400, 300),
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(-6.0),
                FloatRange::Skewed {{
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(6.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 6.0),
                }},
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db()),
        }}
    }}
}}

impl {pascal_name} {{
    fn midi_note_to_freq(note: u8) -> f32 {{
        440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
    }}
}}

impl Plugin for {pascal_name} {{
    const NAME: &'static str = "{pascal_name}";
    const VENDOR: &'static str = "{vendor_name}";
    const URL: &'static str = "{vendor_url}";
    const EMAIL: &'static str = "{vendor_email}";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {{
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }}];

    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::None;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {{
        self.params.clone()
    }}

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {{
        let params = self.params.clone();
        create_egui_editor(
            self.params.editor_state.clone(),
            (),
            |_, _| {{}},
            move |egui_ctx, setter, _state| {{
                egui::CentralPanel::default().show(egui_ctx, |ui| {{
                    ui.heading("{pascal_name}");
                    ui.add_space(10.0);

                    ui.label("Gain");
                    ui.add(widgets::ParamSlider::for_param(&params.gain, setter));
                }});
            }},
        )
    }}

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {{
        self.sample_rate = buffer_config.sample_rate;
        true
    }}

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {{
        // Process MIDI events
        while let Some(event) = context.next_event() {{
            match event {{
                NoteEvent::NoteOn {{ note, velocity, .. }} => {{
                    self.note_freq = Self::midi_note_to_freq(note);
                    self.velocity = velocity;
                }}
                NoteEvent::NoteOff {{ note, .. }} => {{
                    if Self::midi_note_to_freq(note) == self.note_freq {{
                        self.note_freq = 0.0;
                        self.velocity = 0.0;
                    }}
                }}
                _ => {{}}
            }}
        }}

        // Generate audio
        let gain = self.params.gain.smoothed.next();
        let phase_delta = self.note_freq / self.sample_rate;

        for channel_samples in buffer.iter_samples() {{
            let sample = if self.note_freq > 0.0 {{
                let sine = (self.phase * std::f32::consts::TAU).sin();
                self.phase = (self.phase + phase_delta) % 1.0;
                sine * self.velocity * gain
            }} else {{
                0.0
            }};

            for output_sample in channel_samples {{
                // Protect against NaN/Inf (can crash DAWs)
                *output_sample = if sample.is_finite() {{ sample }} else {{ 0.0 }};
            }}
        }}

        ProcessStatus::Normal
    }}
}}

impl ClapPlugin for {pascal_name} {{
    const CLAP_ID: &'static str = "com.{vendor_id}.{snake_name}";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("{description}");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::Instrument, ClapFeature::Synthesizer, ClapFeature::Stereo];
}}

impl Vst3Plugin for {pascal_name} {{
    const VST3_CLASS_ID: [u8; 16] = *b"{vst3_id}";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Synth, Vst3SubCategory::Instrument];
}}

nih_export_clap!({pascal_name});
nih_export_vst3!({pascal_name});
"#,
        pascal_name = pascal_name,
        snake_name = snake_name,
        description = description,
        vst3_id = vst3_id,
        vendor_name = vendor_name,
        vendor_id = vendor_id,
        vendor_url = vendor_url,
        vendor_email = vendor_email
    )
}

/// Generate the HTML file for WebView UI
fn generate_webview_ui_html(pascal_name: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{pascal_name}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e4e4e4;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        h1 {{
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 30px;
            color: #fff;
        }}
        .control {{
            width: 100%;
            max-width: 300px;
            margin-bottom: 20px;
        }}
        label {{
            display: block;
            font-size: 12px;
            color: #888;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        input[type="range"] {{
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: #333;
            outline: none;
            -webkit-appearance: none;
        }}
        input[type="range"]::-webkit-slider-thumb {{
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #6366f1;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
        }}
        .value {{
            text-align: center;
            font-size: 14px;
            color: #6366f1;
            margin-top: 8px;
            font-weight: 500;
        }}
    </style>
</head>
<body>
    <h1>{pascal_name}</h1>

    <div class="control">
        <label for="gain">Gain</label>
        <input type="range" id="gain" min="0" max="1" value="0.5" step="0.001">
        <div class="value" id="gain-value">0.0 dB</div>
    </div>

    <script>
        // Send message to plugin
        function sendToPlugin(msg) {{
            if (window.ipc) {{
                window.ipc.postMessage(JSON.stringify(msg));
            }}
        }}

        // Gain control - uses normalized value (0-1)
        const gainSlider = document.getElementById('gain');
        const gainValue = document.getElementById('gain-value');

        // Track if we're being updated from plugin (to avoid feedback loops)
        let updatingFromPlugin = false;

        gainSlider.addEventListener('input', (e) => {{
            if (updatingFromPlugin) return;
            const normalized = parseFloat(e.target.value);
            // Send normalized value to plugin
            sendToPlugin({{ type: 'SetGain', value: normalized }});
        }});

        // Handle messages from the plugin
        window.onPluginMessage = function(msg) {{
            if (msg.type === 'param_change' && msg.param === 'gain') {{
                updatingFromPlugin = true;
                gainSlider.value = msg.value;
                gainValue.textContent = msg.text;
                updatingFromPlugin = false;
            }}
        }};

        // Request initial state when loaded
        window.addEventListener('DOMContentLoaded', () => {{
            sendToPlugin({{ type: 'Init' }});
        }});
    </script>
</body>
</html>
"##,
        pascal_name = pascal_name
    )
}
