import { create } from 'zustand';

// Draft attachment - same shape as PendingAttachment in ChatInput
interface DraftAttachment {
  id: string;
  originalName: string;
  sourcePath: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
}

interface Draft {
  message: string;
  attachments: DraftAttachment[];
}

interface DraftState {
  // Drafts keyed by project path
  drafts: Record<string, Draft>;

  // Get draft for a project (returns empty draft if none exists)
  getDraft: (projectPath: string) => Draft;

  // Set draft for a project
  setDraft: (projectPath: string, draft: Draft) => void;

  // Update just the message for a project
  setMessage: (projectPath: string, message: string) => void;

  // Update just the attachments for a project
  setAttachments: (projectPath: string, attachments: DraftAttachment[]) => void;

  // Clear draft for a project (after sending)
  clearDraft: (projectPath: string) => void;

  // Remove draft when project is deleted
  removeDraft: (projectPath: string) => void;
}

const emptyDraft: Draft = { message: '', attachments: [] };

export const useDraftStore = create<DraftState>()((set, get) => ({
  drafts: {},

  getDraft: (projectPath) => {
    return get().drafts[projectPath] || emptyDraft;
  },

  setDraft: (projectPath, draft) => {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [projectPath]: draft,
      },
    }));
  },

  setMessage: (projectPath, message) => {
    set((state) => {
      const existing = state.drafts[projectPath] || emptyDraft;
      return {
        drafts: {
          ...state.drafts,
          [projectPath]: { ...existing, message },
        },
      };
    });
  },

  setAttachments: (projectPath, attachments) => {
    set((state) => {
      const existing = state.drafts[projectPath] || emptyDraft;
      return {
        drafts: {
          ...state.drafts,
          [projectPath]: { ...existing, attachments },
        },
      };
    });
  },

  clearDraft: (projectPath) => {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [projectPath]: emptyDraft,
      },
    }));
  },

  removeDraft: (projectPath) => {
    set((state) => {
      const { [projectPath]: _, ...rest } = state.drafts;
      return { drafts: rest };
    });
  },
}));

export type { Draft, DraftAttachment };
