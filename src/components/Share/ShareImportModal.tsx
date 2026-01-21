import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { Modal } from '../Common/Modal';
import { useProjectStore } from '../../stores/projectStore';
import type { ProjectMeta } from '../../types';

interface ShareImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (project: ProjectMeta) => void;
}

type Tab = 'export' | 'import';

interface ConflictInfo {
  zipPath: string;
  conflictingName: string;
}

// Helper to extract folder name from project path
// e.g., "/Users/x/VSTWorkshop/projects/my_plugin" -> "my_plugin"
function getFolderName(projectPath: string): string {
  return projectPath.split(/[\\/]/).pop() || '';
}

export function ShareImportModal({ isOpen, onClose, onImportSuccess }: ShareImportModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('export');
  // Store selected project path (not display name) for reliable filesystem operations
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { projects, loadProjects } = useProjectStore();

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedProjectPath(null);
      setError(null);
      setSuccess(null);
      setConflict(null);
      loadProjects();
    }
  }, [isOpen, loadProjects]);

  const handleExport = async () => {
    if (!selectedProjectPath) return;

    setExporting(true);
    setError(null);
    setSuccess(null);

    // Get the folder name for filesystem operations
    const folderName = getFolderName(selectedProjectPath);

    try {
      // Open save dialog
      const destination = await save({
        title: 'Export Plugin Project',
        defaultPath: `${folderName}.freqlab.zip`,
        filters: [{ name: 'Freqlab Project', extensions: ['zip'] }],
      });

      if (!destination) {
        setExporting(false);
        return;
      }

      const result = await invoke<string>('export_project', {
        projectName: folderName,
        destination,
      });

      setSuccess(`Exported to ${result}`);
    } catch (err) {
      setError(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  const handleSelectImportFile = async () => {
    setError(null);
    setSuccess(null);
    setConflict(null);

    try {
      const selected = await open({
        title: 'Import Plugin Project',
        filters: [{ name: 'Freqlab Project', extensions: ['zip'] }],
        multiple: false,
      });

      if (!selected) return;

      const zipPath = selected as string;

      // Check for conflicts
      setImporting(true);
      const conflictingName = await invoke<string | null>('check_import_conflict', {
        zipPath,
      });

      if (conflictingName) {
        setConflict({ zipPath, conflictingName });
        setImporting(false);
      } else {
        // No conflict, import directly
        await doImport(zipPath, null);
      }
    } catch (err) {
      setError(`Import failed: ${err}`);
      setImporting(false);
    }
  };

  const doImport = async (zipPath: string, renameTo: string | null) => {
    setImporting(true);
    setError(null);

    try {
      const project = await invoke<ProjectMeta>('import_project', {
        zipPath,
        renameTo,
      });

      setSuccess(`Imported "${project.name}" successfully!`);
      setConflict(null);
      onImportSuccess(project);
      loadProjects();
    } catch (err) {
      setError(`Import failed: ${err}`);
    } finally {
      setImporting(false);
    }
  };

  const handleReplaceExisting = async () => {
    if (!conflict) return;
    await doImport(conflict.zipPath, null);
  };

  const handleImportRenamed = async () => {
    if (!conflict) return;
    // Truncate name if needed to fit within 50 char limit (max 41 + 9 for "-imported")
    const baseName = conflict.conflictingName.slice(0, 41);
    const newName = `${baseName}-imported`;
    await doImport(conflict.zipPath, newName);
  };

  const handleCancelConflict = () => {
    setConflict(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share & Import" size="lg">
      {/* Subtitle */}
      <p className="text-sm text-text-muted mb-4 -mt-2">
        Share full projects including source code, chat history, and attachments so others can continue building from where you left off.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-bg-tertiary rounded-lg">
        <button
          onClick={() => setActiveTab('export')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'export'
              ? 'bg-bg-primary text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Export
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'import'
              ? 'bg-bg-primary text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Import
        </button>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Export Tab */}
      {activeTab === 'export' && (
        <div>
          <p className="text-text-secondary text-sm mb-4">
            Export a project as a <span className="text-text-primary font-medium">.freqlab.zip</span> file that includes all source code, chat history, and attachments.
          </p>

          {projects.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              No projects to export
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {projects.map((project) => (
                <label
                  key={project.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedProjectPath === project.path
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-border-hover hover:bg-bg-tertiary'
                  }`}
                >
                  <input
                    type="radio"
                    name="project"
                    value={project.path}
                    checked={selectedProjectPath === project.path}
                    onChange={() => setSelectedProjectPath(project.path)}
                    className="w-4 h-4 text-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary truncate">
                        {project.name}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        project.template === 'instrument'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {project.template === 'instrument' ? 'Instrument' : 'Effect'}
                      </span>
                    </div>
                    {project.description && (
                      <p className="text-sm text-text-muted truncate mt-0.5">
                        {project.description}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={!selectedProjectPath || exporting}
            className="w-full py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {exporting ? 'Exporting...' : 'Export Selected Project'}
          </button>
        </div>
      )}

      {/* Import Tab */}
      {activeTab === 'import' && !conflict && (
        <div>
          <p className="text-text-secondary text-sm mb-4">
            Import a shared project and continue building from where the previous creator left off.
          </p>

          <button
            onClick={handleSelectImportFile}
            disabled={importing}
            className="w-full py-8 border-2 border-dashed border-border hover:border-accent rounded-lg text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? (
              <span>Importing...</span>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="font-medium">Select .zip file to import</span>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Conflict Resolution */}
      {activeTab === 'import' && conflict && (
        <div>
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-4">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="font-medium text-yellow-400 mb-1">
                  Project Already Exists
                </h4>
                <p className="text-sm text-text-secondary">
                  A project named "<span className="text-text-primary font-medium">{conflict.conflictingName}</span>" already exists.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 bg-error/10 border border-error/20 rounded-lg mb-4">
            <p className="text-sm text-error">
              <strong>Warning:</strong> Replacing will permanently delete the existing project and all its chat history. This cannot be undone.
            </p>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleReplaceExisting}
              disabled={importing}
              className="w-full py-2.5 px-4 bg-error hover:bg-error/90 disabled:opacity-50 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {importing ? 'Importing...' : 'Replace Existing Project'}
            </button>
            <button
              onClick={handleImportRenamed}
              disabled={importing}
              className="w-full py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {importing ? 'Importing...' : `Import as "${conflict.conflictingName.slice(0, 41)}-imported"`}
            </button>
            <button
              onClick={handleCancelConflict}
              disabled={importing}
              className="w-full py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
