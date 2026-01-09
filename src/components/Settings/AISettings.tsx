import { useSettingsStore } from '../../stores/settingsStore';
import type { ChatStyle } from '../../types';

interface ChatStyleOption {
  id: ChatStyle;
  label: string;
  description: string;
}

const chatStyleOptions: ChatStyleOption[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Shows a compact thinking indicator while Claude works.',
  },
  {
    id: 'conversational',
    label: 'Conversational',
    description: 'Shows Claude\'s responses as they stream in, similar to a chat conversation.',
  },
];

export function AISettings() {
  const { aiSettings, setChatStyle } = useSettingsStore();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">Chat Settings</h3>
        <p className="text-sm text-text-muted">Configure how Claude interacts with you</p>
      </div>

      {/* Chat Style */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text-primary">
          Chat Style
        </label>
        <div className="space-y-2">
          {chatStyleOptions.map((option) => (
            <label
              key={option.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                aiSettings.chatStyle === option.id
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-text-muted'
              }`}
            >
              <input
                type="radio"
                name="chatStyle"
                value={option.id}
                checked={aiSettings.chatStyle === option.id}
                onChange={() => setChatStyle(option.id)}
                className="mt-1 accent-accent"
              />
              <div>
                <div className="font-medium text-text-primary">{option.label}</div>
                <div className="text-sm text-text-muted">{option.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
