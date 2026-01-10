import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: string | null | undefined;
  children: ReactNode;
  position?: TooltipPosition;
  /** Delay in ms before showing tooltip (default: 400) */
  delay?: number;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  delay = 400,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);

  const showTooltip = useCallback(() => {
    if (!content || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case 'right':
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
    }

    setCoords({ top, left });
    setIsVisible(true);
  }, [content, position]);

  const handleMouseEnter = useCallback(() => {
    if (!content) return;
    timeoutRef.current = window.setTimeout(showTooltip, delay);
  }, [content, delay, showTooltip]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getTransformClasses = () => {
    switch (position) {
      case 'top':
        return '-translate-x-1/2 -translate-y-full';
      case 'bottom':
        return '-translate-x-1/2';
      case 'left':
        return '-translate-x-full -translate-y-1/2';
      case 'right':
        return '-translate-y-1/2';
      default:
        return '';
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {isVisible && content && createPortal(
        <div
          className={`fixed z-[9999] px-2.5 py-1.5 text-xs text-text-primary bg-bg-elevated border border-border rounded-md shadow-lg whitespace-nowrap pointer-events-none ${getTransformClasses()}`}
          style={{
            top: coords.top,
            left: coords.left,
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
