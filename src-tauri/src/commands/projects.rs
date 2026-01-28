use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "frameworkId")]
    pub framework_id: Option<String>, // "nih-plug", "juce", "iplug2", etc.
    pub template: Option<String>, // "effect" or "instrument"
    #[serde(rename = "uiFramework")]
    pub ui_framework: Option<String>, // "webview", "egui", or "native"
    pub components: Option<Vec<String>>, // Starter components selected
    #[serde(rename = "buildFormats")]
    pub build_formats: Option<Vec<String>>, // e.g. ["vst3", "clap", "au"]
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
    #[serde(rename = "frameworkId")]
    pub framework_id: Option<String>,     // "nih-plug", "juce", etc. (defaults to "nih-plug")
    #[serde(rename = "vendorName")]
    pub vendor_name: Option<String>,
    #[serde(rename = "vendorUrl")]
    pub vendor_url: Option<String>,
    #[serde(rename = "vendorEmail")]
    pub vendor_email: Option<String>,
    pub components: Option<Vec<String>>, // Starter components to include
    #[serde(rename = "buildFormats")]
    pub build_formats: Option<Vec<String>>, // Build format selection (e.g. ["vst3", "clap"])
}

pub fn get_workspace_path() -> PathBuf {
    let home = super::get_home_dir();
    PathBuf::from(home).join("Freqlab")
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
    // Only include projects that have Cargo.toml (i.e., Rust/nih-plug projects, not CMake-based projects)
    let workspace_cargo = workspace.join("Cargo.toml");
    let mut rust_projects = Vec::new();

    if projects.exists() {
        if let Ok(entries) = fs::read_dir(&projects) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && path.join("Cargo.toml").exists() {
                    if let Some(name) = path.file_name() {
                        rust_projects.push(format!("projects/{}", name.to_string_lossy()));
                    }
                }
            }
        }
    }

    // Build the members list
    let members_str = if rust_projects.is_empty() {
        r#"members = ["xtask"]"#.to_string()
    } else {
        rust_projects.push("xtask".to_string());
        let quoted: Vec<String> = rust_projects.iter().map(|p| format!("\"{}\"", p)).collect();
        format!("members = [{}]", quoted.join(", "))
    };

    let cargo_content = format!(
        r#"[workspace]
{}
resolver = "2"

[profile.release]
lto = "thin"
strip = "symbols"
"#,
        members_str
    );
    fs::write(&workspace_cargo, &cargo_content)
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

    // Create .cargo/config.toml with xtask alias and custom target directory
    let cargo_config_dir = workspace.join(".cargo");
    fs::create_dir_all(&cargo_config_dir)
        .map_err(|e| format!("Failed to create .cargo dir: {}", e))?;

    let cargo_config = cargo_config_dir.join("config.toml");
    let desired_config = r#"[alias]
xtask = "run --package xtask --release --"

[build]
target-dir = ".cache/cargo-target"
"#;

    // Check if config needs updating (missing target-dir setting)
    let needs_update = if cargo_config.exists() {
        let existing = fs::read_to_string(&cargo_config).unwrap_or_default();
        !existing.contains("target-dir")
    } else {
        true
    };

    if needs_update {
        fs::write(&cargo_config, desired_config)
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
    format!("Freqlab{:05}", hash % 100000)
        .chars()
        .take(16)
        .collect()
}

