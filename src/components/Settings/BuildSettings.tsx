import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../stores/settingsStore';

interface FormatOption {
  id: string;
  label: string;
  description: string;
  locked?: boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { id: 'vst3', label: 'VST3', description: 'Compatible with all major DAWs', locked: true },
  { id: 'clap', label: 'CLAP', description: 'Required for audio preview', locked: true },
  { id: 'au', label: 'Audio Unit', description: 'macOS — Logic Pro, GarageBand, etc.' },
  { id: 'standalone', label: 'Standalone', description: 'Runs without a DAW' },
  { id: 'auv3', label: 'AUv3', description: 'macOS/iOS App Extension' },
  { id: 'aax', label: 'AAX', description: 'Pro Tools (requires Avid SDK)' },
  { id: 'lv2', label: 'LV2', description: 'Open standard — Ardour, Mixbus, etc.' },
];

interface AaxSdkStatus {
  valid: boolean;
  message: string;
}

interface CacheInfo {
  size_bytes: number;
  size_display: string;
  exists: boolean;
}

export function BuildSettings() {
  const { buildFormats, setBuildFormats, aaxSdkPath, setAaxSdkPath } = useSettingsStore();
  const [sdkStatus, setSdkStatus] = useState<AaxSdkStatus | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [buildCacheInfo, setBuildCacheInfo] = useState<CacheInfo | null>(null);
  const [isClearingBuild, setIsClearingBuild] = useState(false);

  const aaxEnabled = buildFormats.includes('aax');

  // Fetch cache info on mount
  useEffect(() => {
    invoke<CacheInfo>('get_build_cache_info').then(setCacheInfo).catch(() => {});
    invoke<CacheInfo>('get_project_build_cache_info').then(setBuildCacheInfo).catch(() => {});
  }, []);

  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      await invoke('clear_build_cache');
      const info = await invoke<CacheInfo>('get_build_cache_info');
      setCacheInfo(info);
    } catch {
      // ignore
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearBuildCache = async () => {
    setIsClearingBuild(true);
    try {
      await invoke('clear_project_build_cache');
      const info = await invoke<CacheInfo>('get_project_build_cache_info');
      setBuildCacheInfo(info);
    } catch {
      // ignore
    } finally {
      setIsClearingBuild(false);
    }
  };

  // Validate AAX SDK path when it changes
  useEffect(() => {
    if (!aaxSdkPath) {
      setSdkStatus(null);
      return;
    }

    setIsValidating(true);
    invoke<AaxSdkStatus>('validate_aax_sdk_path', { path: aaxSdkPath })
      .then(setSdkStatus)
      .catch(() => setSdkStatus({ valid: false, message: 'Validation failed' }))
      .finally(() => setIsValidating(false));
  }, [aaxSdkPath]);

  const toggleFormat = (id: string) => {
    if (id === 'clap' || id === 'vst3') return; // VST3 and CLAP are always required
    let next = buildFormats.includes(id)
      ? buildFormats.filter((f) => f !== id)
      : [...buildFormats, id];
    // Ensure VST3 and CLAP are always present
    if (!next.includes('clap')) next = ['clap', ...next];
    if (!next.includes('vst3')) next = ['vst3', ...next];
    setBuildFormats(next);
  };

  const handleBrowseAaxSdk = async () => {
    const selected = await open({
      directory: true,
      title: 'Select AAX SDK folder',
    });
    if (selected) {
      setAaxSdkPath(selected);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">Build Formats</h3>
        <p className="text-sm text-text-muted">
          Default formats for new projects. Change formats for existing projects in their project settings.
        </p>
      </div>

      <div className="space-y-2">
        {FORMAT_OPTIONS.map((option) => {
          const isChecked = option.locked || buildFormats.includes(option.id);
          return (
            <label
              key={option.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                isChecked
                  ? 'border-accent/30 bg-accent/5'
                  : 'border-border hover:border-border-strong bg-bg-secondary'
              } ${option.locked ? 'cursor-not-allowed opacity-80' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={option.locked}
                onChange={() => toggleFormat(option.id)}
                className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent disabled:opacity-60"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{option.label}</span>
                  {option.locked && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                      required
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5">{option.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      {/* AAX SDK Path (visible when AAX is enabled) */}
      {aaxEnabled && (
        <div className="p-4 rounded-lg border border-border bg-bg-secondary space-y-3">
          <div>
            <h4 className="text-sm font-medium text-text-primary">AAX SDK Path</h4>
            <p className="text-xs text-text-muted mt-0.5">
              Download the AAX SDK from developer.avid.com, then point to the extracted folder.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <input
                type="text"
                readOnly
                value={aaxSdkPath || ''}
                placeholder="Not configured"
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none"
              />
            </div>
            <button
              onClick={handleBrowseAaxSdk}
              className="px-3 py-2 bg-bg-tertiary hover:bg-bg-elevated text-text-primary text-sm font-medium rounded-lg border border-border transition-colors"
            >
              Browse
            </button>
            {aaxSdkPath && (
              <button
                onClick={() => setAaxSdkPath('')}
                className="px-3 py-2 bg-bg-tertiary hover:bg-bg-elevated text-text-muted hover:text-text-primary text-sm rounded-lg border border-border transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Validation status */}
          {aaxSdkPath && !isValidating && sdkStatus && (
            <div className={`flex items-center gap-2 text-xs ${sdkStatus.valid ? 'text-success' : 'text-warning'}`}>
              {sdkStatus.valid ? (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              )}
              <span>{sdkStatus.message}</span>
            </div>
          )}
          {isValidating && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Validating...</span>
            </div>
          )}
        </div>
      )}

      <div className="bg-bg-tertiary rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-text-muted">
            <p>
              <strong className="text-text-secondary">Note:</strong> Not all frameworks support every format. Only supported formats will be available per project.
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-xs mt-2">
              <li>NIH-plug: VST3, CLAP</li>
              <li>JUCE: VST3, CLAP, AU, Standalone, AUv3, AAX, LV2</li>
              <li>iPlug2: VST3, CLAP, AU, Standalone, AUv3, AAX</li>
            </ul>
          </div>
        </div>
      </div>

      {/* SDK Cache */}
      <div className="p-4 rounded-lg border border-border bg-bg-secondary space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-text-primary">SDK Cache</h4>
            <p className="text-xs text-text-muted mt-0.5">
              JUCE, iPlug2, and other SDKs are cached and shared across all projects.
            </p>
          </div>
          {cacheInfo && (
            <span className="text-xs text-text-muted whitespace-nowrap ml-4">
              {cacheInfo.exists ? cacheInfo.size_display : 'Empty'}
            </span>
          )}
        </div>
        <button
          onClick={handleClearCache}
          disabled={isClearing || !cacheInfo?.exists}
          className="px-3 py-2 bg-bg-tertiary hover:bg-bg-elevated disabled:bg-bg-tertiary disabled:text-text-muted text-text-primary text-sm rounded-lg border border-border transition-colors disabled:cursor-not-allowed"
        >
          {isClearing ? 'Clearing...' : 'Clear Cache'}
        </button>
      </div>

      {/* Project Build Files */}
      <div className="p-4 rounded-lg border border-border bg-bg-secondary space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-text-primary">Project Build Files</h4>
            <p className="text-xs text-text-muted mt-0.5">
              Intermediate CMake build files stored per-project. Safe to clear — rebuilt automatically on next build.
            </p>
          </div>
          {buildCacheInfo && (
            <span className="text-xs text-text-muted whitespace-nowrap ml-4">
              {buildCacheInfo.exists ? buildCacheInfo.size_display : 'Empty'}
            </span>
          )}
        </div>
        <button
          onClick={handleClearBuildCache}
          disabled={isClearingBuild || !buildCacheInfo?.exists}
          className="px-3 py-2 bg-bg-tertiary hover:bg-bg-elevated disabled:bg-bg-tertiary disabled:text-text-muted text-text-primary text-sm rounded-lg border border-border transition-colors disabled:cursor-not-allowed"
        >
          {isClearingBuild ? 'Clearing...' : 'Clear Build Files'}
        </button>
      </div>
    </div>
  );
}
