import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { ProjectMeta, CreateProjectInput } from '../types';

interface ProjectState {
  projects: ProjectMeta[];
  activeProject: ProjectMeta | null;
  loading: boolean;
  error: string | null;

  // Actions
  loadProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<ProjectMeta>;
  selectProject: (project: ProjectMeta | null) => void;
  deleteProject: (folderName: string, projectPath: string) => Promise<void>;
  updateProject: (projectPath: string, name: string, description: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProject: null,
  loading: false,
  error: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await invoke<ProjectMeta[]>('list_projects');
      set({ projects, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createProject: async (input: CreateProjectInput) => {
    set({ loading: true, error: null });
    try {
      const project = await invoke<ProjectMeta>('create_project', { input });
      set((state) => ({
        projects: [project, ...state.projects],
        activeProject: project,
        loading: false,
      }));
      return project;
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  selectProject: (project) => {
    set({ activeProject: project });
  },

  deleteProject: async (folderName: string, projectPath: string) => {
    set({ loading: true, error: null });
    try {
      // Backend uses folder name to find the project directory
      await invoke('delete_project', { name: folderName });
      // Filter local state by path (more reliable than name since name can be edited)
      set((state) => ({
        projects: state.projects.filter((p) => p.path !== projectPath),
        activeProject: state.activeProject?.path === projectPath ? null : state.activeProject,
        loading: false,
      }));
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  updateProject: async (projectPath: string, name: string, description: string) => {
    try {
      const updated = await invoke<ProjectMeta>('update_project', {
        projectPath,
        name,
        description,
      });
      set((state) => ({
        projects: state.projects.map((p) =>
          p.path === projectPath ? updated : p
        ),
        activeProject: state.activeProject?.path === projectPath ? updated : state.activeProject,
      }));
    } catch (err) {
      throw err;
    }
  },
}));
