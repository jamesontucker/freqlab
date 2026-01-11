import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { useSettingsStore } from './stores/settingsStore';
import { useProjectStore } from './stores/projectStore';
import { useToastStore } from './stores/toastStore';
import { useUpdateStore } from './stores/updateStore';
import { useNetworkStatusChange } from './hooks/useNetworkStatus';
import { WelcomeWizard } from './components/Setup/WelcomeWizard';
import { MainLayout } from './components/Layout/MainLayout';
import { GuidedTour } from './components/Tour';
import { applyTheme } from './components/Settings/ThemePicker';
import type { PrerequisiteStatus } from './types';

function App() {
  const setupComplete = useSettingsStore((state) => state.setupComplete);
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
      message: 'No internet connection. Claude requests will fail.',
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

        // Check if Claude CLI or auth have issues
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
      } catch (err) {
        console.error('Failed to check prerequisites:', err);
      }
      setHasCheckedPrereqs(true);
    }

    checkPrereqs();
  }, [setupComplete, hasCheckedPrereqs, addToast]);

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

  return (
    <>
      <MainLayout />
      <GuidedTour />
    </>
  );
}

export default App;
