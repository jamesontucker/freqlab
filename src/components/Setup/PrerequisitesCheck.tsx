import { useEffect, useState, useRef, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePrerequisites } from '../../hooks/usePrerequisites';
import { Spinner } from '../Common/Spinner';
import {
  installXcode,
  installRust,
  installCmake,
  installClaudeCli,
  startClaudeAuth,
  requestAccessibilityPermission,
  primeAdminPrivileges,
} from '../../lib/tauri';
import { IS_MAC, IS_WINDOWS, getPlatformDefaults } from '../../lib/platform';
import type { CheckResult, DiskSpaceInfo, PermissionStatus } from '../../types';

// ============================================================================
// Types
// ============================================================================

interface InstallEvent {
  type: 'start' | 'output' | 'done' | 'error' | 'action_required';
  step?: string;
  line?: string;
  success?: boolean;
  message?: string;
  action?: string;
}

type InstallStep = 'xcode' | 'rust' | 'cmake' | 'claude_cli' | 'claude_auth';
type InstallStage = 'preparing' | 'downloading' | 'installing' | 'finishing' | 'done' | 'error';

interface InstallState {
  stage: InstallStage;
  friendlyMessage: string;
  technicalOutput: string[];
  actionRequired: string | null;
  errorMessage: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

// Parse technical output to determine user-friendly stage
function parseStageFromOutput(step: InstallStep, output: string[], currentStage: InstallStage): { stage: InstallStage; message: string } {
  const lastLines = output.slice(-5).join(' ').toLowerCase();

  if (step === 'xcode') {
    if (lastLines.includes('already installed')) {
      return { stage: 'done', message: 'Already installed!' };
    }
    if (lastLines.includes('finding') || lastLines.includes('preparing')) {
      return { stage: 'preparing', message: 'Preparing installation...' };
    }
    if (lastLines.includes('downloading') || lastLines.includes('found:')) {
      return { stage: 'downloading', message: 'Downloading (this may take 5-10 minutes)...' };
    }
    if (lastLines.includes('installing') || lastLines.includes('softwareupdate')) {
      return { stage: 'installing', message: 'Installing...' };
    }
    if (lastLines.includes('complete') || lastLines.includes('success')) {
      return { stage: 'finishing', message: 'Finishing up...' };
    }
  }

  if (step === 'rust') {
    if (lastLines.includes('already installed')) {
      return { stage: 'done', message: 'Already installed!' };
    }
    if (lastLines.includes('downloading installer') || lastLines.includes('downloading rustup')) {
      return { stage: 'downloading', message: 'Downloading Rust...' };
    }
    if (lastLines.includes('downloading component') || lastLines.includes('installing component')) {
      return { stage: 'installing', message: 'Installing components (1-2 minutes)...' };
    }
    if (lastLines.includes('installed') || lastLines.includes('configured')) {
      return { stage: 'finishing', message: 'Finishing up...' };
    }
  }

  if (step === 'cmake') {
    if (lastLines.includes('already installed')) {
      return { stage: 'done', message: 'Already installed!' };
    }
    if (lastLines.includes('downloading')) {
      return { stage: 'downloading', message: 'Downloading CMake...' };
    }
    if (lastLines.includes('extracting') || lastLines.includes('installing')) {
      return { stage: 'installing', message: 'Installing CMake...' };
    }
    if (lastLines.includes('success') || lastLines.includes('complete')) {
      return { stage: 'finishing', message: 'Finishing up...' };
    }
  }

  if (step === 'claude_cli') {
    if (lastLines.includes('already installed')) {
      return { stage: 'done', message: 'Already installed!' };
    }
    if (lastLines.includes('downloading')) {
      return { stage: 'downloading', message: 'Downloading Claude Code...' };
    }
    if (lastLines.includes('installing') || lastLines.includes('extracting')) {
      return { stage: 'installing', message: 'Installing...' };
    }
    if (lastLines.includes('success') || lastLines.includes('complete')) {
      return { stage: 'finishing', message: 'Finishing up...' };
    }
  }

  if (step === 'claude_auth') {
    if (lastLines.includes('opening terminal') || lastLines.includes('opening your browser')) {
      return { stage: 'preparing', message: 'Opening browser for sign-in...' };
    }
    if (lastLines.includes('waiting')) {
      return { stage: 'installing', message: 'Waiting for you to sign in...' };
    }
    if (lastLines.includes('success') || lastLines.includes('complete')) {
      return { stage: 'done', message: 'Sign-in complete!' };
    }
  }

  // Default based on current stage
  const buildToolsName = IS_WINDOWS ? 'Visual Studio Build Tools' : 'Apple Developer Tools';
  const defaults: Record<InstallStep, string> = {
    xcode: `Setting up ${buildToolsName}...`,
    rust: 'Setting up Rust...',
    cmake: 'Setting up CMake...',
    claude_cli: 'Setting up Claude Code...',
    claude_auth: 'Setting up sign-in...',
  };

  return { stage: currentStage, message: defaults[step] };
}

// Helper to wait for install completion
async function waitForInstallComplete(
  installFn: () => Promise<unknown>,
  onOutput: (line: string) => void,
  onActionRequired: (message: string) => void,
  onDone: (success: boolean) => void,
  abortSignal?: AbortSignal,
  timeoutMs: number = 15 * 60 * 1000 // 15 minutes for Xcode
): Promise<boolean> {
  return new Promise((resolve) => {
    let unlisten: UnlistenFn | null = null;
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };

    const finish = (success: boolean) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      onDone(success);
      resolve(success);
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => finish(false));
    }

