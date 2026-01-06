import { useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { FileAttachment } from '../../types';

interface AttachmentPreviewProps {
  attachment: FileAttachment;
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

export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const isImage = isImageMime(attachment.mimeType);
  const imageUrl = isImage && !imageError ? convertFileSrc(attachment.path) : undefined;

  // Handle Escape key to close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && expanded) {
      setExpanded(false);
    }
  }, [expanded]);

  useEffect(() => {
    if (expanded) {
      // Lock body scroll when modal is open
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = originalOverflow;
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [expanded, handleKeyDown]);

  // Handle image load error
  const handleImageError = () => {
    setImageError(true);
  };

  if (isImage && imageUrl) {
    return (
      <>
        <button
          onClick={() => setExpanded(true)}
          className="group relative rounded-lg overflow-hidden border border-border hover:border-accent transition-colors"
        >
          <img
            src={imageUrl}
            alt={attachment.originalName}
            className="max-w-48 max-h-32 object-cover"
            onError={handleImageError}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <svg
              className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"
              />
            </svg>
          </div>
          <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
            <p className="text-xs text-white truncate">{attachment.originalName}</p>
          </div>
        </button>

        {/* Expanded modal */}
        {expanded && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
            onClick={() => setExpanded(false)}
          >
            <div className="relative max-w-full max-h-full">
              <img
                src={imageUrl}
                alt={attachment.originalName}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
                onError={handleImageError}
              />
              <button
                onClick={() => setExpanded(false)}
                className="absolute top-4 right-4 w-10 h-10 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="absolute bottom-4 left-4 right-4 text-center">
                <p className="text-white text-sm bg-black/50 px-3 py-1 rounded-full inline-block">
                  {attachment.originalName}
                  {attachment.size > 0 && ` (${formatFileSize(attachment.size)})`}
                </p>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Non-image file
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border border-border rounded-lg max-w-48">
      <span className="text-xl flex-shrink-0">{getFileIcon(attachment.mimeType)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary truncate" title={attachment.originalName}>
          {attachment.originalName}
        </p>
        {attachment.size > 0 && (
          <p className="text-xs text-text-muted">{formatFileSize(attachment.size)}</p>
        )}
      </div>
    </div>
  );
}
