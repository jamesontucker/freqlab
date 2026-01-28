import { useState, useEffect } from 'react';
import { Modal } from '../Common/Modal';
import { ThemePicker } from './ThemePicker';
import { BrandingSettings } from './BrandingSettings';
import { DawPathsSettings } from './DawPathsSettings';
import { AudioSettings } from './AudioSettings';
import { AISettings } from './AISettings';
import { BuildSettings } from './BuildSettings';
import { DevSettings } from './DevSettings';
import { UpdateSettings } from './UpdateSettings';
import { useUpdateStore } from '../../stores/updateStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
}

type TabId = 'general' | 'builds' | 'audio' | 'ai' | 'branding' | 'daw-paths' | 'updates' | 'dev';

interface Tab {
  id: TabId;
  label: string;
  icon: JSX.Element;
  badge?: boolean;
}

const tabs: Tab[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'builds',
    label: 'Builds',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>
    ),
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'Chat',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.967-.516" />
        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
      </svg>
    ),
  },
  {
    id: 'branding',
    label: 'Branding',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
  {
    id: 'daw-paths',
    label: 'DAW Paths',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    ),
  },
  {
    id: 'dev',
    label: 'Developer',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
];

export function SettingsModal({ isOpen, onClose, initialTab }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const updateStatus = useUpdateStore((state) => state.status);
  const hasUpdate = updateStatus === 'available';

  // Helper to validate tab ID
  const isValidTabId = (id: string): id is TabId => {
    return ['general', 'builds', 'audio', 'ai', 'branding', 'daw-paths', 'updates', 'dev'].includes(id);
  };

  // Set initial tab when modal opens
  useEffect(() => {
    if (isOpen && initialTab && isValidTabId(initialTab)) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Build tabs with dynamic badge
  const tabsWithBadge = tabs.map((tab) => ({
    ...tab,
    badge: tab.id === 'updates' ? hasUpdate : undefined,
  }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="xl">
      <div className="flex gap-6 h-[550px] max-h-[calc(100vh-180px)]">
        {/* Sidebar tabs */}
        <div className="w-48 flex-shrink-0 border-r border-border pr-4">
          <nav className="space-y-1">
            {tabsWithBadge.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge && (
                  <span className="absolute right-2 w-2 h-2 bg-accent rounded-full" />
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Content area - fixed height with scroll */}
        <div className="flex-1 min-w-0 overflow-y-auto pr-2">
          {activeTab === 'general' && <ThemePicker />}
          {activeTab === 'builds' && <BuildSettings />}
          {activeTab === 'audio' && <AudioSettings />}
          {activeTab === 'ai' && <AISettings />}
          {activeTab === 'branding' && <BrandingSettings />}
          {activeTab === 'daw-paths' && <DawPathsSettings />}
          {activeTab === 'updates' && <UpdateSettings />}
          {activeTab === 'dev' && <DevSettings />}
        </div>
      </div>
    </Modal>
  );
}
