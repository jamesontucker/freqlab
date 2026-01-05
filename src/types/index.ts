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

export interface AppConfig {
  workspacePath: string;
  outputPath: string;
  buildFormats: string[];
  autoOpenOutput: boolean;
  showNotifications: boolean;
  theme: 'dark' | 'light';
  setupComplete: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  tags: string[];
  buildFormats: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  filesModified?: string[];
  summary?: string;
}
