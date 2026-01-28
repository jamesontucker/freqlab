//! Library module for framework-agnostic plugin development
//!
//! Provides access to:
//! - Frameworks (nih-plug, JUCE, iPlug2, etc.)
//! - Guides (framework-specific implementation patterns)
//! - Recipes (language-agnostic algorithm descriptions)
//! - References (discovery resources like /dsp-catalog)
//! - Resources (external URLs)

pub mod loader;
pub mod types;

pub use loader::{apply_placeholders, get_template, load_library};
pub use types::*;

use std::fs;
use std::path::Path;

/// Generate GLOSSARY.md content for a project
/// Lists available guides, recipes, references, and resources
pub fn generate_project_glossary(app_handle: &tauri::AppHandle, project_path: &Path) -> String {
    let library = loader::load_library(app_handle);

    // Try to read project metadata for context
    let meta_path = project_path.join(".freqlab/metadata.json");
    let project_context = if meta_path.exists() {
        match fs::read_to_string(&meta_path) {
            Ok(meta_content) => {
                match serde_json::from_str::<serde_json::Value>(&meta_content) {
                    Ok(meta) => {
                        let template = meta.get("template")
                            .and_then(|v| v.as_str())
                            .unwrap_or("effect");
                        let ui_framework = meta.get("uiFramework")
                            .and_then(|v| v.as_str())
                            .unwrap_or("native");

                        // Find the framework for this project by ID
                        let framework_id = meta.get("frameworkId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("nih-plug");

                        // Look up the framework by ID, falling back to first or defaults
                        let framework = library.frameworks.iter()
                            .find(|f| f.id == framework_id)
                            .or_else(|| library.frameworks.first());

                        let (framework_name, language) = framework
                            .map(|f| (f.display_name.as_str(), f.language.as_str()))
                            .unwrap_or(("nih-plug (Rust)", "rust"));

                        Some(format!(
                            "This is a **{framework_name}** ({language}) **{template}** project with **{ui_framework}** UI.",
                            framework_name = framework_name,
                            language = language,
                            template = template,
                            ui_framework = ui_framework,
                        ))
                    }
                    Err(e) => {
                        eprintln!("[WARN] Failed to parse project metadata at {:?}: {}", meta_path, e);
                        None
                    }
                }
            }
            Err(e) => {
                eprintln!("[WARN] Failed to read project metadata at {:?}: {}", meta_path, e);
                None
            }
        }
    } else {
        eprintln!("[DEBUG] No project metadata found at {:?}, glossary will use generic context", meta_path);
        None
    };

    let mut content = String::new();

    // Header with project context
    content.push_str("# Library Glossary\n\n");
    content.push_str("> Quick reference for available guides, recipes, references, and resources.\n");
    content.push_str("> Use `/command-name` in chat to load detailed content.\n\n");

    if let Some(ctx) = project_context {
        content.push_str(&format!("**Project Context:** {}\n\n", ctx));
    }

    // Discovery Resources section (references like /dsp-catalog)
    if !library.references.is_empty() {
        content.push_str("## Discovery Resources\n\n");
        content.push_str("| Command | Description |\n");
        content.push_str("|---------|-------------|\n");
        for reference in &library.references {
            content.push_str(&format!(
                "| `/{id}` | {description} |\n",
                id = reference.id,
                description = if reference.description.is_empty() {
                    &reference.name
                } else {
                    &reference.description
                }
            ));
        }
        content.push('\n');
    }

    // Guides section
    if !library.guides.is_empty() {
        content.push_str("## Guides (Implementation Patterns)\n\n");

        // Group by category
        let mut by_category: std::collections::HashMap<&str, Vec<&types::Guide>> = std::collections::HashMap::new();
        for guide in &library.guides {
            by_category.entry(&guide.category).or_default().push(guide);
        }

        for (category, guides) in &by_category {
            content.push_str(&format!("### {}\n\n", capitalize(category)));
            content.push_str("| Guide | Description |\n");
            content.push_str("|-------|-------------|\n");
            for guide in guides {
                content.push_str(&format!(
                    "| `/{id}` | {description} |\n",
                    id = guide.id,
                    description = if guide.description.is_empty() {
                        &guide.name
                    } else {
                        &guide.description
                    }
                ));
            }
            content.push('\n');
        }
    }

    // Recipes section
    if !library.recipes.is_empty() {
        content.push_str("## Recipes (Algorithm Descriptions)\n\n");

        // Group by category
        let mut by_category: std::collections::HashMap<&str, Vec<&types::Recipe>> = std::collections::HashMap::new();
        for recipe in &library.recipes {
            by_category.entry(&recipe.category).or_default().push(recipe);
        }

        for (category, recipes) in &by_category {
            content.push_str(&format!("### {}\n\n", capitalize(category)));
            content.push_str("| Recipe | Description |\n");
            content.push_str("|--------|-------------|\n");
            for recipe in recipes {
                content.push_str(&format!(
                    "| `/{id}` | {description} |\n",
                    id = recipe.id,
                    description = if recipe.description.is_empty() {
                        &recipe.name
                    } else {
                        &recipe.description
                    }
                ));
            }
            content.push('\n');
        }
    }

    // Resources section
    if !library.resources.is_empty() {
        content.push_str("## Resources (External References)\n\n");

        // Group by category
        let mut by_category: std::collections::HashMap<&str, Vec<&types::Resource>> = std::collections::HashMap::new();
        for resource in &library.resources {
            by_category.entry(&resource.category).or_default().push(resource);
        }

        for (category, resources) in &by_category {
            content.push_str(&format!("### {}\n\n", capitalize(category)));
            content.push_str("| Resource | Description | Link |\n");
            content.push_str("|----------|-------------|------|\n");
            for resource in resources {
                let link = if resource.url.is_empty() {
                    "-".to_string()
                } else {
                    format!("[Link]({})", resource.url)
                };
                content.push_str(&format!(
                    "| {name} | {description} | {link} |\n",
                    name = resource.name,
                    description = if resource.description.is_empty() {
                        "-"
                    } else {
                        &resource.description
                    },
                    link = link
                ));
            }
            content.push('\n');
        }
    }

    content
}

/// Capitalize first letter of a string
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().chain(chars).collect(),
    }
}
