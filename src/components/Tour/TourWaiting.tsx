import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TourWaitingProps {
  message: string;
  onSkip: () => void;
}

/**
 * Waiting indicator shown during async operations (chat response, build).
 */
export function TourWaiting({ message, onSkip }: TourWaitingProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Fade in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return createPortal(
    <div
      className="fixed bottom-8 left-1/2 z-[10000]"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(8px)',
        transition: 'opacity 200ms ease-out, transform 200ms ease-out',
      }}
    >
      <div className="flex items-center gap-3 px-5 py-3 bg-bg-elevated rounded-full shadow-2xl border border-border">
        {/* Spinner */}
        <div className="w-5 h-5 relative">
          <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
          <div className="absolute inset-0 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>

        {/* Message */}
        <span className="text-sm text-text-secondary">{message}</span>

        {/* Skip button */}
        <button
          onClick={onSkip}
          className="ml-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          Skip tour
        </button>
      </div>
    </div>,
    document.body
  );
}
