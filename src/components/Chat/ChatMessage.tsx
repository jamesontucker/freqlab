import type { ChatMessage as ChatMessageType } from '../../types';
import { AttachmentPreview } from './AttachmentPreview';
import ReactMarkdown from 'react-markdown';

interface ChatMessageProps {
  message: ChatMessageType;
  isInactive?: boolean;  // Version is ahead of active version (greyed out)
  isCurrentVersion?: boolean;  // This is the currently active version
  onVersionClick?: () => void;  // Click to switch to this version
}

export function ChatMessage({ message, isInactive, isCurrentVersion, onVersionClick }: ChatMessageProps) {
  const isUser = message.role === 'user';
  // Use isInactive for styling, fall back to legacy reverted field
  const isGreyedOut = isInactive || message.reverted;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${isGreyedOut ? 'opacity-50' : ''}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-bg-tertiary text-text-primary rounded-bl-md'
        } ${isGreyedOut ? 'border border-dashed border-text-muted/30' : ''} ${isCurrentVersion ? 'ring-2 ring-accent/50' : ''}`}
      >
        {isGreyedOut && (
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Inactive version</span>
          </div>
        )}
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="text-sm prose prose-sm prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:my-2 prose-code:bg-black/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-pre:bg-black/30 prose-pre:p-3 prose-pre:rounded-lg prose-strong:text-text-primary prose-a:text-accent">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`mt-2 pt-2 border-t ${isUser ? 'border-white/20' : 'border-white/10'}`}>
            <div className="text-xs opacity-75 mb-2">Attachments:</div>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <AttachmentPreview key={attachment.id} attachment={attachment} />
              ))}
            </div>
          </div>
        )}
        {message.filesModified && message.filesModified.length > 0 && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <div className="text-xs opacity-75 mb-1">Modified files:</div>
            {message.filesModified.map((file, i) => (
              <div key={i} className="text-xs flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{file}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`flex items-center justify-between mt-1 ${isUser ? 'text-white/60' : 'text-text-muted'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xs">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {message.version && !isUser && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${isCurrentVersion ? 'bg-violet-500 text-white' : 'bg-violet-500/20 text-violet-400'}`}>
                v{message.version}{isCurrentVersion ? ' (current)' : ''}
              </span>
            )}
          </div>
          {onVersionClick && !isUser && message.version && (
            <button
              onClick={onVersionClick}
              className="text-xs hover:text-accent transition-colors flex items-center gap-1"
            >
              {isGreyedOut ? (
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
      </div>
    </div>
  );
}