    timeoutId = setTimeout(() => {
      onOutput('Taking longer than expected...');
      // Don't fail, just warn
    }, timeoutMs);

    listen<InstallEvent>('install-stream', (event) => {
      if (resolved) return;
      const data = event.payload;

      if (data.type === 'output' && data.line) {
        onOutput(data.line);
      } else if (data.type === 'action_required' && data.message) {
        onActionRequired(data.message);
      } else if (data.type === 'done') {
        finish(data.success ?? false);
      } else if (data.type === 'error') {
        if (data.message) onOutput(`Error: ${data.message}`);
        finish(false);
      }
    }).then((fn) => {
      unlisten = fn;
      installFn().catch((err) => {
        onOutput(`Failed to start: ${err}`);
        finish(false);
      });
    }).catch((err) => {
      onOutput(`Setup error: ${err}`);
      finish(false);
    });
  });
}

// ============================================================================
// Sub-Components
// ============================================================================

// Accessibility Instructions Overlay
function AccessibilityInstructionsOverlay({ onDone }: { onDone: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-primary rounded-xl border border-border shadow-xl max-w-sm w-full p-5 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-text-primary">One more step</h3>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          A settings window opened. Follow these steps:
        </p>

        <div className="space-y-3 mb-5">
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">1</div>
            <p className="text-sm text-text-secondary">Find <strong className="text-text-primary">"FreqLab"</strong> in the list</p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">2</div>
            <p className="text-sm text-text-secondary">Toggle the switch <strong className="text-text-primary">ON</strong></p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">3</div>
            <p className="text-sm text-text-secondary">Come back to this window</p>
          </div>
        </div>

        <button
          onClick={onDone}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
        >
          I've done this
        </button>
      </div>
    </div>
  );
}

