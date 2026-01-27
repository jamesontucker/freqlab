import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from './ChatMessage';
import { ChatInput, type PendingAttachment } from './ChatInput';
import { useProjectOutput } from '../../stores/outputStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';
import { isAppFocused } from '../../utils/focusTracker';
import type { ChatMessage as ChatMessageType, ChatState, ProjectMeta, FileAttachment, TokenUsage } from '../../types';
import { markdownComponents } from './markdownUtils';

// 30 minute timeout for Claude sessions (in milliseconds)
const CLAUDE_TIMEOUT_MS = 30 * 60 * 1000;

interface AttachmentInput {
  originalName: string;
  sourcePath: string;
  mimeType: string;
  size: number;
}

interface StoredAttachment {
  id: string;
  originalName: string;
  path: string;
  mimeType: string;
  size: number;
}

interface EnsuredLibraryItem {
  id: string;
  name: string;
  was_copied: boolean;
}

interface ClaudeStreamEvent {
  type: 'start' | 'text' | 'error' | 'done';
  project_path: string;
  content?: string;
  message?: string;
}

interface ChatPanelProps {
  project: ProjectMeta;
  onVersionChange?: () => void;
}

const THINKING_PHRASES = [
  'Thinking...',
  'Pondering...',
  'Ruminating...',
  'Contemplating...',
  'Processing...',
];

