//! Library loader - loads content from bundled resources

use super::types::*;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::Manager;

/// Global cache for the loaded library
static LIBRARY_CACHE: Lazy<RwLock<Option<Library>>> = Lazy::new(|| RwLock::new(None));

/// Load the complete library from bundled resources (with caching)
pub fn load_library(app_handle: &tauri::AppHandle) -> Library {
    // Check cache first
    if let Ok(cache) = LIBRARY_CACHE.read() {
        if let Some(ref library) = *cache {
            log::debug!("Returning cached library ({} frameworks, {} guides)",
                library.frameworks.len(), library.guides.len());
            return library.clone();
        }
    }

    // Load from disk
    let library = load_library_from_disk(app_handle);

    // Cache the result
    if let Ok(mut cache) = LIBRARY_CACHE.write() {
        *cache = Some(library.clone());
        log::info!("Library cached ({} frameworks, {} guides, {} recipes, {} resources)",
            library.frameworks.len(), library.guides.len(),
            library.recipes.len(), library.resources.len());
    }

    library
}

/// Clear the library cache (useful for hot reload in dev)
#[allow(dead_code)]
pub fn clear_library_cache() {
    if let Ok(mut cache) = LIBRARY_CACHE.write() {
        *cache = None;
        log::debug!("Library cache cleared");
    }
}

/// Internal: Load the library from disk (no caching)
fn load_library_from_disk(app_handle: &tauri::AppHandle) -> Library {
    let resource_path = get_library_resource_path(app_handle);

    log::debug!("Loading library from: {:?}", resource_path);

    let mut library = Library::default();

    if !resource_path.exists() {
        log::warn!("Library resource path does not exist: {:?}", resource_path);
        return library;
    }

    // Load frameworks
    let frameworks_dir = resource_path.join("frameworks");
    log::debug!("Looking for frameworks in: {:?}", frameworks_dir);
    if frameworks_dir.exists() {
        if let Ok(entries) = fs::read_dir(&frameworks_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    log::debug!("Found framework dir: {:?}", entry.path());
                    match load_framework(&entry.path()) {
                        Some(fw) => {
                            log::debug!("Loaded framework: {}", fw.id);
                            library.frameworks.push(fw);
                        }
                        None => {
                            log::warn!("Failed to load framework from: {:?}", entry.path());
                        }
                    }
                }
            }
        }
    } else {
        log::warn!("Frameworks directory does not exist: {:?}", frameworks_dir);
    }

    // Load shared guides
    let guides_dir = resource_path.join("guides");
    if guides_dir.exists() {
        load_guides_from_dir(&guides_dir, None, &mut library.guides);
    }

    // Load framework-specific guides (still in "skills" subdirectory for backwards compatibility)
    for framework in &library.frameworks {
        let fw_guides_dir = frameworks_dir.join(&framework.id).join("skills");
        if fw_guides_dir.exists() {
            load_guides_from_dir(&fw_guides_dir, Some(&framework.id), &mut library.guides);
        }
    }

    // Load recipes (algorithms)
    let recipes_dir = resource_path.join("recipes");
    if recipes_dir.exists() {
        load_recipes_from_dir(&recipes_dir, &mut library.recipes);
    }

    // Load references
    let references_dir = resource_path.join("references");
    if references_dir.exists() {
        load_references_from_dir(&references_dir, &mut library.references);
    }

    // Load resources
    let resources_dir = resource_path.join("resources");
    if resources_dir.exists() {
        load_resources_from_dir(&resources_dir, &mut library.resources);
    }

    library
}

/// Get the path to the bundled library resources
pub fn get_library_resource_path(app_handle: &tauri::AppHandle) -> PathBuf {
    // Check if the bundled resource directory has actual content (frameworks subfolder)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let library_path = resource_dir.join("library");
        let frameworks_path = library_path.join("frameworks");
        if frameworks_path.exists() {
            log::debug!("Using bundled library path: {:?}", library_path);
            return library_path;
        }
    }

    // Dev mode fallback: try relative paths that contain actual content
    // During `tauri dev`, the current directory is typically the project root
    let dev_paths = [
        PathBuf::from("src-tauri/resources/library"),
        PathBuf::from("resources/library"),
    ];

    for path in &dev_paths {
        let frameworks_path = path.join("frameworks");
        if frameworks_path.exists() {
            log::debug!("Using dev library path: {:?}", path);
            return path.clone();
        }
    }

    log::warn!("Could not find library resources in any expected location");

    // Last resort: return the expected bundled path even if it doesn't exist
    app_handle
        .path()
        .resource_dir()
        .map(|p| p.join("library"))
        .unwrap_or_else(|_| PathBuf::from("resources/library"))
}

