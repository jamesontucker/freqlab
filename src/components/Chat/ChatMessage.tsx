import type { ChatMessage as ChatMessageType } from '../../types';
import { AttachmentPreview } from './AttachmentPreview';
import ReactMarkdown from 'react-markdown';
import type { ReactNode } from 'react';

interface ChatMessageProps {
  message: ChatMessageType;
  isInactive?: boolean;  // Version is ahead of active version (greyed out)
  isCurrentVersion?: boolean;  // This is the currently active version
  onVersionClick?: () => void;  // Click to switch to this version
}

// Remove trailing colon from message content (common artifact from Claude's responses)
function cleanMessageContent(content: string): string {
  const trimmed = content.trimEnd();
  if (trimmed.endsWith(':')) {
    return trimmed.slice(0, -1);
  }
  return content;
}

// Render text with color swatches for hex codes
function renderWithColorSwatches(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  const regex = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the color swatch with hex code (no code styling, just plain text)
    const hexColor = match[0];
    parts.push(
      <span key={match.index} className="inline-flex items-center gap-1">
        <span
          className="inline-block w-5 h-3.5 rounded-sm border border-white/20"
          style={{ backgroundColor: hexColor }}
        />
        <span className="text-sm font-mono">{hexColor}</span>
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// Process children to find and replace hex codes in text nodes
function processChildren(children: ReactNode): ReactNode {
  const regex = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
  if (typeof children === 'string') {
    if (regex.test(children)) {
      return renderWithColorSwatches(children);
    }
    return children;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      const testRegex = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
      if (typeof child === 'string' && testRegex.test(child)) {
        return <span key={i}>{renderWithColorSwatches(child)}</span>;
      }
      return child;
    });
  }
  return children;
}

// Custom components for ReactMarkdown to render color swatches
const markdownComponents = {
  // Handle inline code that might contain hex colors
  code: ({ children, className }: { children?: ReactNode; className?: string }) => {
    // If it's a code block (has language class), render normally
    if (className) {
      return <code className={className}>{children}</code>;
    }
    // For inline code, check for hex colors
    const text = String(children);
    const regex = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
    if (regex.test(text)) {
      const hexColor = text.match(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/)?.[0];
      if (hexColor) {
        // If it's just a hex code, show swatch + plain text (no code styling)
        return (
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block w-5 h-3.5 rounded-sm border border-white/20"
              style={{ backgroundColor: hexColor }}
            />
            <span className="text-sm font-mono">{hexColor}</span>
          </span>
        );
      }
    }
    return <code className="bg-black/20 px-1 py-0.5 rounded text-sm">{children}</code>;
  },
  // Handle paragraph text that might contain hex colors
  p: ({ children }: { children?: ReactNode }) => {
    return <p>{processChildren(children)}</p>;
  },
  // Handle list items
  li: ({ children }: { children?: ReactNode }) => {
    return <li>{processChildren(children)}</li>;
  },
};

export function ChatMessage({ message, isInactive, isCurrentVersion, onVersionClick }: ChatMessageProps) {
  const isUser = message.role === 'user';
  // Use isInactive for styling, fall back to legacy reverted field
  const isGreyedOut = isInactive || message.reverted;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${isGreyedOut ? 'opacity-50' : ''}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
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
            <ReactMarkdown components={markdownComponents}>{cleanMessageContent(message.content)}</ReactMarkdown>
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
