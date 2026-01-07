import { useState } from 'react';
import { SettingsModal } from '../Settings/SettingsModal';
import { ShareImportModal } from '../Share';
import { AboutModal } from '../About';
import { usePreviewStore } from '../../stores/previewStore';

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
  const { isOpen: isPreviewOpen, toggleOpen: togglePreview } = usePreviewStore();

  return (
    <>
      <header className="h-14 bg-bg-secondary/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <WaveformLogo />
          <h1 className="text-lg font-semibold gradient-text">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={togglePreview}
            className={`p-2 rounded-lg transition-all duration-200 ${
              isPreviewOpen
                ? 'bg-accent/10 text-accent'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
            }`}
            title={isPreviewOpen ? 'Close Preview' : 'Open Preview'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
          </button>
          <button
            onClick={() => setShowShareImport(true)}
            className="px-3 py-1.5 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-all duration-200"
          >
            Share & Import
          </button>
          <button
            onClick={() => setShowAbout(true)}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-all duration-200"
            title="About"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-all duration-200"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
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
