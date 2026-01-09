import { useState, useEffect, useRef, useCallback } from 'react';

interface NetworkStatus {
  isOnline: boolean;
  lastChecked: Date | null;
  isChecking: boolean;
}

/**
 * Hook to monitor network connectivity
 * - Uses browser's online/offline events for immediate feedback
 * - Periodically pings a reliable endpoint to verify actual connectivity
 * - Returns current online status
 */
export function useNetworkStatus(checkIntervalMs: number = 60000): NetworkStatus {
  // Start with null to indicate "checking" state, avoiding false positives from navigator.onLine
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const isMountedRef = useRef(true);

  // Actual connectivity check by fetching a lightweight endpoint
  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      // Use Cloudflare's 1.1.1.1 - returns quickly and is highly available
      await fetch('https://1.1.1.1/cdn-cgi/trace', {
        method: 'HEAD',
        mode: 'no-cors', // Avoid CORS issues
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return true; // If fetch completes without error, we're online
    } catch {
      clearTimeout(timeoutId); // Clear timeout on error too
      return false;
    }
  }, []);

  // Perform connectivity check and update state
  const performCheck = useCallback(async () => {
    const online = await checkConnectivity();

    // Only update state if still mounted
    if (isMountedRef.current) {
      setIsOnline(online);
      setLastChecked(new Date());
    }
    return online;
  }, [checkConnectivity]);

  useEffect(() => {
    isMountedRef.current = true;

    // Browser online/offline event handlers
    const handleOnline = () => {
      // Browser thinks we're online - verify with actual check
      performCheck();
    };

    const handleOffline = () => {
      if (isMountedRef.current) {
        setIsOnline(false);
        setLastChecked(new Date());
      }
    };

    // Listen to browser events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check on mount
    performCheck();

    // Periodic checks
    const intervalId = setInterval(performCheck, checkIntervalMs);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalId);
    };
  }, [performCheck, checkIntervalMs]);

  // Return true while checking (optimistic), actual value after first check
  return {
    isOnline: isOnline ?? true, // Assume online until proven otherwise
    lastChecked,
    isChecking: isOnline === null,
  };
}

/**
 * Hook that calls a callback when network status changes
 * Waits for initial check to complete before triggering callbacks
 */
export function useNetworkStatusChange(
  onOnline?: () => void,
  onOffline?: () => void,
  checkIntervalMs: number = 60000
) {
  const { isOnline, lastChecked, isChecking } = useNetworkStatus(checkIntervalMs);
  const previousOnlineRef = useRef<boolean | null>(null);
  const hasInitialCheckCompletedRef = useRef(false);

  useEffect(() => {
    // Wait for initial check to complete before triggering any callbacks
    // This prevents false toasts from inaccurate navigator.onLine
    if (isChecking) {
      return;
    }

    // First check completed
    if (!hasInitialCheckCompletedRef.current) {
      hasInitialCheckCompletedRef.current = true;
      previousOnlineRef.current = isOnline;

      // Show toast on startup ONLY if actually offline (verified by fetch)
      if (!isOnline && onOffline) {
        onOffline();
      }
      return;
    }

    // Only trigger callbacks when status actually changes
    if (previousOnlineRef.current !== isOnline) {
      if (isOnline && onOnline) {
        onOnline();
      } else if (!isOnline && onOffline) {
        onOffline();
      }
    }

    previousOnlineRef.current = isOnline;
  }, [isOnline, isChecking, onOnline, onOffline]);

  return { isOnline, lastChecked };
}
