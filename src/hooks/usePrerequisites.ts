import { useState, useCallback } from 'react';
import { checkPrerequisites } from '../lib/tauri';
import type { PrerequisiteStatus } from '../types';

export function usePrerequisites() {
  const [status, setStatus] = useState<PrerequisiteStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await checkPrerequisites();
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check prerequisites');
    } finally {
      setLoading(false);
    }
  }, []);

  const allInstalled = status
    ? status.xcode_cli.status === 'installed' &&
      status.rust.status === 'installed' &&
      status.claude_cli.status === 'installed' &&
      status.claude_auth.status === 'installed'
    : false;

  return { status, loading, error, check, allInstalled };
}
