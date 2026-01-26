import { useState, useMemo, useCallback } from 'react';
import type { LibraryFramework } from '../../types';

interface FrameworksTabProps {
  frameworks: LibraryFramework[];
  searchQuery: string;
}

export function FrameworksTab({ frameworks, searchQuery }: FrameworksTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredFrameworks = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return frameworks.filter((fw) =>
      fw.name.toLowerCase().includes(query) ||
      fw.display_name.toLowerCase().includes(query) ||
      fw.description.toLowerCase().includes(query) ||
      fw.language.toLowerCase().includes(query)
    );
  }, [frameworks, searchQuery]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  if (filteredFrameworks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
        <svg className="w-12 h-12 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <p>No frameworks found</p>
        {searchQuery && <p className="text-sm mt-1">Try a different search term</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filteredFrameworks.map((fw) => (
        <FrameworkCard
          key={fw.id}
          framework={fw}
          isExpanded={expandedId === fw.id}
          onToggle={() => toggleExpand(fw.id)}
        />
      ))}
    </div>
  );
}

// Extracted card component to prevent unnecessary re-renders
interface FrameworkCardProps {
  framework: LibraryFramework;
  isExpanded: boolean;
  onToggle: () => void;
}

function FrameworkCard({ framework: fw, isExpanded, onToggle }: FrameworkCardProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-tertiary/50">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-bg-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <span className="text-lg font-bold text-accent">
              {fw.language === 'rust' ? 'Rs' : fw.language === 'cpp' ? 'C++' : '?'}
            </span>
          </div>
          <div>
            <h3 className="font-medium text-text-primary">{fw.display_name}</h3>
            <p className="text-sm text-text-secondary">{fw.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              fw.source === 'core' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'
            }`}
          >
            {fw.source}
          </span>
          <svg
            className={`w-5 h-5 text-text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border pt-4 space-y-4">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-text-tertiary">Language:</span>
              <span className="ml-2 text-text-primary capitalize">{fw.language}</span>
            </div>
            <div>
              <span className="text-text-tertiary">Version:</span>
              <span className="ml-2 text-text-primary">{fw.version}</span>
            </div>
          </div>

          {/* Output formats */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">Output Formats</h4>
            <div className="flex gap-2">
              {Object.entries(fw.outputs).map(([key, output]) => (
                <span
                  key={key}
                  className="px-2 py-1 text-xs rounded bg-bg-tertiary text-text-secondary"
                  title={output.description}
                >
                  {output.extension}
                </span>
              ))}
            </div>
          </div>

          {/* UI Frameworks */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">UI Frameworks</h4>
            <div className="space-y-2">
              {fw.ui_frameworks.map((ui) => (
                <div key={ui.id} className="flex items-start gap-2">
                  <span className="text-accent">-</span>
                  <div>
                    <span className="text-sm text-text-primary">{ui.name}</span>
                    <p className="text-xs text-text-tertiary">{ui.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prerequisites (filter out core prereqs handled by setup wizard) */}
          {(() => {
            const corePrereqs = ['xcode_cli', 'cmake', 'claude_cli', 'claude_auth', 'rust'];
            const filteredRequired = fw.prerequisites.required.filter(p => !corePrereqs.includes(p));
            const filteredOptional = fw.prerequisites.optional.filter(p => !corePrereqs.includes(p));
            if (filteredRequired.length === 0 && filteredOptional.length === 0) return null;
            return (
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Additional Prerequisites</h4>
                <div className="flex flex-wrap gap-2">
                  {filteredRequired.map((prereq) => (
                    <span key={prereq} className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400">
                      {prereq}
                    </span>
                  ))}
                  {filteredOptional.map((prereq) => (
                    <span key={prereq} className="px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400">
                      {prereq} (optional)
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Links */}
          <div className="flex gap-4 pt-2">
            <a
              href={fw.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Website
            </a>
            <a
              href={fw.documentation}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Documentation
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
