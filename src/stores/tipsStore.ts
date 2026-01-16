import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Tip IDs - add new ones here as we create more tips
export type TipId =
  | 'collapse-sidebar'      // Hint to collapse sidebar for more space
  | 'preview-controls'      // Hint about preview panel controls
  | 'version-revert'        // Hint about reverting to previous versions
  | 'auto-build'            // Hint about auto-build feature (unused - covered by tour)
  | 'auto-build-hint'       // Hint to try auto-build after many manual builds
  | 'plugin-editor'         // Hint about opening plugin editor
  | 'file-attachments'      // Hint about attaching files and drag-drop
  | 'launch-plugin';        // Hint to launch and test plugin for first time

interface TipsState {
  // Set of tip IDs that have been shown
  shownTips: string[];

  // Track successful builds for triggering tips
  successfulBuildCount: number;

  // Track if user has ever enabled auto-build
  hasEverEnabledAutoBuild: boolean;

  // Check if a tip has been shown
  hasTipBeenShown: (tipId: TipId) => boolean;

  // Mark a tip as shown
  markTipShown: (tipId: TipId) => void;

  // Increment build count
  incrementBuildCount: () => void;

  // Mark that user has used auto-build
  markAutoBuildUsed: () => void;

  // Reset all tips (for dev settings)
  resetAllTips: () => void;
}

export const useTipsStore = create<TipsState>()(
  persist(
    (set, get) => ({
      shownTips: [],
      successfulBuildCount: 0,
      hasEverEnabledAutoBuild: false,

      hasTipBeenShown: (tipId) => {
        return get().shownTips.includes(tipId);
      },

      markTipShown: (tipId) => {
        const current = get().shownTips;
        if (!current.includes(tipId)) {
          set({ shownTips: [...current, tipId] });
        }
      },

      incrementBuildCount: () => {
        set({ successfulBuildCount: get().successfulBuildCount + 1 });
      },

      markAutoBuildUsed: () => {
        set({ hasEverEnabledAutoBuild: true });
      },

      resetAllTips: () => {
        set({ shownTips: [], successfulBuildCount: 0, hasEverEnabledAutoBuild: false });
      },
    }),
    {
      name: 'freqlab-tips',
    }
  )
);
