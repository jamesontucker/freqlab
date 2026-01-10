import { create } from 'zustand';

interface ChatState {
  pendingMessage: string | null;
  // Streaming content per project (survives component unmount/remount)
  streamingContent: Record<string, string>;

  // Actions
  queueMessage: (message: string) => void;
  clearPendingMessage: () => void;
  setStreamingContent: (projectPath: string, content: string) => void;
  clearStreamingContent: (projectPath: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  pendingMessage: null,
  streamingContent: {},

  queueMessage: (message) => {
    set({ pendingMessage: message });
  },

  clearPendingMessage: () => {
    set({ pendingMessage: null });
  },

  setStreamingContent: (projectPath, content) => {
    set((state) => ({
      streamingContent: { ...state.streamingContent, [projectPath]: content },
    }));
  },

  clearStreamingContent: (projectPath) => {
    set((state) => {
      const { [projectPath]: _, ...rest } = state.streamingContent;
      return { streamingContent: rest };
    });
  },
}));
