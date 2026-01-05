import { useEffect } from 'react';
import { usePrerequisites } from '../../hooks/usePrerequisites';
import { Spinner } from '../Common/Spinner';
import type { CheckResult } from '../../types';

interface CheckItemProps {
  label: string;
  result: CheckResult | undefined;
  isLoading: boolean;
}

function CheckItem({ label, result, isLoading }: CheckItemProps) {
  const getStatusStyles = () => {
    if (isLoading || !result) {
      return {
        bg: 'bg-bg-elevated',
        border: 'border-border',
        iconBg: 'bg-bg-tertiary',
        iconColor: 'text-text-muted',
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
    <div className={`p-4 rounded-xl ${styles.bg} border ${styles.border} transition-all duration-300`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg ${styles.iconBg} ${styles.iconColor} flex items-center justify-center flex-shrink-0`}>
          <StatusIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text-primary">{label}</div>
          {result && (
            <div className="text-xs text-text-muted mt-0.5 truncate">
              {result.version || result.message || ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PrerequisitesCheckProps {
  onComplete: () => void;
}

export function PrerequisitesCheck({ onComplete }: PrerequisitesCheckProps) {
  const { status, loading, check, allInstalled } = usePrerequisites();

  useEffect(() => {
    check();
  }, [check]);

  const items = [
    { key: 'xcode_cli', label: 'Xcode Command Line Tools', result: status?.xcode_cli },
    { key: 'rust', label: 'Rust & Cargo', result: status?.rust },
    { key: 'claude_cli', label: 'Claude Code CLI', result: status?.claude_cli },
    { key: 'claude_auth', label: 'Claude Authentication', result: status?.claude_auth },
  ];

  const hasIssues = status && !allInstalled;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-accent-subtle flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-text-primary">System Requirements</h2>
        <p className="text-sm text-text-secondary mt-1">
          Checking your development environment
        </p>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        {items.map((item) => (
          <CheckItem
            key={item.key}
            label={item.label}
            result={item.result}
            isLoading={loading}
          />
        ))}
      </div>

      {/* Help section */}
      {hasIssues && (
        <div className="p-4 rounded-xl bg-bg-tertiary border border-border">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-text-primary mb-2">Installation Help</h3>
              <div className="text-xs text-text-muted space-y-2">
                {status?.xcode_cli.status !== 'installed' && (
                  <p>
                    <span className="text-text-secondary">Xcode CLI:</span>{' '}
                    <code className="px-1.5 py-0.5 bg-bg-primary rounded text-accent text-[10px]">
                      xcode-select --install
                    </code>
                  </p>
                )}
                {status?.rust.status !== 'installed' && (
                  <p>
                    <span className="text-text-secondary">Rust:</span>{' '}
                    Visit <a href="https://rustup.rs" className="text-accent hover:underline">rustup.rs</a>
                  </p>
                )}
                {status?.claude_cli.status !== 'installed' && (
                  <p>
                    <span className="text-text-secondary">Claude CLI:</span>{' '}
                    <code className="px-1.5 py-0.5 bg-bg-primary rounded text-accent text-[10px]">
                      npm i -g @anthropic-ai/claude-code
                    </code>
                  </p>
                )}
                {status?.claude_auth.status === 'needsconfig' && (
                  <p>
                    <span className="text-text-secondary">Claude Auth:</span>{' '}
                    <code className="px-1.5 py-0.5 bg-bg-primary rounded text-accent text-[10px]">
                      claude login
                    </code>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={check}
          disabled={loading}
          className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading && <Spinner size="sm" />}
          Recheck
        </button>

        <button
          onClick={onComplete}
          disabled={!allInstalled}
          className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-xl transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none"
        >
          {allInstalled ? 'Continue' : 'Requirements needed'}
        </button>
      </div>
    </div>
  );
}
