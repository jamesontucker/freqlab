import { useState, useCallback } from 'react';
import { checkPrerequisites, checkDiskSpace, checkPermissions } from '../lib/tauri';
import type { PrerequisiteStatus, DiskSpaceInfo, PermissionStatus } from '../types';
import { useSettingsStore } from '../stores/settingsStore';

export function usePrerequisites() {
  const [status, setStatus] = useState<PrerequisiteStatus | null>(null);
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiProvider = useSettingsStore((s) => s.aiSettings.provider);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch prerequisites, disk space, and permissions in parallel
      const [prereqResult, spaceResult, permResult] = await Promise.all([
        checkPrerequisites(),
        checkDiskSpace(),
        checkPermissions(),
      ]);
      setStatus(prereqResult);
      setDiskSpace(spaceResult);
      setPermissions(permResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check prerequisites');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPermissions = useCallback(async () => {
    try {
      const permResult = await checkPermissions();
      setPermissions(permResult);
    } catch {
      // Ignore errors on permission refresh
    }
  }, []);

  const allInstalled = status
    ? status.xcode_cli.status === 'installed' &&
      status.rust.status === 'installed' &&
      (aiProvider === 'claude'
        ? status.claude_cli.status === 'installed' && status.claude_auth.status === 'installed'
        : status.codex_cli.status === 'installed')
    : false;

  const hasSufficientSpace = diskSpace?.sufficient ?? false;

  return {
    status,
    diskSpace,
    permissions,
    loading,
    error,
    check,
    refreshPermissions,
    allInstalled,
    hasSufficientSpace,
  };
}
