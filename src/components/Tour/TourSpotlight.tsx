import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TourSpotlightProps {
  targetElement: HTMLElement | null;
  padding?: number;
  borderRadius?: number;
}

/**
 * TourSpotlight creates a dark overlay with a transparent cutout
 * around the target element, drawing attention to it.
 * The dark overlay stays solid while only the glow ring fades between targets.
 */
export function TourSpotlight({
  targetElement,
  padding = 8,
  borderRadius = 8,
}: TourSpotlightProps) {
  const [displayRect, setDisplayRect] = useState<SpotlightRect | null>(null);
  const [glowVisible, setGlowVisible] = useState(false);
  const [canUpdateRect, setCanUpdateRect] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prevTargetRef = useRef<HTMLElement | null>(null);

  // Helper to check if element has valid bounds (is actually visible in DOM)
  const hasValidBounds = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    // Just check that element has actual size
    return rect.width > 0 && rect.height > 0;
  };

  // Handle target element changes - fade glow ring only
  useEffect(() => {
    // Track if target changed during transition - we need to handle this
    const targetChanged = targetElement !== prevTargetRef.current;

    // If transitioning but target hasn't changed, skip
    // But if target changed, we need to restart the transition
    if (isTransitioning && !targetChanged) return;

    if (targetElement && !prevTargetRef.current) {
      // Target appeared - wait for valid bounds, then calculate position and fade in
      const trySetRect = () => {
        if (!hasValidBounds(targetElement)) return false;
        const bounds = targetElement.getBoundingClientRect();
        setDisplayRect({
          top: bounds.top - padding,
          left: bounds.left - padding,
          width: bounds.width + padding * 2,
          height: bounds.height + padding * 2,
        });
        return true;
      };

      if (trySetRect()) {
        prevTargetRef.current = targetElement;
        setCanUpdateRect(true);
        setTimeout(() => setGlowVisible(true), 100);
      } else {
        // Retry until element has valid bounds
        const retryInterval = setInterval(() => {
          if (trySetRect()) {
            clearInterval(retryInterval);
            prevTargetRef.current = targetElement;
            setCanUpdateRect(true);
            setTimeout(() => setGlowVisible(true), 100);
          }
        }, 50);
        setTimeout(() => clearInterval(retryInterval), 2000);
      }
    } else if (!targetElement && prevTargetRef.current) {
      // Target disappeared - fade out, keep position, then clear
      setIsTransitioning(true);
      setGlowVisible(false);
      setCanUpdateRect(false);
      const timer = setTimeout(() => {
        setDisplayRect(null);
        prevTargetRef.current = null;
        setIsTransitioning(false);
      }, 200);
      return () => clearTimeout(timer);
    } else if (targetElement && targetElement !== prevTargetRef.current) {
      // Target changed to different element - lock, fade out, clear, wait for valid bounds, fade in
      setIsTransitioning(true);
      setGlowVisible(false);
      setCanUpdateRect(false);

      const timer = setTimeout(() => {
        // Clear rect so nothing renders during position search
        setDisplayRect(null);

        const trySetRect = () => {
          if (!hasValidBounds(targetElement)) return false;
          const bounds = targetElement.getBoundingClientRect();
          setDisplayRect({
            top: bounds.top - padding,
            left: bounds.left - padding,
            width: bounds.width + padding * 2,
            height: bounds.height + padding * 2,
          });
          return true;
        };

        if (trySetRect()) {
          prevTargetRef.current = targetElement;
          setCanUpdateRect(true);
          setTimeout(() => {
            setGlowVisible(true);
            setTimeout(() => setIsTransitioning(false), 200);
          }, 100);
        } else {
          // Retry until element has valid bounds
          const retryInterval = setInterval(() => {
            if (trySetRect()) {
              clearInterval(retryInterval);
              prevTargetRef.current = targetElement;
              setCanUpdateRect(true);
              setTimeout(() => {
                setGlowVisible(true);
                setTimeout(() => setIsTransitioning(false), 200);
              }, 100);
            }
          }, 50);
          setTimeout(() => {
            clearInterval(retryInterval);
            setIsTransitioning(false);
          }, 2000);
        }
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [targetElement, padding, isTransitioning]);

  // Update on scroll, resize, and DOM mutations
  // Keep listeners active even during transitions so we catch position changes
  useEffect(() => {
    if (!targetElement) return;

    const handleUpdate = () => {
      // Only apply updates when allowed
      if (canUpdateRect && hasValidBounds(targetElement)) {
        const bounds = targetElement.getBoundingClientRect();
        setDisplayRect({
          top: bounds.top - padding,
          left: bounds.left - padding,
          width: bounds.width + padding * 2,
          height: bounds.height + padding * 2,
        });
      }
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    // Use ResizeObserver to catch element size changes
    const resizeObserver = new ResizeObserver(handleUpdate);
    resizeObserver.observe(targetElement);

    // Use MutationObserver to catch DOM changes that might shift the target
    // (e.g., chat messages being added above the target)
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
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearInterval(intervalId);
    };
  }, [targetElement, padding, canUpdateRect]);

  // Always render the dark overlay - it stays solid throughout the tour
  return createPortal(
    <div className="fixed inset-0 z-[9998] pointer-events-none">
      {/* Dark overlay - always at full opacity */}
      <svg
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="spotlight-mask">
            {/* White = visible (overlay), Black = transparent (cutout) */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {displayRect && (
              <rect
                x={displayRect.left}
                y={displayRect.top}
                width={displayRect.width}
                height={displayRect.height}
                rx={borderRadius}
                ry={borderRadius}
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Dark overlay with cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.6)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Glow ring around cutout - fades between targets */}
      {displayRect && (
        <div
          className="absolute"
          style={{
            top: displayRect.top - 2,
            left: displayRect.left - 2,
            width: displayRect.width + 4,
            height: displayRect.height + 4,
            borderRadius: borderRadius + 2,
            boxShadow: '0 0 0 2px rgba(45, 168, 110, 0.5), 0 0 20px rgba(45, 168, 110, 0.3)',
            opacity: glowVisible ? 1 : 0,
            transition: 'opacity 200ms ease-out',
          }}
        />
      )}
    </div>,
    document.body
  );
}
