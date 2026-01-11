import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type TourStepConfig, getActionableStepNumber, getActionableStepCount } from '../../stores/tourStore';

type Position = 'top' | 'bottom' | 'left' | 'right';

interface TourStepProps {
  step: TourStepConfig;
  targetElement: HTMLElement | null;
  onSkip: () => void;
  onNext?: () => void; // For manual advance steps
}

/**
 * TourStep displays a tooltip with instructions for the current tour step.
 * Positioned relative to the target element with an arrow pointing to it.
 */
export function TourStep({
  step,
  targetElement,
  onSkip,
  onNext,
}: TourStepProps) {
  const [displayCoords, setDisplayCoords] = useState<{ top: number; left: number } | null>(null);
  const [actualPosition, setActualPosition] = useState<Position>(step.position || 'right');
  const [isVisible, setIsVisible] = useState(false);
  const [canUpdatePosition, setCanUpdatePosition] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false); // Blocks ALL updates during step transitions
  const [displayedStep, setDisplayedStep] = useState(step); // Content shown - only updates when hidden
  const prevStepRef = useRef<string | null>(null);
  const pendingCoordsRef = useRef({ top: 0, left: 0 });
  const pendingPositionRef = useRef<Position>(step.position || 'right');

  // Helper to check if element has valid bounds (is actually visible in DOM)
  const hasValidBounds = useCallback((el: HTMLElement | null): boolean => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    // Just check that element has actual size - position checks were too strict
    // and caused issues with elements near screen edges
    return rect.width > 0 && rect.height > 0;
  }, []);

  // Use displayedStep for UI content so it doesn't change during fade-out
  const stepNumber = getActionableStepNumber(displayedStep.id);
  const totalSteps = getActionableStepCount();

  // Calculate position based on target element (stores in pending refs)
  const calculatePosition = useCallback(() => {
    if (!targetElement || !hasValidBounds(targetElement)) return;

    const rect = targetElement.getBoundingClientRect();
    const tipWidth = 320;
    const tipHeight = 140; // Approximate
    const gap = 16;
    const padding = 16; // Viewport padding

    // Extra offset for specific steps (e.g., chat input needs more space)
    const extraTopOffset = step.id === 'send-chat-message' || step.id === 'highlight-send-button' ? 30 : 0;

    let top = 0;
    let left = 0;
    let position = step.position || 'right';

    // Calculate initial position
    switch (position) {
      case 'top':
        top = rect.top - tipHeight - gap - extraTopOffset;
        left = rect.left + rect.width / 2 - tipWidth / 2;
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tipWidth / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tipHeight / 2;
        left = rect.left - tipWidth - gap;
        break;
      case 'right':
      default:
        top = rect.top + rect.height / 2 - tipHeight / 2;
        left = rect.right + gap;
        break;
    }

    // Check if position needs adjustment to stay in viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Flip horizontally if needed
    if (position === 'right' && left + tipWidth > viewportWidth - padding) {
      position = 'left';
      left = rect.left - tipWidth - gap;
    } else if (position === 'left' && left < padding) {
      position = 'right';
      left = rect.right + gap;
    }

    // Flip vertically if needed
    if (position === 'bottom' && top + tipHeight > viewportHeight - padding) {
      position = 'top';
      top = rect.top - tipHeight - gap;
    } else if (position === 'top' && top < padding) {
      position = 'bottom';
      top = rect.bottom + gap;
    }

    // Clamp to viewport bounds
    left = Math.max(padding, Math.min(left, viewportWidth - tipWidth - padding));
    top = Math.max(padding, Math.min(top, viewportHeight - tipHeight - padding));

    // Store in refs
    pendingCoordsRef.current = { top, left };
    pendingPositionRef.current = position;

    // Only update display if allowed (not during transition)
    if (canUpdatePosition) {
      setDisplayCoords({ top, left });
      setActualPosition(position);
    }
  }, [targetElement, step.position, step.id, canUpdatePosition]);

  // Handle fade in/out transitions between steps
  useEffect(() => {
    if (step.id !== prevStepRef.current) {
      // Step changed - lock everything and start fade out
      setIsTransitioning(true);
      setCanUpdatePosition(false);
      setIsVisible(false);

      // After fade out completes (200ms), update content and find new position
      const fadeOutTimer = setTimeout(() => {
        // Now safe to update the displayed content
        setDisplayedStep(step);
        // Clear coords so nothing renders during position search
        setDisplayCoords(null);
        prevStepRef.current = step.id;

        // Function to calculate and set position
        const trySetPosition = () => {
          if (!targetElement || !hasValidBounds(targetElement)) {
            return false;
          }

          const rect = targetElement.getBoundingClientRect();
          const tipWidth = 320;
          const tipHeight = 140;
          const gap = 16;
          const padding = 16;
          const extraTopOffset = step.id === 'send-chat-message' || step.id === 'highlight-send-button' ? 30 : 0;

          let top = 0;
          let left = 0;
          let position = step.position || 'right';

          switch (position) {
            case 'top':
              top = rect.top - tipHeight - gap - extraTopOffset;
              left = rect.left + rect.width / 2 - tipWidth / 2;
              break;
            case 'bottom':
              top = rect.bottom + gap;
              left = rect.left + rect.width / 2 - tipWidth / 2;
              break;
            case 'left':
              top = rect.top + rect.height / 2 - tipHeight / 2;
              left = rect.left - tipWidth - gap;
              break;
            case 'right':
            default:
              top = rect.top + rect.height / 2 - tipHeight / 2;
              left = rect.right + gap;
              break;
          }

          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;

          if (position === 'right' && left + tipWidth > viewportWidth - padding) {
            position = 'left';
            left = rect.left - tipWidth - gap;
          } else if (position === 'left' && left < padding) {
            position = 'right';
            left = rect.right + gap;
          }

          if (position === 'bottom' && top + tipHeight > viewportHeight - padding) {
            position = 'top';
            top = rect.top - tipHeight - gap;
          } else if (position === 'top' && top < padding) {
            position = 'bottom';
            top = rect.bottom + gap;
          }

          left = Math.max(padding, Math.min(left, viewportWidth - tipWidth - padding));
          top = Math.max(padding, Math.min(top, viewportHeight - tipHeight - padding));

          setDisplayCoords({ top, left });
          setActualPosition(position);
          return true;
        };

        // Try to set position, if successful fade in
        if (trySetPosition()) {
          setTimeout(() => {
            setIsVisible(true);
            setTimeout(() => {
              setCanUpdatePosition(true);
              setIsTransitioning(false);
            }, 200);
          }, 50);
        } else {
          // Element not ready - wait and retry
          const retryInterval = setInterval(() => {
            if (trySetPosition()) {
              clearInterval(retryInterval);
              setTimeout(() => {
                setIsVisible(true);
                setTimeout(() => {
                  setCanUpdatePosition(true);
                  setIsTransitioning(false);
                }, 200);
              }, 50);
            }
          }, 50);
          // Clean up retry after reasonable time
          setTimeout(() => {
            clearInterval(retryInterval);
            setIsTransitioning(false); // Unlock even if we couldn't find element
          }, 2000);
        }
      }, 200);

      return () => clearTimeout(fadeOutTimer);
    } else if (!isVisible && !isTransitioning && targetElement && canUpdatePosition && hasValidBounds(targetElement)) {
      // Initial mount or target just became available with valid bounds (not during transition)
      calculatePosition();
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    }
  }, [step.id, step.position, targetElement, isVisible, isTransitioning, canUpdatePosition, calculatePosition, hasValidBounds]);

  // Update on scroll, resize, and DOM mutations (only when allowed)
  useEffect(() => {
    if (!targetElement || !canUpdatePosition) return;

    const handleUpdate = () => {
      requestAnimationFrame(calculatePosition);
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    // Use MutationObserver to catch DOM changes that might shift the target
    const mutationObserver = new MutationObserver(handleUpdate);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    // Periodic update as fallback for edge cases
    const intervalId = setInterval(handleUpdate, 500);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
      mutationObserver.disconnect();
      clearInterval(intervalId);
    };
  }, [targetElement, canUpdatePosition, calculatePosition]);

  // Extra position refresh for steps where content may still be settling
  // (e.g., after chat messages are added and chat scrolls)
  useEffect(() => {
    const stepsNeedingRefresh = ['show-version-message'];
    if (!stepsNeedingRefresh.includes(step.id) || !isVisible || !targetElement) return;

    // Refresh position multiple times over 1 second to catch settling
    const refreshTimes = [100, 300, 500, 800];
    const timers = refreshTimes.map(delay =>
      setTimeout(() => {
        if (canUpdatePosition) {
          calculatePosition();
        }
      }, delay)
    );

    return () => timers.forEach(clearTimeout);
  }, [step.id, isVisible, targetElement, canUpdatePosition, calculatePosition]);

  // Handle target element disappearing - fade out and clear coords
  useEffect(() => {
    if (!targetElement && displayCoords) {
      // Target disappeared - fade out first, then clear coords
      setIsVisible(false);
      setCanUpdatePosition(false);
      const timer = setTimeout(() => {
        setDisplayCoords(null);
      }, 200); // Wait for fade out
      return () => clearTimeout(timer);
    }
  }, [targetElement, displayCoords]);

  // Don't render if waiting type (handled by GuidedTour)
  if (step.type === 'waiting') {
    return null;
  }

  // Don't render spotlight tooltips if no valid position yet
  if (step.type === 'spotlight' && !displayCoords) {
    return null;
  }

  // TypeScript guard - displayCoords must be set for spotlight steps after above check
  // For popup steps, we need coords too
  if (!displayCoords) {
    return null;
  }

  const getArrowClasses = () => {
    const base = 'absolute w-0 h-0 border-solid';
    switch (actualPosition) {
      case 'top':
        return `${base} bottom-[-8px] left-1/2 -translate-x-1/2 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-bg-elevated`;
      case 'bottom':
        return `${base} top-[-8px] left-1/2 -translate-x-1/2 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-bg-elevated`;
      case 'left':
        return `${base} right-[-8px] top-1/2 -translate-y-1/2 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[8px] border-l-bg-elevated`;
      case 'right':
      default:
        return `${base} left-[-8px] top-1/2 -translate-y-1/2 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[8px] border-r-bg-elevated`;
    }
  };

  return createPortal(
    <div
      className="fixed z-[10000]"
      style={{
        top: displayCoords.top,
        left: displayCoords.left,
        width: 320,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(4px)',
        transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      {/* Arrow */}
      <div className={getArrowClasses()} />

      {/* Content card */}
      <div className="bg-bg-elevated rounded-xl shadow-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-tertiary/50">
          {stepNumber > 0 ? (
            <span className="text-xs font-medium text-text-muted">
              Step {stepNumber} of {totalSteps}
            </span>
          ) : (
            <span className="text-xs font-medium text-accent">Guided Tour</span>
          )}
          <button
            onClick={onSkip}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Skip tour
          </button>
        </div>

        {/* Body - uses displayedStep so content doesn't change during fade-out */}
        <div className="px-4 py-3">
          <p className="text-sm text-text-primary leading-relaxed">
            {displayedStep.message}
          </p>

          {/* Suggested value hint */}
          {displayedStep.suggestedValue && (
            <div className="mt-2 px-2.5 py-1.5 bg-accent/10 rounded-md border border-accent/20">
              <p className="text-xs text-accent font-mono">{displayedStep.suggestedValue}</p>
            </div>
          )}

          {/* Suggested message hint */}
          {displayedStep.suggestedMessage && (
            <div className="mt-2 px-2.5 py-1.5 bg-accent/10 rounded-md border border-accent/20">
              <p className="text-xs text-text-secondary italic">"{displayedStep.suggestedMessage}"</p>
            </div>
          )}

          {/* Manual advance button */}
          {displayedStep.advanceOn === 'manual' && onNext && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={onNext}
                className="px-3 py-1.5 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
              >
                Got it
              </button>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {stepNumber > 0 && (
          <div className="h-1 bg-bg-tertiary">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(stepNumber / totalSteps) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