/// Load a framework from its directory
fn load_framework(framework_dir: &Path) -> Option<Framework> {
    let config_path = framework_dir.join("config.json");
    if !config_path.exists() {
        log::warn!("config.json not found at: {:?}", config_path);
        return None;
    }

    let content = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to read config.json at {:?}: {}", config_path, e);
            return None;
        }
    };

    match serde_json::from_str(&content) {
        Ok(fw) => Some(fw),
        Err(e) => {
            log::error!("Failed to parse config.json at {:?}: {}", config_path, e);
            None
        }
    }
}

/// Load guides from a directory (recursive)
fn load_guides_from_dir(dir: &Path, framework: Option<&str>, guides: &mut Vec<Guide>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories (e.g., components/)
                load_guides_from_dir(&path, framework, guides);
            } else if path.extension().map_or(false, |ext| ext == "md") {
                if let Some(guide) = load_guide_file(&path, framework) {
                    guides.push(guide);
                }
            }
        }
    }
}

/// Load a single guide from a markdown file
fn load_guide_file(path: &Path, framework: Option<&str>) -> Option<Guide> {
    let content = fs::read_to_string(path).ok()?;
    let (frontmatter, body) = parse_frontmatter(&content);

    let id = path.file_stem()?.to_str()?.to_string();
    let name = frontmatter.get("name").cloned().unwrap_or_else(|| id.clone());
    let description = frontmatter.get("description").cloned().unwrap_or_default();
    let category = path.parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("general")
        .to_string();

    // Parse tags from frontmatter (comma-separated)
    let tags = frontmatter
        .get("tags")
        .map(|t| t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    // Parse internal flag (defaults to false)
    let internal = frontmatter
        .get("internal")
        .map(|v| v.to_lowercase() == "true")
        .unwrap_or(false);

    let file_path = path.to_string_lossy().to_string();

    Some(Guide {
        id,
        name,
        description,
        category,
        framework: framework.map(String::from),
        content: body,
        source: "core".to_string(),
        path: file_path,
        tags,
        internal,
    })
}

/// Load recipes from a directory (recursive)
fn load_recipes_from_dir(dir: &Path, recipes: &mut Vec<Recipe>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                load_recipes_from_dir(&path, recipes);
            } else if path.extension().map_or(false, |ext| ext == "md") {
                if let Some(recipe) = load_recipe_file(&path) {
                    recipes.push(recipe);
                }
            }
        }
    }
}

/// Load a single recipe from a markdown file
fn load_recipe_file(path: &Path) -> Option<Recipe> {
    let content = fs::read_to_string(path).ok()?;
    let (frontmatter, body) = parse_frontmatter(&content);

    let id = path.file_stem()?.to_str()?.to_string();
    let name = frontmatter.get("name").cloned().unwrap_or_else(|| id.clone());
    let description = frontmatter.get("description").cloned().unwrap_or_default();
    let category = path.parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("general")
        .to_string();

    // Parse tags from frontmatter (comma-separated)
    let tags = frontmatter
        .get("tags")
        .map(|t| t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    let file_path = path.to_string_lossy().to_string();

    Some(Recipe {
        id,
        name,
        description,
        category,
        content: body,
        source: "core".to_string(),
        path: file_path,
        tags,
    })
}

/// Load references from a directory
fn load_references_from_dir(dir: &Path, references: &mut Vec<Reference>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Some(reference) = load_reference_file(&path) {
                    references.push(reference);
                }
            }
        }
    }
}

/// Load a single reference from a markdown file
fn load_reference_file(path: &Path) -> Option<Reference> {
    let content = fs::read_to_string(path).ok()?;
    let (frontmatter, body) = parse_frontmatter(&content);

    let id = path.file_stem()?.to_str()?.to_string();
    let name = frontmatter.get("name").cloned().unwrap_or_else(|| id.clone());
    let description = frontmatter.get("description").cloned().unwrap_or_default();

    Some(Reference {
        id,
        name,
        description,
        content: body,
    })
}

