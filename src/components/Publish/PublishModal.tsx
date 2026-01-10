import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Modal } from '../Common/Modal';
import { Spinner } from '../Common/Spinner';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ProjectMeta, DawPaths } from '../../types';

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectMeta;
  onSuccess?: () => void;
}

interface AvailableFormats {
  vst3: boolean;
  clap: boolean;
}

interface DawPublishTarget {
  daw: string;
  vst3_path: string;
  clap_path: string;
}

interface CopiedFile {
  format: string;
  daw: string;
  path: string;
}

interface PublishResult {
  success: boolean;
  copied: CopiedFile[];
  errors: string[];
}

interface PackageResult {
  success: boolean;
  zip_path: string;
  included: string[];
}

const DAW_LABELS: Record<keyof DawPaths, string> = {
  reaper: 'REAPER',
  ableton: 'Ableton Live',
  flStudio: 'FL Studio',
  logic: 'Logic Pro',
  other: 'Custom Location',
};

// Helper to extract folder name from project path
// e.g., "/Users/x/VSTWorkshop/projects/my_plugin" -> "my_plugin"
function getFolderName(projectPath: string): string {
  return projectPath.split('/').pop() || '';
}

export function PublishModal({ isOpen, onClose, project, onSuccess }: PublishModalProps) {
  const { dawPaths } = useSettingsStore();
  const [selectedDaws, setSelectedDaws] = useState<Set<keyof DawPaths>>(new Set());
  const [formats, setFormats] = useState<AvailableFormats | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPackaging, setIsPackaging] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [packageResult, setPackageResult] = useState<PackageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number>(1);

  // Check available formats when modal opens
  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setPackageResult(null);
      setError(null);
      setFormats(null);

      // First get the current version, then check available formats
      // Map version 0 (fresh project) to 1 for display and filesystem operations
      invoke<number>('get_current_version', { projectPath: project.path })
        .then((version) => {
          const displayVersion = Math.max(version, 1);
          setCurrentVersion(displayVersion);
          // Use folder name from path, not display name, for filesystem operations
          const folderName = getFolderName(project.path);
          return invoke<AvailableFormats>('check_available_formats', {
            projectName: folderName,
            version,
          });
        })
        .then(setFormats)
        .catch((err) => setError(String(err)));
    }
  }, [isOpen, project.name, project.path]);

  // Get DAWs that have at least one path configured
  const configuredDaws = Object.entries(dawPaths).filter(
    ([, paths]) => paths.vst3.trim() !== '' || paths.clap.trim() !== ''
  ) as [keyof DawPaths, { vst3: string; clap: string }][];

  // Check if "other" (Custom Location) is configured
  const isOtherConfigured = dawPaths.other.vst3.trim() !== '' || dawPaths.other.clap.trim() !== '';

  const handleToggleDaw = (daw: keyof DawPaths) => {
    setSelectedDaws((prev) => {
      const next = new Set(prev);
      if (next.has(daw)) {
        next.delete(daw);
      } else {
        next.add(daw);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedDaws(new Set(configuredDaws.map(([daw]) => daw)));
  };

  const handleSelectNone = () => {
    setSelectedDaws(new Set());
  };

  const handlePublish = async () => {
    if (selectedDaws.size === 0) return;

    setIsPublishing(true);
    setError(null);
    setResult(null);

    try {
      const targets: DawPublishTarget[] = Array.from(selectedDaws).map((daw) => ({
        daw: DAW_LABELS[daw],
        vst3_path: dawPaths[daw].vst3,
        clap_path: dawPaths[daw].clap,
      }));

      // Use folder name from path, not display name
      const folderName = getFolderName(project.path);
      const publishResult = await invoke<PublishResult>('publish_to_daw', {
        projectName: folderName,
        version: currentVersion,
        targets,
      });

      setResult(publishResult);
      if (publishResult.success) {
        onSuccess?.();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePackage = async () => {
    setIsPackaging(true);
    setError(null);
    setPackageResult(null);

    try {
      const destination = await save({
        defaultPath: `${project.name}_v${currentVersion}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });

      if (!destination) {
        setIsPackaging(false);
        return; // User cancelled
      }

      // Use folder name from path, not display name
      const packageFolderName = getFolderName(project.path);
      const result = await invoke<PackageResult>('package_plugins', {
        projectName: packageFolderName,
        version: currentVersion,
        destination,
      });

      setPackageResult(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsPackaging(false);
    }
  };

  const handleClose = () => {
    setSelectedDaws(new Set());
    setResult(null);
    setPackageResult(null);
    setError(null);
    onClose();
  };

  const noFormatsAvailable = formats && !formats.vst3 && !formats.clap;
  const noDawsConfigured = configuredDaws.length === 0;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Publish to DAW">
      <div className="space-y-5">
        {/* Version indicator */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Publishing version:</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-medium">
            v{currentVersion}
          </span>
        </div>

        {/* Available formats */}
        <div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">Available Formats</h4>
          {!formats ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Spinner size="sm" />
              Checking...
            </div>
          ) : noFormatsAvailable ? (
            <p className="text-sm text-warning">
              No built plugins found. Build the project first.
            </p>
          ) : (
            <div className="flex gap-3">
              {formats.vst3 && (
                <span className="px-3 py-1 rounded-lg bg-accent/20 text-accent text-sm font-medium">
                  VST3
                </span>
              )}
              {formats.clap && (
                <span className="px-3 py-1 rounded-lg bg-accent/20 text-accent text-sm font-medium">
                  CLAP
                </span>
              )}
            </div>
          )}
        </div>

        {/* DAW selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-text-secondary">Select DAWs</h4>
            {configuredDaws.length > 1 && (
              <div className="flex gap-2 text-xs">
                <button
                  onClick={handleSelectAll}
                  className="text-accent hover:text-accent-hover"
                >
                  Select All
                </button>
                <span className="text-text-muted">/</span>
                <button
                  onClick={handleSelectNone}
                  className="text-accent hover:text-accent-hover"
                >
                  None
                </button>
              </div>
            )}
          </div>

          {noDawsConfigured && !isOtherConfigured ? (
            <p className="text-sm text-text-muted">
              No DAW paths configured. Set up paths in Settings &rarr; DAW Paths.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {configuredDaws.filter(([daw]) => daw !== 'other').map(([daw]) => (
                  <label
                    key={daw}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      selectedDaws.has(daw)
                        ? 'bg-accent/10 border-accent/30 text-text-primary'
                        : 'bg-bg-tertiary border-border hover:border-accent/30 text-text-secondary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDaws.has(daw)}
                      onChange={() => handleToggleDaw(daw)}
                      className="rounded border-border text-accent focus:ring-accent"
                    />
                    <span className="text-sm font-medium">{DAW_LABELS[daw]}</span>
                  </label>
                ))}
                {/* Always show Custom Location option */}
                {isOtherConfigured ? (
                  <label
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      selectedDaws.has('other')
                        ? 'bg-accent/10 border-accent/30 text-text-primary'
                        : 'bg-bg-tertiary border-border hover:border-accent/30 text-text-secondary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDaws.has('other')}
                      onChange={() => handleToggleDaw('other')}
                      className="rounded border-border text-accent focus:ring-accent"
                    />
                    <span className="text-sm font-medium">{DAW_LABELS.other}</span>
                  </label>
                ) : (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-text-muted cursor-not-allowed"
                    title="Configure in Settings → DAW Paths"
                  >
                    <span className="text-sm">{DAW_LABELS.other}</span>
                    <span className="text-xs">(not configured)</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-text-muted mt-2">
                Configure paths in Settings &rarr; DAW Paths
              </p>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-error-subtle border border-error/20 text-error text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`p-3 rounded-lg border text-sm ${
              result.success
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-warning/10 border-warning/30 text-warning'
            }`}
          >
            {result.success ? (
              <>
                <p className="font-medium mb-1">Published successfully!</p>
                <ul className="text-xs space-y-0.5">
                  {result.copied.map((file, i) => (
                    <li key={i}>
                      {file.format} &rarr; {file.daw}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="font-medium mb-1">Publish completed with errors:</p>
                <ul className="text-xs space-y-0.5">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Package Result */}
        {packageResult && (
          <div className="p-3 rounded-lg border text-sm bg-success/10 border-success/30 text-success">
            <p className="font-medium mb-1">Package created!</p>
            <ul className="text-xs space-y-0.5">
              {packageResult.included.map((file, i) => (
                <li key={i}>{file}</li>
              ))}
            </ul>
            <p className="text-xs text-text-muted mt-2 break-all">{packageResult.zip_path}</p>
          </div>
        )}

        {/* Gatekeeper Info */}
        <div className="p-3 rounded-lg bg-bg-tertiary border border-border">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <div className="text-xs">
              <p className="text-text-primary font-medium">macOS Gatekeeper</p>
              <p className="text-text-secondary mt-0.5">
                Quarantine attributes are automatically cleared when publishing, so plugins should load without Gatekeeper issues.
              </p>
              <p className="text-text-muted mt-1">
                If you still have issues, run in Terminal:
              </p>
              <code className="block mt-1 px-2 py-1 bg-bg-primary rounded text-[11px] text-text-primary font-mono">
                xattr -cr ~/Library/Audio/Plug-Ins/VST3/ ~/Library/Audio/Plug-Ins/CLAP/
              </code>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200"
          >
            {result || packageResult ? 'Close' : 'Cancel'}
          </button>
          {!result && !packageResult && (
            <>
              <button
                type="button"
                onClick={handlePackage}
                disabled={isPublishing || isPackaging || noFormatsAvailable || !formats}
                className="py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated disabled:bg-bg-tertiary disabled:text-text-muted text-text-primary font-medium rounded-xl border border-border transition-all duration-200 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                title="Package plugins into a zip file"
              >
                {isPackaging && <Spinner size="sm" />}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
                Package
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing || isPackaging || noFormatsAvailable || !formats || selectedDaws.size === 0}
                className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-xl transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {isPublishing && <Spinner size="sm" />}
                Publish
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