// Terminal Sign-In Guide Overlay (shown before and during Claude auth)
function TerminalSignInGuide({
  stage,
  onContinue,
  onCancel,
  onRecheck
}: {
  stage: 'intro' | 'in_progress' | 'timeout';
  onContinue: () => void;
  onCancel: () => void;
  onRecheck: () => void;
}) {
  if (stage === 'intro') {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-bg-primary rounded-xl border border-border shadow-xl max-w-md w-full p-5 animate-fade-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-text-primary">Sign in to Claude</h3>
          </div>

          <div className="mb-4 p-3 bg-warning/10 rounded-lg border border-warning/20">
            <p className="text-xs text-text-secondary">
              <strong className="text-warning">Heads up:</strong> A Terminal window will open and run some setup automatically. Don't type anything — just wait until you see a login option to select.
            </p>
          </div>

          <div className="mb-5 p-3 bg-bg-tertiary rounded-lg border border-border">
            <p className="text-sm text-text-secondary mb-2">Here's what to do:</p>
            <ol className="text-sm space-y-2">
              <li className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                <span className="text-text-secondary"><strong className="text-text-primary">Wait</strong> — let it run until you see a login method prompt</span>
              </li>
              <li className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                <span className="text-text-secondary"><strong className="text-text-primary">Press Enter</strong> — "Claude account" is already selected</span>
              </li>
              <li className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                <span className="text-text-secondary"><strong className="text-text-primary">Browser opens</strong> — sign in and approve access</span>
              </li>
              <li className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">4</span>
                <span className="text-text-secondary"><strong className="text-text-primary">Done!</strong> — close Terminal if it didn't close automatically</span>
              </li>
            </ol>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary font-medium rounded-lg border border-border transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onContinue}
              className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
            >
              Open Terminal
            </button>
          </div>
        </div>
      </div>
    );
  }

  // In progress or timeout state
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-primary rounded-xl border border-border shadow-xl max-w-md w-full p-5 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stage === 'timeout' ? 'bg-warning/20' : 'bg-accent/20'}`}>
            {stage === 'timeout' ? (
              <svg className="w-5 h-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>
          <h3 className="text-base font-semibold text-text-primary">
            {stage === 'timeout' ? 'Still signing in?' : 'Waiting for sign-in...'}
          </h3>
        </div>

        <div className="mb-4 p-3 bg-bg-tertiary rounded-lg border border-border">
          <p className="text-sm font-medium text-text-primary mb-2">In Terminal:</p>
          <ol className="text-sm space-y-1.5">
            <li className="flex gap-2 text-text-secondary">
              <span className="text-accent">→</span>
              <span>Wait for the login method prompt</span>
            </li>
            <li className="flex gap-2 text-text-secondary">
              <span className="text-accent">→</span>
              <span>Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-xs font-mono">Enter</kbd> (Claude account is selected)</span>
            </li>
            <li className="flex gap-2 text-text-secondary">
              <span className="text-accent">→</span>
              <span>Sign in and approve access in browser</span>
            </li>
            <li className="flex gap-2 text-text-secondary">
              <span className="text-accent">→</span>
              <span>Close Terminal if it didn't close automatically</span>
            </li>
          </ol>
        </div>

        {stage === 'timeout' && (
          <div className="p-3 bg-warning/10 rounded-lg border border-warning/20 mb-4">
            <p className="text-xs text-text-secondary">
              <strong className="text-warning">Taking a while?</strong> Make sure you've signed in and approved access in your browser, then close Terminal.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary font-medium rounded-lg border border-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onRecheck}
            className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
          >
            {stage === 'timeout' ? "I've signed in" : 'Check now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Permission Section
interface PermissionSectionProps {
  permissions: PermissionStatus | null;
  onRefresh: () => void;
  adminPrimed: boolean;
  onAdminPrimed: (primed: boolean) => void;
  allInstalled: boolean;
  needsXcode: boolean;
  needsClaudeAuth: boolean;
  onShowAccessibilityInstructions: () => void;
}

function PermissionSection({
  permissions,
  onRefresh,
  adminPrimed,
  onAdminPrimed,
  allInstalled,
  needsXcode,
  needsClaudeAuth,
  onShowAccessibilityInstructions,
}: PermissionSectionProps) {
  const [requestingAccessibility, setRequestingAccessibility] = useState(false);
  const [requestingAdmin, setRequestingAdmin] = useState(false);

  if (allInstalled) return null;

  const needsAdmin = needsXcode;
  const needsAccessibility = needsClaudeAuth;

  if (!needsAdmin && !needsAccessibility) return null;

  const handleAccessibility = async () => {
    setRequestingAccessibility(true);
    try {
      const alreadyGranted = await requestAccessibilityPermission();
      if (!alreadyGranted) {
        // Show instructions overlay
        onShowAccessibilityInstructions();
        // Poll for permission grant
        const pollInterval = setInterval(() => onRefresh(), 2000);
        setTimeout(() => clearInterval(pollInterval), 60000);
      }
    } finally {
      setRequestingAccessibility(false);
      onRefresh();
    }
  };

  const handleAdmin = async () => {
    setRequestingAdmin(true);
    try {
      const success = await primeAdminPrivileges();
      onAdminPrimed(success);
    } finally {
      setRequestingAdmin(false);
    }
  };

  const accessibilityGranted = permissions?.accessibility ?? false;
  const adminReady = !needsAdmin || adminPrimed;
  const accessibilityReady = !needsAccessibility || accessibilityGranted;

  if (adminReady && accessibilityReady) {
    return (
      <div className="p-3 rounded-lg bg-success-subtle border border-success/20">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="text-sm text-success font-medium">Ready to install</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
      <div className="mb-3">
        <p className="text-sm font-medium text-text-primary">First, grant permissions</p>
        <p className="text-xs text-text-muted mt-0.5">This allows FreqLab to install tools for you</p>
      </div>

      <div className="flex gap-2">
        {needsAdmin && (
          <button
            onClick={handleAdmin}
            disabled={requestingAdmin || adminPrimed}
            className={`flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border transition-all flex items-center justify-center gap-2
              ${adminPrimed
                ? 'bg-success-subtle border-success/20 text-success'
                : 'bg-bg-elevated hover:bg-bg-primary border-border text-text-primary hover:border-accent'
              } disabled:opacity-60`}
          >
            {requestingAdmin ? (
              <Spinner size="sm" />
            ) : adminPrimed ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            )}
            <span>{adminPrimed ? 'Done' : 'Enter Password'}</span>
          </button>
        )}

        {needsAccessibility && (
          <button
            onClick={handleAccessibility}
            disabled={requestingAccessibility || accessibilityGranted}
            className={`flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border transition-all flex items-center justify-center gap-2
              ${accessibilityGranted
                ? 'bg-success-subtle border-success/20 text-success'
                : 'bg-bg-elevated hover:bg-bg-primary border-border text-text-primary hover:border-accent'
              } disabled:opacity-60`}
          >
            {requestingAccessibility ? (
              <Spinner size="sm" />
            ) : accessibilityGranted ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
            )}
            <span>{accessibilityGranted ? 'Done' : 'Allow Access'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Disk Space Section
function DiskSpaceSection({ diskSpace }: { diskSpace: DiskSpaceInfo | null }) {
  if (!diskSpace) {
    return (
      <div className="p-3 rounded-lg bg-bg-tertiary border border-border">
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-text-muted">Checking disk space...</span>
        </div>
      </div>
    );
  }

  if (!diskSpace.sufficient) {
    return (
      <div className="p-4 rounded-lg bg-error-subtle border border-error/20">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-error flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-error">Not enough disk space</p>
            <p className="text-xs text-text-secondary mt-1">
              You have {diskSpace.available_gb.toFixed(1)} GB available, but need ~{diskSpace.required_gb.toFixed(0)} GB.
            </p>
            <p className="text-xs text-text-muted mt-2">
              Free up some space and try again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null; // Don't show if sufficient - less visual noise
}

// Progress Bar Component
function ProgressBar({ stage }: { stage: InstallStage }) {
  const stages: InstallStage[] = ['preparing', 'downloading', 'installing', 'finishing', 'done'];
  const currentIndex = stages.indexOf(stage);
  const progress = stage === 'error' ? 0 : ((currentIndex + 1) / stages.length) * 100;

  return (
    <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          stage === 'error' ? 'bg-error' : 'bg-accent'
        }`}
        style={{ width: `${Math.max(10, progress)}%` }}
      />
    </div>
  );
}

