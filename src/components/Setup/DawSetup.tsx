import { useState, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DawPaths } from '../../types';

interface DawSetupProps {
  onComplete: () => void;
  onBack: () => void;
}

interface DawOption {
  key: keyof DawPaths;
  name: string;
  icon: React.ReactNode;
}

type DawKey = keyof DawPaths;

const dawOptions: DawOption[] = [
  {
    key: 'ableton',
    name: 'Ableton Live',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <rect x="4" y="4" width="4" height="16" rx="1" />
        <rect x="10" y="8" width="4" height="12" rx="1" />
        <rect x="16" y="4" width="4" height="16" rx="1" />
      </svg>
    ),
  },
  {
    key: 'logic',
    name: 'Logic Pro',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'reaper',
    name: 'Reaper',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4L4 8v8l8 4 8-4V8l-8-4zm0 2.5L17 9l-5 2.5L7 9l5-2.5zM6 10.5l5 2.5v5l-5-2.5v-5zm12 0v5l-5 2.5v-5l5-2.5z" />
      </svg>
    ),
  },
  {
    key: 'flStudio',
    name: 'FL Studio',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H8l5-6v4h3l-5 6z" />
      </svg>
    ),
  },
  {
    key: 'other',
    name: 'Other DAW',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
      </svg>
    ),
  },
];

export function DawSetup({ onComplete, onBack }: DawSetupProps) {
  const { dawPaths, updateDawPath } = useSettingsStore();
  const [selectedDaws, setSelectedDaws] = useState<Set<DawKey>>(new Set());
  const [useDefaults, setUseDefaults] = useState(true);

  const defaultVst3 = '~/Library/Audio/Plug-Ins/VST3';
  const defaultClap = '~/Library/Audio/Plug-Ins/CLAP';

  const toggleDaw = useCallback((dawKey: DawKey) => {
    setSelectedDaws(prev => {
      const next = new Set(prev);
      if (next.has(dawKey)) {
        next.delete(dawKey);
      } else {
        next.add(dawKey);
        // Pre-fill with defaults if empty
        if (!dawPaths[dawKey].vst3.trim()) {
          updateDawPath(dawKey, 'vst3', defaultVst3);
        }
        if (!dawPaths[dawKey].clap.trim()) {
          updateDawPath(dawKey, 'clap', defaultClap);
        }
      }
      return next;
    });
  }, [dawPaths, updateDawPath]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="text-center">
        <div className="w-10 h-10 mx-auto rounded-lg bg-accent-subtle flex items-center justify-center mb-2">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Publish to Your DAW</h2>
        <p className="text-xs text-text-secondary mt-0.5">Set up where your plugins will go</p>
      </div>

      {/* Workflow explanation */}
      <div className="p-3 rounded-lg bg-bg-tertiary/50 border border-border-subtle">
        <div className="flex gap-3 items-start">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
            <span className="text-xs font-bold text-accent">?</span>
          </div>
          <div className="text-xs text-text-muted">
            <p className="text-text-secondary font-medium mb-1">How publishing works</p>
            <p>
              After building your plugin, test it using freqlab&apos;s built-in preview.
              When you&apos;re happy with it, click <span className="text-accent font-medium">Publish</span> to
              copy it to your DAW&apos;s plugin folder. Your DAW will find it on the next scan.
            </p>
          </div>
        </div>
      </div>

      {/* DAW Selection */}
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          Select your DAWs
        </label>
        <p className="text-[11px] text-text-muted mb-2">
          Select all DAWs you use — we&apos;ll configure plugin paths for each
        </p>
        <div className="grid grid-cols-2 gap-2">
          {dawOptions.map((daw) => {
            const isSelected = selectedDaws.has(daw.key);
            return (
              <button
                key={daw.key}
                onClick={() => toggleDaw(daw.key)}
                className={`p-2.5 rounded-lg border transition-all duration-200 flex items-center gap-2 ${
                  isSelected
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border bg-bg-tertiary/50 text-text-secondary hover:border-accent/30 hover:text-text-primary'
                }`}
              >
                {/* Checkbox indicator */}
                <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-accent border-accent'
                    : 'border-border-strong bg-bg-tertiary'
                }`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className={isSelected ? 'text-accent' : 'text-text-muted'}>
                  {daw.icon}
                </div>
                <span className="text-sm font-medium">{daw.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Path Configuration (shown when DAWs selected) */}
      {selectedDaws.size > 0 && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useDefaults"
              checked={useDefaults}
              onChange={(e) => {
                setUseDefaults(e.target.checked);
                if (e.target.checked) {
                  // Apply defaults to all selected DAWs
                  selectedDaws.forEach(dawKey => {
                    updateDawPath(dawKey, 'vst3', defaultVst3);
                    updateDawPath(dawKey, 'clap', defaultClap);
                  });
                }
              }}
              className="w-4 h-4 rounded border-border bg-bg-tertiary text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
            />
            <label htmlFor="useDefaults" className="text-xs text-text-secondary">
              Use standard macOS plugin folders (recommended)
            </label>
          </div>

          {useDefaults && (
            <div className="pl-6 text-[11px] text-text-muted space-y-0.5">
              <p>VST3: <span className="text-text-secondary font-mono">{defaultVst3}</span></p>
              <p>CLAP: <span className="text-text-secondary font-mono">{defaultClap}</span></p>
            </div>
          )}

          {!useDefaults && (
            <div className="space-y-3 pl-5">
              {Array.from(selectedDaws).map(dawKey => {
                const dawName = dawOptions.find(d => d.key === dawKey)?.name || dawKey;
                return (
                  <div key={dawKey} className="space-y-2">
                    <p className="text-xs font-medium text-text-secondary">{dawName}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-text-muted mb-1">VST3 Path</label>
                        <input
                          type="text"
                          value={dawPaths[dawKey].vst3}
                          onChange={(e) => updateDawPath(dawKey, 'vst3', e.target.value)}
                          placeholder={defaultVst3}
                          className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-text-muted mb-1">CLAP Path</label>
                        <input
                          type="text"
                          value={dawPaths[dawKey].clap}
                          onChange={(e) => updateDawPath(dawKey, 'clap', e.target.value)}
                          placeholder={defaultClap}
                          className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent font-mono"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tip */}
      <div className="flex items-start gap-2 text-[11px] text-text-muted">
        <svg className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          You can configure paths for multiple DAWs later in{' '}
          <span className="text-text-secondary">Settings → DAW Paths</span>
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-2 px-3 text-sm bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-lg border border-border transition-all duration-200"
        >
          Back
        </button>
        <button
          onClick={onComplete}
          className="flex-1 py-2 px-3 text-sm bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
        >
          {selectedDaws.size > 0 ? 'Continue' : 'Skip for now'}
        </button>
      </div>
    </div>
  );
}
