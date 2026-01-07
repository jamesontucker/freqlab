import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChatMessage } from './ChatMessage';
import { ChatInput, type PendingAttachment } from './ChatInput';
import { useProjectOutput } from '../../stores/outputStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import type { ChatMessage as ChatMessageType, ChatState, ProjectMeta, FileAttachment } from '../../types';

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
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingPhraseIndex, setThinkingPhraseIndex] = useState(0);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessageType[]>([]);
  const isSavingRef = useRef(false);
  const saveQueueRef = useRef<ChatMessageType[] | null>(null);
  const streamingContentRef = useRef('');
  const { addLine, setActive, clear } = useProjectOutput(project.path);
  const { pendingMessage, clearPendingMessage } = useChatStore();
  const { isClaudeBusy, setClaudeBusy, clearClaudeBusy, isProjectBusy } = useProjectBusyStore();

  // Check if THIS project is currently busy with Claude
  const isLoading = isClaudeBusy(project.path);
  // Check if project is busy with anything (Claude or building)
  const isBusy = isProjectBusy(project.path);

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
      // Claude just finished working on THIS project - reload to get the saved result
      // Don't reset state, just reload from disk (preserves smooth UX)
      loadHistory();
      return;
    }

    // Project changed or initial mount - reset and reload
    setMessages([]);
    setActiveVersion(null);
    setIsHistoryLoaded(false);
    setStreamingContent('');
    loadHistory();
  }, [project.path, loadHistory, isLoading]);

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
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

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

  const handleSend = useCallback(async (content: string, attachments?: PendingAttachment[]) => {
    // Use ref for current messages (avoids stale closure issues)
    const currentMessages = messagesRef.current;

    // Store attachments if any
    let storedAttachments: FileAttachment[] | undefined;
    if (attachments && attachments.length > 0) {
      try {
        const attachmentInputs: AttachmentInput[] = attachments.map((a) => ({
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
        addLine(`[Warning] Could not store ${attachments.length} attachment(s): ${err}`);
        addLine('Message will be sent without attachments.');
      }
    }

    // Add user message
    const userMessage: ChatMessageType = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      reverted: false,
      attachments: storedAttachments,
    };
    const messagesWithUser = [...currentMessages, userMessage];
    setMessages(messagesWithUser);
    messagesRef.current = messagesWithUser; // Keep ref in sync immediately
    setClaudeBusy(project.path);
    setStreamingContent('');
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

    // Clear and activate output panel
    clear();
    setActive(true);
    // Show appropriate message based on content
    if (content) {
      addLine(`> Processing: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    } else if (storedAttachments && storedAttachments.length > 0) {
      addLine(`> Processing ${storedAttachments.length} attachment(s)...`);
    }
    addLine('');

    // Listen for streaming events - filter by project path to prevent cross-talk
    const unlisten = await listen<ClaudeStreamEvent>('claude-stream', (event) => {
      const data = event.payload;
      // Only process events for THIS project
      if (data.project_path !== project.path) return;

      if (data.type === 'text' && data.content) {
        streamingContentRef.current += data.content + '\n';
        setStreamingContent(streamingContentRef.current);
        addLine(data.content);
      } else if (data.type === 'error' && data.message) {
        streamingContentRef.current += `\nError: ${data.message}`;
        setStreamingContent(streamingContentRef.current);
        addLine(`[ERROR] ${data.message}`);
      } else if (data.type === 'start') {
        addLine('[Started working...]');
      }
    });

    // Build message with file context for Claude
    let messageForClaude = content;
    if (storedAttachments && storedAttachments.length > 0) {
      const fileContext = storedAttachments
        .map((a) => `[Attached file: ${a.originalName} at ${a.path}]`)
        .join('\n');
      messageForClaude = `${fileContext}\n\n${content}`;
    }

    try {
      const response = await invoke<{ content: string; commit_hash?: string }>('send_to_claude', {
        projectPath: project.path,
        projectName: project.name,
        description: project.description,
        message: messageForClaude,
      });

      // Calculate next version number if this response has a commit (files were changed)
      // Version is based on count of previous commits that have version numbers
      const nextVersion = response.commit_hash
        ? messagesWithUser.filter((m) => m.version).length + 1
        : undefined;

      // Add assistant message with commit hash for version control
      const assistantMessage: ChatMessageType = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.content.trim() || streamingContentRef.current.trim(),
        timestamp: new Date().toISOString(),
        commitHash: response.commit_hash,
        version: nextVersion,
        reverted: false,
      };
      const messagesWithAssistant = [...messagesWithUser, assistantMessage];
      setMessages(messagesWithAssistant);
      messagesRef.current = messagesWithAssistant; // Keep ref in sync immediately

      // Save assistant message explicitly (in case component unmounts)
      await invoke('save_chat_history', {
        projectPath: project.path,
        messages: messagesWithAssistant,
      });

      // Update active version if this created a new version (AFTER saving messages)
      if (nextVersion) {
        setActiveVersion(nextVersion);
        // Persist activeVersion to disk so it survives reload
        await invoke('update_active_version', {
          projectPath: project.path,
          version: nextVersion,
        });
      }
    } catch (err) {
      // Add error message
      const errorMessage: ChatMessageType = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, something went wrong: ${err}`,
        timestamp: new Date().toISOString(),
        reverted: false,
      };
      const messagesWithError = [...messagesWithUser, errorMessage];
      setMessages(messagesWithError);
      messagesRef.current = messagesWithError; // Keep ref in sync immediately

      // Save error message explicitly
      await invoke('save_chat_history', {
        projectPath: project.path,
        messages: messagesWithError,
      }).catch((e) => console.error('Failed to save error message:', e));
    } finally {
      unlisten();
      // Only clear if we're still the active Claude session (prevents race with other projects)
      clearClaudeBusy(project.path);
      setStreamingContent('');
      streamingContentRef.current = '';
      setActive(false);
      addLine('');
      addLine('[Done]');
    }
  }, [project, addLine, setActive, clear, setClaudeBusy, clearClaudeBusy]);

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
      // Notify parent that version changed so it can update build status
      onVersionChange?.();
    } catch (err) {
      addLine(`[ERROR] Failed to change version: ${err}`);
    } finally {
      clearClaudeBusy(project.path);
    }
  }, [project.path, messages, activeVersion, addLine, setClaudeBusy, clearClaudeBusy]);

  // Calculate current effective version for header display
  const latestVersionForHeader = messages.reduce((max, m) =>
    m.version && m.version > max ? m.version : max, 0);
  const effectiveVersionForHeader = activeVersion ?? latestVersionForHeader;

  return (
    <div className="h-full flex flex-col bg-bg-secondary rounded-xl border border-border overflow-hidden">
      {/* Version header */}
      {effectiveVersionForHeader > 0 && (
        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <span className="text-xs text-text-muted">Current Version:</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-medium">
            v{effectiveVersionForHeader}
          </span>
          {activeVersion && activeVersion < latestVersionForHeader && (
            <span className="text-xs text-warning">
              (older version - latest is v{latestVersionForHeader})
            </span>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              // Get max version to treat as "current" when activeVersion is null
              const latestVersion = messages.reduce((max, m) =>
                m.version && m.version > max ? m.version : max, 0);
              const effectiveActiveVersion = activeVersion ?? latestVersion;

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
                />
              );
            })}
            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-bg-tertiary">
                  <div className="flex items-center gap-3 text-text-muted">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-4 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-6 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-4 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '300ms' }} />
                      <div className="w-1.5 h-5 rounded-full bg-accent animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: '450ms' }} />
                    </div>
                    <span className="text-sm transition-all duration-300">{THINKING_PHRASES[thinkingPhraseIndex]}</span>
                  </div>
                  <p className="text-xs text-text-muted mt-2">
                    View progress in the output panel below
                  </p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        placeholder={messages.length === 0 ? 'Describe what you want to build...' : 'Ask for changes...'}
      />
    </div>
  );
}
