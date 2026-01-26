import { useState, useRef, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';
import { useTourStore, TOUR_STEPS } from '../../stores/tourStore';
import { useTipsStore } from '../../stores/tipsStore';
import { useDraftStore } from '../../stores/draftStore';
import { Tip } from '../Common/Tip';
import { GuidePicker } from './GuidePicker';

interface PendingAttachment {
  id: string;
  originalName: string;
  sourcePath: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
  // Library item fields (mutually exclusive with sourcePath for files)
  libraryType?: 'skill' | 'algorithm';
  libraryItemId?: string;  // The library item ID (for reference-based attachment)
}

// LibraryItem type used internally by GuidePicker
interface LibraryItem {
  type: 'skill' | 'algorithm';
  id: string;
  name: string;
}

interface ChatInputProps {
  projectPath: string; // Required for draft persistence
  onSend: (message: string, attachments?: PendingAttachment[]) => void;
  onInterrupt?: () => void;
  disabled?: boolean;
  showInterrupt?: boolean;
  placeholder?: string;
  droppedFiles?: string[]; // File paths dropped from outside (e.g., drag onto chat panel)
  onDroppedFilesProcessed?: () => void; // Called after dropped files are added to attachments
  // Guide picker is now built-in, no need for external library modal callbacks
}

// Helper to get MIME type from file extension
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    // Audio
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    // Code/Text
    rs: 'text/x-rust',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    js: 'text/javascript',
    json: 'application/json',
    toml: 'text/x-toml',
    md: 'text/markdown',
    txt: 'text/plain',
    // Other
    pdf: 'application/pdf',
    zip: 'application/zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Helper to check if a MIME type is an image
function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

// SVG icons for different file/attachment types
function SkillIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  );
}

function AlgorithmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  );
}

function AudioIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
    </svg>
  );
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}

function AttachmentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
    </svg>
  );
}

