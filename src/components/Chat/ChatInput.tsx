import { useState, useRef, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

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

  return (
    <div className="border-t border-border bg-bg-secondary p-4">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative group flex items-center gap-2 px-3 py-2 bg-bg-tertiary border border-border rounded-lg"
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
          className="h-11 w-11 bg-bg-tertiary hover:bg-bg-elevated disabled:opacity-50 text-text-muted hover:text-text-primary border border-border rounded-xl transition-all duration-200 disabled:cursor-not-allowed flex-shrink-0 flex items-center justify-center"
          title="Attach files"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none disabled:opacity-50 disabled:cursor-not-allowed leading-normal"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className="h-11 w-11 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary text-white disabled:text-text-muted rounded-xl transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none flex-shrink-0 flex items-center justify-center"
        >
          {disabled ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          )}
        </button>
      </div>
      <div className="flex items-center justify-between mt-2 px-1">
        <p className="text-xs text-text-muted">
          Press Enter to send, Shift+Enter for new line
        </p>
        {showInterrupt && onInterrupt && (
          <button
            onClick={onInterrupt}
            className="text-xs text-error/70 hover:text-error transition-all duration-200 animate-fade-in"
          >
            Interrupt Claude
          </button>
        )}
      </div>
    </div>
  );
}

export type { PendingAttachment };
