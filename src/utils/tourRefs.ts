import type { RefObject } from 'react';

/**
 * Tour Ref Registry
 *
 * A simple registry for storing refs to DOM elements that the guided tour
 * needs to highlight. Components register their refs on mount and unregister
 * on unmount.
 *
 * Usage in components:
 * ```tsx
 * const buttonRef = useRef<HTMLButtonElement>(null);
 *
 * useEffect(() => {
 *   registerTourRef('my-button', buttonRef);
 *   return () => unregisterTourRef('my-button');
 * }, []);
 *
 * return <button ref={buttonRef}>Click me</button>;
 * ```
 */

// Store refs as the actual RefObject so we can access .current
const tourRefs = new Map<string, RefObject<HTMLElement>>();

// Listeners for ref changes (so GuidedTour can react to new refs)
type RefChangeListener = (id: string, ref: RefObject<HTMLElement> | null) => void;
const listeners = new Set<RefChangeListener>();

/**
 * Register a ref for a tour target element
 */
export function registerTourRef(id: string, ref: RefObject<HTMLElement>): void {
  tourRefs.set(id, ref);
  listeners.forEach(listener => listener(id, ref));
}

/**
 * Unregister a ref when component unmounts
 */
export function unregisterTourRef(id: string): void {
  tourRefs.delete(id);
  listeners.forEach(listener => listener(id, null));
}

/**
 * Get a registered ref by ID
 */
export function getTourRef(id: string): RefObject<HTMLElement> | undefined {
  return tourRefs.get(id);
}

/**
 * Get the current DOM element for a tour target
 */
export function getTourElement(id: string): HTMLElement | null {
  const ref = tourRefs.get(id);
  return ref?.current || null;
}

/**
 * Check if a ref is registered
 */
export function hasTourRef(id: string): boolean {
  return tourRefs.has(id);
}

/**
 * Subscribe to ref changes
 */
export function subscribeToRefChanges(listener: RefChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get all registered ref IDs (for debugging)
 */
export function getAllTourRefIds(): string[] {
  return Array.from(tourRefs.keys());
}
