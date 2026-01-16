import { useEffect, useRef } from 'react';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTourStore } from '../../stores/tourStore';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';
import * as previewApi from '../../api/preview';
import { Tip } from '../Common/Tip';

// Helper to extract folder name from project path
function getFolderName(projectPath: string): string {
  return projectPath.split('/').pop() || '';
}

export function PluginViewerToggle() {
  // Tour ref
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  // Register tour ref
  useEffect(() => {
    registerTourRef('launch-plugin-toggle', toggleButtonRef);
    return () => unregisterTourRef('launch-plugin-toggle');
  }, []);

  // === REACTIVE STATE (with selectors) ===
  const loadedPlugin = usePreviewStore((s) => s.loadedPlugin);
  const pluginAvailable = usePreviewStore((s) => s.pluginAvailable);
  const currentPluginVersion = usePreviewStore((s) => s.currentPluginVersion);
  const webviewNeedsFreshBuild = usePreviewStore((s) => s.webviewNeedsFreshBuild);
  const pluginLoading = usePreviewStore((s) => s.pluginLoading);
  const engineInitialized = usePreviewStore((s) => s.engineInitialized);
  const editorOpen = usePreviewStore((s) => s.editorOpen);
  const activeProject = useProjectStore((s) => s.activeProject);
  const buildInProgress = useProjectBusyStore((s) => s.buildingPath !== null);
  const audioSettings = useSettingsStore((s) => s.audioSettings);

  // Tour state
  const tourActive = useTourStore((s) => s.isActive);
  const currentTourStep = useTourStore((s) => s.currentStep);
  // Block during tour except during launch-plugin step when plugin is NOT active
  // Once plugin is active during launch-plugin step, block to prevent accidental double-click toggle
  const isActive = loadedPlugin.status === 'active';
  const launchPluginBlocked = tourActive && (currentTourStep !== 'launch-plugin' || isActive);

  // === STABLE ACTION REFERENCES ===
  const setPluginLoading = usePreviewStore.getState().setPluginLoading;
  const setWebviewNeedsFreshBuild = usePreviewStore.getState().setWebviewNeedsFreshBuild;
  const setLoadedPlugin = usePreviewStore.getState().setLoadedPlugin;
  const setPluginAvailable = usePreviewStore.getState().setPluginAvailable;
  const setEngineInitialized = usePreviewStore.getState().setEngineInitialized;
  const setEditorOpen = usePreviewStore.getState().setEditorOpen;

  const handleToggle = async () => {
    if (!activeProject) return;

    if (loadedPlugin.status === 'active') {
      // Disable: close editor and unload plugin
      try {
        await previewApi.pluginCloseEditor();
        setEditorOpen(false);
        await previewApi.pluginUnload();
        await previewApi.setPluginIsInstrument(false);
        setLoadedPlugin({ status: 'unloaded' });
        // WebView plugins require a fresh build before re-enabling (class name conflicts)
        // Non-webview plugins (egui/native) can be re-enabled immediately
        if (activeProject.uiFramework === 'webview') {
          setWebviewNeedsFreshBuild(true);
        } else {
          // Ensure plugin shows as available for non-webview plugins
          setPluginAvailable(true);
        }
      } catch (err) {
        console.error('Failed to disable plugin viewer:', err);
      }
    } else if (loadedPlugin.status === 'unloaded' && pluginAvailable) {
      // Enable: load plugin and open editor
      setPluginLoading(true);
      try {
        // Initialize engine on-demand if not already initialized
        if (!engineInitialized) {
          await previewApi.initAudioEngine(
            audioSettings.outputDevice,
            audioSettings.sampleRate,
            audioSettings.bufferSize
          );
          setEngineInitialized(true);
        }

        const folderName = getFolderName(activeProject.path);
        await previewApi.pluginLoadForProject(folderName, currentPluginVersion);
        await previewApi.setPluginIsInstrument(activeProject.template === 'instrument');

        // Get the actual plugin state after loading and update store
        const state = await previewApi.pluginGetState();
        setLoadedPlugin(state);

        // Open editor if plugin loaded successfully and has one
        if (state.status === 'active') {
          if (!webviewNeedsFreshBuild || activeProject.uiFramework !== 'webview') {
            const hasEditor = await previewApi.pluginHasEditor();
            if (hasEditor) {
              console.log('[PluginViewerToggle] Opening editor...');
              await previewApi.pluginOpenEditor();
              console.log('[PluginViewerToggle] Editor opened, setting editorOpen=true');
              setEditorOpen(true);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load plugin:', err);
        setLoadedPlugin({ status: 'error', message: String(err) });
      } finally {
        setPluginLoading(false);
      }
    }
  };

  const handleOpenEditor = async () => {
    try {
      await previewApi.pluginOpenEditor();
      setEditorOpen(true);
    } catch (err) {
      console.error('Failed to open editor:', err);
    }
  };

  // Derive has_editor safely for dependency tracking
  const pluginHasEditor = loadedPlugin.status === 'active' && loadedPlugin.has_editor;

  // Poll editor status when plugin is active to detect manual window close
  useEffect(() => {
    if (loadedPlugin.status !== 'active' || !pluginHasEditor) return;

    console.log('[PluginViewerToggle] Starting editor status polling');
    const intervalId = setInterval(async () => {
      try {
        const isOpen = await previewApi.pluginIsEditorOpen();
        const current = usePreviewStore.getState().editorOpen;
        if (current !== isOpen) {
          console.log(`[PluginViewerToggle] Editor status changed: ${current} -> ${isOpen}`);
          setEditorOpen(isOpen);
        }
      } catch {
        // Ignore errors - plugin may have been unloaded
      }
    }, 250); // Poll every 250ms

    return () => {
      console.log('[PluginViewerToggle] Stopping editor status polling');
      clearInterval(intervalId);
    };
  }, [loadedPlugin.status, pluginHasEditor, setEditorOpen]);

  // Don't render if no active project
  if (!activeProject) {
    return null;
  }

  const isLoading = pluginLoading || loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading';
  const isNative = activeProject.uiFramework === 'native';
  const needsBuild = !pluginAvailable;
  const needsFreshBuild = webviewNeedsFreshBuild && activeProject.uiFramework === 'webview';
  // Engine initializes on-demand when toggle is clicked, so don't require it for enabling
  // Always allow disabling if plugin is active - only disable when trying to enable but can't
  // Native plugins have no UI, so always disabled
  // Disable during builds to prevent version conflicts
  // Disable during tour unless it's the launch-plugin step
  const isDisabled = isNative || isLoading || buildInProgress || launchPluginBlocked ||
    (!isActive && needsFreshBuild && loadedPlugin.status === 'unloaded') ||
    (!isActive && needsBuild);

  // Show webview warning context when active
  const showWebviewWarning = isActive && activeProject.uiFramework === 'webview';

  // Determine status message and color - always show status
  const getStatusMessage = () => {
    // Native plugins have no UI to view
    if (isNative) {
      return { text: 'Unavailable for native plugins', color: 'text-text-muted' };
    }
    if (isLoading) {
      return {
        text: loadedPlugin.status === 'reloading' ? 'Reloading...' : 'Loading...',
        color: 'text-amber-400',
      };
    }
    if (loadedPlugin.status === 'error') {
      return { text: 'Error', color: 'text-error' };
    }
    // Check active BEFORE needsBuild - if plugin is active, it's working
    if (isActive) {
      // Show building indicator if active but build in progress
      if (buildInProgress) {
        return { text: 'Active (building...)', color: 'text-accent' };
      }
      return { text: 'Active', color: 'text-accent' };
    }
    if (needsBuild) {
      return { text: 'Rebuild required', color: 'text-amber-400' };
    }
    if (needsFreshBuild) {
      return { text: 'Build required', color: 'text-amber-400' };
    }
    // Available but not active - show if build in progress
    if (buildInProgress) {
      return { text: 'Building...', color: 'text-amber-400' };
    }
    // Available but not active
    return { text: 'Available', color: 'text-amber-400' };
  };

  const status = getStatusMessage();

  // Determine dot color: grey (no build/native), orange (available but off), green (active)
  const getDotColor = () => {
    if (isNative) return 'bg-zinc-500'; // Grey - native has no UI
    if (isLoading) return 'bg-amber-400 animate-pulse';
    if (loadedPlugin.status === 'error') return 'bg-error';
    if (isActive) return 'bg-accent'; // Green - active (checked before needsBuild)
    if (needsBuild) return 'bg-zinc-500'; // Grey - no build
    if (needsFreshBuild) return 'bg-amber-400'; // Orange - needs fresh build
    return 'bg-amber-400'; // Orange - available but off
  };

  // Build tooltip text
  const getTooltip = () => {
    if (launchPluginBlocked) {
      return 'Complete the current step first';
    }
    if (isNative) {
      return 'Native plugins have no UI to preview';
    }
    if (buildInProgress) {
      return 'Wait for build to complete';
    }
    if (showWebviewWarning) {
      return 'WebView plugins require rebuild after disabling';
    }
    if (needsBuild) {
      return 'Rebuild required to launch plugin';
    }
    if (needsFreshBuild && !isActive) {
      return 'Build required before launching';
    }
    return isActive ? 'Disable plugin' : 'Launch plugin preview';
  };

  return (
    <div className="flex items-center gap-2">
      {/* Webview warning + status indicator */}
      <div className="flex items-center gap-2">
        {showWebviewWarning && (
          <>
            <span className="text-xs text-amber-400 flex items-center gap-1">
              Rebuild required if disabled
              <span className="relative group">
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-medium cursor-help">
                  ?
                </span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-xs text-text-primary bg-bg-elevated border border-border rounded-md shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50">
                  WebView plugins require a new build after disabling
                </span>
              </span>
            </span>
            <div className="w-px h-3 bg-border" />
          </>
        )}
        <span className={`text-xs font-medium ${status.color}`}>
          {status.text}
        </span>
      </div>

      {/* Toggle button - styled to match Controls button */}
      <button
        ref={toggleButtonRef}
        onClick={handleToggle}
        disabled={isDisabled}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-accent text-white'
            : pluginAvailable && !isDisabled
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/50 hover:bg-amber-500/25 hover:border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)] animate-pulse'
              : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border border-border hover:border-accent/30'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={getTooltip()}
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isActive ? 'bg-white' : getDotColor()
        }`} />
        {isActive ? 'Disable Plugin' : 'Launch Plugin'}
      </button>

      {/* Reopen button (when active and has editor, but editor is closed) */}
      {isActive && pluginHasEditor && !needsFreshBuild && !editorOpen && (
        <button
          onClick={handleOpenEditor}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border border-border hover:border-accent/30 transition-all duration-200"
          title="Reopen Plugin Window"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Reopen
        </button>
      )}

      {/* First-time launch plugin tip */}
      <Tip
        tipId="launch-plugin"
        targetRef={toggleButtonRef}
        message="Launch and test with the controls panel! If the plugin sounds awful or UI is broken, just ask chat to fix it."
        position="bottom"
        showCondition={pluginAvailable && !isActive && !isLoading && !tourActive && !isNative && !buildInProgress}
        delayMs={1500}
        icon="sparkle"
      />
    </div>
  );
}
