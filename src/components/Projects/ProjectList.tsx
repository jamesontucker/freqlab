import { useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import { useTourStore } from '../../stores/tourStore';
import { ProjectCard } from './ProjectCard';
import { Spinner } from '../Common/Spinner';

interface ProjectListProps {
  collapsed?: boolean;
}

export function ProjectList({ collapsed = false }: ProjectListProps) {
  // === REACTIVE STATE (with selectors) ===
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);

  // Subscribe to busy state as primitives for proper memoization
  const buildingPath = useProjectBusyStore((s) => s.buildingPath);
  // Get the Set directly - we'll check membership in the card
  const claudeBusyPaths = useProjectBusyStore((s) => s.claudeBusyPaths);

  // Tour state - block switching to other projects during tour
  const tourActive = useTourStore((s) => s.isActive);

  // === STABLE ACTION REFERENCES ===
  const loadProjects = useProjectStore.getState().loadProjects;
  const selectProject = useProjectStore.getState().selectProject;
  const deleteProject = useProjectStore.getState().deleteProject;

  // === ALL HOOKS MUST BE BEFORE EARLY RETURNS ===

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Derive busy state for a project - memoized to avoid recalculating
  const getBusyState = useCallback((projectPath: string): { isBusy: boolean; busyType: 'claude' | 'build' | null } => {
    if (claudeBusyPaths.has(projectPath)) {
      return { isBusy: true, busyType: 'claude' };
    }
    if (buildingPath === projectPath) {
      return { isBusy: true, busyType: 'build' };
    }
    return { isBusy: false, busyType: null };
  }, [claudeBusyPaths, buildingPath]);

  // Disable project selection when any build is in progress
  const anyBuildInProgress = buildingPath !== null;

  // Memoize the project items to prevent unnecessary recalculations
  const projectItems = useMemo(() => {
    return projects.map((project) => {
      const { isBusy, busyType } = getBusyState(project.path);
      const isCurrentProject = activeProjectId === project.id;
      // Disable non-active projects during build OR during tour
      const disabled = (anyBuildInProgress && !isCurrentProject) || (tourActive && !isCurrentProject);
      return {
        project,
        isActive: isCurrentProject,
        isBusy,
        busyType,
        disabled,
      };
    });
  }, [projects, activeProjectId, getBusyState, anyBuildInProgress, tourActive]);

  // Stable callback for delete - memoize with project path
  const handleDelete = useCallback(async (projectPath: string) => {
    const folderName = projectPath.split('/').pop() || '';
    await deleteProject(folderName, projectPath);
  }, [deleteProject]);

  // === EARLY RETURNS (after all hooks) ===

  if (loading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" className="text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-sm text-error bg-error-subtle rounded-lg">
        {error}
      </div>
    );
  }

  if (projects.length === 0) {
    if (collapsed) {
      return (
        <div className="flex justify-center py-4">
          <div className="w-10 h-10 rounded-xl bg-bg-tertiary flex items-center justify-center">
            <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
            </svg>
          </div>
        </div>
      );
    }
    return (
      <div className="text-center py-8 px-4">
        <div className="w-12 h-12 mx-auto rounded-xl bg-bg-tertiary flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
          </svg>
        </div>
        <p className="text-sm text-text-muted">No plugins yet</p>
        <p className="text-xs text-text-muted mt-1">Click "New Plugin" to get started</p>
      </div>
    );
  }

  return (
    <div className={collapsed ? 'space-y-1 flex flex-col items-center' : 'space-y-1'}>
      {projectItems.map(({ project, isActive, isBusy, busyType, disabled }) => (
        <ProjectCard
          key={project.id}
          project={project}
          isActive={isActive}
          isBusy={isBusy}
          busyType={busyType}
          collapsed={collapsed}
          disabled={disabled}
          onClick={() => selectProject(project)}
          onDelete={() => handleDelete(project.path)}
        />
      ))}
    </div>
  );
}
