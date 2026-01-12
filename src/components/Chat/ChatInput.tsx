import { useState, useRef, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';
import { useTourStore, TOUR_STEPS } from '../../stores/tourStore';

interface PendingAttachment {
  id: string;
  originalName: string;
  sourcePath: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: PendingAttachment[]) => void;
  onInterrupt?: () => void;
  disabled?: boolean;
  showInterrupt?: boolean;
  placeholder?: string;
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

// Helper to get file icon based on MIME type
function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return '📄';
  if (mimeType === 'application/pdf') return '📕';
  if (mimeType === 'application/zip') return '📦';
  return '📎';
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({ onSend, onInterrupt, disabled = false, showInterrupt = false, placeholder = 'Describe what you want to build...' }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [previewErrors, setPreviewErrors] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Tour state
  const tourActive = useTourStore((s) => s.isActive);
  const currentTourStep = useTourStore((s) => s.currentStep);

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

  // Handle preview image load error - fall back to file icon
  const handlePreviewError = (id: string) => {
    setPreviewErrors(prev => new Set(prev).add(id));
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleFileSelect = async () => {
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
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if ((trimmed || attachments.length > 0) && !disabled) {
      onSend(trimmed, attachments.length > 0 ? attachments : undefined);
      setValue('');
      setAttachments([]);
      setPreviewErrors(new Set());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

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
                <span className="text-xl w-10 h-10 flex items-center justify-center">
                  {getFileIcon(attachment.mimeType)}
                </span>
              )}
              <div className="max-w-32">
                <div className="text-sm text-text-primary truncate">
                  {attachment.originalName}
                </div>
                <div className="text-xs text-text-muted">
                  {attachment.size > 0 ? formatFileSize(attachment.size) : 'File'}
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

export type { PendingAttachment };
