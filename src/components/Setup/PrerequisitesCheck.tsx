import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePrerequisites } from '../../hooks/usePrerequisites';
import { Spinner } from '../Common/Spinner';
import {
  checkHomebrew,
  checkNode,
  installHomebrew,
  installNode,
  installXcode,
  installRust,
  installClaudeCli,
  startClaudeAuth,
} from '../../lib/tauri';
import type { CheckResult } from '../../types';

// Helper to wait for an install to complete via events
// Fixed: Register listener BEFORE starting installation to avoid race condition
// Accepts an AbortSignal for cleanup on component unmount
async function waitForInstallComplete(
  installFn: () => Promise<unknown>,
  onOutput: (line: string) => void,
  onActionRequired: (message: string) => void,
  abortSignal?: AbortSignal,
  timeoutMs: number = 10 * 60 * 1000 // 10 minute default timeout
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
      resolve(success);
    };

    // Handle abort signal (component unmount)
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        finish(false);
      });
    }

    // Set timeout
    timeoutId = setTimeout(() => {
      onOutput('Installation timed out. Please check your network connection and try again.');
      finish(false);
    }, timeoutMs);

    // Register listener FIRST, then start installation
    listen<InstallEvent>('install-stream', (event) => {
      // Don't process events if already resolved (e.g., component unmounted)
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
      // Only start installation AFTER listener is registered
      installFn().catch((err) => {
        onOutput(`Failed to start: ${err}`);
        finish(false);
      });
    }).catch((err) => {
      onOutput(`Failed to set up listener: ${err}`);
      finish(false);
    });
  });
}

// Dev-only: fake failure states for testing UI
const FAKE_FAILURES: Record<string, CheckResult> = {
  xcode_cli: { status: 'notinstalled', version: null, message: 'Not installed' },
  rust: { status: 'notinstalled', version: null, message: 'Not installed' },
  claude_cli: { status: 'notinstalled', version: null, message: 'Not installed' },
  claude_auth: { status: 'needsconfig', version: null, message: 'Not authenticated' },
};

interface InstallEvent {
  type: 'start' | 'output' | 'done' | 'error' | 'action_required';
  step?: string;
  line?: string;
  success?: boolean;
  message?: string;
  action?: string;
}

interface HelpContent {
  description: string;
  instruction: ReactNode;
  command: string;
  note: ReactNode;
}

interface CheckItemProps {
  label: string;
  result: CheckResult | undefined;
  isLoading: boolean;
  help?: HelpContent;
  onInstall?: () => void;
  installLabel?: string;
  isInstalling?: boolean;
  isAnyInstalling?: boolean; // Disable button when ANY item is installing
  installOutput?: string[];
  actionRequired?: string | null;
}

