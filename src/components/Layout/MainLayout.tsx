import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OutputPanel } from './OutputPanel';
import { ProjectActionBar } from './ProjectActionBar';
import { NewProjectModal } from '../Projects';
import { PublishModal } from '../Publish';
import { ChatPanel } from '../Chat';
import { PreviewPanel } from '../Preview';
import { ToastContainer } from '../Common/Toast';
import { Modal } from '../Common/Modal';
import { useProjectStore } from '../../stores/projectStore';
import { useToastStore } from '../../stores/toastStore';
import { usePreviewStore } from '../../stores/previewStore';

interface AvailableFormats {
  vst3: boolean;
  clap: boolean;
}

// Helper to extract folder name from project path
// e.g., "/Users/x/VSTWorkshop/projects/my_plugin" -> "my_plugin"
function getFolderName(projectPath: string): string {
  return projectPath.split('/').pop() || '';
}

export function MainLayout() {
  // === LOCAL UI STATE ===
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasBuild, setHasBuild] = useState(false);
  // Edit project modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isEditSaving, setIsEditSaving] = useState(false);

  // === REACTIVE STATE (with selectors) ===
  const activeProject = useProjectStore((s) => s.activeProject);
  const projects = useProjectStore((s) => s.projects);
  const isPreviewOpen = usePreviewStore((s) => s.isOpen);

  // === STABLE ACTION REFERENCES ===
  const createProject = useProjectStore.getState().createProject;
  const deleteProject = useProjectStore.getState().deleteProject;
  const selectProject = useProjectStore.getState().selectProject;
  const updateProject = useProjectStore.getState().updateProject;
  const addToast = useToastStore.getState().addToast;

  // Check if a build exists for the current version
  // Called on project change and version change
  // Note: Does NOT reset pluginAvailable - that's handled separately when version actually changes
  const checkBuildExists = useCallback(async () => {
    if (!activeProject) {
      setHasBuild(false);
      return;
    }

    try {
      const version = await invoke<number>('get_current_version', {
        projectPath: activeProject.path,
      });
      // Use folder name (from path), not display name, for filesystem operations
      const folderName = getFolderName(activeProject.path);
      const formats = await invoke<AvailableFormats>('check_available_formats', {
        projectName: folderName,
        version,
      });
      setHasBuild(formats.vst3 || formats.clap);
    } catch {
      setHasBuild(false);
    }
  }, [activeProject]);

  // Check build status when project changes
  useEffect(() => {
    checkBuildExists();
  }, [checkBuildExists]);

  const handleCreateProject = async (input: Parameters<typeof createProject>[0]) => {
    await createProject(input);
  };

  // Open edit modal with current project values
  const handleOpenEditModal = useCallback(() => {
    if (activeProject) {
      setEditName(activeProject.name);
      setEditDescription(activeProject.description || '');
      setIsEditModalOpen(true);
    }
  }, [activeProject]);

  // Save edited project
  const handleSaveEdit = async () => {
    if (!activeProject || !editName.trim()) return;

    setIsEditSaving(true);
    try {
      await updateProject(activeProject.path, editName.trim(), editDescription.trim());
      setIsEditModalOpen(false);
      addToast({
        type: 'success',
        message: 'Project updated',
      });
    } catch (err) {
      addToast({
        type: 'error',
        message: `Failed to update: ${err}`,
      });
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleOpenFolder = useCallback(async () => {
    if (activeProject?.path) {
      await invoke('open_project_folder', { path: activeProject.path });
    }
  }, [activeProject?.path]);

  const handleOpenInEditor = useCallback(async () => {
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
  }, [activeProject?.path, addToast]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleDelete = async () => {
    if (!activeProject) return;
    try {
      // Use folder name (from path), not display name, for delete operation
      const folderName = getFolderName(activeProject.path);
      await deleteProject(folderName, activeProject.path);
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
                    <p className="text-sm text-text-muted mt-1 line-clamp-2 break-words">{activeProject.description || 'No description'}</p>
                  </div>
                  <ProjectActionBar
                    project={activeProject}
                    hasBuild={hasBuild}
                    onBuildComplete={checkBuildExists}
                    onPublishClick={() => setIsPublishModalOpen(true)}
                    onEditClick={handleOpenEditModal}
                    onDeleteClick={handleDeleteClick}
                    onOpenFolder={handleOpenFolder}
                    onOpenInEditor={handleOpenInEditor}
                  />
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

      {/* Edit Project Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Project"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="edit-name" className="block text-sm font-medium text-text-secondary mb-2">
              Name
            </label>
            <input
              type="text"
              id="edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value.slice(0, 50))}
              maxLength={50}
              className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-xs text-text-muted">
                Display name only (does not rename files)
              </p>
              <span className={`text-xs ${editName.length >= 45 ? 'text-warning' : 'text-text-muted'}`}>
                {editName.length}/50
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="edit-description" className="block text-sm font-medium text-text-secondary mb-1">
              Description
            </label>
            <p className="text-xs text-text-muted mb-2">
              Provides context for code suggestions
            </p>
            <textarea
              id="edit-description"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value.slice(0, 280))}
              rows={3}
              maxLength={280}
              className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none"
            />
            <div className="mt-1.5 flex justify-end">
              <span className={`text-xs ${editDescription.length >= 260 ? 'text-warning' : 'text-text-muted'}`}>
                {editDescription.length}/280
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsEditModalOpen(false)}
              disabled={isEditSaving}
              className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={isEditSaving || !editName.trim()}
              className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-xl transition-all duration-200 disabled:cursor-not-allowed"
            >
              {isEditSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

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
