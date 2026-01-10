import { useEffect } from 'react';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import * as previewApi from '../../api/preview';

// Helper to extract folder name from project path
function getFolderName(projectPath: string): string {
  return projectPath.split('/').pop() || '';
}

export function PluginViewerToggle() {
  // === REACTIVE STATE (with selectors) ===
  const loadedPlugin = usePreviewStore((s) => s.loadedPlugin);
  const pluginAvailable = usePreviewStore((s) => s.pluginAvailable);
  const currentPluginVersion = usePreviewStore((s) => s.currentPluginVersion);
  const webviewNeedsFreshBuild = usePreviewStore((s) => s.webviewNeedsFreshBuild);
  const pluginLoading = usePreviewStore((s) => s.pluginLoading);
  const engineInitialized = usePreviewStore((s) => s.engineInitialized);
  const editorOpen = usePreviewStore((s) => s.editorOpen);
  const activeProject = useProjectStore((s) => s.activeProject);
  const audioSettings = useSettingsStore((s) => s.audioSettings);

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
        // Non-webview plugins (egui/headless) can be re-enabled immediately
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

  // Poll editor status when plugin is active to detect manual window close
  useEffect(() => {
    if (loadedPlugin.status !== 'active' || !loadedPlugin.has_editor) return;

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
  }, [loadedPlugin.status, loadedPlugin.has_editor, setEditorOpen]);

  // Don't render if no active project
  if (!activeProject) {
    return null;
  }

  const isLoading = pluginLoading || loadedPlugin.status === 'loading' || loadedPlugin.status === 'reloading';
  const isActive = loadedPlugin.status === 'active';
  const isHeadless = activeProject.uiFramework === 'headless';
  const needsBuild = !pluginAvailable;
  const needsFreshBuild = webviewNeedsFreshBuild && activeProject.uiFramework === 'webview';
  // Engine initializes on-demand when toggle is clicked, so don't require it for enabling
  // Always allow disabling if plugin is active - only disable when trying to enable but can't
  // Headless plugins have no UI, so always disabled
  const isDisabled = isHeadless || isLoading ||
    (!isActive && needsFreshBuild && loadedPlugin.status === 'unloaded') ||
    (!isActive && needsBuild);

  // Show webview warning context when active
  const showWebviewWarning = isActive && activeProject.uiFramework === 'webview';

  // Determine status message and color - always show status
  const getStatusMessage = () => {
    // Headless plugins have no UI to view
    if (isHeadless) {
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
      return { text: 'Active', color: 'text-accent' };
    }
    if (needsBuild) {
      return { text: 'Rebuild required', color: 'text-amber-400' };
    }
    if (needsFreshBuild) {
      return { text: 'Build required', color: 'text-amber-400' };
    }
    // Available but not active
    return { text: 'Available', color: 'text-amber-400' };
  };

  const status = getStatusMessage();

  // Determine dot color: grey (no build/headless), orange (available but off), green (active)
  const getDotColor = () => {
    if (isHeadless) return 'bg-zinc-500'; // Grey - headless has no UI
    if (isLoading) return 'bg-amber-400 animate-pulse';
    if (loadedPlugin.status === 'error') return 'bg-error';
    if (isActive) return 'bg-accent'; // Green - active (checked before needsBuild)
    if (needsBuild) return 'bg-zinc-500'; // Grey - no build
    if (needsFreshBuild) return 'bg-amber-400'; // Orange - needs fresh build
    return 'bg-amber-400'; // Orange - available but off
  };

  // Build tooltip text
  const getTooltip = () => {
    if (isHeadless) {
      return 'Native/headless plugins have no UI to preview';
    }
    if (showWebviewWarning) {
      return 'Plugin Viewer - WebView plugins require rebuild after disabling';
    }
    if (needsBuild) {
      return 'Plugin Viewer - Rebuild required';
    }
    if (needsFreshBuild && !isActive) {
      return 'Plugin Viewer - Build required before enabling';
    }
    return isActive ? 'Disable plugin viewer' : 'Enable plugin viewer';
  };

  return (
    <div className="flex items-center gap-2">
      {/* Compact status indicator */}
      <span className={`text-xs font-medium ${status.color}`}>
        {status.text}
      </span>

      {/* Toggle button - styled to match Controls button */}
      <button
        onClick={handleToggle}
        disabled={isDisabled}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-accent text-white'
            : pluginAvailable && !isDisabled
              ? 'bg-amber-500/10 text-text-primary hover:bg-amber-500/20 hover:text-amber-400 border border-amber-500/30 hover:border-amber-500/50'
              : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border border-border hover:border-accent/30'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={getTooltip()}
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isActive ? 'bg-white' : getDotColor()
        }`} />
        {isActive ? 'Disable Plugin' : 'View Plugin'}
      </button>

      {/* Reopen button (when active and has editor, but editor is closed) */}
      {isActive && loadedPlugin.has_editor && !needsFreshBuild && !editorOpen && (
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
    </div>
  );
}
