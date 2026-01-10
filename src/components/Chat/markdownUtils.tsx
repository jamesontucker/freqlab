import type { ReactNode } from 'react';

// Render text with color swatches for hex codes
export function renderWithColorSwatches(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  const regex = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;

  while ((match = regex.exec(text)) !== null) {
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

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// Process children to find and replace hex codes in text nodes
export function processChildren(children: ReactNode): ReactNode {
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
export const markdownComponents = {
  code: ({ children, className }: { children?: ReactNode; className?: string }) => {
    if (className) {
      return <code className={className}>{children}</code>;
    }
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
  p: ({ children }: { children?: ReactNode }) => {
    return <p>{processChildren(children)}</p>;
  },
  li: ({ children }: { children?: ReactNode }) => {
    return <li>{processChildren(children)}</li>;
  },
};

// Remove trailing colon from message content (common artifact from Claude's responses)
export function cleanMessageContent(content: string): string {
  const trimmed = content.trimEnd();
  if (trimmed.endsWith(':')) {
    return trimmed.slice(0, -1);
  }
  return content;
}
