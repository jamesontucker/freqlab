//! Library types for framework-agnostic plugin development

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The full library content
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Library {
    pub frameworks: Vec<Framework>,
    /// Guides - uses "skills" in JSON for frontend compatibility
    #[serde(rename = "skills")]
    pub guides: Vec<Guide>,
    /// Recipes - uses "algorithms" in JSON for frontend compatibility
    #[serde(rename = "algorithms")]
    pub recipes: Vec<Recipe>,
    pub references: Vec<Reference>,
    pub resources: Vec<Resource>,
}

/// License information for a framework
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub license_type: String,
    pub summary: String,
    pub details: String,
    pub url: String,
}

/// A framework configuration (nih-plug, JUCE, iPlug2, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Framework {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub language: String,
    pub version: String,
    pub website: String,
    pub documentation: String,
    #[serde(default)]
    pub license: Option<LicenseInfo>,
    pub prerequisites: Prerequisites,
    pub outputs: HashMap<String, OutputFormat>,
    pub build: BuildConfig,
    pub templates: TemplateMapping,
    pub ui_frameworks: Vec<UiFramework>,
    /// Guide configuration - uses "skills" in JSON for backwards compatibility
    #[serde(rename = "skills")]
    pub guides: GuidesConfig,
    pub components: Vec<ComponentConfig>,
    pub placeholders: HashMap<String, String>,
    /// Source: "core" for bundled, "custom" for user-added
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "core".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prerequisites {
    pub required: Vec<String>,
    #[serde(default)]
    pub optional: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputFormat {
    pub extension: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildConfig {
    /// Build system type: "cargo" or "cmake"
    #[serde(default = "default_build_system")]
    pub build_system: String,
    pub command: String,
    pub arguments: Vec<String>,
    /// For CMake: configure command (e.g., "cmake")
    #[serde(default)]
    pub configure_command: Option<String>,
    /// For CMake: configure arguments (e.g., ["-B", "build", "-S", "."])
    #[serde(default)]
    pub configure_arguments: Option<Vec<String>>,
    pub working_directory: String,
    pub output_directory: String,
    /// Glob patterns to find build artifacts (for CMake builds)
    #[serde(default)]
    pub artifact_patterns: Option<Vec<String>>,
}

fn default_build_system() -> String {
    "cargo".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateMapping {
    pub effect: HashMap<String, String>,
    pub instrument: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiFramework {
    pub id: String,
    pub name: String,
    pub description: String,
    pub dependencies: HashMap<String, serde_json::Value>,
}

/// Configuration for which guides are available for a framework
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuidesConfig {
    #[serde(default)]
    pub core: Vec<String>,
    #[serde(default)]
    pub effect: Vec<String>,
    #[serde(default)]
    pub instrument: Vec<String>,
    #[serde(default)]
    pub ui: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub shared: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Guide reference - uses "skill" in JSON for backwards compatibility
    #[serde(rename = "skill")]
    pub guide: String,
    #[serde(default)]
    pub template_type: Option<String>,
}

/// A guide - framework-specific implementation patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guide {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub framework: Option<String>,
    pub content: String,
    /// Source: "core" for bundled, "custom" for user-added
    #[serde(default = "default_source")]
    pub source: String,
    /// Path to the source file (relative)
    #[serde(default)]
    pub path: String,
    /// Tags for searching/filtering
    #[serde(default)]
    pub tags: Vec<String>,
    /// Internal guides are hidden from user UI but available to AI
    #[serde(default)]
    pub internal: bool,
}

/// A recipe - language-agnostic algorithm description (pseudocode)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub content: String,
    /// Source: "core" for bundled, "custom" for user-added
    #[serde(default = "default_source")]
    pub source: String,
    /// Path to the source file (relative)
    #[serde(default)]
    pub path: String,
    /// Tags for searching/filtering
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A reference (discovery resource like /dsp-catalog)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reference {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
}

/// A resource (external URL for browsing)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub url: String,
    pub content: String,
    /// Source: "core" for bundled, "custom" for user-added
    #[serde(default = "default_source")]
    pub source: String,
    /// Tags for searching/filtering
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A template file for project creation
#[derive(Debug, Clone)]
pub struct TemplateFile {
    pub filename: String,
    pub content: String,
}

/// A complete template for a project type
#[derive(Debug, Clone)]
pub struct Template {
    pub framework_id: String,
    pub template_type: String,  // "effect" or "instrument"
    pub ui_framework: String,   // "webview", "egui", "native"
    pub files: Vec<TemplateFile>,
}
