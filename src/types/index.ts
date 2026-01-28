export type CheckStatus = 'installed' | 'notinstalled' | 'needsconfig';

export interface CheckResult {
  status: CheckStatus;
  version: string | null;
  message: string | null;
}

export interface PrerequisiteStatus {
  xcode_cli: CheckResult;
  rust: CheckResult;
  cmake: CheckResult;
  claude_cli: CheckResult;
  claude_auth: CheckResult;
}

export interface DiskSpaceBreakdown {
  xcode_gb: number;
  rust_gb: number;
  claude_cli_gb: number;
  total_required_gb: number;
}

export interface DiskSpaceInfo {
  available_gb: number;
  required_gb: number;
  sufficient: boolean;
  breakdown: DiskSpaceBreakdown;
}

export interface PermissionStatus {
  accessibility: boolean;
  admin_primed: boolean;
}

export interface DawPathConfig {
  vst3: string;
  clap: string;
  au: string;
  auv3: string;
  aax: string;
  lv2: string;
  standalone: string;
}

export interface DawPaths {
  reaper: DawPathConfig;
  ableton: DawPathConfig;
  flStudio: DawPathConfig;
  logic: DawPathConfig;
  other: DawPathConfig;
}

export interface CustomThemeColors {
  accent: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  chatUser: string;
}

export interface AudioSettings {
  outputDevice: string | null;  // null = system default
  sampleRate: number;
  bufferSize: number;
}

// Plugin performance metrics (only present when monitoring is enabled)
export interface PluginPerformance {
  process_time_ns: number;      // Time spent in plugin.process() in nanoseconds
  samples_processed: number;    // Number of samples in buffer
  sample_rate: number;          // Current sample rate
  buffer_duration_ns: number;   // Expected real-time budget in nanoseconds
  cpu_percent: number;          // Percentage of budget used (process_time / buffer_duration * 100)
  per_sample_ns: number;        // Cost per sample in nanoseconds
}

// Token usage from Claude Code session logs
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  context_percent: number;      // Percentage of 200K context window used
  message_count: number;
}

export type ChatStyle = 'minimal' | 'conversational';

export type ClaudeModel = 'haiku' | 'sonnet' | 'opus';

// Controls how verbose/detailed the agent is in responses
export type AgentVerbosity = 'thorough' | 'balanced' | 'direct';

export interface AISettings {
  chatStyle: ChatStyle;
  model: ClaudeModel;
  customInstructions: string;
  agentVerbosity: AgentVerbosity;
}

export interface AppConfig {
  workspacePath: string;
  outputPath: string;
  buildFormats: string[];
  autoOpenOutput: boolean;
  showNotifications: boolean;
  theme: 'dark' | 'light' | 'custom';
  customColors: CustomThemeColors;
  setupComplete: boolean;
  // Branding
  vendorName: string;
  vendorUrl: string;
  vendorEmail: string;
  // DAW plugin paths
  dawPaths: DawPaths;
  // AAX SDK path (empty = not configured)
  aaxSdkPath: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  frameworkId?: string;  // Framework ID (e.g., "nih-plug", "juce", "iplug2")
  template?: PluginTemplate;
  uiFramework?: UIFramework;
  components?: string[];  // Starter components selected
  buildFormats?: string[];  // Selected build formats (e.g., ["vst3", "clap"])
  created_at: string;
  updated_at: string;
  path: string;
}

export type PluginTemplate = 'effect' | 'instrument';

export type UIFramework = 'webview' | 'egui' | 'native' | 'igraphics' | 'juce';

// Starter components for Effect plugins (custom_gui removed - handled by uiFramework)
export type EffectComponent =
  | 'preset_system'
  | 'param_smoothing'
  | 'sidechain_input'
  | 'oversampling';

// Starter components for Instrument plugins (custom_gui removed - handled by uiFramework)
export type InstrumentComponent =
  | 'preset_system'
  | 'polyphony'
  | 'velocity_layers'
  | 'adsr_envelope'
  | 'lfo';