export function ChatPanel({ project, onVersionChange }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [thinkingPhraseIndex, setThinkingPhraseIndex] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  // Initialize elapsed time from store to prevent "0s flash" when switching to a loading project
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    const store = useProjectBusyStore.getState();
    if (store.isClaudeBusy(project.path)) {
      const startTime = store.getClaudeStartTime(project.path);
      if (startTime) {
        return Math.floor((Date.now() - startTime) / 1000);
      }
    }
    return 0;
  });
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const versionBadgeRef = useRef<HTMLSpanElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessageType[]>([]);
  // Track if user is at bottom of scroll (within threshold)
  const isAtBottomRef = useRef(true);
  const isInitialMount = useRef(true);
  const isSavingRef = useRef(false);
  const saveQueueRef = useRef<ChatMessageType[] | null>(null);
  const streamingContentRef = useRef('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Flag to skip loadHistory when handleSend just completed (prevents race condition)
  const handleSendCompletedRef = useRef(false);
  const { addLine, clear } = useProjectOutput(project.path);

  // Use selector for pendingMessage (reactive), getState() for stable action references
  const pendingMessage = useChatStore((s) => s.pendingMessage);
  const clearPendingMessage = useChatStore.getState().clearPendingMessage;

  // Streaming content stored in Zustand (survives component unmount/remount when switching projects)
  const streamingContent = useChatStore((s) => s.streamingContent[project.path] || '');
  const setStreamingContent = useChatStore.getState().setStreamingContent;
  const clearStreamingContent = useChatStore.getState().clearStreamingContent;

  // Context cleared state stored in Zustand (per-project, survives unmount)
  const contextCleared = useChatStore((s) => s.contextCleared[project.path] ?? false);
  const setContextCleared = useChatStore.getState().setContextCleared;

  // Token usage stored in Zustand (per-project, survives unmount)
  const tokenUsage = useChatStore((s) => s.tokenUsage[project.path]);
  const setTokenUsage = useChatStore.getState().setTokenUsage;

  // Subscribe to derived busy state booleans (triggers re-render when they change)
  // Using selectors ensures component re-renders when Claude busy state changes
  const isLoading = useProjectBusyStore((s) => s.claudeBusyPaths.has(project.path));
  const isBusy = useProjectBusyStore((s) =>
    s.claudeBusyPaths.has(project.path) || s.buildingPath === project.path
  );

  // Get stable action references via getState() (no subscription needed for actions)
  const setClaudeBusy = useProjectBusyStore.getState().setClaudeBusy;
  const clearClaudeBusy = useProjectBusyStore.getState().clearClaudeBusy;
  const getClaudeStartTime = useProjectBusyStore.getState().getClaudeStartTime;

  const aiSettings = useSettingsStore((s) => s.aiSettings);
  const chatStyle = aiSettings.chatStyle;
  // Track chat style for current processing session (initialized from setting, captured when chat starts)
  const activeChatStyleRef = useRef(chatStyle);

  // Clear timeout helper
  const clearTimeoutTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Reset timeout helper - called on each streaming event
  const resetTimeout = useCallback(() => {
    clearTimeoutTimer();
    timeoutRef.current = setTimeout(async () => {
      // Timeout reached - interrupt Claude
      console.warn('[ChatPanel] Claude session timed out after 30 minutes');
      addLine('[WARNING] Session timed out after 30 minutes of no activity');
      try {
        await invoke('interrupt_claude', { projectPath: project.path });
      } catch (err) {
        console.error('Failed to interrupt Claude:', err);
      }
    }, CLAUDE_TIMEOUT_MS);
  }, [clearTimeoutTimer, addLine, project.path]);

  // Interrupt handler
  const handleInterrupt = useCallback(async () => {
    clearTimeoutTimer();
    addLine('[Interrupting...]');
    try {
      await invoke('interrupt_claude', { projectPath: project.path });
    } catch (err) {
      // If there's no active session, it might have just finished - that's fine
      const errorStr = String(err);
      if (errorStr.includes('No active Claude session')) {
        addLine('[Session already finished]');
      } else {
        console.error('Failed to interrupt Claude:', err);
        addLine(`[ERROR] Failed to interrupt: ${err}`);
      }
    }
  }, [clearTimeoutTimer, addLine, project.path]);

  // Clear context handler - resets Claude session but keeps chat history
  const handleClearContext = useCallback(async () => {
    try {
      await invoke('clear_claude_session', { projectPath: project.path });
      setContextCleared(project.path, true);
      // Clear cached token usage - the session file is gone so get_project_usage would fail
      // New session will start fresh at ~16% baseline when user sends next message
      useChatStore.getState().clearTokenUsage(project.path);
      addLine('[Context cleared - next message will include conversation summary]');
    } catch (err) {
      console.error('Failed to clear context:', err);
      addLine(`[ERROR] Failed to clear context: ${err}`);
    }
  }, [project.path, addLine, setContextCleared]);

  // Tauri drag and drop event listeners
  useEffect(() => {
    let mounted = true;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;

    const setupListeners = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (!mounted) return;

      unlistenEnter = await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-enter', () => {
        if (mounted) setIsDraggingOver(true);
      });

      unlistenLeave = await listen('tauri://drag-leave', () => {
        if (mounted) setIsDraggingOver(false);
      });

      unlistenDrop = await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
        if (!mounted) return;
        setIsDraggingOver(false);

        // Only handle drop if it's within this panel's bounds
        const panel = chatPanelRef.current;
        if (panel && event.payload.position) {
          const rect = panel.getBoundingClientRect();
          const { x, y } = event.payload.position;
          const isInBounds = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          if (!isInBounds) return;
        }

        if (event.payload.paths && event.payload.paths.length > 0) {
          setDroppedFiles(event.payload.paths);
        }
      });
    };

    setupListeners();

    return () => {
      mounted = false;
      unlistenEnter?.();
      unlistenLeave?.();
      unlistenDrop?.();
    };
  }, []);

  const handleDroppedFilesProcessed = useCallback(() => {
    setDroppedFiles([]);
  }, []);

  // Cleanup timeout on unmount (important when switching projects mid-session)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Register tour refs
  useEffect(() => {
    registerTourRef('chat-panel', chatPanelRef);
    registerTourRef('chat-version-badge', versionBadgeRef);
    return () => {
      unregisterTourRef('chat-panel');
      unregisterTourRef('chat-version-badge');
    };
  }, []);

  // Load chat history from disk
  const loadHistory = useCallback(async () => {
    try {
      const state = await invoke<ChatState>('load_chat_history', {
        projectPath: project.path,
      });
      setMessages(state.messages);
      messagesRef.current = state.messages;
      setActiveVersion(state.activeVersion);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
    setIsHistoryLoaded(true);
  }, [project.path]);

  // Track state from previous render to detect meaningful changes
  const prevStateRef = useRef<{ projectPath: string | null; isLoading: boolean }>({
    projectPath: null,
    isLoading: false,
  });

  // Load chat history when project changes OR when Claude finishes working on this project
  useEffect(() => {
    const prev = prevStateRef.current;
    const projectChanged = prev.projectPath !== project.path;
    const claudeJustFinished = prev.isLoading && !isLoading && !projectChanged;
    const claudeJustStarted = !prev.isLoading && isLoading && !projectChanged;

    // Update ref for next render
    prevStateRef.current = { projectPath: project.path, isLoading };

    if (claudeJustStarted) {
      // User just sent a message - handleSend is managing state, don't interfere
      return;
    }

    if (claudeJustFinished) {
      // Claude just finished working on THIS project
      // If handleSend just completed, it already set the correct state - skip reload
      // This prevents a race condition where loadHistory would overwrite with stale disk data
      if (handleSendCompletedRef.current) {
        handleSendCompletedRef.current = false;
        return;
      }
      // Otherwise reload to get the saved result (e.g., after component remount during Claude work)
      loadHistory();
      return;
    }

    // Project changed or initial mount - reset and reload
    // Note: streamingContent is NOT cleared here - it's stored in Zustand per-project
    // and should be preserved when switching back to a project with active streaming
    setMessages([]);
    setActiveVersion(null);
    setIsHistoryLoaded(false);
    loadHistory();
  }, [project.path, loadHistory, isLoading]);

  // Fetch token usage from Claude's logs
  // Update after each Claude response completes and periodically
  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const usage = await invoke<TokenUsage>('get_project_usage', {
          projectPath: project.path,
        });
        setTokenUsage(project.path, usage);
      } catch {
        // No session yet or logs not found - that's okay
        // Don't clear existing usage - it may just be a transient error
      }
    };

    // Fetch immediately
    fetchUsage();

    // Also refetch when Claude finishes (isLoading changes from true to false)
    // The dependency on messages.length ensures we update after new messages
    // Note: setTokenUsage is from getState() so it's stable and not needed in deps
  }, [project.path, isLoading, messages.length]);

  // Re-sync from disk when window regains focus or becomes visible
  // This fixes state sync issues when the app is minimized or in background
  useEffect(() => {
    let lastSyncTime = Date.now();
    const SYNC_DEBOUNCE_MS = 1000; // Don't sync more than once per second

    const syncFromDisk = () => {
      // Debounce to prevent rapid re-syncs
      const now = Date.now();
      if (now - lastSyncTime < SYNC_DEBOUNCE_MS) return;
      lastSyncTime = now;

      // If handleSend just completed, it set the correct state - skip reload
      // This prevents race condition where we'd read stale disk data during save
      if (handleSendCompletedRef.current) {
        handleSendCompletedRef.current = false;
        return;
      }

      if (!isLoading) {
        // Reload from disk to catch any updates that happened while unfocused
        loadHistory();
        // Notify parent to re-check build status too
        onVersionChange?.();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncFromDisk();
      }
    };

    const handleFocus = () => {
      syncFromDisk();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadHistory, isLoading, onVersionChange]);

  // Save chat history when messages change (after initial load)
  // Uses a queue to prevent race conditions when multiple saves are triggered
  useEffect(() => {
    if (!isHistoryLoaded || messages.length === 0) return;

    const saveMessages = async (toSave: ChatMessageType[]) => {
      if (isSavingRef.current) {
        // Queue this save for later
        saveQueueRef.current = toSave;
        return;
      }

      isSavingRef.current = true;
      try {
        await invoke('save_chat_history', {
          projectPath: project.path,
          messages: toSave,
        });
      } catch (err) {
        console.error('Failed to save chat history:', err);
      } finally {
        isSavingRef.current = false;
        // Check if there's a queued save
        if (saveQueueRef.current) {
          const queued = saveQueueRef.current;
          saveQueueRef.current = null;
          saveMessages(queued);
        }
      }
    };

    saveMessages(messages);
  }, [messages, project.path, isHistoryLoaded]);

  // Keep messagesRef in sync with state for use in callbacks
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Auto-scroll to bottom when messages change
  // Use scrollTop for more predictable behavior than scrollIntoView
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const scrollToBottom = (smooth: boolean) => {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (smooth) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        } else {
          container.scrollTop = container.scrollHeight;
        }
        isAtBottomRef.current = true;
      });
    };

    if (!isHistoryLoaded) {
      // Still loading - use instant scroll (will be hidden during fade anyway)
      scrollToBottom(false);
    } else if (isInitialMount.current) {
      // History just loaded - instant scroll then mark mount complete
      scrollToBottom(false);
      isInitialMount.current = false;
    } else {
      // Normal chat flow - smooth scroll for new messages
      scrollToBottom(true);
    }
  }, [messages, streamingContent, isHistoryLoaded]);

  // Track scroll position to determine if user is at bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "at bottom" if within 50px of the bottom
      const threshold = 50;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < threshold;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Maintain scroll position on container resize (e.g., preview panel opens/closes)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      // If user was at bottom before resize, scroll back to bottom
      // Use scrollTop for precise positioning (avoids gap issues with scrollIntoView)
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - container.clientHeight;
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Rotate through thinking phrases while loading
  useEffect(() => {
    if (!isLoading) {
      setThinkingPhraseIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setThinkingPhraseIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Track elapsed time while loading (start time stored in Zustand)
  useEffect(() => {
    if (!isLoading) {
      setElapsedSeconds(0);
      return;
    }

    // Calculate elapsed from start time stored in the busy store
    const updateElapsed = () => {
      const startTime = getClaudeStartTime(project.path);
      if (startTime) {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }
    };

    // Update immediately, then every second
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [isLoading, project.path, getClaudeStartTime]);

  const handleSend = useCallback(async (content: string, attachments?: PendingAttachment[]) => {
    // Capture current chat style at start of processing (so changing settings mid-chat doesn't affect display)
    activeChatStyleRef.current = chatStyle;

    // Use ref for current messages (avoids stale closure issues)
    const currentMessages = messagesRef.current;

    // Separate library items from file attachments
    const libraryItems = attachments?.filter(a => a.libraryType && a.libraryItemId) || [];
    const fileAttachments = attachments?.filter(a => !a.libraryType && a.sourcePath) || [];

    // Store file attachments
    let storedAttachments: FileAttachment[] | undefined;
    if (fileAttachments.length > 0) {
      try {
        const attachmentInputs: AttachmentInput[] = fileAttachments.map((a) => ({
          originalName: a.originalName,
          sourcePath: a.sourcePath,
          mimeType: a.mimeType,
          size: a.size,
        }));
        const stored = await invoke<StoredAttachment[]>('store_chat_attachments', {
          projectPath: project.path,
          attachments: attachmentInputs,
        });
        storedAttachments = stored.map((s) => ({
          id: s.id,
          originalName: s.originalName,
          path: s.path,
          mimeType: s.mimeType,
          size: s.size,
        }));
      } catch (err) {
        console.error('Failed to store attachments:', err);
        // Notify user but continue without attachments
        addLine(`[Warning] Could not store ${fileAttachments.length} attachment(s): ${err}`);
        addLine('Message will be sent without file attachments.');
      }
    }

    // Ensure library items are copied to project's .claude/commands/ directory
    // This uses reference-based attachment - Claude reads the skill via slash command
    const ensuredLibraryItems: EnsuredLibraryItem[] = [];
    for (const item of libraryItems) {
      // Validate required fields (filter ensures these exist, but be defensive)
      if (!item.libraryType || !item.libraryItemId) {
        console.error('Library item missing required fields:', item);
        addLine(`[Warning] Skipping invalid library attachment: ${item.originalName}`);
        continue;
      }

      try {
        const ensured = await invoke<EnsuredLibraryItem>('ensure_library_item_in_project', {
          projectPath: project.path,
          itemType: item.libraryType,
          itemId: item.libraryItemId,
        });
        ensuredLibraryItems.push(ensured);
        if (ensured.was_copied) {
          addLine(`[Copied ${item.libraryType}: ${ensured.name} to project]`);
        }
      } catch (err) {
        console.error(`Failed to ensure library item ${item.libraryItemId}:`, err);
        addLine(`[Warning] Could not attach ${item.originalName}: ${err}`);
      }
    }

    // Create display attachments for library items (stored in chat history for display)
    const libraryAttachments: FileAttachment[] = ensuredLibraryItems.map((item) => ({
      id: crypto.randomUUID(),
      originalName: `${item.name}.md`,
      path: `library://skill/${item.id}`, // Pseudo-path for display (skill or algorithm)
      mimeType: 'text/markdown',
      size: 0,
    }));

    // Combine all attachments for display in chat history
    const allDisplayAttachments = [...(storedAttachments || []), ...libraryAttachments];
    const finalAttachments = allDisplayAttachments.length > 0 ? allDisplayAttachments : undefined;

    // Add user message
    const userMessage: ChatMessageType = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      reverted: false,
      attachments: finalAttachments,
    };
    const messagesWithUser = [...currentMessages, userMessage];
    setMessages(messagesWithUser);
    messagesRef.current = messagesWithUser; // Keep ref in sync immediately
    setClaudeBusy(project.path);
    clearStreamingContent(project.path);
    streamingContentRef.current = '';

    // Save user message immediately (don't rely on effect in case of unmount)
    try {
      await invoke('save_chat_history', {
        projectPath: project.path,
        messages: messagesWithUser,
      });
    } catch (err) {
      console.error('Failed to save user message:', err);
    }

    // Clear output panel (user controls expand/collapse)
    clear();
    // Show appropriate message based on content
    if (content) {
      addLine(`> Processing: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    } else if (finalAttachments && finalAttachments.length > 0) {
      addLine(`> Processing ${finalAttachments.length} attachment(s)...`);
    }
    addLine('');

    // Start the 30-minute timeout timer
    resetTimeout();

    // Listen for streaming events - filter by project path to prevent cross-talk
    const unlisten = await listen<ClaudeStreamEvent>('claude-stream', (event) => {
      const data = event.payload;
      // Only process events for THIS project
      if (data.project_path !== project.path) return;

      // Reset timeout on any activity from Claude
      resetTimeout();

      if (data.type === 'text' && data.content) {
        // Use \n\n so each message becomes a separate bubble in conversational mode
        streamingContentRef.current += data.content + '\n\n';
        setStreamingContent(project.path, streamingContentRef.current);
        addLine(data.content);
      } else if (data.type === 'error' && data.message) {
        streamingContentRef.current += `\nError: ${data.message}`;
        setStreamingContent(project.path, streamingContentRef.current);
        addLine(`[ERROR] ${data.message}`);
      } else if (data.type === 'start') {
        addLine('[Started working...]');
      }
    });

    // Build message with context for Claude
    let messageForClaude = content;
    const contextParts: string[] = [];

    // Add file attachment references (Claude will read from paths)
    if (storedAttachments && storedAttachments.length > 0) {
      const fileContext = storedAttachments
        .map((a) => `[Attached file: ${a.originalName} at ${a.path}]`)
        .join('\n');
      contextParts.push(fileContext);
    }

    // Add library item references (skills/algorithms copied to .claude/commands/)
    // Claude reads the content on-demand via slash command - lean context usage
    if (ensuredLibraryItems.length > 0) {
      const skillRefs = ensuredLibraryItems.map((item) => `/${item.id}`).join(', ');
      contextParts.push(`Reference these skills for this task: ${skillRefs}`);
    }

    // Prepend context to message
    if (contextParts.length > 0) {
      messageForClaude = `${contextParts.join('\n\n')}\n\n${content}`;
    }

    // Collect previous user messages if context was cleared
    let previousUserMessages: string[] | undefined;
    if (contextCleared) {
      previousUserMessages = messagesWithUser
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      // Reset cleared flag since we're about to send with the history
      setContextCleared(project.path, false);
    }

    try {
      const response = await invoke<{ content: string; commit_hash?: string }>('send_to_claude', {
        projectPath: project.path,
        projectName: project.name,
        description: project.description,
        message: messageForClaude,
        model: aiSettings.model,
        customInstructions: aiSettings.customInstructions,
        agentVerbosity: aiSettings.agentVerbosity,
        previousUserMessages,
      });

      // Calculate next version number if this response has a commit (files were changed)
      // Version is based on count of previous commits that have version numbers
      const nextVersion = response.commit_hash
        ? messagesWithUser.filter((m) => m.version).length + 1
        : undefined;

      // Add assistant message with commit hash for version control
      // Prefer streaming content (has all messages) over response.content (may only be final message)
      const assistantMessage: ChatMessageType = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: streamingContentRef.current.trim() || response.content.trim(),
        timestamp: new Date().toISOString(),
        commitHash: response.commit_hash,
        version: nextVersion,
        reverted: false,
      };
      const messagesWithAssistant = [...messagesWithUser, assistantMessage];
      setMessages(messagesWithAssistant);
      messagesRef.current = messagesWithAssistant; // Keep ref in sync immediately

      // Update active version IMMEDIATELY if this created a new version
      // This must happen before any await to prevent a render with stale activeVersion
      // (which would cause the new message to appear greyed out momentarily)
      if (nextVersion) {
        setActiveVersion(nextVersion);
        // Signal that this new version needs to be built (include projectPath for multi-project safety)
        usePreviewStore.getState().setPendingBuildVersion({
          projectPath: project.path,
          version: nextVersion,
        });
      }

      // Mark state as authoritative BEFORE async saves - prevents race condition
      // where focus event could trigger loadHistory during the await calls below
      // and overwrite our freshly-set state with stale disk data
      handleSendCompletedRef.current = true;

      // Now persist to disk (async operations after state is consistent)
      // Pass activeVersion explicitly to make this atomic - prevents race condition
      // where focus events could read stale disk data between save and version update
      await invoke('save_chat_history', {
        projectPath: project.path,
        messages: messagesWithAssistant,
        activeVersion: nextVersion ?? null,  // null preserves existing, number sets it
      });
    } catch (err) {
      // Check if this was a user-initiated interrupt
      const errorStr = String(err);
      const wasInterrupted = errorStr.includes('Session interrupted');

      if (wasInterrupted) {
        // Clear any pending build to prevent auto-build from triggering on interrupt
        usePreviewStore.getState().setPendingBuildVersion(null);

        if (activeChatStyleRef.current === 'minimal') {
          // Minimal mode: show interrupt message
          const interruptMessage: ChatMessageType = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Chat was interrupted.',
            timestamp: new Date().toISOString(),
            reverted: false,
          };
          const messagesWithInterrupt = [...messagesWithUser, interruptMessage];
          setMessages(messagesWithInterrupt);
          messagesRef.current = messagesWithInterrupt;

          await invoke('save_chat_history', {
            projectPath: project.path,
            messages: messagesWithInterrupt,
          }).catch((e) => console.error('Failed to save interrupt message:', e));
        } else {
          // Conversational mode: keep partial streaming content if any
          const partialContent = streamingContentRef.current.trim();
          if (partialContent) {
            const partialMessage: ChatMessageType = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: partialContent,
              timestamp: new Date().toISOString(),
              reverted: false,
            };
            const messagesWithPartial = [...messagesWithUser, partialMessage];
            setMessages(messagesWithPartial);
            messagesRef.current = messagesWithPartial;

            await invoke('save_chat_history', {
              projectPath: project.path,
              messages: messagesWithPartial,
            }).catch((e) => console.error('Failed to save partial message:', e));
          }
          // If no content yet, just stop - user message remains
        }
      } else {
        // Add error message for actual errors
        // Use streaming content if available (already contains the error), otherwise show generic message
        const errorMessage: ChatMessageType = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: streamingContentRef.current.trim() || `Sorry, something went wrong: ${err}`,
          timestamp: new Date().toISOString(),
          reverted: false,
        };
        const messagesWithError = [...messagesWithUser, errorMessage];
        setMessages(messagesWithError);
        messagesRef.current = messagesWithError;

        await invoke('save_chat_history', {
          projectPath: project.path,
          messages: messagesWithError,
        }).catch((e) => console.error('Failed to save error message:', e));
      }
    } finally {
      unlisten();
      // Clear the timeout timer since we're done
      clearTimeoutTimer();
      // Only clear if we're still the active Claude session (prevents race with other projects)
      clearClaudeBusy(project.path);
      clearStreamingContent(project.path);
      streamingContentRef.current = '';
      addLine('');
      addLine('[Done]');

      // Send notification if enabled and app is not focused
      // Uses app-level focus tracking (initialized in main.tsx) - works even if component unmounted
      const currentShowNotifications = useSettingsStore.getState().showNotifications;

      if (currentShowNotifications && !isAppFocused()) {
        (async () => {
          try {
            let granted = await isPermissionGranted();

            // Request permission if not granted - this triggers the macOS prompt
            if (!granted) {
              const permission = await requestPermission();
              granted = permission === 'granted';
            }

            if (granted) {
              await sendNotification({
                title: 'freqlab',
                body: `Claude finished working on ${project.name}`,
              });
            }
          } catch (err) {
            console.warn('Failed to send notification:', err);
          }
        })();
      }
    }
  }, [project, addLine, clear, setClaudeBusy, clearClaudeBusy, clearStreamingContent, resetTimeout, clearTimeoutTimer, chatStyle, contextCleared, aiSettings]);

  // Watch for pending messages (e.g., from "Fix with Claude" button)
  useEffect(() => {
    if (pendingMessage && !isLoading) {
      handleSend(pendingMessage);
      clearPendingMessage();
    }
  }, [pendingMessage, isLoading, handleSend, clearPendingMessage]);

  // Handle changing to a specific version (works for both forward and backward)
  const handleVersionChange = useCallback(async (version: number, commitHash: string) => {
    setClaudeBusy(project.path);

    // Calculate effective active version (same logic as render)
    const latestVersion = messages.reduce((max, m) =>
      m.version && m.version > max ? m.version : max, 0);
    const effectiveActive = activeVersion ?? latestVersion;

    const direction = version < effectiveActive ? 'Reverting' : 'Restoring';
    addLine(`> ${direction} to v${version}...`);

    try {
      // Call backend to checkout the version and update activeVersion
      const state = await invoke<ChatState>('set_active_version', {
        projectPath: project.path,
        version,
        commitHash,
      });

      setMessages(state.messages);
      setActiveVersion(state.activeVersion);
      addLine(`[${direction === 'Reverting' ? 'Reverted' : 'Restored'} to v${version}]`);

      // Clear any pending build version since we've changed versions manually
      usePreviewStore.getState().setPendingBuildVersion(null);

      // Notify parent that version changed so it can update build status
      onVersionChange?.();
    } catch (err) {
      addLine(`[ERROR] Failed to change version: ${err}`);
    } finally {
      clearClaudeBusy(project.path);
    }
  }, [project.path, messages, activeVersion, addLine, setClaudeBusy, clearClaudeBusy]);

  // Memoize version calculations - used by header and message list
  const latestVersion = useMemo(() =>
    messages.reduce((max, m) => m.version && m.version > max ? m.version : max, 0),
    [messages]
  );
  const effectiveActiveVersion = activeVersion ?? latestVersion;

  return (
    <div
      ref={chatPanelRef}
      className="h-full flex flex-col bg-bg-secondary rounded-xl border border-border overflow-hidden animate-fade-in relative"
    >
      {/* Drag overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-accent/10 backdrop-blur-sm border-2 border-dashed border-accent rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-bg-secondary/95 rounded-xl px-6 py-4 shadow-xl border border-accent/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">Drop files to attach</p>
                <p className="text-xs text-text-muted">Files will be added to your message</p>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Header with framework, UI type and version */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        {/* Framework with label */}
        {project.frameworkId && (
          <>
            <span className="text-[10px] text-text-muted">Framework:</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary font-medium">
              {{
                'nih-plug': 'NIH-plug',
                'iplug2': 'iPlug2',
                'juce': 'JUCE',
              }[project.frameworkId] || project.frameworkId}
            </span>
          </>
        )}
        {/* UI type with label */}
        {project.uiFramework && (
          <>
            <span className="text-[10px] text-text-muted">UI:</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary font-medium">
              {{
                webview: 'WebView',
                egui: 'egui',
                native: 'Native',
                igraphics: 'IGraphics',
                juce: 'JUCE UI',
              }[project.uiFramework] || project.uiFramework}
            </span>
          </>
        )}
        {/* Context usage indicator */}
        {(tokenUsage || contextCleared) && (
          <div
            className="flex items-center gap-1.5"
            title={tokenUsage ? `${Math.round(tokenUsage.context_percent)}% of context used | ${tokenUsage.message_count} messages` : 'Context cleared - ready to send'}
          >
            <span className="text-[10px] text-text-muted">Context:</span>
            {contextCleared ? (
              <span className="text-[10px] text-success" title="Next message will include conversation summary">
                ✓ Cleared
              </span>
            ) : tokenUsage && (
              <>
                <span
                  className={`text-[10px] font-medium ${
                    tokenUsage.context_percent < 50
                      ? 'text-success'
                      : tokenUsage.context_percent < 80
                        ? 'text-warning'
                        : 'text-error'
                  }`}
                >
                  {tokenUsage.context_percent < 50
                    ? 'Good'
                    : tokenUsage.context_percent < 80
                      ? 'Fair'
                      : 'Low'}
                </span>
                {/* Clear context button - shows when context is Fair or Low */}
                {tokenUsage.context_percent >= 50 && !isLoading && (
                  <button
                    onClick={handleClearContext}
                    className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary hover:bg-warning/20 text-text-muted hover:text-warning transition-colors"
                    title="Clear context to free up space (chat history will be preserved)"
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {/* Spacer */}
        <div className="flex-1" />
        {/* Version info */}
        {effectiveActiveVersion > 0 && (
          <>
            <span className="text-[10px] text-text-muted">Active Version:</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-medium">
              v{effectiveActiveVersion}
            </span>
            {activeVersion && activeVersion < latestVersion && (
              <span className="text-[10px] text-warning">
                (latest: v{latestVersion})
              </span>
            )}
          </>
        )}
      </div>

      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 bg-chat-inset">
        {messages.length === 0 && !isLoading && isHistoryLoaded ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto rounded-xl bg-bg-tertiary flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-text-primary mb-2">Start building {project.name}</h3>
              <p className="text-sm text-text-muted">
                Describe what features you want to add and the code will be updated for you.
              </p>
              <div className="mt-4 text-xs text-text-muted">
                <p className="mb-1">Try something like:</p>
                <p className="text-accent">"Add a low-pass filter with resonance"</p>
                <p className="text-accent">"Make it a stereo delay with feedback"</p>
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/15 text-xs text-blue-400">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <span>First builds are slower. After that, they'll be much faster.</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-full flex flex-col justify-end space-y-4">
            {messages.map((message) => {
              // Use memoized effectiveActiveVersion (calculated once, not per-message)
              // Determine if this version is "inactive" (ahead of current active version)
              const isInactiveVersion = message.version != null &&
                effectiveActiveVersion > 0 &&
                message.version > effectiveActiveVersion;

              // Determine if this version is the currently active one
              const isCurrentVersion = message.version != null &&
                effectiveActiveVersion > 0 &&
                message.version === effectiveActiveVersion;

              // Can click to switch to this version if:
              // - Has a version and commitHash
              // - Not busy
              // - Not already the effective active version
              const canSwitchToVersion = message.version != null &&
                message.commitHash != null &&
                !isBusy &&
                message.version !== effectiveActiveVersion;

              // In conversational mode, render as phone-style chat bubbles
              if (chatStyle === 'conversational') {
                // User messages: blue bubble on the right
                if (message.role === 'user') {
                  return (
                    <div key={message.id} className={`flex justify-end animate-chat-bubble ${isInactiveVersion ? 'opacity-50' : ''}`}>
                      <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 bg-chat-user text-white">
                        <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
                        {/* Show attachments if any */}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="mt-2.5 bg-white/10 rounded-lg px-2.5 py-2">
                            {message.attachments.map((attachment, idx) => {
                              const isLibraryItem = attachment.path.startsWith('library://');
                              const isSkill = attachment.path.startsWith('library://skill');
                              return (
                                <div
                                  key={attachment.id}
                                  className={`flex items-center gap-2 ${idx > 0 ? 'mt-1.5 pt-1.5 border-t border-white/10' : ''}`}
                                >
                                  <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
                                    {isLibraryItem ? (
                                      isSkill ? (
                                        // Skill icon (lightbulb)
                                        <svg className="w-3.5 h-3.5 text-yellow-300/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                                        </svg>
                                      ) : (
                                        // Algorithm icon (code brackets)
                                        <svg className="w-3.5 h-3.5 text-blue-300/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                                        </svg>
                                      )
                                    ) : (
                                      // File attachment icon
                                      <svg className="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                      </svg>
                                    )}
                                  </div>
                                  <span className="text-xs text-white/80 truncate">{attachment.originalName}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="text-[10px] text-white/60 text-right mt-1">
                          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Assistant messages: split by \n\n into separate grey bubbles on the left
                const blocks = message.content.split(/\n\n+/).filter((block) => block.trim());
                const conversationalContent = (
                  <div className={`space-y-2 ${isInactiveVersion ? 'opacity-50' : ''}`}>
                    {blocks.map((block, index) => {
                      const isLastBlock = index === blocks.length - 1;
                      const trimmedBlock = block.trimEnd();
                      // Only strip trailing colon on the LAST block (nothing follows, so it's an artifact)
                      // Keep colon on non-last blocks (introduces content that follows)
                      // Also don't strip if the block itself is a list or code (the colon is part of content)
                      const startsWithListMarker = /^[\d\-\*\•]/.test(trimmedBlock);
                      const isCodeBlock = trimmedBlock.startsWith('```');
                      const shouldStripColon = isLastBlock &&
                        trimmedBlock.endsWith(':') &&
                        !startsWithListMarker &&
                        !isCodeBlock;
                      const displayBlock = shouldStripColon
                        ? trimmedBlock.slice(0, -1)
                        : block;
                      return (
                        <div key={index} className="flex justify-start animate-chat-bubble">
                          <div className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-bg-tertiary ${isCurrentVersion && isLastBlock ? 'ring-2 ring-accent/50' : ''}`}>
                            <div className="text-sm text-text-primary break-words prose prose-sm prose-invert max-w-none prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-code:bg-black/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-strong:text-text-primary">
                              <ReactMarkdown components={markdownComponents}>{displayBlock}</ReactMarkdown>
                            </div>
                            {/* Show timestamp on last bubble, version badge only if versioned */}
                            {isLastBlock && (
                              <div className="flex items-center justify-between mt-1 text-text-muted">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs">
                                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {message.version && (
                                    <span
                                      ref={isCurrentVersion ? versionBadgeRef : undefined}
                                      className={`text-xs px-1.5 py-0.5 rounded ${isCurrentVersion ? 'bg-violet-500 text-white' : 'bg-violet-500/20 text-violet-400'}`}
                                    >
                                      v{message.version}{isCurrentVersion ? ' (current)' : ''}
                                    </span>
                                  )}
                                </div>
                                {canSwitchToVersion && (
                                  <button
                                    onClick={() => handleVersionChange(message.version!, message.commitHash!)}
                                    className="text-xs hover:text-accent transition-colors flex items-center gap-1"
                                  >
                                    {isInactiveVersion ? (
                                      <>
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                        </svg>
                                        Restore to v{message.version}
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                        </svg>
                                        Revert to v{message.version}
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );

                // Version badge ref is now applied directly to the badge element inside conversationalContent
                return <div key={message.id}>{conversationalContent}</div>;
              }

              // Minimal mode: Version badge ref is passed directly to the ChatMessage component
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isInactive={isInactiveVersion}
                  isCurrentVersion={isCurrentVersion}
                  onVersionClick={
                    canSwitchToVersion
                      ? () => handleVersionChange(message.version!, message.commitHash!)
                      : undefined
                  }
                  versionBadgeRef={isCurrentVersion && message.version ? versionBadgeRef : undefined}
                />
              );
            })}
            {isLoading && (
              activeChatStyleRef.current === 'conversational' ? (
                // Conversational mode: Show each message as a separate bubble
                <>
                  {streamingContent
                    .split(/\n\n+/)
                    .filter((block) => block.trim())
                    .map((block, index) => (
                      <div key={index} className="flex justify-start animate-chat-bubble">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-bg-tertiary">
                          <div className="text-sm text-text-primary break-words prose prose-sm prose-invert max-w-none prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-code:bg-black/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-strong:text-text-primary">
                            <ReactMarkdown components={markdownComponents}>{block}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}
                  {/* Typing indicator */}
                  <div className="flex justify-start animate-chat-bubble">
                    <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-bg-tertiary">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-text-muted animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                // Minimal mode: Show thinking indicator
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-bg-tertiary">
                    <div className="flex items-center gap-3 text-text-muted">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-4 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-6 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-4 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '300ms' }} />
                        <div className="w-1.5 h-5 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '450ms' }} />
                      </div>
                      <span className="text-sm transition-all duration-300">{THINKING_PHRASES[thinkingPhraseIndex]}</span>
                      <span className="text-xs text-text-muted tabular-nums">
                        {elapsedSeconds < 60
                          ? `${elapsedSeconds}s`
                          : `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-2">
                      View progress in the output panel below
                    </p>
                  </div>
                </div>
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <ChatInput
        projectPath={project.path}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        disabled={isLoading}
        showInterrupt={isLoading}
        placeholder={messages.length === 0 ? 'Describe what you want to build...' : 'Ask for changes...'}
        droppedFiles={droppedFiles}
        onDroppedFilesProcessed={handleDroppedFilesProcessed}
      />
    </div>
  );
}
