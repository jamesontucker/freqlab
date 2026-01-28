import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DawPaths } from '../../types';

interface DawConfig {
  key: keyof DawPaths;
  name: string;
}

const daws: DawConfig[] = [
  { key: 'reaper', name: 'Reaper' },
  { key: 'ableton', name: 'Ableton Live' },
  { key: 'flStudio', name: 'FL Studio' },
  { key: 'logic', name: 'Logic Pro' },
  { key: 'other', name: 'Other' },
];

export function DawPathsSettings() {
  const { dawPaths, updateDawPath } = useSettingsStore();
  const [expandedDaws, setExpandedDaws] = useState<Set<keyof DawPaths>>(new Set());

  const toggleDaw = (key: keyof DawPaths) => {
    setExpandedDaws((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const hasPath = (key: keyof DawPaths) => {
    const p = dawPaths[key];
    return p.vst3.trim() !== '' || p.clap.trim() !== '' || p.au.trim() !== '' || p.standalone.trim() !== '' || p.auv3.trim() !== '' || p.aax.trim() !== '' || p.lv2.trim() !== '';
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">DAW Plugin Paths</h3>
        <p className="text-sm text-text-muted">
          Configure where plugins should be published for each DAW. These paths are used when you click &quot;Publish&quot;.
        </p>
      </div>

      <div className="space-y-2">
        {daws.map((daw) => {
          const isExpanded = expandedDaws.has(daw.key);
          const configured = hasPath(daw.key);

          return (
            <div key={daw.key} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleDaw(daw.key)}
                className="w-full flex items-center justify-between p-3 hover:bg-bg-tertiary transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                  </svg>
                  <span className="font-medium text-text-primary">{daw.name}</span>
                  {configured && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                      configured
                    </span>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="p-3 pt-0 border-t border-border bg-bg-secondary">
                  <div className="grid grid-cols-2 gap-3 pt-3">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        VST3 Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].vst3}
                        onChange={(e) => updateDawPath(daw.key, 'vst3', e.target.value)}
                        placeholder="~/Library/Audio/Plug-Ins/VST3"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        CLAP Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].clap}
                        onChange={(e) => updateDawPath(daw.key, 'clap', e.target.value)}
                        placeholder="~/Library/Audio/Plug-Ins/CLAP"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        AU Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].au}
                        onChange={(e) => updateDawPath(daw.key, 'au', e.target.value)}
                        placeholder="~/Library/Audio/Plug-Ins/Components"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        Standalone Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].standalone}
                        onChange={(e) => updateDawPath(daw.key, 'standalone', e.target.value)}
                        placeholder="/Applications"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        AUv3 Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].auv3}
                        onChange={(e) => updateDawPath(daw.key, 'auv3', e.target.value)}
                        placeholder="(no standard path)"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        AAX Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].aax}
                        onChange={(e) => updateDawPath(daw.key, 'aax', e.target.value)}
                        placeholder="/Library/Application Support/Avid/Audio/Plug-Ins"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        LV2 Path
                      </label>
                      <input
                        type="text"
                        value={dawPaths[daw.key].lv2}
                        onChange={(e) => updateDawPath(daw.key, 'lv2', e.target.value)}
                        placeholder="~/Library/Audio/Plug-Ins/LV2"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                      />
                    </div>

                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-bg-tertiary rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-text-muted">
            <p className="mb-1">
              <strong className="text-text-secondary">Tip:</strong> Most DAWs on macOS use the system plugin folders:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>VST3: ~/Library/Audio/Plug-Ins/VST3</li>
              <li>CLAP: ~/Library/Audio/Plug-Ins/CLAP</li>
              <li>AU: ~/Library/Audio/Plug-Ins/Components</li>
              <li>Standalone: /Applications</li>
              <li>AAX: /Library/Application Support/Avid/Audio/Plug-Ins</li>
              <li>LV2: ~/Library/Audio/Plug-Ins/LV2</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
