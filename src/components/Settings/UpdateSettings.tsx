import { useState, useEffect } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { useUpdateStore } from '../../stores/updateStore';
import { useToastStore } from '../../stores/toastStore';

export function UpdateSettings() {
  const {
    status,
    updateInfo,
    downloadProgress,
    error,
    lastChecked,
    setStatus,
    setUpdateInfo,
    setDownloadProgress,
    setError,
    setLastChecked,
    reset,
  } = useUpdateStore();
  const { addToast } = useToastStore();
  const [updateHandle, setUpdateHandle] = useState<Update | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('0.1.0');

  // Get current version on mount
  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  const handleCheckForUpdates = async () => {
    reset();
    setStatus('checking');

    try {
      const update = await check();
      setLastChecked(new Date().toISOString());

      if (update) {
        setUpdateInfo({
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date,
          body: update.body,
        });
        setStatus('available');
        setUpdateHandle(update);
      } else {
        setStatus('not-available');
        setUpdateInfo(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
      setError(errorMessage);
      console.error('Update check failed:', err);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateHandle) return;

    setStatus('downloading');
    setDownloadProgress(0);

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await updateHandle.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setDownloadProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === 'Finished') {
          setDownloadProgress(100);
        }
      });

      setStatus('ready');
      addToast({
        type: 'success',
        message: 'Update downloaded. Restarting...',
      });

      // Short delay before relaunch for UX
      setTimeout(async () => {
        await relaunch();
      }, 1000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to download update';
      setError(errorMessage);
      addToast({
        type: 'error',
        message: 'Update failed: ' + errorMessage,
      });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">Updates</h3>
        <p className="text-sm text-text-muted">
          Check for and install freqlab updates.
        </p>
      </div>

      {/* Current Version */}
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-text-primary">Current Version</h4>
            <p className="text-2xl font-bold text-accent mt-1">v{currentVersion}</p>
          </div>
          <button
            onClick={handleCheckForUpdates}
            disabled={status === 'checking' || status === 'downloading'}
            className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {status === 'checking' ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Checking...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Check for Updates
              </>
            )}
          </button>
        </div>
        {lastChecked && (
          <p className="text-xs text-text-muted mt-2">
            Last checked: {formatDate(lastChecked)}
          </p>
        )}
      </div>

      {/* Update Available */}
      {status === 'available' && updateInfo && (
        <div className="border border-accent/30 bg-accent/5 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-text-primary">Update Available</h4>
                <span className="px-2 py-0.5 text-xs font-medium bg-accent/20 text-accent rounded-full">
                  v{updateInfo.version}
                </span>
              </div>
              {updateInfo.date && (
                <p className="text-sm text-text-muted mt-1">
                  Released {formatDate(updateInfo.date)}
                </p>
              )}
            </div>
            <button
              onClick={handleDownloadAndInstall}
              className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Update Now
            </button>
          </div>

          {/* Release Notes */}
          {updateInfo.body && (
            <div className="mt-4 pt-4 border-t border-border">
              <h5 className="text-sm font-medium text-text-secondary mb-2">Release Notes</h5>
              <div className="text-sm text-text-muted max-h-48 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans">{updateInfo.body}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Downloading */}
      {status === 'downloading' && (
        <div className="border border-border rounded-lg p-4">
          <h4 className="font-medium text-text-primary mb-3">Downloading Update...</h4>
          <div className="w-full bg-bg-tertiary rounded-full h-2 overflow-hidden">
            <div
              className="bg-accent h-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <p className="text-sm text-text-muted mt-2">{downloadProgress}% complete</p>
        </div>
      )}

      {/* Ready to Install */}
      {status === 'ready' && (
        <div className="border border-success/30 bg-success/5 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <h4 className="font-medium text-text-primary">Update Ready</h4>
              <p className="text-sm text-text-muted">Restarting to apply update...</p>
            </div>
          </div>
        </div>
      )}

      {/* No Update */}
      {status === 'not-available' && (
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <h4 className="font-medium text-text-primary">You're up to date</h4>
              <p className="text-sm text-text-muted">freqlab v{currentVersion} is the latest version.</p>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="border border-error/30 bg-error/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-error flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="font-medium text-error">Update Check Failed</h4>
              <p className="text-sm text-text-muted mt-1">{error}</p>
              <button
                onClick={handleCheckForUpdates}
                className="text-sm text-accent hover:text-accent-hover mt-2"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-bg-tertiary rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-text-muted flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-text-muted">
            <p>
              Updates are checked automatically on app launch. You can also check manually using the button above.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
