import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OutputPanel } from './OutputPanel';
import { NewProjectModal } from '../Projects';
import { PublishModal } from '../Publish';
import { ChatPanel } from '../Chat';
import { PreviewPanel } from '../Preview';
import { ToastContainer } from '../Common/Toast';
import { Modal } from '../Common/Modal';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectOutput } from '../../stores/outputStore';
import { useToastStore } from '../../stores/toastStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import { usePreviewStore } from '../../stores/previewStore';

interface AvailableFormats {
  vst3: boolean;
  clap: boolean;
}

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

export function MainLayout() {
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasBuild, setHasBuild] = useState(false);
  // Store last build error so user can fix it even after dismissing toast
  const [lastBuildError, setLastBuildError] = useState<string | null>(null);
  const { activeProject, createProject, projects, deleteProject, selectProject } = useProjectStore();
  const { addToast } = useToastStore();
  const { queueMessage } = useChatStore();
  const { buildingPath, setBuildingPath, clearBuildingIfMatch, isClaudeBusy } = useProjectBusyStore();
  const { isOpen: isPreviewOpen } = usePreviewStore();

  // Per-project output - use activeProject's path
  const { addLine, setActive, clear } = useProjectOutput(activeProject?.path ?? null);

  // Check if current project is building
  const isBuilding = activeProject ? buildingPath === activeProject.path : false;
  // Check if THIS project has Claude working (project-specific)
  const thisProjectClaudeBusy = activeProject ? isClaudeBusy(activeProject.path) : false;
  // Check if ANY build is happening (global - can't have two builds at once)
  const anyBuildInProgress = buildingPath !== null;
  // Build disabled if: this project has Claude working OR any build in progress
  const buildDisabled = thisProjectClaudeBusy || anyBuildInProgress;
  // Publish disabled if: build disabled OR no build exists for current version
  const publishDisabled = buildDisabled || !hasBuild;

  // Check if a build exists for the current version
  const checkBuildExists = useCallback(async () => {
    if (!activeProject) {
      setHasBuild(false);
      return;
    }

    try {
      const version = await invoke<number>('get_current_version', {
        projectPath: activeProject.path,
      });
      const formats = await invoke<AvailableFormats>('check_available_formats', {
        projectName: activeProject.name,
        version,
      });
      setHasBuild(formats.vst3 || formats.clap);
    } catch {
      setHasBuild(false);
    }
  }, [activeProject]);

  // Check build status when project changes and clear any stale error
  useEffect(() => {
    checkBuildExists();
    setLastBuildError(null); // Clear error when switching projects
  }, [checkBuildExists]);

  const handleCreateProject = async (input: Parameters<typeof createProject>[0]) => {
    await createProject(input);
  };

  const handleOpenFolder = async () => {
    if (activeProject?.path) {
      await invoke('open_project_folder', { path: activeProject.path });
    }
  };

  const handleOpenInEditor = async () => {
    if (activeProject?.path) {
      try {
        await invoke('open_in_editor', { path: activeProject.path });
      } catch (err) {
        addToast({
          type: 'error',
          message: `${err}`,
        });
      }
    }
  };

  const handleDelete = async () => {
    if (!activeProject) return;
    try {
      await deleteProject(activeProject.name);
      selectProject(null);
      addToast({
        type: 'success',
        message: `Deleted "${activeProject.name}"`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        message: `Failed to delete: ${err}`,
      });
    }
    setShowDeleteConfirm(false);
  };

  const handleBuild = async () => {
    if (!activeProject || buildDisabled) return;

    setBuildingPath(activeProject.path);
    setLastBuildError(null); // Clear any previous error
    clear();
    setActive(true);

    // Get current version for this project
    let version = 1;
    try {
      version = await invoke<number>('get_current_version', {
        projectPath: activeProject.path,
      });
    } catch {
      // Default to v1 if we can't get version
    }

    addLine(`> Building ${activeProject.name} (v${version})...`);
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
      const result = await invoke<BuildResult>('build_project', {
        projectName: activeProject.name,
        version,
      });

      if (result.success) {
        addLine('');
        addLine('Build successful!');
        setLastBuildError(null); // Clear error on success
        // Re-check build availability so Publish button enables
        checkBuildExists();
        addToast({
          type: 'success',
          message: 'Build successful!',
        });
      } else {
        const errorMsg = result.error || 'Unknown error';
        addLine('');
        addLine(`Build failed: ${errorMsg}`);
        // Store error so user can fix it later even if they dismiss the toast
        setLastBuildError(errorMsg);
        addToast({
          type: 'error',
          message: 'Build failed. Check output for details.',
          action: {
            label: 'Fix It',
            onClick: () => {
              // Extract just the key error info (last ~20 lines usually have the actual error)
              const errorLines = errorMsg.split('\n');
              const relevantError = errorLines.slice(-30).join('\n');
              queueMessage(`The build failed with this error:\n\n\`\`\`\n${relevantError}\n\`\`\`\n\nPlease fix this issue.`);
              setLastBuildError(null); // Clear after sending to fix
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
      // Only clear if we're still the active build (prevents race conditions)
      if (activeProject) {
        clearBuildingIfMatch(activeProject.path);
      }
      setActive(false);
      addLine('');
      addLine('[Done]');
    }
  };

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar onNewPlugin={() => setIsNewProjectModalOpen(true)} />
        <main className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${isPreviewOpen ? 'mr-[480px]' : ''}`}>
          <div className="flex-1 overflow-auto p-6">
            {activeProject ? (
              <div className="h-full flex flex-col">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-text-primary">{activeProject.name}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        activeProject.template === 'instrument'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {activeProject.template === 'instrument' ? 'Instrument' : 'Effect'}
                      </span>
                    </div>
                    <p className="text-sm text-text-muted mt-1">{activeProject.description || 'No description'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Persistent Fix Error button - shows when there's an unresolved build error */}
                    {lastBuildError && !isBuilding && (
                      <button
                        onClick={() => {
                          const errorLines = lastBuildError.split('\n');
                          const relevantError = errorLines.slice(-30).join('\n');
                          queueMessage(`The build failed with this error:\n\n\`\`\`\n${relevantError}\n\`\`\`\n\nPlease fix this issue.`);
                          setLastBuildError(null);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-error hover:bg-error/90 rounded-lg transition-colors animate-pulse-subtle"
                        title="Send build error to be fixed"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                        </svg>
                        Fix Error
                      </button>
                    )}
                    <button
                      onClick={handleBuild}
                      disabled={buildDisabled}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
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
                    <button
                      onClick={() => setIsPublishModalOpen(true)}
                      disabled={publishDisabled}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary bg-bg-tertiary hover:bg-bg-elevated disabled:opacity-50 disabled:cursor-not-allowed rounded-lg border border-border transition-colors"
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
                    <button
                      onClick={handleOpenFolder}
                      className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated border border-transparent hover:border-border transition-colors"
                      title="Open project folder"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                    </button>
                    <button
                      onClick={handleOpenInEditor}
                      className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated border border-transparent hover:border-border transition-colors"
                      title="Open in VS Code"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={buildDisabled}
                      className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error disabled:opacity-50 disabled:cursor-not-allowed border border-transparent hover:border-error/20 transition-colors"
                      title="Delete project"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  {/* Key by project path to force full remount when switching projects */}
                  <ChatPanel
                    key={activeProject.path}
                    project={activeProject}
                    onVersionChange={checkBuildExists}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-subtle flex items-center justify-center mb-6">
                    <svg className="w-10 h-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                    </svg>
                  </div>
                  {projects.length === 0 ? (
                    <>
                      <h2 className="text-2xl font-semibold text-text-primary mb-2">Welcome to freqlab</h2>
                      <p className="text-text-secondary mb-4 max-w-md">
                        Create VST/CLAP plugins by describing what you want in natural language.
                      </p>
                      <div className="text-text-muted text-sm mb-6 space-y-1">
                        <p>No coding experience required.</p>
                        <p>Just describe your plugin idea and build!</p>
                      </div>
                      <button
                        onClick={() => setIsNewProjectModalOpen(true)}
                        className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
                      >
                        Create Your First Plugin
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl font-semibold text-text-primary mb-2">Select a Plugin</h2>
                      <p className="text-text-secondary mb-6 max-w-md">
                        Choose a plugin from the sidebar to continue working on it, or create a new one.
                      </p>
                      <button
                        onClick={() => setIsNewProjectModalOpen(true)}
                        className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
                      >
                        New Plugin
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <OutputPanel />
        </main>
      </div>

      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onSubmit={handleCreateProject}
      />

      {activeProject && (
        <PublishModal
          isOpen={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
          project={activeProject}
          onSuccess={() => {
            addToast({
              type: 'success',
              message: 'Plugin published to DAW folders!',
            });
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Plugin"
      >
        <div className="space-y-4">
          <p className="text-text-secondary">
            Are you sure you want to delete <span className="font-semibold text-text-primary">{activeProject?.name}</span>?
            This will permanently remove all project files and built plugins.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 py-2.5 px-4 bg-error hover:bg-error/90 text-white font-medium rounded-xl transition-all duration-200"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>

      <PreviewPanel />
      <ToastContainer />
    </div>
  );
}
