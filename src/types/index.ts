export type CheckStatus = 'installed' | 'notinstalled' | 'needsconfig';

export interface CheckResult {
  status: CheckStatus;
  version: string | null;
  message: string | null;
}

export interface PrerequisiteStatus {
  xcode_cli: CheckResult;
  rust: CheckResult;
  claude_cli: CheckResult;
  claude_auth: CheckResult;
}

export interface DawPathConfig {
  vst3: string;
  clap: string;
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
}

export interface AudioSettings {
  outputDevice: string | null;  // null = system default
  sampleRate: number;
  bufferSize: number;
}

export type ChatStyle = 'minimal' | 'conversational';

export interface AISettings {
  chatStyle: ChatStyle;
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
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  template?: PluginTemplate;
  uiFramework?: UIFramework;
  components?: string[];  // Starter components selected
  created_at: string;
  updated_at: string;
  path: string;
}

export type PluginTemplate = 'effect' | 'instrument';

export type UIFramework = 'webview' | 'egui' | 'headless';

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
  name: string;
  description: string;
  template: PluginTemplate;
  uiFramework: UIFramework;
  vendorName?: string;
  vendorUrl?: string;
  vendorEmail?: string;
  components?: string[];  // Selected component IDs
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