function CheckItem({
  label,
  result,
  isLoading,
  help,
  onInstall,
  installLabel = 'Install',
  isInstalling,
  isAnyInstalling,
  installOutput = [],
  actionRequired,
}: CheckItemProps) {
  const [manualExpanded, setManualExpanded] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const needsHelp = result && result.status !== 'installed';

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [installOutput]);

  const getStatusStyles = () => {
    if (isLoading || !result) {
      return {
        bg: 'bg-bg-elevated',
        border: 'border-border',
        iconBg: 'bg-bg-tertiary',
        iconColor: 'text-text-muted',
      };
    }

    if (isInstalling) {
      return {
        bg: 'bg-accent-subtle',
        border: 'border-accent/20',
        iconBg: 'bg-accent/20',
        iconColor: 'text-accent',
      };
    }

    switch (result.status) {
      case 'installed':
        return {
          bg: 'bg-success-subtle',
          border: 'border-success/20',
          iconBg: 'bg-success/20',
          iconColor: 'text-success',
        };
      case 'needsconfig':
        return {
          bg: 'bg-warning-subtle',
          border: 'border-warning/20',
          iconBg: 'bg-warning/20',
          iconColor: 'text-warning',
        };
      default:
        return {
          bg: 'bg-error-subtle',
          border: 'border-error/20',
          iconBg: 'bg-error/20',
          iconColor: 'text-error',
        };
    }
  };

  const styles = getStatusStyles();

  const StatusIcon = () => {
    if (isInstalling) {
      return <Spinner size="sm" className="text-accent" />;
    }

    if (isLoading || !result) {
      return <Spinner size="sm" className="text-text-muted" />;
    }

    switch (result.status) {
      case 'installed':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'needsconfig':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
    }
  };

  return (
    <div className={`p-3 rounded-lg ${styles.bg} border ${styles.border} transition-all duration-300`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-md ${styles.iconBg} ${styles.iconColor} flex items-center justify-center flex-shrink-0`}>
          <StatusIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary">{label}</div>
          {result && result.status === 'installed' && !isInstalling && (
            <div className="text-xs text-text-muted mt-0.5 truncate">
              {result.version || result.message || ''}
            </div>
          )}
          {isInstalling && (
            <div className="text-xs text-accent mt-0.5">Installing...</div>
          )}
        </div>

        {/* Install button - disabled when any installation is in progress */}
        {needsHelp && onInstall && !isInstalling && (
          <button
            onClick={onInstall}
            disabled={isAnyInstalling}
            className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {installLabel}
          </button>
        )}
      </div>

      {/* Action required message */}
      {actionRequired && (
        <div className="mt-2 px-2 py-1.5 bg-warning/10 border border-warning/20 rounded-md flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          <span className="text-[11px] text-warning font-medium">{actionRequired}</span>
        </div>
      )}

      {/* Installation output */}
      {installOutput.length > 0 && (
        <div
          ref={outputRef}
          className="mt-2 p-1.5 bg-bg-primary rounded-md max-h-20 overflow-y-auto font-mono text-[10px] text-text-muted"
        >
          {installOutput.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
        </div>
      )}

      {/* Collapsible manual instructions */}
      {needsHelp && help && !isInstalling && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <button
            onClick={() => setManualExpanded(!manualExpanded)}
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors w-full"
          >
            <svg
              className={`w-3 h-3 transition-transform ${manualExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>Manual setup instructions</span>
          </button>

          {manualExpanded && (
            <div className="mt-2 space-y-1.5 animate-fade-in">
              <p className="text-[11px] text-text-muted">{help.description}</p>
              <p className="text-[11px] text-text-secondary">{help.instruction}</p>
              <code className="block px-2 py-1.5 bg-bg-primary rounded-md text-accent text-[11px] font-mono">
                {help.command}
              </code>
              <p className="text-[11px] text-text-muted">{help.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PrerequisitesCheckProps {
  onComplete: () => void;
}

type InstallStep = 'homebrew' | 'node' | 'xcode' | 'rust' | 'claude_cli' | 'claude_auth';

export function PrerequisitesCheck({ onComplete }: PrerequisitesCheckProps) {
  const { status, loading, check, allInstalled } = usePrerequisites();
  // Keep for testing - uncomment the test button below to use
  const [testFailure, _setTestFailure] = useState(false);

  // Installation state
  const [installingStep, setInstallingStep] = useState<InstallStep | null>(null);
  const [installOutput, setInstallOutput] = useState<Record<string, string[]>>({});
  const [actionRequired, setActionRequired] = useState<Record<string, string | null>>({});
  const [hasHomebrew, setHasHomebrew] = useState<boolean | null>(null);
  const [hasNode, setHasNode] = useState<boolean | null>(null);

  // Refs for cleanup and preventing race conditions
  const abortControllerRef = useRef<AbortController | null>(null);
  const recheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-progress installation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Cancel any pending recheck
      if (recheckTimeoutRef.current) {
        clearTimeout(recheckTimeoutRef.current);
      }
    };
  }, []);

  // Refresh all checks
  const refreshChecks = useCallback(() => {
    // Cancel any pending recheck to avoid race condition
    if (recheckTimeoutRef.current) {
      clearTimeout(recheckTimeoutRef.current);
      recheckTimeoutRef.current = null;
    }
    check();
    checkHomebrew().then((v) => isMountedRef.current && setHasHomebrew(v));
    checkNode().then((v) => isMountedRef.current && setHasNode(v));
  }, [check]);

  useEffect(() => {
    refreshChecks();
  }, [refreshChecks]);

  // Helper to get result, optionally overriding with fake failure
  const getResult = (key: string, realResult: CheckResult | undefined) => {
    if (testFailure) return FAKE_FAILURES[key];
    return realResult;
  };

  // Helper to run an install step with proper event handling
  const runInstallStep = useCallback(async (
    step: InstallStep,
    installFn: () => Promise<unknown>
  ): Promise<boolean> => {
    // Create abort controller for this installation
    abortControllerRef.current = new AbortController();

    setInstallingStep(step);
    setInstallOutput((prev) => ({ ...prev, [step]: [] }));
    setActionRequired((prev) => ({ ...prev, [step]: null }));

    const success = await waitForInstallComplete(
      installFn,
      (line) => isMountedRef.current && setInstallOutput((prev) => ({
        ...prev,
        [step]: [...(prev[step] || []), line],
      })),
      (message) => isMountedRef.current && setActionRequired((prev) => ({
        ...prev,
        [step]: message,
      })),
      abortControllerRef.current.signal
    );

    if (!isMountedRef.current) return success;

    setInstallingStep(null);
    setActionRequired((prev) => ({ ...prev, [step]: null }));

    // Refresh all checks after installation - longer delay to give system time to update
    recheckTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setInstallOutput((prev) => ({
        ...prev,
        [step]: [...(prev[step] || []), 'Rechecking...'],
      }));
      refreshChecks();
    }, 1000);

    return success;
  }, [refreshChecks]);

  // Installation handlers
  const handleInstallXcode = useCallback(async () => {
    await runInstallStep('xcode', installXcode);
  }, [runInstallStep]);

  const handleInstallRust = useCallback(async () => {
    await runInstallStep('rust', installRust);
  }, [runInstallStep]);

  const handleInstallClaudeCli = useCallback(async () => {
    // Check if we need to install homebrew first
    const brewInstalled = hasHomebrew ?? await checkHomebrew();
    if (!brewInstalled) {
      const brewSuccess = await runInstallStep('homebrew', installHomebrew);
      if (!brewSuccess) return;
      setHasHomebrew(true);
    }

    // Check if we need to install node
    const nodeInstalled = hasNode ?? await checkNode();
    if (!nodeInstalled) {
      const nodeSuccess = await runInstallStep('node', installNode);
      if (!nodeSuccess) return;
      setHasNode(true);
    }

    // Finally install Claude CLI
    await runInstallStep('claude_cli', installClaudeCli);
  }, [hasHomebrew, hasNode, runInstallStep]);

  const handleClaudeAuth = useCallback(async () => {
    await runInstallStep('claude_auth', startClaudeAuth);
  }, [runInstallStep]);

  // Determine install label for Claude CLI based on what's missing
  const getClaudeCliInstallLabel = () => {
    if (!hasHomebrew) return 'Install (via Homebrew)';
    if (!hasNode) return 'Install (+ Node.js)';
    return 'Install';
  };

  const items = [
    {
      key: 'xcode_cli',
      label: 'Xcode Command Line Tools',
      result: getResult('xcode_cli', status?.xcode_cli),
      onInstall: handleInstallXcode,
      installLabel: 'Install',
      help: {
        description: 'Required for compiling native code on macOS',
        instruction: 'Open Terminal and run:',
        command: 'xcode-select --install',
        note: 'A dialog will appear. Click "Install" and wait for completion (~5 min).',
      },
    },
    {
      key: 'rust',
      label: 'Rust & Cargo',
      result: getResult('rust', status?.rust),
      onInstall: handleInstallRust,
      installLabel: 'Install',
      help: {
        description: 'The programming language used for audio plugin development',
        instruction: 'Open Terminal and run:',
        command: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
        note: (<>Follow the prompts (press Enter for defaults). Then restart your terminal or run <code className="text-accent">source ~/.cargo/env</code></>),
      },
    },
    {
      key: 'claude_cli',
      label: 'Claude Code CLI',
      result: getResult('claude_cli', status?.claude_cli),
      onInstall: handleInstallClaudeCli,
      installLabel: getClaudeCliInstallLabel(),
      help: {
        description: 'The AI assistant that helps write your plugin code',
        instruction: 'Requires Node.js 18+. Install with npm:',
        command: 'npm install -g @anthropic-ai/claude-code',
        note: (<>Don't have Node.js? Get it from <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">nodejs.org</a> (LTS version recommended)</>),
      },
    },
    {
      key: 'claude_auth',
      label: 'Claude Authentication',
      result: getResult('claude_auth', status?.claude_auth),
      onInstall: handleClaudeAuth,
      installLabel: 'Sign In',
      help: {
        description: 'Sign in with your Claude Pro or Max subscription',
        instruction: (<>
          <strong className="text-warning">Requires paid subscription.</strong>{' '}
          <a href="https://claude.ai/upgrade" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Upgrade here</a>
        </>),
        command: 'claude → /login',
        note: 'Max plan recommended for uninterrupted development.',
      },
    },
  ];

  // Check if currently installing intermediate steps (homebrew/node for claude_cli)
  const isInstallingIntermediate = installingStep === 'homebrew' || installingStep === 'node';

  return (
    <div className="space-y-4 animate-fade-in relative">
      {/* Dev test button - uncomment to test failure states
      {import.meta.env.DEV && (
        <button
          onClick={() => _setTestFailure(!testFailure)}
          className={`absolute -top-2 -right-2 text-[10px] px-2 py-1 rounded-md border transition-colors ${
            testFailure
              ? 'bg-error/20 border-error/30 text-error'
              : 'bg-bg-tertiary border-border text-text-muted hover:text-text-secondary'
          }`}
        >
          {testFailure ? 'Reset' : 'Test Fail'}
        </button>
      )}
      */}

      {/* Header */}
      <div className="text-center">
        <div className="w-10 h-10 mx-auto rounded-lg bg-accent-subtle flex items-center justify-center mb-2">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary">System Requirements</h2>
        <p className="text-xs text-text-secondary mt-0.5">Checking your development environment</p>
      </div>

      {/* Intermediate installation step (Homebrew/Node for Claude CLI) */}
      {isInstallingIntermediate && (
        <div className="p-3 rounded-lg bg-accent-subtle border border-accent/20">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-md bg-accent/20 flex items-center justify-center">
              <Spinner size="sm" className="text-accent" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">
                {installingStep === 'homebrew' ? 'Installing Homebrew...' : 'Installing Node.js...'}
              </div>
              <div className="text-[11px] text-text-muted">
                {installingStep === 'homebrew'
                  ? 'Required for installing Node.js'
                  : 'Required for Claude Code CLI'}
              </div>
            </div>
          </div>
          {installOutput[installingStep || '']?.length > 0 && (
            <div className="p-1.5 bg-bg-primary rounded-md max-h-20 overflow-y-auto font-mono text-[10px] text-text-muted">
              {installOutput[installingStep || ''].map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Checklist with inline help */}
      <div className="space-y-2">
        {items.map((item) => (
          <CheckItem
            key={item.key}
            label={item.label}
            result={item.result}
            isLoading={loading}
            help={item.help}
            onInstall={item.onInstall}
            installLabel={item.installLabel}
            isInstalling={installingStep === item.key}
            isAnyInstalling={installingStep !== null}
            installOutput={installOutput[item.key] || []}
            actionRequired={actionRequired[item.key]}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={refreshChecks}
          disabled={loading || installingStep !== null}
          className="flex-1 py-2 px-3 text-sm bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-lg border border-border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading && <Spinner size="sm" />}
          Recheck
        </button>

        <button
          onClick={onComplete}
          disabled={!allInstalled || testFailure || installingStep !== null}
          className="flex-1 py-2 px-3 text-sm bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-lg transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none"
        >
          {allInstalled && !testFailure ? 'Continue' : 'Requirements needed'}
        </button>
      </div>
    </div>
  );
}
