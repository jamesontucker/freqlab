import { useSettingsStore } from '../../stores/settingsStore';
import type { ClaudeModel, AgentVerbosity } from '../../types';

interface ModelOption {
  id: ClaudeModel;
  label: string;
  description: string;
}

interface VerbosityOption {
  id: AgentVerbosity;
  label: string;
  description: string;
}

const modelOptions: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', description: 'Fast intern' },
  { id: 'sonnet', label: 'Sonnet', description: 'Reliable engineer' },
  { id: 'opus', label: 'Opus (Recommended)', description: 'Senior audio engineer' },
];

const verbosityOptions: VerbosityOption[] = [
  { id: 'direct', label: 'Direct', description: 'Minimal questions, just implement' },
  { id: 'balanced', label: 'Balanced', description: 'A few key questions, then implement' },
  { id: 'thorough', label: 'Thorough', description: 'Detailed exploration before implementing' },
];

export function AISettings() {
  const { aiSettings, setChatStyle, setModel, setCustomInstructions, setAgentVerbosity } = useSettingsStore();

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">Chat Settings</h3>
        <p className="text-sm text-text-muted">Configure how Claude interacts with you</p>
      </div>

      {/* Chat Style - inline toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-text-primary">Chat Style</label>
          <p className="text-xs text-text-muted">How responses are displayed</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setChatStyle('conversational')}
            className={`px-3 py-1.5 text-sm transition-colors ${
              aiSettings.chatStyle === 'conversational'
                ? 'bg-accent text-white'
                : 'bg-bg-primary text-text-secondary hover:text-text-primary'
            }`}
          >
            Conversational
          </button>
          <button
            onClick={() => setChatStyle('minimal')}
            className={`px-3 py-1.5 text-sm transition-colors border-l border-border ${
              aiSettings.chatStyle === 'minimal'
                ? 'bg-accent text-white'
                : 'bg-bg-primary text-text-secondary hover:text-text-primary'
            }`}
          >
            Minimal
          </button>
        </div>
      </div>

      {/* Agent Verbosity - toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-text-primary">Response Style</label>
          <p className="text-xs text-text-muted">
            {verbosityOptions.find(v => v.id === aiSettings.agentVerbosity)?.description}
          </p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {verbosityOptions.map((option, index) => (
            <button
              key={option.id}
              onClick={() => setAgentVerbosity(option.id)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                index > 0 ? 'border-l border-border' : ''
              } ${
                aiSettings.agentVerbosity === option.id
                  ? 'bg-accent text-white'
                  : 'bg-bg-primary text-text-secondary hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model Selection - toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-text-primary">Model</label>
          <p className="text-xs text-text-muted">
            {modelOptions.find(m => m.id === aiSettings.model)?.description}
          </p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {modelOptions.map((option, index) => (
            <button
              key={option.id}
              onClick={() => setModel(option.id)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                index > 0 ? 'border-l border-border' : ''
              } ${
                aiSettings.model === option.id
                  ? 'bg-accent text-white'
                  : 'bg-bg-primary text-text-secondary hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Instructions - textarea */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text-primary">
          Custom Instructions
        </label>
        <textarea
          value={aiSettings.customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="e.g., Keep code concise. Always add safety limiters..."
          className="w-full h-24 px-3 py-2 rounded-lg border border-border bg-bg-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none text-sm"
        />
      </div>
    </div>
  );
}
