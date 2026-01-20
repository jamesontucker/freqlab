/**
 * App-level window focus tracking
 *
 * This module tracks whether the app window is focused, independent of
 * React component lifecycle. This is used for notifications - we only
 * want to notify when the user is NOT looking at the app.
 *
 * Uses Tauri's native window events (more reliable than DOM events in WebView)
 * with DOM events as fallback.
 *
 * Initialize once at app startup (in main.tsx).
 */

import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

let isWindowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
let initialized = false;

/**
 * Initialize focus tracking. Call once at app startup.
 * Safe to call multiple times - will only initialize once.
 */
export async function initFocusTracker(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Try to get initial focus state from Tauri (more accurate than document.hasFocus)
  try {
    const tauriWindow = getCurrentWindow();
    isWindowFocused = await tauriWindow.isFocused();
  } catch {
    // Fallback to document.hasFocus() if Tauri API fails
    isWindowFocused = document.hasFocus();
  }

  // Listen to Tauri native window events (primary - most reliable)
  listen('tauri://focus', () => {
    isWindowFocused = true;
  });

  listen('tauri://blur', () => {
    isWindowFocused = false;
  });

  // Also listen to DOM events as fallback (handles edge cases)
  globalThis.window.addEventListener('focus', () => {
    isWindowFocused = true;
  });

  globalThis.window.addEventListener('blur', () => {
    isWindowFocused = false;
  });

  // Visibility change for minimize (Tauri events may not fire for this)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isWindowFocused = false;
    } else {
      // When becoming visible, check actual focus state
      getCurrentWindow().isFocused().then(focused => {
        isWindowFocused = focused;
      }).catch(() => {
        // Fallback to document.hasFocus
        isWindowFocused = document.hasFocus();
      });
    }
  });

  // No cleanup needed - this lives for the entire app lifetime
}

/**
 * Check if the app window is currently focused.
 * Returns true if user is looking at the app, false if they've switched away or minimized.
 */
export function isAppFocused(): boolean {
  return isWindowFocused;
}
