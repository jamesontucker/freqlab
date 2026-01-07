import { useState } from 'react';
import type { ProjectMeta } from '../../types';
import { Modal } from '../Common/Modal';
import { Spinner } from '../Common/Spinner';

interface ProjectCardProps {
  project: ProjectMeta;
  isActive: boolean;
  isBusy: boolean;
  busyType: 'claude' | 'build' | null;
  collapsed?: boolean;
  onClick: () => void;
  onDelete: () => Promise<void>;
}

export function ProjectCard({ project, isActive, isBusy, busyType, collapsed = false, onClick, onDelete }: ProjectCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const timeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error('Failed to delete project:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Collapsed view - icon only
  if (collapsed) {
    return (
      <div
        onClick={onClick}
        className={`w-12 h-12 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center ${
          isActive
            ? 'bg-accent-subtle border border-accent/30'
            : 'hover:bg-bg-tertiary border border-transparent'
        }`}
        title={project.name}
      >
        {isBusy ? (
          <Spinner size="sm" className={isActive ? 'text-accent' : 'text-text-muted'} />
        ) : project.template === 'instrument' ? (
          <svg className={`w-5 h-5 ${isActive ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 4v10M10 4v10M14 4v10M18 4v10" />
            <rect x="5" y="4" width="2" height="6" fill="currentColor" />
            <rect x="9" y="4" width="2" height="6" fill="currentColor" />
            <rect x="13" y="4" width="2" height="6" fill="currentColor" />
            <rect x="17" y="4" width="2" height="6" fill="currentColor" />
          </svg>
        ) : (
          <svg className={`w-5 h-5 ${isActive ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" d="M6 4v16M12 4v16M18 4v16" />
            <rect x="4" y="6" width="4" height="3" rx="1" fill="currentColor" />
            <rect x="10" y="12" width="4" height="3" rx="1" fill="currentColor" />
            <rect x="16" y="9" width="4" height="3" rx="1" fill="currentColor" />
          </svg>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        onClick={onClick}
        className={`group w-full text-left p-3 rounded-xl transition-all duration-200 cursor-pointer ${
          isActive
            ? 'bg-accent-subtle border border-accent/30'
            : 'hover:bg-bg-tertiary border border-transparent'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${
            isActive ? 'bg-accent/20' : 'bg-bg-elevated'
          }`}>
            {isBusy ? (
              <Spinner size="sm" className={isActive ? 'text-accent' : 'text-text-muted'} />
            ) : project.template === 'instrument' ? (
              // Instrument icon (piano keys)
              <svg className={`w-5 h-5 ${isActive ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 4v10M10 4v10M14 4v10M18 4v10" />
                <rect x="5" y="4" width="2" height="6" fill="currentColor" />
                <rect x="9" y="4" width="2" height="6" fill="currentColor" />
                <rect x="13" y="4" width="2" height="6" fill="currentColor" />
                <rect x="17" y="4" width="2" height="6" fill="currentColor" />
              </svg>
            ) : (
              // Effect icon (mixer sliders)
              <svg className={`w-5 h-5 ${isActive ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" d="M6 4v16M12 4v16M18 4v16" />
                <rect x="4" y="6" width="4" height="3" rx="1" fill="currentColor" />
                <rect x="10" y="12" width="4" height="3" rx="1" fill="currentColor" />
                <rect x="16" y="9" width="4" height="3" rx="1" fill="currentColor" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-medium truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                {project.name}
              </span>
              {isBusy && (
                <span className="text-xs text-text-muted flex-shrink-0">
                  {busyType === 'claude' ? 'Working...' : 'Building...'}
                </span>
              )}
            </div>
            <div className="text-xs text-text-muted truncate mt-0.5">
              {project.description || 'No description'}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-text-muted">
                {timeAgo(project.updated_at)}
              </span>
              <button
                onClick={handleDeleteClick}
                className="opacity-0 group-hover:opacity-100 p-1 -mr-1 rounded text-text-muted hover:text-error hover:bg-error/10 transition-all"
                title="Delete project"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Project"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-text-secondary">
            Are you sure you want to delete <strong className="text-text-primary">{project.name}</strong>? This will permanently remove all project files and cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium text-white bg-error hover:bg-error/90 rounded-lg transition-colors flex items-center gap-2"
            >
              {isDeleting ? (
                <>
                  <Spinner size="sm" className="text-white" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
