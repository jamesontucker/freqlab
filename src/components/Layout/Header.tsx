import { useState, useEffect } from 'react';
import { SettingsModal } from '../Settings/SettingsModal';
import { ShareImportModal } from '../Share';
import { AboutModal } from '../About';
import { PluginViewerToggle } from './PluginViewerToggle';
import { usePreviewStore } from '../../stores/previewStore';
import { useUpdateStore } from '../../stores/updateStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';

interface HeaderProps {
  title?: string;
}

function WaveformLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 40V35M26 40V30M32 40V25M38 40V20M44 40V25M50 40V30M56 40V35M62 40V32"
            stroke="url(#headerGrad)" strokeWidth="4" strokeLinecap="round"/>
      <path d="M20 40V45M26 40V50M32 40V55M38 40V60M44 40V55M50 40V50M56 40V45M62 40V48"
            stroke="url(#headerGrad)" strokeWidth="4" strokeLinecap="round"/>
      <defs>
        <linearGradient id="headerGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2DA86E"/>
          <stop offset="1" stopColor="#36C07E"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Header({ title = 'freqlab' }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showShareImport, setShowShareImport] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>();

  // === REACTIVE STATE (with selectors) ===
  const isPreviewOpen = usePreviewStore((s) => s.isOpen);
  const updateStatus = useUpdateStore((s) => s.status);
  const hasUpdate = updateStatus === 'available';
  const anyBuildInProgress = useProjectBusyStore((s) => s.buildingPath !== null);

  // === STABLE ACTION REFERENCES ===
  const togglePreview = usePreviewStore.getState().toggleOpen;

  // Listen for open-settings events (e.g., from toast actions)
  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<string>) => {
      setSettingsInitialTab(event.detail);
      setShowSettings(true);
    };

    window.addEventListener('open-settings', handleOpenSettings as EventListener);
    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener);
    };
  }, []);

  // Reset initial tab when modal closes
  const handleCloseSettings = () => {
    setShowSettings(false);
    setSettingsInitialTab(undefined);
  };

  return (
    <>
      <header className="h-14 bg-bg-secondary/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <WaveformLogo />
          <h1 className="text-lg font-semibold gradient-text">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <PluginViewerToggle />
          <button
            onClick={togglePreview}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              isPreviewOpen
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border border-border hover:border-accent/30'
            }`}
            title={isPreviewOpen ? 'Close Controls' : 'Open Controls'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            Controls
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-border mx-1" />

          <button
            onClick={() => !anyBuildInProgress && setShowShareImport(true)}
            disabled={anyBuildInProgress}
            className={`p-2 rounded-lg border transition-all duration-200 ${
              anyBuildInProgress
                ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
                : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
            }`}
            title={anyBuildInProgress ? 'Build in progress...' : 'Share & Import'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          </button>
          <button
            onClick={() => setShowAbout(true)}
            className="p-2 rounded-lg bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border border-border hover:border-accent/30 transition-all duration-200"
            title="About"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </button>
          <button
            onClick={() => !anyBuildInProgress && setShowSettings(true)}
            disabled={anyBuildInProgress}
            className={`relative p-2 rounded-lg border transition-all duration-200 ${
              anyBuildInProgress
                ? 'bg-bg-tertiary text-text-muted border-border opacity-50 cursor-not-allowed'
                : 'bg-bg-tertiary text-text-primary hover:bg-accent/20 hover:text-accent border-border hover:border-accent/30'
            }`}
            title={anyBuildInProgress ? 'Build in progress...' : 'Settings'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {hasUpdate && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
            )}
          </button>
        </div>
      </header>

      <SettingsModal
        isOpen={showSettings}
        onClose={handleCloseSettings}
        initialTab={settingsInitialTab}
      />
      <ShareImportModal
        isOpen={showShareImport}
        onClose={() => setShowShareImport(false)}
        onImportSuccess={() => {
          // Could refresh project list or navigate, for now just close
          setShowShareImport(false);
        }}
      />
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </>
  );
}
