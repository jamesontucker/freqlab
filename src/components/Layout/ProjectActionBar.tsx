import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useProjectOutput } from '../../stores/outputStore';
import { useToastStore } from '../../stores/toastStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import type { ProjectMeta } from '../../types';

interface BuildStreamEvent {
  type: 'start' | 'output' | 'done' | 'error';
  line?: string;
  success?: boolean;
  output_path?: string;
  message?: string;
}

interface BuildResult {
  success: boolean;
  output_path?: string;
  error?: string;
}

interface ProjectActionBarProps {
  project: ProjectMeta;
  hasBuild: boolean;
  onBuildComplete: () => void;
  onPublishClick: () => void;
  onEditClick: () => void;
  onDeleteClick: () => void;
  onOpenFolder: () => void;
  onOpenInEditor: () => void;
}

// Helper to extract folder name from project path
function getFolderName(projectPath: string): string {
  return projectPath.split('/').pop() || '';
}

export function ProjectActionBar({
  project,
  hasBuild,
  onBuildComplete,
  onPublishClick,
  onEditClick,
  onDeleteClick,
  onOpenFolder,
  onOpenInEditor,
}: ProjectActionBarProps) {
  // === LOCAL STATE (isolated from parent) ===
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [lastBuildError, setLastBuildError] = useState<string | null>(null);
  const quickActionsRef = useRef<HTMLDivElement>(null);

  // === REACTIVE STATE (with selectors) ===
  const buildingPath = useProjectBusyStore((s) => s.buildingPath);
  const thisProjectClaudeBusy = useProjectBusyStore((s) =>
    s.claudeBusyPaths.has(project.path)
  );
  const pluginAvailable = usePreviewStore((s) => s.pluginAvailable);
  const webviewNeedsFreshBuild = usePreviewStore((s) => s.webviewNeedsFreshBuild);
  const autoBuildEnabled = useProjectStore((s) => s.autoBuildPaths.includes(project.path));
  const setAutoBuild = useProjectStore.getState().setAutoBuild;

  // === STABLE ACTION REFERENCES ===
  const addToast = useToastStore.getState().addToast;
  const queueMessage = useChatStore.getState().queueMessage;
  const setBuildingPath = useProjectBusyStore.getState().setBuildingPath;
  const clearBuildingIfMatch = useProjectBusyStore.getState().clearBuildingIfMatch;

  // Per-project output
  const { addLine, setActive, clear } = useProjectOutput(project.path);

  // === DERIVED STATE ===
  const isBuilding = buildingPath === project.path;
  const anyBuildInProgress = buildingPath !== null;
  const buildDisabled = thisProjectClaudeBusy || anyBuildInProgress;
  const publishDisabled = buildDisabled || !hasBuild;
  const needsWebviewRebuild = webviewNeedsFreshBuild && project.uiFramework === 'webview';
  const buildHighlighted = !pluginAvailable || needsWebviewRebuild;

  // Clear error when project changes
  useEffect(() => {
    setLastBuildError(null);
  }, [project.path]);

  // Close quick actions dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (quickActionsRef.current && !quickActionsRef.current.contains(event.target as Node)) {
        setShowQuickActions(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowQuickActions(false);
      }
    };

    if (showQuickActions) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [showQuickActions]);

  const handleBuild = useCallback(async () => {
    if (buildDisabled) return;

    setBuildingPath(project.path);
    setLastBuildError(null);
    clear();
    setActive(true);

    // Get current version for this project
    let version = 1;
    try {
      version = await invoke<number>('get_current_version', {
        projectPath: project.path,
      });
    } catch {
      // Default to v1 if we can't get version
    }

    addLine(`> Building ${project.name} (v${version})...`);
    addLine('');

    // Listen for build stream events
    const unlisten = await listen<BuildStreamEvent>('build-stream', (event) => {
      const data = event.payload;
      if (data.type === 'output' && data.line) {
        addLine(data.line);
      } else if (data.type === 'error' && data.message) {
        addLine(`[ERROR] ${data.message}`);
      }
    });

    try {
      const folderName = getFolderName(project.path);
      const result = await invoke<BuildResult>('build_project', {
        projectName: folderName,
        version,
      });

      if (result.success) {
        addLine('');
        addLine('Build successful!');
        setLastBuildError(null);
        onBuildComplete();
        addToast({
          type: 'success',
          message: 'Build successful!',
        });
      } else {
        const errorMsg = result.error || 'Unknown error';
        addLine('');
        addLine(`Build failed: ${errorMsg}`);
        setLastBuildError(errorMsg);
        addToast({
          type: 'error',
          message: 'Build failed. Check output for details.',
          action: {
            label: 'Fix It',
            onClick: () => {
              const errorLines = errorMsg.split('\n');
              const relevantError = errorLines.slice(-30).join('\n');
              queueMessage(`The build failed with this error:\n\n\`\`\`\n${relevantError}\n\`\`\`\n\nPlease fix this issue.`);
              setLastBuildError(null);
            },
          },
        });
      }
    } catch (err) {
      addLine(`[ERROR] ${err}`);
      addToast({
        type: 'error',
        message: `Build error: ${err}`,
      });
    } finally {
      unlisten();
      clearBuildingIfMatch(project.path);
      setActive(false);
      addLine('');
      addLine('[Done]');
    }
  }, [project, buildDisabled, addLine, clear, setActive, setBuildingPath, clearBuildingIfMatch, addToast, queueMessage, onBuildComplete]);

  const handleFixError = useCallback(() => {
    if (!lastBuildError) return;
    const errorLines = lastBuildError.split('\n');
    const relevantError = errorLines.slice(-30).join('\n');
    queueMessage(`The build failed with this error:\n\n\`\`\`\n${relevantError}\n\`\`\`\n\nPlease fix this issue.`);
    setLastBuildError(null);
  }, [lastBuildError, queueMessage]);

  const handleQuickAction = useCallback((action: () => void) => {
    setShowQuickActions(false);
    action();
  }, []);

  const handleToggleAutoBuild = useCallback(() => {
    setAutoBuild(project.path, !autoBuildEnabled);
  }, [project.path, autoBuildEnabled, setAutoBuild]);

  // Auto-build effect: trigger build when needed and auto-build is enabled
  const handleBuildRef = useRef(handleBuild);
  handleBuildRef.current = handleBuild;

  useEffect(() => {
    if (!autoBuildEnabled) return;
    if (buildDisabled) return;
    if (!buildHighlighted) return; // Only build when build is needed

    // Small delay to avoid triggering immediately on mount
    const timeoutId = setTimeout(() => {
      handleBuildRef.current();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [autoBuildEnabled, buildDisabled, buildHighlighted]);

  return (
    <div className="flex items-center gap-2">
      {/* Persistent Fix Error button */}
      {lastBuildError && !isBuilding && (
        <button
          onClick={handleFixError}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-error hover:bg-error/90 rounded-lg transition-colors animate-pulse-subtle"
          title="Send build error to be fixed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
          </svg>
          Fix Error
        </button>
      )}

      {/* Build button */}
      <button
        onClick={handleBuild}
        disabled={buildDisabled}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all duration-200 ${
          buildDisabled
            ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
            : buildHighlighted
              ? 'bg-accent hover:bg-accent-hover text-white border-accent'
              : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
        }`}
        title={buildDisabled ? (anyBuildInProgress ? 'Build in progress...' : 'Working on this project...') : 'Build plugin'}
      >
        {isBuilding ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Building...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
            Build
          </>
        )}
      </button>

      {/* Auto Build toggle */}
      <button
        onClick={handleToggleAutoBuild}
        disabled={anyBuildInProgress}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all duration-200 ${
          anyBuildInProgress
            ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
            : autoBuildEnabled
              ? 'bg-accent text-white border-accent'
              : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
        }`}
        title={autoBuildEnabled ? 'Auto-build enabled: builds automatically when changes are detected' : 'Enable auto-build to automatically build when changes are detected'}
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          autoBuildEnabled ? 'bg-white' : 'bg-zinc-500'
        }`} />
        Auto Build
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-border" />

      {/* Publish button */}
      <button
        onClick={onPublishClick}
        disabled={publishDisabled}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all duration-200 ${
          publishDisabled
            ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
            : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
        }`}
        title={
          !hasBuild
            ? 'Build the plugin first before publishing'
            : buildDisabled
              ? anyBuildInProgress
                ? 'Build in progress...'
                : 'Working on this project...'
              : 'Publish to DAW folders'
        }
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        Publish
      </button>

      {/* Quick Actions Dropdown */}
      <div className="relative" ref={quickActionsRef}>
        <button
          onClick={() => !anyBuildInProgress && setShowQuickActions(!showQuickActions)}
          disabled={anyBuildInProgress}
          className={`p-2 rounded-lg transition-all duration-200 ${
            anyBuildInProgress
              ? 'bg-bg-tertiary text-text-muted border border-border opacity-50 cursor-not-allowed'
              : showQuickActions
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border border-border hover:border-accent/30'
          }`}
          title={anyBuildInProgress ? 'Build in progress...' : 'More actions'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
          </svg>
        </button>
        {showQuickActions && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 py-1 animate-fade-in">
            <button
              onClick={() => handleQuickAction(onOpenFolder)}
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              Open Folder
            </button>
            <button
              onClick={() => handleQuickAction(onOpenInEditor)}
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
              Open in Editor
            </button>
            <button
              onClick={() => handleQuickAction(onEditClick)}
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Edit Project
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={() => handleQuickAction(onDeleteClick)}
              disabled={buildDisabled}
              className="w-full px-3 py-2 text-left text-sm text-error hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete Project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
