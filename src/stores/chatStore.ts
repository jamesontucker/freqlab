import { create } from 'zustand';
import type { TokenUsage } from '../types';

interface ChatState {
  pendingMessage: string | null;
  // Streaming content per project (survives component unmount/remount)
  streamingContent: Record<string, string>;
  // Context cleared state per project (waiting to send with history summary)
  contextCleared: Record<string, boolean>;
  // Token usage per project (cached from Claude logs)
  tokenUsage: Record<string, TokenUsage>;

  // Actions
  queueMessage: (message: string) => void;
  clearPendingMessage: () => void;
  setStreamingContent: (projectPath: string, content: string) => void;
  clearStreamingContent: (projectPath: string) => void;
  // Context cleared actions
  setContextCleared: (projectPath: string, cleared: boolean) => void;
  isContextCleared: (projectPath: string) => boolean;
  // Token usage actions
  setTokenUsage: (projectPath: string, usage: TokenUsage) => void;
  getTokenUsage: (projectPath: string) => TokenUsage | undefined;
  clearTokenUsage: (projectPath: string) => void;
  // Cleanup all state for a project (call when project is deleted)
  cleanupProject: (projectPath: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  pendingMessage: null,
  streamingContent: {},
  contextCleared: {},
  tokenUsage: {},

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

  // Context cleared actions
  setContextCleared: (projectPath, cleared) => {
    set((state) => ({
      contextCleared: { ...state.contextCleared, [projectPath]: cleared },
    }));
  },

  isContextCleared: (projectPath) => {
    return get().contextCleared[projectPath] ?? false;
  },

  // Token usage actions
  setTokenUsage: (projectPath, usage) => {
    set((state) => ({
      tokenUsage: { ...state.tokenUsage, [projectPath]: usage },
    }));
  },

  getTokenUsage: (projectPath) => {
    return get().tokenUsage[projectPath];
  },

  clearTokenUsage: (projectPath) => {
    set((state) => {
      const { [projectPath]: _, ...rest } = state.tokenUsage;
      return { tokenUsage: rest };
    });
  },

  // Cleanup all state for a project (call when project is deleted)
  cleanupProject: (projectPath) => {
    set((state) => {
      const { [projectPath]: _stream, ...restStream } = state.streamingContent;
      const { [projectPath]: _cleared, ...restCleared } = state.contextCleared;
      const { [projectPath]: _usage, ...restUsage } = state.tokenUsage;
      return {
        streamingContent: restStream,
        contextCleared: restCleared,
        tokenUsage: restUsage,
      };
    });
  },
}));
