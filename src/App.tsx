import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { useSettingsStore } from './stores/settingsStore';
import { useProjectStore } from './stores/projectStore';
import { useToastStore } from './stores/toastStore';
import { useChatStore } from './stores/chatStore';
import { useUpdateStore } from './stores/updateStore';
import { useNetworkStatusChange } from './hooks/useNetworkStatus';
import { WelcomeWizard } from './components/Setup/WelcomeWizard';
import { MainLayout } from './components/Layout/MainLayout';
import { GuidedTour } from './components/Tour';
import { LicenseAcceptanceModal } from './components/License';
import { applyTheme } from './components/Settings/ThemePicker';
import { CURRENT_LICENSE_VERSION } from './constants/license';
import { onPluginCrashed } from './api/preview';
import type { PrerequisiteStatus } from './types';

function App() {
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const acceptedLicenseVersion = useSettingsStore((state) => state.acceptedLicenseVersion);
  const aiProvider = useSettingsStore((state) => state.aiSettings.provider);
  const theme = useSettingsStore((state) => state.theme);
  const customColors = useSettingsStore((state) => state.customColors);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const { addToast } = useToastStore();
  const { setStatus, setUpdateInfo, setLastChecked } = useUpdateStore();
  const [hasCheckedPrereqs, setHasCheckedPrereqs] = useState(false);
  const [hasCheckedUpdates, setHasCheckedUpdates] = useState(false);

  // Network status change handlers
  const handleOnline = useCallback(() => {
    addToast({
      type: 'success',
      message: 'Back online',
    });
  }, [addToast]);

  const handleOffline = useCallback(() => {
    addToast({
      type: 'warning',
      message: 'No internet connection. AI requests will fail.',
      duration: 10000, // Show longer since this is important
    });
  }, [addToast]);

  // Monitor network status (checks every 60 seconds, plus instant browser events)
  useNetworkStatusChange(handleOnline, handleOffline);

  // Apply theme on startup and when it changes
  useEffect(() => {
    applyTheme(theme, customColors);
  }, [theme, customColors]);

  // Load projects on startup
  useEffect(() => {
    if (setupComplete) {
      loadProjects();
    }
  }, [setupComplete, loadProjects]);

  // Silent prerequisites check on startup
  useEffect(() => {
    if (!setupComplete || hasCheckedPrereqs) return;

    async function checkPrereqs() {
      try {
        const status = await invoke<PrerequisiteStatus>('check_prerequisites');

        if (aiProvider === 'claude') {
          const cliOk = status.claude_cli.status === 'installed';
          const authOk = status.claude_auth.status === 'installed';

          if (!cliOk) {
            addToast({
              type: 'warning',
              message: 'Claude CLI not found. Install it to use Claude features.',
            });
          } else if (!authOk) {
            addToast({
              type: 'warning',
              message: 'Claude CLI not authenticated. Run "claude login" in terminal.',
            });
          }
        } else {
          const codexOk = status.codex_cli.status === 'installed';
          if (!codexOk) {
            addToast({
              type: 'warning',
              message: 'Codex CLI not found. Install it to use Codex features.',
            });
          }
        }
      } catch (err) {
        console.error('Failed to check prerequisites:', err);
      }
      setHasCheckedPrereqs(true);
    }

    checkPrereqs();
  }, [setupComplete, hasCheckedPrereqs, addToast, aiProvider]);

  // Global plugin crash listener - always active so crashes are caught even when PreviewPanel is closed
  useEffect(() => {
    if (!setupComplete) return;

    const unlistenPromise = onPluginCrashed((message) => {
      const { addToast, clearErrorToasts } = useToastStore.getState();
      const { queueMessage } = useChatStore.getState();

      addToast({
        type: 'error',
        message: 'Plugin crashed during audio processing',
        action: {
          label: 'Fix It',
          onClick: () => {
            queueMessage(
              `The plugin crashed during audio processing with this error:\n\n\`\`\`\n${message}\n\`\`\`\n\nThis is likely a bug in the plugin code. Common causes include:\n- Division by zero\n- Memory allocation in the audio thread (use pre-allocated buffers instead)\n- Unwrap/panic calls that can fail\n- Array index out of bounds\n\nPlease review the \`process()\` function in \`src/lib.rs\` and fix any bugs that could cause a panic.`
            );
            clearErrorToasts();
          },
        },
      });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [setupComplete]);

  // Silent update check on startup
  useEffect(() => {
    if (!setupComplete || hasCheckedUpdates) return;

    async function checkForUpdates() {
      try {
        const update = await check();
        setLastChecked(new Date().toISOString());

        if (update) {
          setUpdateInfo({
            version: update.version,
            currentVersion: update.currentVersion,
            date: update.date ?? null,
            body: update.body ?? null,
          });
          setStatus('available');

          // Show toast notification with action to open settings
          addToast({
            type: 'info',
            message: `Update v${update.version} available`,
            action: {
              label: 'View',
              onClick: () => {
                window.dispatchEvent(
                  new CustomEvent('open-settings', { detail: 'updates' })
                );
              },
            },
          });
        } else {
          setStatus('not-available');
        }
      } catch (err) {
        // Silently fail on startup - don't show error toast
        console.warn('Silent update check failed:', err);
        setStatus('idle');
      }
      setHasCheckedUpdates(true);
    }

    // Delay update check slightly to not compete with other startup tasks
    const timer = setTimeout(checkForUpdates, 2000);
    return () => clearTimeout(timer);
  }, [setupComplete, hasCheckedUpdates, addToast, setStatus, setUpdateInfo, setLastChecked]);

  if (!setupComplete) {
    return (
      <>
        <WelcomeWizard />
        <GuidedTour />
      </>
    );
  }

  // Check if user needs to accept updated license terms
  // Defensive: treat invalid values (NaN, undefined) as 0 (unaccepted)
  const validLicenseVersion = typeof acceptedLicenseVersion === 'number' && !isNaN(acceptedLicenseVersion)
    ? acceptedLicenseVersion
    : 0;
  const needsLicenseAcceptance = validLicenseVersion < CURRENT_LICENSE_VERSION;

  return (
    <>
      {needsLicenseAcceptance ? (
        <LicenseAcceptanceModal isOpen={true} />
      ) : (
        <MainLayout />
      )}
      <GuidedTour />
    </>
  );
}

export default App;
