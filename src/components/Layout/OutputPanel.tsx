import { useState } from 'react';

interface OutputPanelProps {
  output?: string[];
}

export function OutputPanel({ output = [] }: OutputPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <div
      className={`bg-bg-secondary border-t border-border transition-all duration-300 ease-in-out ${
        isCollapsed ? 'h-10' : 'h-44'
      }`}
    >
      <div className="flex items-center justify-between px-4 h-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse-subtle" />
          <span className="text-sm font-medium text-text-secondary">Output</span>
        </div>
        <div className="flex items-center gap-2">
          {!isCollapsed && (
            <button className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="h-[calc(100%-2.5rem)] overflow-auto px-4 pb-3">
          <div className="font-mono text-xs bg-bg-primary rounded-lg p-3 h-full overflow-auto">
            {output.length === 0 ? (
              <span className="text-text-muted">Ready to build...</span>
            ) : (
              output.map((line, i) => (
                <div key={i} className="text-text-secondary leading-relaxed">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
