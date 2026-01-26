import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Modal } from '../Common/Modal';
import { FrameworksTab } from './FrameworksTab';
import { GuidesTab } from './GuidesTab';
import { RecipesTab } from './RecipesTab';
import { ResourcesTab } from './ResourcesTab';
import type { Library } from '../../types';

interface LibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: TabId;
  // Note: content is not included - we use reference-based attachments
  // The item is copied to .claude/commands/ and Claude reads it on-demand
  onAttach?: (item: { type: 'skill' | 'algorithm'; id: string; name: string }) => void;
}

type TabId = 'frameworks' | 'guides' | 'recipes' | 'resources';

interface Tab {
  id: TabId;
  label: string;
  icon: JSX.Element;
  count?: number;
}

export function LibraryModal({ isOpen, onClose, initialTab, onAttach }: LibraryModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('frameworks');
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lib = await invoke<Library>('get_library');
      setLibrary(lib);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load library data when modal opens, reset state when it closes
  useEffect(() => {
    if (isOpen) {
      loadLibrary();
      if (initialTab) {
        setActiveTab(initialTab);
      }
    } else {
      // Reset state when modal closes
      setSearchQuery('');
      setError(null);
    }
  }, [isOpen, initialTab, loadLibrary]);

  const tabs: Tab[] = [
    {
      id: 'frameworks',
      label: 'Frameworks',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
      count: library?.frameworks.length,
    },
    {
      id: 'guides',
      label: 'Guides',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      ),
      count: library?.skills.length,
    },
    {
      id: 'recipes',
      label: 'Recipes',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      count: library?.algorithms.length,
    },
    {
      id: 'resources',
      label: 'Resources',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      ),
      count: library?.resources.length,
    },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Library" size="xl">
      <div className="flex flex-col h-[600px] max-h-[calc(100vh-180px)]">
        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-bg-tertiary text-text-tertiary">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3 text-text-secondary">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading library...
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-400 mb-2">{error}</p>
                <button
                  onClick={loadLibrary}
                  aria-label="Retry loading library"
                  className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : library ? (
            <>
              {activeTab === 'frameworks' && (
                <FrameworksTab frameworks={library.frameworks} searchQuery={searchQuery} />
              )}
              {activeTab === 'guides' && (
                <GuidesTab guides={library.skills} searchQuery={searchQuery} onAttach={onAttach} />
              )}
              {activeTab === 'recipes' && (
                <RecipesTab recipes={library.algorithms} searchQuery={searchQuery} onAttach={onAttach} />
              )}
              {activeTab === 'resources' && (
                <ResourcesTab resources={library.resources} searchQuery={searchQuery} />
              )}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