// Install Item Component
interface InstallItemProps {
  label: string;
  timeEstimate: string;
  result: CheckResult | undefined;
  isLoading: boolean;
  installState: InstallState | null;
  canInstall: boolean;
  disabledReason?: string;
  onInstall: () => void;
  installLabel?: string;
}

function InstallItem({
  label,
  timeEstimate,
  result,
  isLoading,
  installState,
  canInstall,
  disabledReason,
  onInstall,
  installLabel = 'Install',
}: InstallItemProps) {
  const [showDetails, setShowDetails] = useState(false);
  const isInstalled = result?.status === 'installed';
  // Don't show installing UI if the item is already detected as installed (e.g., from a recheck)
  const isInstalling = !isInstalled && installState !== null && installState.stage !== 'done' && installState.stage !== 'error';
  const hasError = installState?.stage === 'error';
  const justCompletedSuccessfully = installState?.stage === 'done';
  // Don't show button if: already installed, currently installing, or just finished successfully (waiting for recheck)
  const needsAction = result && result.status !== 'installed' && !isInstalling && !justCompletedSuccessfully;

  return (
    <div className={`p-3 rounded-lg border transition-all duration-300 ${
      isInstalled || justCompletedSuccessfully
        ? 'bg-success-subtle border-success/20'
        : isInstalling
          ? 'bg-accent-subtle border-accent/30 ring-2 ring-accent/10'
          : hasError
            ? 'bg-error-subtle border-error/20'
            : 'bg-bg-elevated border-border'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Status Icon */}
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            isInstalled || justCompletedSuccessfully
              ? 'bg-success/20 text-success'
              : isInstalling
                ? 'bg-accent/20 text-accent'
                : hasError
                  ? 'bg-error/20 text-error'
                  : isLoading
                    ? 'bg-bg-tertiary text-text-muted'
                    : 'bg-bg-tertiary text-text-muted'
          }`}>
            {isInstalling ? (
              <Spinner size="sm" />
            ) : isLoading ? (
              <Spinner size="sm" />
            ) : isInstalled || justCompletedSuccessfully ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : hasError ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-text-primary">{label}</p>
            {!isInstalling && !isInstalled && !hasError && !justCompletedSuccessfully && (
              <p className="text-xs text-text-muted">{timeEstimate}</p>
            )}
            {(isInstalled || justCompletedSuccessfully) && (
              <p className="text-xs text-success">{justCompletedSuccessfully && !isInstalled ? 'Complete!' : 'Installed'}</p>
            )}
          </div>
        </div>

        {/* Action Button */}
        {needsAction && !hasError && (
          <button
            onClick={onInstall}
            disabled={!canInstall}
            title={disabledReason}
            className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {installLabel}
          </button>
        )}

        {hasError && (
          <button
            onClick={onInstall}
            className="px-4 py-2 text-sm font-medium bg-error hover:bg-error/80 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        )}
      </div>

      {/* Disabled Reason */}
      {needsAction && !canInstall && disabledReason && (
        <p className="text-xs text-text-muted mt-2 ml-11">{disabledReason}</p>
      )}

      {/* Installing State */}
      {isInstalling && installState && (
        <div className="mt-4 space-y-3">
          <ProgressBar stage={installState.stage} />
          <p className="text-sm text-accent font-medium">{installState.friendlyMessage}</p>

          {/* Action Required Banner */}
          {installState.actionRequired && (
            <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-warning flex-shrink-0 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
                <div>
                  <p className="text-sm text-warning font-medium">Action needed</p>
                  <p className="text-xs text-text-secondary mt-0.5">{installState.actionRequired}</p>
                </div>
              </div>
            </div>
          )}

          {/* Technical Details (collapsed by default) */}
          {installState.technicalOutput.length > 0 && (
            <div>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1"
              >
                <svg className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {showDetails ? 'Hide' : 'Show'} technical details
              </button>

              {showDetails && (
                <div className="mt-2 p-2 bg-bg-primary rounded-md max-h-32 overflow-y-auto">
                  <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap">
                    {installState.technicalOutput.slice(-20).join('\n')}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {hasError && installState && (
        <div className="mt-3 p-3 bg-error/10 border border-error/20 rounded-lg">
          <p className="text-sm text-error font-medium">Installation couldn't complete</p>
          <p className="text-xs text-text-secondary mt-1">
            {installState.errorMessage || "Something went wrong. Try again or click 'Having trouble?' below."}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface PrerequisitesCheckProps {
  onComplete: () => void;
  helpUrl?: string;
}

export function PrerequisitesCheck({ onComplete, helpUrl = 'https://freqlab.app/docs' }: PrerequisitesCheckProps) {
  const { status, diskSpace, permissions, loading, check, refreshPermissions, allInstalled, hasSufficientSpace } = usePrerequisites();

  // Installation state per step
  const [installStates, setInstallStates] = useState<Record<InstallStep, InstallState | null>>({
    xcode: null,
    rust: null,
    cmake: null,
    claude_cli: null,
    claude_auth: null,
  });
  const [installingStep, setInstallingStep] = useState<InstallStep | null>(null);
  // On Windows, admin priming isn't needed (UAC handles elevation per-operation)
  const [adminPrimed, setAdminPrimed] = useState(!IS_MAC);

  // Overlay states
  const [showAccessibilityInstructions, setShowAccessibilityInstructions] = useState(false);
  const [terminalGuideStage, setTerminalGuideStage] = useState<'intro' | 'in_progress' | 'timeout' | null>(null);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const recheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      if (recheckTimeoutRef.current) clearTimeout(recheckTimeoutRef.current);
    };
  }, []);

  const refreshChecks = useCallback(() => {
    if (recheckTimeoutRef.current) {
      clearTimeout(recheckTimeoutRef.current);
      recheckTimeoutRef.current = null;
    }
    check();
  }, [check]);

  useEffect(() => {
    refreshChecks();
  }, [refreshChecks]);

  // Close terminal guide overlay when auth succeeds
  useEffect(() => {
    if (status?.claude_auth.status === 'installed' && terminalGuideStage) {
      setTerminalGuideStage(null);
    }
  }, [status?.claude_auth.status, terminalGuideStage]);

  // Switch to timeout stage after waiting for a while
  useEffect(() => {
    if (terminalGuideStage === 'in_progress') {
      const timeoutId = setTimeout(() => {
        if (isMountedRef.current) {
          setTerminalGuideStage('timeout');
        }
      }, 60000); // 60 seconds before showing timeout UI
      return () => clearTimeout(timeoutId);
    }
  }, [terminalGuideStage]);

  // Permission checks
  const needsXcode = status?.xcode_cli.status !== 'installed';
  const needsClaudeAuth = status?.claude_auth.status !== 'installed';
  const permissionsReady = (!needsXcode || adminPrimed) && (!needsClaudeAuth || permissions?.accessibility);

  // Can install checks
  const canInstall = useCallback((step: InstallStep): boolean => {
    if (!hasSufficientSpace) return false;
    if (installingStep !== null) return false;

    switch (step) {
      case 'xcode':
        return adminPrimed;
      case 'rust':
      case 'cmake':
      case 'claude_cli':
        return permissionsReady || allInstalled;
      case 'claude_auth':
        return status?.claude_cli.status === 'installed';
    }
  }, [status, hasSufficientSpace, installingStep, adminPrimed, permissionsReady, allInstalled]);

  const getDisabledReason = useCallback((step: InstallStep): string | undefined => {
    if (!hasSufficientSpace) return 'Not enough disk space';
    if (installingStep !== null) return 'Please wait for current install to finish';

    switch (step) {
      case 'xcode':
        if (!adminPrimed) return 'Enter your password above first';
        break;
      case 'rust':
      case 'cmake':
      case 'claude_cli':
        if (!permissionsReady && !allInstalled) return 'Complete the permissions step above first';
        break;
      case 'claude_auth':
        if (status?.claude_cli.status !== 'installed') return 'Install Claude Code first';
        break;
    }
    return undefined;
  }, [status, hasSufficientSpace, installingStep, adminPrimed, permissionsReady, allInstalled]);

  // Run install step
  const runInstallStep = useCallback(async (step: InstallStep, installFn: () => Promise<unknown>) => {
    abortControllerRef.current = new AbortController();
    setInstallingStep(step);

    const initialState: InstallState = {
      stage: 'preparing',
      friendlyMessage: 'Preparing...',
      technicalOutput: [],
      actionRequired: null,
      errorMessage: null,
    };
    setInstallStates(prev => ({ ...prev, [step]: initialState }));

    await waitForInstallComplete(
      installFn,
      // On output
      (line) => {
        if (!isMountedRef.current) return;
        setInstallStates(prev => {
          const current = prev[step];
          if (!current) return prev;

          const newOutput = [...current.technicalOutput, line];
          const { stage, message } = parseStageFromOutput(step, newOutput, current.stage);

          return {
            ...prev,
            [step]: {
              ...current,
              stage,
              friendlyMessage: message,
              technicalOutput: newOutput,
            },
          };
        });
      },
      // On action required
      (message) => {
        if (!isMountedRef.current) return;
        setInstallStates(prev => {
          const current = prev[step];
          if (!current) return prev;
          return {
            ...prev,
            [step]: { ...current, actionRequired: message },
          };
        });
      },
      // On done
      (success) => {
        if (!isMountedRef.current) return;
        setInstallStates(prev => {
          const current = prev[step];
          if (!current) return prev;
          return {
            ...prev,
            [step]: {
              ...current,
              stage: success ? 'done' : 'error',
              friendlyMessage: success ? 'Complete!' : 'Installation failed',
              actionRequired: null,
              errorMessage: success ? null : 'Something went wrong. Please try again.',
            },
          };
        });
        setInstallingStep(null);

        // Recheck after a moment
        recheckTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) refreshChecks();
        }, 1500);
      },
      abortControllerRef.current.signal,
    );
  }, [refreshChecks]);

  // Install handlers
  const handleInstallXcode = useCallback(() => runInstallStep('xcode', installXcode), [runInstallStep]);
  const handleInstallRust = useCallback(() => runInstallStep('rust', installRust), [runInstallStep]);
  const handleInstallCmake = useCallback(() => runInstallStep('cmake', installCmake), [runInstallStep]);
  const handleInstallClaudeCli = useCallback(() => runInstallStep('claude_cli', installClaudeCli), [runInstallStep]);

  const handleClaudeAuthStart = useCallback(() => {
    setTerminalGuideStage('intro');
  }, []);

  const handleClaudeAuthConfirm = useCallback(() => {
    setTerminalGuideStage('in_progress');
    runInstallStep('claude_auth', startClaudeAuth);
  }, [runInstallStep]);

  const handleClaudeAuthCancel = useCallback(() => {
    setTerminalGuideStage(null);
    // If we were in the middle of auth, abort it
    if (installingStep === 'claude_auth') {
      abortControllerRef.current?.abort();
      setInstallingStep(null);
      setInstallStates(prev => ({ ...prev, claude_auth: null }));
    }
  }, [installingStep]);

  const handleClaudeAuthRecheck = useCallback(() => {
    // Trigger a recheck of prerequisites
    refreshChecks();
  }, [refreshChecks]);

  // Item configs
  // Platform-aware labels
  const platformDefaults = getPlatformDefaults();

  const items: Array<{
    key: InstallStep;
    label: string;
    timeEstimate: string;
    result: CheckResult | undefined;
    onInstall: () => void;
    installLabel?: string;
  }> = [
    {
      key: 'xcode',
      label: platformDefaults.buildToolsName,
      timeEstimate: IS_WINDOWS ? 'Takes 10-15 minutes' : 'Takes 5-10 minutes',
      result: status?.xcode_cli,
      onInstall: handleInstallXcode,
    },
    {
      key: 'rust',
      label: 'Rust',
      timeEstimate: 'Takes 1-2 minutes',
      result: status?.rust,
      onInstall: handleInstallRust,
    },
    {
      key: 'cmake',
      label: 'CMake',
      timeEstimate: 'Takes about 1 minute',
      result: status?.cmake,
      onInstall: handleInstallCmake,
    },
    {
      key: 'claude_cli',
      label: 'Claude Code',
      timeEstimate: 'Takes about 30 seconds',
      result: status?.claude_cli,
      onInstall: handleInstallClaudeCli,
    },
    {
      key: 'claude_auth',
      label: 'Claude Sign In',
      timeEstimate: 'Opens your browser',
      result: status?.claude_auth,
      onInstall: handleClaudeAuthStart,
      installLabel: 'Sign In',
    },
  ];

  return (
    <>
      {/* Overlays */}
      {showAccessibilityInstructions && (
        <AccessibilityInstructionsOverlay onDone={() => {
          setShowAccessibilityInstructions(false);
          refreshPermissions();
        }} />
      )}

      {terminalGuideStage && (
        <TerminalSignInGuide
          stage={terminalGuideStage}
          onContinue={handleClaudeAuthConfirm}
          onCancel={handleClaudeAuthCancel}
          onRecheck={handleClaudeAuthRecheck}
        />
      )}

      <div className="space-y-3 animate-fade-in">
        {/* Header */}
        <div className="text-center">
          <div className="w-10 h-10 mx-auto rounded-xl bg-accent/20 flex items-center justify-center mb-2">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text-primary">Let's get you set up</h2>
          <p className="text-xs text-text-secondary mt-0.5">This only takes a few minutes</p>
        </div>

        {/* Disk Space Check */}
        <DiskSpaceSection diskSpace={diskSpace} />

        {/* Permission Section - macOS only */}
        {IS_MAC && (
          <PermissionSection
            permissions={permissions}
            onRefresh={refreshPermissions}
            adminPrimed={adminPrimed}
            onAdminPrimed={setAdminPrimed}
            allInstalled={allInstalled}
            needsXcode={needsXcode}
            needsClaudeAuth={needsClaudeAuth}
            onShowAccessibilityInstructions={() => setShowAccessibilityInstructions(true)}
          />
        )}

        {/* Install Items */}
        <div className="space-y-2">
          {items.map((item) => (
            <InstallItem
              key={item.key}
              label={item.label}
              timeEstimate={item.timeEstimate}
              result={item.result}
              isLoading={loading}
              installState={installStates[item.key]}
              canInstall={canInstall(item.key)}
              disabledReason={getDisabledReason(item.key)}
              onInstall={item.onInstall}
              installLabel={item.installLabel}
            />
          ))}
        </div>

        {/* Help Link */}
        <div className="text-center pt-1">
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-accent transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Having trouble?</span>
          </a>
        </div>

        {/* Continue Button */}
        <button
          onClick={onComplete}
          disabled={!allInstalled || installingStep !== null}
          className="w-full py-2.5 text-sm bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-lg transition-all disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none"
        >
          {allInstalled ? 'Continue' : 'Complete the steps above to continue'}
        </button>
      </div>
    </>
  );
}
