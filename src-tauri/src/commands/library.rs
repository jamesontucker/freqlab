//! Library commands for accessing guides, recipes, references, and resources

use crate::library;
use crate::library::types::Framework;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Response for ensure_library_item_in_project
#[derive(Serialize)]
pub struct EnsuredLibraryItem {
    pub id: String,
    pub name: String,
    pub was_copied: bool,
}

/// Get the full library content
#[tauri::command]
pub async fn get_library(app_handle: tauri::AppHandle) -> library::Library {
    library::load_library(&app_handle)
}

/// Get just the frameworks list (for project creation modal)
#[tauri::command]
pub async fn get_frameworks(app_handle: tauri::AppHandle) -> Vec<Framework> {
    let library = library::load_library(&app_handle);
    library.frameworks
}

/// Ensure a library item (guide/recipe) is available in the project's .claude/commands/ directory
/// This enables Claude to read the content via slash command (e.g., /guide-name)
#[tauri::command]
pub async fn ensure_library_item_in_project(
    app_handle: tauri::AppHandle,
    project_path: String,
    item_type: String,
    item_id: String,
) -> Result<EnsuredLibraryItem, String> {
    let library = library::load_library(&app_handle);
    let project_path = Path::new(&project_path);

    // Find the item in the library
    let (name, content) = match item_type.as_str() {
        "skill" => {
            let guide = library
                .guides
                .iter()
                .find(|g| g.id == item_id)
                .ok_or_else(|| format!("Guide '{}' not found in library", item_id))?;
            (guide.name.clone(), guide.content.clone())
        }
        "algorithm" => {
            let recipe = library
                .recipes
                .iter()
                .find(|r| r.id == item_id)
                .ok_or_else(|| format!("Recipe '{}' not found in library", item_id))?;
            (recipe.name.clone(), recipe.content.clone())
        }
        _ => return Err(format!("Unknown item type: {}", item_type)),
    };

    // Ensure .claude/commands/ directory exists
    let commands_dir = project_path.join(".claude").join("commands");
    fs::create_dir_all(&commands_dir)
        .map_err(|e| format!("Failed to create commands directory: {}", e))?;

    // Check if file already exists
    let file_path = commands_dir.join(format!("{}.md", item_id));
    let was_copied = if file_path.exists() {
        // Already exists, no need to copy
        false
    } else {
        // Write the content
        fs::write(&file_path, &content)
            .map_err(|e| format!("Failed to write library item: {}", e))?;
        true
    };

    Ok(EnsuredLibraryItem {
        id: item_id,
        name,
        was_copied,
    })
}

/// Refresh the GLOSSARY.md file for a project
#[tauri::command]
pub async fn refresh_project_glossary(
    app_handle: tauri::AppHandle,
    project_path: String,
) -> Result<(), String> {
    let project_path = Path::new(&project_path);

    // Generate glossary content
    let glossary_content = library::generate_project_glossary(&app_handle, project_path);

    // Ensure .claude/ directory exists
    let claude_dir = project_path.join(".claude");
    fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Failed to create .claude directory: {}", e))?;

    // Write GLOSSARY.md
    let glossary_path = claude_dir.join("GLOSSARY.md");
    fs::write(&glossary_path, glossary_content)
        .map_err(|e| format!("Failed to write GLOSSARY.md: {}", e))?;

    log::debug!("Refreshed glossary for project at {:?}", project_path);
    Ok(())
}