// Helper to get file icon component based on MIME type or library type
function getFileIcon(mimeType: string, libraryType?: 'skill' | 'algorithm'): JSX.Element {
  const className = "w-6 h-6 text-text-secondary";
  if (libraryType === 'skill') return <SkillIcon className={className} />;
  if (libraryType === 'algorithm') return <AlgorithmIcon className={className} />;
  if (mimeType.startsWith('audio/')) return <AudioIcon className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return <DocumentIcon className={className} />;
  if (mimeType === 'application/pdf') return <PdfIcon className={className} />;
  if (mimeType === 'application/zip') return <ArchiveIcon className={className} />;
  return <AttachmentIcon className={className} />;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({ projectPath, onSend, onInterrupt, disabled = false, showInterrupt = false, placeholder = 'Describe what you want to build...', droppedFiles, onDroppedFilesProcessed }: ChatInputProps) {
  // Draft store for persistence across project switches
  const getDraft = useDraftStore((s) => s.getDraft);
  const setDraftMessage = useDraftStore((s) => s.setMessage);
  const setDraftAttachments = useDraftStore((s) => s.setAttachments);
  const clearDraft = useDraftStore((s) => s.clearDraft);

  // Initialize from draft store
  const draft = getDraft(projectPath);
  const [value, setValue] = useState(draft.message);
  const [attachments, setAttachments] = useState<PendingAttachment[]>(draft.attachments);
  const [previewErrors, setPreviewErrors] = useState<Set<string>>(new Set());
  const [guidePickerOpen, setGuidePickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const guideButtonRef = useRef<HTMLButtonElement>(null);

  // Track previous project path to detect switches
  const prevProjectPathRef = useRef(projectPath);

  // Tour state
  const tourActive = useTourStore((s) => s.isActive);
  const currentTourStep = useTourStore((s) => s.currentStep);

  // Tips state
  const successfulBuildCount = useTipsStore((s) => s.successfulBuildCount);

  // Get tour step config for suggested message
  const tourStepConfig = TOUR_STEPS.find(s => s.id === currentTourStep);
  const tourSuggestedMessage = tourStepConfig?.suggestedMessage;

  // Check if we're in the send-chat-message tour step (block send until they click "Got it")
  const isChatTourStep = tourActive && currentTourStep === 'send-chat-message';
  // Check if we're in waiting step (block interrupt)
  const isWaitingTourStep = tourActive && currentTourStep === 'wait-for-response';

  // Steps where chat input should be completely blocked (after we've sent the initial message)
  const chatBlockedSteps = [
    'send-chat-message',
    'highlight-send-button',
    'wait-for-response',
    'show-version-message',
    'introduce-build',
    'introduce-auto-build',
    'click-build',
    'wait-for-build',
    'launch-plugin',
    'open-controls',
    'select-sample',
    'click-play',
    'show-publish',
    'show-settings',
    'complete',
  ];
  const isChatTourInputLocked = tourActive && currentTourStep !== null && chatBlockedSteps.includes(currentTourStep);

  // Auto-fill the input with suggested message when entering the chat tour step
  useEffect(() => {
    if (isChatTourStep && tourSuggestedMessage && !value) {
      setValue(tourSuggestedMessage);
    }
  }, [isChatTourStep, tourSuggestedMessage]);

  // Register tour refs
  useEffect(() => {
    registerTourRef('chat-input', textareaRef);
    registerTourRef('chat-send-button', sendButtonRef);
    registerTourRef('chat-input-container', inputContainerRef);
    return () => {
      unregisterTourRef('chat-input');
      unregisterTourRef('chat-send-button');
      unregisterTourRef('chat-input-container');
    };
  }, []);

  // Handle project switch - save current draft and restore new project's draft
  useEffect(() => {
    if (prevProjectPathRef.current !== projectPath) {
      // Save current state to old project's draft before switching
      // (This is a safety net - normally synced on every change)

      // Restore new project's draft
      const newDraft = getDraft(projectPath);
      setValue(newDraft.message);
      setAttachments(newDraft.attachments);
      setPreviewErrors(new Set());

      prevProjectPathRef.current = projectPath;
    }
  }, [projectPath, getDraft]);

  // Sync message changes to draft store (debounced effect)
  useEffect(() => {
    // Don't save tour-suggested messages as drafts
    if (isChatTourStep) return;

    setDraftMessage(projectPath, value);
  }, [value, projectPath, setDraftMessage, isChatTourStep]);

  // Sync attachment changes to draft store
  useEffect(() => {
    setDraftAttachments(projectPath, attachments);
  }, [attachments, projectPath, setDraftAttachments]);

  // Handle preview image load error - fall back to file icon
  const handlePreviewError = useCallback((id: string) => {
    setPreviewErrors(prev => new Set(prev).add(id));
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  // Handle files dropped from outside (e.g., drag onto chat panel)
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      const newAttachments: PendingAttachment[] = droppedFiles.map((filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
        const mimeType = getMimeType(fileName);
        const isImage = isImageMime(mimeType);

        return {
          id: crypto.randomUUID(),
          originalName: fileName,
          sourcePath: filePath,
          mimeType,
          size: 0,
          previewUrl: isImage ? convertFileSrc(filePath) : undefined,
        };
      });
      setAttachments(prev => [...prev, ...newAttachments]);
      onDroppedFilesProcessed?.();
    }
  }, [droppedFiles, onDroppedFilesProcessed]);

  // Handle guide selection from the GuidePicker
  // Guide items use reference-based attachment - content is NOT embedded
  // The item will be copied to .claude/commands/ when the message is sent
  const handleGuideSelect = useCallback((item: { type: 'skill' | 'algorithm'; id: string; name: string }) => {
    const newAttachment: PendingAttachment = {
      id: crypto.randomUUID(),
      originalName: `${item.name}.md`,
      sourcePath: '', // No file path for library items
      mimeType: 'text/markdown',
      size: 0, // Size unknown until copied
      libraryType: item.type,
      libraryItemId: item.id, // Store the ID for reference-based lookup
    };
    setAttachments(prev => [...prev, newAttachment]);
    // Don't close - let user attach multiple items
  }, []);

  // Remove a library item from attachments (called from GuidePicker)
  const handleGuideRemove = useCallback((item: { type: 'skill' | 'algorithm'; id: string }) => {
    setAttachments(prev => prev.filter(a => !(a.libraryType === item.type && a.libraryItemId === item.id)));
  }, []);

  const handleFileSelect = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        title: 'Select files to attach',
      });

      if (selected && Array.isArray(selected)) {
        const newAttachments: PendingAttachment[] = selected.map((filePath) => {
          // Handle both Unix (/) and Windows (\) path separators
          const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
          const mimeType = getMimeType(fileName);
          const isImage = isImageMime(mimeType);

          return {
            id: crypto.randomUUID(),
            originalName: fileName,
            sourcePath: filePath,
            mimeType,
            size: 0, // We'll get actual size from backend
            previewUrl: isImage ? convertFileSrc(filePath) : undefined,
          };
        });

        setAttachments(prev => [...prev, ...newAttachments]);
      }
    } catch (err) {
      console.error('Failed to select files:', err);
    }
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if ((trimmed || attachments.length > 0) && !disabled) {
      onSend(trimmed, attachments.length > 0 ? attachments : undefined);
      setValue('');
      setAttachments([]);
      setPreviewErrors(new Set());
      // Clear draft in store (local state clears trigger sync, but be explicit)
      clearDraft(projectPath);
    }
  }, [value, attachments, disabled, onSend, clearDraft, projectPath]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const canSend = (value.trim() || attachments.length > 0) && !disabled;

  return (
    <div ref={inputContainerRef} className="border-t border-border bg-bg-secondary p-3">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative group flex items-center gap-2 px-3 py-2 bg-bg-tertiary border border-border rounded-lg hover:border-accent/30 transition-colors"
            >
              {attachment.previewUrl && !previewErrors.has(attachment.id) ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.originalName}
                  className="w-10 h-10 object-cover rounded"
                  onError={() => handlePreviewError(attachment.id)}
                />
              ) : (
                <div className="w-10 h-10 flex items-center justify-center">
                  {getFileIcon(attachment.mimeType, attachment.libraryType)}
                </div>
              )}
              <div className="max-w-32">
                <div className="text-sm text-text-primary truncate">
                  {attachment.originalName}
                </div>
                <div className="text-xs text-text-muted">
                  {attachment.libraryType
                    ? (attachment.libraryType === 'skill' ? 'Guide' : 'Recipe')
                    : (attachment.size > 0 ? formatFileSize(attachment.size) : 'File')}
                </div>
              </div>
              <button
                onClick={() => handleRemoveAttachment(attachment.id)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-error text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Attachment button */}
        <button
          ref={attachButtonRef}
          onClick={handleFileSelect}
          disabled={disabled}
          className={`p-2.5 rounded-lg border transition-all duration-200 flex-shrink-0 flex items-center justify-center ${
            disabled
              ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
              : 'bg-bg-tertiary text-text-muted hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
          }`}
          title="Attach files"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>

        {/* Library button - attach guides/recipes or open resources */}
        <div className="relative">
          <button
            ref={guideButtonRef}
            onClick={() => setGuidePickerOpen(!guidePickerOpen)}
            disabled={disabled}
            className={`p-2.5 rounded-lg border transition-all duration-200 flex-shrink-0 flex items-center justify-center ${
              disabled
                ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
                : guidePickerOpen
                  ? 'bg-accent/20 text-accent border-accent/30'
                  : 'bg-bg-tertiary text-text-muted hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
            }`}
            title="Library"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </button>
          <GuidePicker
            isOpen={guidePickerOpen}
            onClose={() => setGuidePickerOpen(false)}
            onSelect={handleGuideSelect}
            onRemove={handleGuideRemove}
            anchorRef={guideButtonRef}
            attachedItems={attachments}
          />
        </div>

        {/* Tip for file attachments - shows while Claude is thinking after 3+ builds */}
        <Tip
          tipId="file-attachments"
          targetRef={attachButtonRef}
          message="Share files with chat! You can also drag and drop."
          position="top"
          showCondition={showInterrupt && !tourActive && successfulBuildCount >= 3}
          delayMs={2000}
          icon="lightbulb"
        />

        {/* Input container */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-bg-primary border border-border rounded-lg focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20 transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              // Prevent changes during tour chat steps
              if (isChatTourInputLocked) return;
              setValue(e.target.value);
            }}
            onKeyDown={(e) => {
              // Prevent submit during tour chat steps
              if (isChatTourInputLocked && e.key === 'Enter') {
                e.preventDefault();
                return;
              }
              handleKeyDown(e);
            }}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={isChatTourInputLocked}
            rows={1}
            className={`flex-1 bg-transparent text-text-primary placeholder-text-muted focus:outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed leading-normal text-sm py-1 ${isChatTourInputLocked ? 'cursor-default' : ''}`}
          />
          {/* Keyboard hint inside input */}
          <span className="text-[10px] text-text-muted hidden sm:block whitespace-nowrap">
            Enter to send
          </span>
        </div>

        {/* Send or Stop button */}
        {showInterrupt && onInterrupt ? (
          <button
            onClick={() => {
              // Block interrupt during tour waiting step
              if (isWaitingTourStep) return;
              onInterrupt();
            }}
            disabled={isWaitingTourStep}
            className={`p-2.5 rounded-lg border transition-all duration-200 flex-shrink-0 flex items-center justify-center ${
              isWaitingTourStep
                ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
                : 'bg-error/10 text-error border-error/30 hover:bg-error/20 hover:border-error/50'
            }`}
            title={isWaitingTourStep ? 'Please wait for the plugin to be created' : 'Stop generating'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h12v12H6z" />
            </svg>
          </button>
        ) : (
          <button
            ref={sendButtonRef}
            onClick={() => {
              // During send-chat-message step, block send (user needs to click "Got it" first)
              if (isChatTourStep) return;
              // During highlight-send-button step, allow send
              handleSubmit();
            }}
            disabled={!canSend || isChatTourStep}
            className={`p-2.5 rounded-lg border transition-all duration-200 flex-shrink-0 flex items-center justify-center ${
              !canSend || isChatTourStep
                ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
                : 'bg-accent hover:bg-accent-hover text-white border-accent hover:shadow-lg hover:shadow-accent/25'
            }`}
            title={isChatTourStep ? 'Type the suggested message first' : 'Send message'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export type { PendingAttachment, LibraryItem };