/// Generate .claude/commands/ with project-specific guides from library
/// Guides are loaded from the library system (bundled + custom)
fn generate_project_guides(
    app_handle: &tauri::AppHandle,
    project_path: &std::path::Path,
    framework_id: &str,
    template: &str,
    ui_framework: &str,
    components: Option<&Vec<String>>,
) -> Result<(), String> {
    use crate::library;

    let commands_dir = project_path.join(".claude/commands");
    fs::create_dir_all(&commands_dir)
        .map_err(|e| format!("Failed to create .claude/commands: {}", e))?;

    // Load the library
    let lib = library::loader::load_library(app_handle);

    // Helper to write a guide file
    let write_guide = |guide_id: &str, filename: &str| -> Result<(), String> {
        if let Some(guide) = lib.guides.iter().find(|g| g.id == guide_id) {
            // Write full content with frontmatter for Claude
            let content = format!(
                "---\nname: {}\ndescription: {}\n---\n\n{}",
                guide.name, guide.description, guide.content
            );
            fs::write(commands_dir.join(filename), content)
                .map_err(|e| format!("Failed to write {}: {}", filename, e))?;
        }
        Ok(())
    };

    // Write shared guides (dsp-safety is always included)
    write_guide("dsp-safety", "dsp-safety.md")?;

    // Write framework core guides
    if let Some(fw) = lib.frameworks.iter().find(|f| f.id == framework_id) {
        for guide_ref in &fw.guides.core {
            let guide_id = guide_ref.split('/').last().unwrap_or(guide_ref);
            let filename = format!("{}.md", guide_id);
            write_guide(guide_id, &filename)?;
        }

        // Write shared guides from framework config
        for guide_ref in &fw.guides.shared {
            let guide_id = guide_ref.split('/').last().unwrap_or(guide_ref);
            let filename = format!("{}.md", guide_id);
            write_guide(guide_id, &filename)?;
        }

        // Write UI framework guide
        if let Some(ui_guides) = fw.guides.ui.get(ui_framework) {
            for guide_ref in ui_guides {
                let guide_id = guide_ref.split('/').last().unwrap_or(guide_ref);
                let filename = format!("{}.md", guide_id);
                write_guide(guide_id, &filename)?;
            }
        }

        // Write template-specific guides
        let template_guides = match template {
            "effect" => &fw.guides.effect,
            "instrument" => &fw.guides.instrument,
            _ => &fw.guides.effect,
        };
        for guide_ref in template_guides {
            let guide_id = guide_ref.split('/').last().unwrap_or(guide_ref);
            let filename = format!("{}.md", guide_id);
            write_guide(guide_id, &filename)?;
        }
    }

    // Write component guides if any were selected
    if let Some(comps) = components {
        for component in comps {
            let guide_id = component.replace('_', "-");
            let filename = format!("{}.md", guide_id);
            write_guide(&guide_id, &filename)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn create_project(
    app_handle: tauri::AppHandle,
    input: CreateProjectInput,
) -> Result<ProjectMeta, String> {
    use crate::library;
    use std::collections::HashMap;

    validate_name(&input.name)?;
    ensure_workspace()?;

    let project_path = get_projects_path().join(&input.name);

    if project_path.exists() {
        return Err(format!("Project '{}' already exists", input.name));
    }

    // Create directory structure
    fs::create_dir_all(project_path.join("src"))
        .map_err(|e| format!("Failed to create src dir: {}", e))?;
    fs::create_dir_all(project_path.join(".freqlab"))
        .map_err(|e| format!("Failed to create .freqlab dir: {}", e))?;

    let snake_name = to_snake_case(&input.name);
    let pascal_name = to_pascal_case(&input.name);
    let vst3_id = generate_vst3_id(&input.name);

    // Framework (default to nih-plug for backwards compatibility)
    let framework_id = input.framework_id.as_deref().unwrap_or("nih-plug");

    // Validate that the framework exists in the library
    let lib = library::loader::load_library(&app_handle);
    let framework = lib.frameworks.iter().find(|f| f.id == framework_id).ok_or_else(|| {
        let available: Vec<_> = lib.frameworks.iter().map(|f| f.id.as_str()).collect();
        format!(
            "Unknown framework '{}'. Available frameworks: {}",
            framework_id,
            available.join(", ")
        )
    })?;

    // Vendor info
    let vendor_name = input.vendor_name.as_deref().unwrap_or("freqlab");
    let vendor_id: String = vendor_name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let vendor_url = input.vendor_url.as_deref().unwrap_or("");
    let vendor_email = input.vendor_email.as_deref().unwrap_or("");
    let description_escaped = input.description.replace('"', "\\\"");

    // Build placeholders for template substitution
    let mut placeholders: HashMap<String, String> = HashMap::new();
    placeholders.insert("snake_name".to_string(), snake_name.clone());
    placeholders.insert("pascal_name".to_string(), pascal_name.clone());
    placeholders.insert("description".to_string(), description_escaped.clone());
    placeholders.insert("vst3_id".to_string(), vst3_id.clone());
    placeholders.insert("vendor_name".to_string(), vendor_name.to_string());
    placeholders.insert("vendor_url".to_string(), vendor_url.to_string());
    placeholders.insert("vendor_email".to_string(), vendor_email.to_string());

    // vendor_id is the lowercase alphanumeric vendor name (for bundle identifiers)
    placeholders.insert("vendor_id".to_string(), vendor_id.clone());

    // mfr_id is the 4-character uppercase manufacturer code (for AU/JUCE/iPlug2)
    let mfr_id = if vendor_id.len() >= 4 {
        vendor_id[..4].to_uppercase()
    } else {
        format!("{:0<4}", vendor_id).to_uppercase()
    };
    placeholders.insert("mfr_id".to_string(), mfr_id);

    // Generate unique 4-character plugin code for JUCE (from plugin name hash)
    let plugin_code = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        input.name.hash(&mut hasher);
        let hash = hasher.finish();
        format!("{:04X}", hash % 0xFFFF)
    };
    placeholders.insert("plugin_code".to_string(), plugin_code);

    // Plugin UI dimensions (default 400x300)
    placeholders.insert("plug_width".to_string(), "400".to_string());
    placeholders.insert("plug_height".to_string(), "300".to_string());

    // Try to load template from library
    let template_result = library::loader::get_template(
        &app_handle,
        framework_id,
        &input.template,
        &input.ui_framework,
    );

    // Load template from library (required - no fallback)
    let template = template_result.ok_or_else(|| {
        format!(
            "Template not found for framework '{}', type '{}', UI '{}'. \
            Please ensure templates exist in the library at: \
            frameworks/{}/templates/{}-{}/",
            framework_id, input.template, input.ui_framework,
            framework_id, input.template, input.ui_framework
        )
    })?;

    // Write template files to project
    for file in &template.files {
        let content = library::loader::apply_placeholders(&file.content, &placeholders);

        // Determine output path based on filename
        // If filename contains a path separator, preserve the relative structure
        let output_path = if file.filename.contains('/') || file.filename.contains('\\') {
            // File already has a relative path (e.g., resources/web/ui.html)
            let file_path = project_path.join(&file.filename);
            // Create parent directories if needed
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory for {}: {}", file.filename, e))?;
            }
            file_path
        } else if file.filename == "Cargo.toml" || file.filename == "CMakeLists.txt" {
            // Build config files go in project root
            project_path.join(&file.filename)
        } else if file.filename == "config.h" || file.filename == "resource.h" {
            // iPlug2: config.h and resource.h go in project root (not src/)
            project_path.join(&file.filename)
        } else if file.filename.starts_with("main.rc_mac") {
            // iPlug2: Resource files go in resources/
            let resources_dir = project_path.join("resources");
            fs::create_dir_all(&resources_dir)
                .map_err(|e| format!("Failed to create resources dir: {}", e))?;
            resources_dir.join(&file.filename)
        } else if file.filename.ends_with(".plist") || file.filename.ends_with(".xib") {
            // iPlug2: Info.plist and XIB files go in resources/ with {PascalName}- prefix
            let resources_dir = project_path.join("resources");
            fs::create_dir_all(&resources_dir)
                .map_err(|e| format!("Failed to create resources dir: {}", e))?;
            let prefixed_filename = format!("{}-{}", pascal_name, file.filename);
            resources_dir.join(&prefixed_filename)
        } else if file.filename.ends_with(".rs")
            || file.filename.ends_with(".cpp")
            || file.filename.ends_with(".h")
        {
            // Source files go in src/ (but NOT .html - those should have explicit paths)
            project_path.join("src").join(&file.filename)
        } else {
            project_path.join(&file.filename)
        };

        fs::write(&output_path, content)
            .map_err(|e| format!("Failed to write {}: {}", file.filename, e))?;
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
        framework_id: Some(framework_id.to_string()),
        template: Some(input.template.clone()),
        ui_framework: Some(input.ui_framework.clone()),
        components: input.components.clone(),
        build_formats: input.build_formats.clone(),
        created_at: now.clone(),
        updated_at: now,
        path: project_path.to_string_lossy().to_string(),
    };

    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(project_path.join(".freqlab/metadata.json"), metadata_json)
        .map_err(|e| format!("Failed to write metadata.json: {}", e))?;

    // Generate CLAUDE.md for project-specific Claude guidance (uses display name for header)
    // Use framework info from earlier validation
    let framework_info = super::claude_md::FrameworkInfo {
        id: framework.id.clone(),
        display_name: framework.display_name.clone(),
        language: framework.language.clone(),
    };

    // Find and inline core guides (basics + UI framework)
    // Guides are loaded with ID = filename stem, and framework association comes from path
    let basics_guide = lib.guides.iter()
        .find(|g| {
            // Match "basics" guide for this framework
            g.id == "basics" && g.framework.as_deref() == Some(framework_id)
        })
        .map(|g| g.content.clone());

    let ui_guide = lib.guides.iter()
        .find(|g| {
            // Match UI framework guide (e.g., "webview-ui", "egui-ui", "native-ui")
            let ui_id = format!("{}-ui", input.ui_framework);
            g.id == ui_id && g.framework.as_deref() == Some(framework_id)
        })
        .map(|g| g.content.clone());

    let inlined_guides = super::claude_md::InlinedGuides {
        basics: basics_guide,
        ui_framework: ui_guide,
    };

    let claude_md_content = super::claude_md::generate_claude_md_with_framework(
        &display_name,
        &input.template,
        &input.ui_framework,
        input.components.as_ref(),
        &framework_info,
        &inlined_guides,
    );
    fs::write(project_path.join("CLAUDE.md"), claude_md_content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

    // Generate GLOSSARY.md with available library content
    let glossary_content = library::generate_project_glossary(&app_handle, &project_path);
    fs::write(project_path.join("GLOSSARY.md"), glossary_content)
        .map_err(|e| format!("Failed to write GLOSSARY.md: {}", e))?;

    // Generate .claude/commands/ with project-specific guides from library
    generate_project_guides(
        &app_handle,
        &project_path,
        framework_id,
        &input.template,
        &input.ui_framework,
        input.components.as_ref(),
    )?;

    // Update CMakeLists.txt FORMATS line to match selected build formats
    if let Some(ref formats) = input.build_formats {
        update_cmake_formats(&app_handle, &project_path, formats)?;
    }

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

        let metadata_path = path.join(".freqlab/metadata.json");
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
    let metadata_path = project_path.join(".freqlab/metadata.json");

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

    // Get the full path string before deletion (for Claude log cleanup)
    let project_path_str = project_path.to_string_lossy().to_string();

    // Delete the project source folder
    fs::remove_dir_all(&project_path)
        .map_err(|e| format!("Failed to delete project: {}", e))?;

    // Also clean up the output folder for this project (output/{name}/)
    let output_folder = get_output_path().join(&name);
    if output_folder.exists() {
        // Don't fail if output cleanup fails - project is already deleted
        let _ = fs::remove_dir_all(&output_folder);
    }

    // Clean up Claude Code's log folder for this project
    // Don't fail if this doesn't work - project is already deleted
    if let Err(e) = super::usage::delete_claude_logs(&project_path_str) {
        eprintln!("[WARN] Failed to delete Claude logs: {}", e);
    }

    Ok(())
}

#[tauri::command]
pub async fn update_project(
    app_handle: tauri::AppHandle,
    project_path: String,
    name: String,
    description: String,
    build_formats: Option<Vec<String>>,
) -> Result<ProjectMeta, String> {
    // Validate description length
    if description.len() > 280 {
        return Err("Description must be 280 characters or less".to_string());
    }

    let path = PathBuf::from(&project_path);
    let metadata_path = path.join(".freqlab/metadata.json");

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
    if let Some(ref formats) = build_formats {
        meta.build_formats = Some(formats.clone());
        // Update CMakeLists.txt FORMATS line to match new selection
        update_cmake_formats(&app_handle, &path, formats)?;
    }
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
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
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

/// Get the output format IDs supported by a framework, optionally filtered by UI framework.
/// Some UI frameworks don't support all output formats (e.g. iPlug2 native can't build standalone/AUv3).
#[tauri::command]
pub async fn get_framework_outputs(
    app_handle: tauri::AppHandle,
    framework_id: String,
    ui_framework: Option<String>,
) -> Result<Vec<String>, String> {
    use crate::library;

    let lib = library::loader::load_library(&app_handle);
    let framework = lib
        .frameworks
        .iter()
        .find(|f| f.id == framework_id)
        .ok_or_else(|| format!("Framework '{}' not found", framework_id))?;

    let mut formats: Vec<String> = framework.outputs.keys().cloned().collect();

    // Filter out formats unsupported by the specific UI framework
    if let Some(ref ui_fw_id) = ui_framework {
        if let Some(ui_fw) = framework.ui_frameworks.iter().find(|u| &u.id == ui_fw_id) {
            if !ui_fw.unsupported_formats.is_empty() {
                formats.retain(|f| !ui_fw.unsupported_formats.contains(f));
            }
        }
    }

    Ok(formats)
}

/// Rewrite the FORMATS line in a project's CMakeLists.txt to match the selected build formats.
/// Uses the framework's cmake_formats mapping to convert format IDs to CMake format names.
/// This is a no-op for cargo-based builds (nih-plug).
pub fn update_cmake_formats(
    app_handle: &tauri::AppHandle,
    project_path: &std::path::Path,
    build_formats: &[String],
) -> Result<(), String> {
    use crate::library;

    // Read framework ID from metadata
    let metadata_path = project_path.join(".freqlab/metadata.json");
    if !metadata_path.exists() {
        return Ok(()); // No metadata = nothing to do
    }
    let content = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let meta: ProjectMeta = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;
    let framework_id = meta.framework_id.as_deref().unwrap_or("nih-plug");

    // Load framework config to get cmake_formats mapping
    let lib = library::loader::load_library(app_handle);
    let framework = lib.frameworks.iter().find(|f| f.id == framework_id);
    let cmake_formats = match framework.and_then(|f| f.build.cmake_formats.as_ref()) {
        Some(map) => map,
        None => return Ok(()), // No cmake_formats = not a cmake build (e.g., nih-plug)
    };

    // Build the new FORMATS value from selected build formats
    // Use the cmake_formats map to convert format IDs to CMake names
    let cmake_names: Vec<&str> = build_formats
        .iter()
        .filter_map(|id| cmake_formats.get(id).map(|s| s.as_str()))
        .collect();

    if cmake_names.is_empty() {
        return Ok(()); // Nothing to write
    }

    let new_formats_value = cmake_names.join(" ");

    // Find and update CMakeLists.txt
    let cmake_path = project_path.join("CMakeLists.txt");
    if !cmake_path.exists() {
        return Ok(());
    }

    let cmake_content = fs::read_to_string(&cmake_path)
        .map_err(|e| format!("Failed to read CMakeLists.txt: {}", e))?;

    // Replace the FORMATS line using regex-like matching
    // Pattern: whitespace + "FORMATS" + space + format names (rest of line)
    let mut new_content = String::new();
    let mut found = false;
    for line in cmake_content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("FORMATS ") {
            // Preserve leading whitespace
            let indent = &line[..line.len() - line.trim_start().len()];
            new_content.push_str(&format!("{}FORMATS {}", indent, new_formats_value));
            found = true;
        } else {
            new_content.push_str(line);
        }
        new_content.push('\n');
    }

    if found {
        fs::write(&cmake_path, new_content)
            .map_err(|e| format!("Failed to write CMakeLists.txt: {}", e))?;

        // Delete cmake cache so the next build reconfigures with new format targets
        let cache_path = project_path.join("build/CMakeCache.txt");
        if cache_path.exists() {
            let _ = fs::remove_file(&cache_path);
        }
    }

    Ok(())
}

// NOTE: Template generation functions have been removed.
// Templates are now loaded from the library system at:
// resources/library/frameworks/{framework_id}/templates/{template_type}-{ui_framework}/
//
// See library/loader.rs get_template() for template loading logic.

// REMOVED FUNCTIONS (formerly here, now in library templates):
// - generate_effect_native_template
// - generate_instrument_native_template
// - generate_effect_webview_template
// - generate_effect_egui_template
// - generate_instrument_webview_template
// - generate_instrument_egui_template
// - generate_webview_ui_html