export interface CreateProjectInput {
  name: string;              // Folder-safe name (my_cool_plugin)
  displayName?: string;      // User-friendly name (My Cool Plugin)
  description: string;
  frameworkId?: string;      // Framework ID (e.g., "nih-plug", "juce")
  template: PluginTemplate;
  uiFramework: UIFramework;
  vendorName?: string;
  vendorUrl?: string;
  vendorEmail?: string;
  components?: string[];  // Selected component IDs
  buildFormats?: string[];  // Selected build formats (e.g., ["vst3", "clap"])
}

export interface FileAttachment {
  id: string;           // UUID for the upload
  originalName: string; // Original filename
  path: string;         // Absolute path in project
  mimeType: string;     // MIME type for display logic
  size: number;         // File size in bytes
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  filesModified?: string[];
  summary?: string;
  commitHash?: string;
  version?: number;  // Version number for commits (1, 2, 3...) - only set if files were changed
  reverted: boolean;
  attachments?: FileAttachment[];  // Files attached to this message
}

export interface ChatState {
  messages: ChatMessage[];
  activeVersion: number | null;
}

// ============================================================================
// Library Types
// ============================================================================

export interface Library {
  frameworks: LibraryFramework[];
  skills: LibrarySkill[];      // Backend still uses "skills" internally
  algorithms: LibraryAlgorithm[]; // Backend still uses "algorithms" internally
  references: LibraryReference[]; // Discovery resources like /dsp-catalog
  resources: LibraryResource[];
}

// Frontend display names:
// - skills → "Guides" (instructional content)
// - algorithms → "Recipes" (ready-to-use DSP code)
// - resources → "Resources" (external links, references)

export interface FrameworkLicense {
  name: string;
  type: string;  // "permissive", "copyleft", etc.
  summary: string;
  details: string;
  url: string;
}

export interface LibraryFramework {
  id: string;
  name: string;
  display_name: string;
  description: string;
  language: string;
  version: string;
  website: string;
  documentation: string;
  license?: FrameworkLicense;
  prerequisites: {
    required: string[];
    optional: string[];
  };
  outputs: Record<string, { extension: string; description: string }>;
  build: {
    build_system?: string; // "cargo" or "cmake"
    command: string;
    arguments: string[];
    configure_command?: string; // For CMake
    configure_arguments?: string[]; // For CMake
    working_directory: string;
    output_directory: string;
    artifact_patterns?: string[]; // Glob patterns for CMake artifacts
  };
  templates: {
    effect: Record<string, string>;
    instrument: Record<string, string>;
  };
  ui_frameworks: LibraryUIFramework[];
  skills: {
    core: string[];
    effect: string[];
    instrument: string[];
    ui: Record<string, string[]>;
    shared: string[];
  };
  components: LibraryComponent[];
  placeholders: Record<string, string>;
  source: 'core' | 'custom';
}

export interface LibraryUIFramework {
  id: string;
  name: string;
  description: string;
  dependencies: Record<string, unknown>;
  unsupported_formats?: string[];
}

export interface LibraryComponent {
  id: string;
  name: string;
  description: string;
  skill: string;
  template_type?: string;
}

export type SkillCategory = 'framework' | 'effect' | 'instrument' | 'component' | 'shared' | 'reference';

export interface LibrarySkill {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;  // Can be any category string from backend
  source?: 'core' | 'custom';
  path?: string;
  tags?: string[];
  framework?: string;  // Optional framework association
  internal?: boolean;  // Internal guides are hidden from user UI but available to AI
}

export interface LibraryAlgorithm {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  source?: 'core' | 'custom';
  path?: string;
  tags?: string[];
}

export interface LibraryResource {
  id: string;
  name: string;
  description: string;
  url: string;
  category: string;
  content?: string; // Optional content for search/preview
  tags?: string[];
  source?: 'core' | 'custom';
}

export interface LibraryReference {
  id: string;
  name: string;
  description: string;
  content: string;
}