/// Load resources from a directory (recursive)
fn load_resources_from_dir(dir: &Path, resources: &mut Vec<Resource>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                load_resources_from_dir(&path, resources);
            } else if path.extension().map_or(false, |ext| ext == "md") {
                if let Some(resource) = load_resource_file(&path) {
                    resources.push(resource);
                }
            }
        }
    }
}

/// Load a single resource from a markdown file
fn load_resource_file(path: &Path) -> Option<Resource> {
    let content = fs::read_to_string(path).ok()?;
    let (frontmatter, body) = parse_frontmatter(&content);

    let id = path.file_stem()?.to_str()?.to_string();
    let name = frontmatter.get("name").cloned().unwrap_or_else(|| id.clone());
    let description = frontmatter.get("description").cloned().unwrap_or_default();
    let url = frontmatter.get("url").cloned().unwrap_or_default();
    let category = path.parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("general")
        .to_string();

    // Parse tags from frontmatter (comma-separated)
    let tags = frontmatter
        .get("tags")
        .map(|t| t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    Some(Resource {
        id,
        name,
        description,
        category,
        url,
        content: body,
        source: "core".to_string(),
        tags,
    })
}

/// Parse YAML frontmatter from markdown content
fn parse_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    let mut frontmatter = HashMap::new();

    if !content.starts_with("---") {
        return (frontmatter, content.to_string());
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return (frontmatter, content.to_string());
    }

    // Parse simple key: value frontmatter
    for line in parts[1].lines() {
        let line = line.trim();
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim().to_string();
            let value = line[colon_pos + 1..].trim().trim_matches('"').to_string();
            if !key.is_empty() {
                frontmatter.insert(key, value);
            }
        }
    }

    (frontmatter, parts[2].trim().to_string())
}

/// Get a template for a specific framework/type/ui combination
pub fn get_template(
    app_handle: &tauri::AppHandle,
    framework_id: &str,
    template_type: &str,
    ui_framework: &str,
) -> Option<Template> {
    let resource_path = get_library_resource_path(app_handle);
    let template_name = format!("{}-{}", template_type, ui_framework);
    let template_dir = resource_path
        .join("frameworks")
        .join(framework_id)
        .join("templates")
        .join(&template_name);

    if !template_dir.exists() {
        log::debug!("Template directory not found: {:?}", template_dir);
        return None;
    }

    let mut files = Vec::new();
    load_template_files_recursive(&template_dir, &template_dir, &mut files);

    if files.is_empty() {
        return None;
    }

    Some(Template {
        framework_id: framework_id.to_string(),
        template_type: template_type.to_string(),
        ui_framework: ui_framework.to_string(),
        files,
    })
}

/// Recursively load template files, preserving relative paths
fn load_template_files_recursive(base_dir: &Path, current_dir: &Path, files: &mut Vec<TemplateFile>) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories (e.g., resources/web/)
                load_template_files_recursive(base_dir, &path, files);
            } else if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                    // Skip hidden files
                    if filename.starts_with('.') {
                        continue;
                    }

                    // Get relative path from template root to preserve directory structure
                    let relative_path = path.strip_prefix(base_dir).ok();

                    // Strip .template suffix if present
                    let output_path = if let Some(rel) = relative_path {
                        let rel_str = rel.to_string_lossy();
                        rel_str.strip_suffix(".template")
                            .unwrap_or(&rel_str)
                            .to_string()
                    } else {
                        filename.strip_suffix(".template")
                            .unwrap_or(filename)
                            .to_string()
                    };

                    if let Ok(content) = fs::read_to_string(&path) {
                        files.push(TemplateFile {
                            filename: output_path,
                            content,
                        });
                    }
                }
            }
        }
    }
}

/// Apply placeholders to template content
pub fn apply_placeholders(content: &str, placeholders: &HashMap<String, String>) -> String {
    let mut result = content.to_string();
    for (key, value) in placeholders {
        // Support both {{key}} and {key} placeholder formats
        result = result.replace(&format!("{{{{{}}}}}", key), value);
        result = result.replace(&format!("{{{}}}", key), value);
    }
    result
}
