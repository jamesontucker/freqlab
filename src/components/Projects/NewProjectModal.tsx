import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Modal } from '../Common/Modal';
import { Spinner } from '../Common/Spinner';
import { installCmake } from '../../lib/tauri';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTourStore } from '../../stores/tourStore';
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs';
import type { CreateProjectInput, PluginTemplate, UIFramework, LibraryFramework } from '../../types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

// Step order: basic → framework → ui → components
type WizardStep = 'basic' | 'framework' | 'ui' | 'components';

interface ComponentOption {
  id: string;
  name: string;
  description: string;
}

interface UIFrameworkOption {
  id: UIFramework;
  name: string;
  tag: string;
  description: string;
  cpuUsage: 'minimal' | 'light' | 'moderate';
  designControl: 'full' | 'standard' | 'daw-only';
  previewSupport: 'full' | 'none';
  previewNote: string;
}

const UI_FRAMEWORK_OPTIONS: UIFrameworkOption[] = [
  {
    id: 'webview',
    name: 'Advanced UI',
    tag: 'WebView',
    description: 'Best for plugins where appearance and user experience are top priorities.',
    cpuUsage: 'moderate',
    designControl: 'full',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'egui',
    name: 'Simple UI',
    tag: 'egui',
    description: 'Good middle ground between visual polish and CPU efficiency.',
    cpuUsage: 'light',
    designControl: 'standard',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'native',
    name: 'No Custom UI',
    tag: 'Native',
    description: 'Focus entirely on your audio algorithm. Your DAW provides basic controls.',
    cpuUsage: 'minimal',
    designControl: 'daw-only',
    previewSupport: 'none',
    previewNote: 'Requires DAW to test parameters',
  },
];

// JUCE-specific UI framework options
const JUCE_UI_FRAMEWORK_OPTIONS: UIFrameworkOption[] = [
  {
    id: 'webview',
    name: 'Advanced UI',
    tag: 'WebView',
    description: 'Modern HTML/CSS/JS interface. Best for complex, polished UIs.',
    cpuUsage: 'moderate',
    designControl: 'full',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'juce',
    name: 'JUCE UI',
    tag: 'Components',
    description: 'Traditional JUCE Components with LookAndFeel. Cross-platform consistent.',
    cpuUsage: 'light',
    designControl: 'standard',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'native',
    name: 'No Custom UI',
    tag: 'Native',
    description: 'Focus entirely on your audio algorithm. Your DAW provides basic controls.',
    cpuUsage: 'minimal',
    designControl: 'daw-only',
    previewSupport: 'none',
    previewNote: 'Requires DAW to test parameters',
  },
];

// iPlug2-specific UI framework options
const IPLUG2_UI_FRAMEWORK_OPTIONS: UIFrameworkOption[] = [
  {
    id: 'webview',
    name: 'Advanced UI',
    tag: 'WebView',
    description: 'Modern HTML/CSS/JS interface. Best for complex, polished UIs.',
    cpuUsage: 'moderate',
    designControl: 'full',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'igraphics',
    name: 'IGraphics UI',
    tag: 'NanoVG',
    description: 'Native vector graphics with IControls. Fast and cross-platform consistent.',
    cpuUsage: 'light',
    designControl: 'standard',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'native',
    name: 'No Custom UI',
    tag: 'Native',
    description: 'Focus entirely on your audio algorithm. Your DAW provides basic controls.',
    cpuUsage: 'minimal',
    designControl: 'daw-only',
    previewSupport: 'none',
    previewNote: 'Requires DAW to test parameters',
  },
];

// SVG icons for UI framework options
function WebViewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 8h18" />
      <circle cx="5.5" cy="6" r="0.5" fill="currentColor" />
      <circle cx="7.5" cy="6" r="0.5" fill="currentColor" />
      <circle cx="9.5" cy="6" r="0.5" fill="currentColor" />
      <path d="M7 12l3 3-3 3M12 18h5" />
    </svg>
  );
}

function EguiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <rect x="5" y="11" width="6" height="2" rx="0.5" />
      <rect x="5" y="15" width="4" height="2" rx="0.5" />
      <circle cx="16" cy="14" r="3" />
      <path d="M16 12v2h2" />
    </svg>
  );
}

function NativeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 3v18" />
      <path d="M8 6l4-3 4 3" />
      <path d="M8 18l4 3 4-3" />
      <path d="M3 12h4M17 12h4" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IGraphicsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 7v10M7 12h10" />
      <path d="M9 9l6 6M15 9l-6 6" strokeOpacity="0.5" />
    </svg>
  );
}

function JuceUIIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {/* Main container */}
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {/* Slider component */}
      <rect x="5" y="6" width="6" height="2" rx="1" />
      <circle cx="9" cy="7" r="1.5" fill="currentColor" />
      {/* Button component */}
      <rect x="13" y="5" width="6" height="4" rx="1" />
      {/* Knob component */}
      <circle cx="8" cy="14" r="3" />
      <path d="M8 12v2" />
      {/* Text/label */}
      <rect x="13" y="12" width="5" height="1.5" rx="0.5" fill="currentColor" />
      <rect x="13" y="15" width="4" height="1.5" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function getUIFrameworkIcon(id: string, className?: string) {
  switch (id) {
    case 'webview': return <WebViewIcon className={className} />;
    case 'egui': return <EguiIcon className={className} />;
    case 'igraphics': return <IGraphicsIcon className={className} />;
    case 'juce': return <JuceUIIcon className={className} />;
    case 'native': return <NativeIcon className={className} />;
    default: return <NativeIcon className={className} />;
  }
}

// SVG icons for plugin frameworks
function RustIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.687 11.709l-.995-.616a13.559 13.559 0 0 0-.028-.29l.855-.797a.344.344 0 0 0-.114-.571l-1.093-.39a8.59 8.59 0 0 0-.086-.282l.682-.947a.344.344 0 0 0-.204-.531l-1.152-.202a9.172 9.172 0 0 0-.14-.262l.483-1.063a.344.344 0 0 0-.283-.478l-1.167-.013a9.027 9.027 0 0 0-.187-.235l.263-1.14a.344.344 0 0 0-.355-.413l-1.138.173a8.697 8.697 0 0 0-.227-.2l.029-1.176a.344.344 0 0 0-.416-.338l-1.064.356a8.473 8.473 0 0 0-.259-.16l-.207-1.169a.344.344 0 0 0-.466-.254l-.95.53a8.439 8.439 0 0 0-.282-.113l-.433-1.117a.344.344 0 0 0-.501-.165l-.798.69a8.462 8.462 0 0 0-.296-.06l-.644-1.024a.344.344 0 0 0-.52-.07l-.616.826a8.527 8.527 0 0 0-.3-.005l-.834-.89a.344.344 0 0 0-.52.028l-.41.929a8.592 8.592 0 0 0-.295.047l-.998-.715a.344.344 0 0 0-.502.123l-.187.999a8.685 8.685 0 0 0-.278.1l-1.126-.502a.344.344 0 0 0-.467.212l.041 1.035a8.765 8.765 0 0 0-.253.15l-1.214-.254a.344.344 0 0 0-.414.29l.264 1.03a8.832 8.832 0 0 0-.22.196l-1.26.013a.344.344 0 0 0-.347.36l.475.984a8.874 8.874 0 0 0-.178.234l-1.26.28a.344.344 0 0 0-.264.418l.671.898a8.897 8.897 0 0 0-.13.266l-1.215.544a.344.344 0 0 0-.168.463l.847.773a8.9 8.9 0 0 0-.074.29l-1.123.796a.344.344 0 0 0-.061.492l1.001.617c-.003.097-.005.193-.005.29l-.87.79a.344.344 0 0 0 .054.564l1.094.39c.026.095.054.19.086.282l-.68.946a.344.344 0 0 0 .165.524l1.152.202c.045.089.092.176.14.262l-.483 1.063a.344.344 0 0 0 .244.471l1.166.012c.061.08.123.158.188.235l-.263 1.14a.344.344 0 0 0 .316.407l1.138-.173c.074.068.15.135.228.2l-.03 1.176a.344.344 0 0 0 .377.332l1.064-.356c.085.055.17.108.26.16l.207 1.169a.344.344 0 0 0 .427.247l.95-.53c.092.04.186.078.282.113l.433 1.117a.344.344 0 0 0 .463.159l.798-.69c.098.022.196.042.296.06l.644 1.024a.344.344 0 0 0 .481.064l.616-.826c.1.004.199.005.3.005l.834.89a.344.344 0 0 0 .48-.022l.41-.93c.099-.014.197-.03.295-.047l.998.715a.344.344 0 0 0 .464-.117l.187-.999c.094-.031.187-.064.278-.1l1.126.502a.344.344 0 0 0 .428-.206l-.041-1.035c.087-.048.172-.098.253-.15l1.214.254a.344.344 0 0 0 .376-.284l-.264-1.03c.076-.064.149-.129.22-.196l1.26-.013a.344.344 0 0 0 .307-.354l-.475-.984c.062-.077.121-.155.178-.234l1.26-.28a.344.344 0 0 0 .224-.412l-.671-.898c.046-.087.09-.176.13-.266l1.215-.544a.344.344 0 0 0 .128-.457l-.847-.773c.027-.096.051-.193.074-.29l1.123-.796a.344.344 0 0 0 .02-.486zM12 18.858a6.858 6.858 0 1 1 0-13.716 6.858 6.858 0 0 1 0 13.716z"/>
    </svg>
  );
}

function CppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.5 15.97l.41 2.44c-.26.14-.68.27-1.24.39-.57.13-1.24.2-2.01.2-2.21-.04-3.87-.7-4.98-1.96C1.56 15.77 1 14.16 1 12.21c.05-2.31.72-4.08 2-5.32C4.32 5.64 5.96 5 7.94 5c.75 0 1.4.07 1.94.19s.94.25 1.2.4l-.58 2.49-1.06-.34c-.4-.1-.86-.15-1.39-.15-1.16-.01-2.12.36-2.87 1.1-.76.73-1.15 1.85-1.18 3.34 0 1.36.37 2.42 1.08 3.2.71.77 1.71 1.17 2.99 1.18l1.33-.12c.43-.08.79-.19 1.1-.32zm3.5.14l-.67-4.03h-.04l-.67 4.03h-2.23l1.34-8.03h3.18l1.34 8.03h-2.25zm7.97-3.97H24v2h-2.03v2.03h-2V14.14h-2.03v-2h2.03V10.1h2v2.04z"/>
    </svg>
  );
}

const EFFECT_COMPONENTS: ComponentOption[] = [
  { id: 'preset_system', name: 'Preset System', description: 'Save and load preset functionality' },
  { id: 'param_smoothing', name: 'Parameter Smoothing', description: 'Smooth parameter interpolation' },
  { id: 'sidechain_input', name: 'Sidechain Input', description: 'Auxiliary audio input channel' },
  { id: 'oversampling', name: 'Oversampling', description: '2x/4x oversampling for quality' },
];

const INSTRUMENT_COMPONENTS: ComponentOption[] = [
  { id: 'preset_system', name: 'Preset System', description: 'Save and load preset functionality' },
  { id: 'polyphony', name: 'Polyphony', description: 'Multi-voice architecture (8 voices)' },
  { id: 'velocity_layers', name: 'Velocity Layers', description: 'Velocity-sensitive response' },
  { id: 'adsr_envelope', name: 'ADSR Envelope', description: 'Attack/Decay/Sustain/Release' },
  { id: 'lfo', name: 'LFO Modulation', description: 'Low-frequency oscillator' },
];

// Pure utility functions
function toFolderName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function validateName(displayName: string, existingFolderNames: string[]): string | null {
  if (!displayName.trim()) return 'Name is required';
  if (displayName.length > 50) return 'Name too long (max 50 chars)';

  const folderName = toFolderName(displayName);
  if (!folderName) return 'Name must contain at least one letter or number';
  if (!/^[a-z]/.test(folderName)) return 'Name must start with a letter';

  if (existingFolderNames.includes(folderName)) {
    return 'A project with this name already exists';
  }

  return null;
}

// CPU usage badge labels
const CPU_LABELS: Record<UIFrameworkOption['cpuUsage'], string> = {
  minimal: 'Minimal CPU',
  light: 'Light CPU',
  moderate: 'Moderate CPU',
};

// Design creativity badge labels
const DESIGN_LABELS: Record<UIFrameworkOption['designControl'], string> = {
  full: 'Unlimited creativity',
  standard: 'Standard styling',
  'daw-only': 'DAW native UI',
};

// Design creativity icons
function DesignControlIcon({ type, className }: { type: UIFrameworkOption['designControl']; className?: string }) {
  switch (type) {
    case 'full':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      );
    case 'standard':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
        </svg>
      );
    case 'daw-only':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h18" />
          <circle cx="5.5" cy="6" r="0.5" fill="currentColor" />
          <circle cx="7.5" cy="6" r="0.5" fill="currentColor" />
          <circle cx="9.5" cy="6" r="0.5" fill="currentColor" />
        </svg>
      );
  }
}

// Framework display data - user-friendly names and descriptions
interface FrameworkDisplayInfo {
  displayName: string;
  tagline: string;
  icon: (className?: string) => JSX.Element;
  licenseType: 'free' | 'conditional' | 'paid';
  licenseLabel: string;
  licenseNote: string;
  languageLabel: string;
  platforms: string[];
  features: string[];
  buildSpeed: 'fast' | 'slow';
  buildNote: string;
}

// Consistent format order for all frameworks
const FORMAT_ORDER = ['.clap', '.vst3', '.component', '.appex', '.app'];

// Display names for extensions (e.g., .app -> standalone)
const FORMAT_DISPLAY_NAMES: Record<string, string> = {
  '.app': 'standalone',
};

function sortFormats(outputs: Record<string, { extension: string; description: string }>): Array<{ key: string; extension: string; displayName: string; description: string }> {
  return Object.entries(outputs)
    .map(([key, output]) => ({
      key,
      ...output,
      displayName: FORMAT_DISPLAY_NAMES[output.extension] || output.extension,
    }))
    .sort((a, b) => {
      const aIndex = FORMAT_ORDER.indexOf(a.extension);
      const bIndex = FORMAT_ORDER.indexOf(b.extension);
      if (aIndex === -1 && bIndex === -1) return a.extension.localeCompare(b.extension);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
}

function getFrameworkDisplayInfo(fw: LibraryFramework): FrameworkDisplayInfo {
  if (fw.id === 'nih-plug') {
    return {
      displayName: 'NIH-plug',
      tagline: 'Modern, memory-safe plugin development with excellent performance',
      icon: (className) => <RustIcon className={className} />,
      licenseType: 'free',
      licenseLabel: 'Free for all use',
      licenseNote: 'Open source, no restrictions',
      languageLabel: 'Rust',
      platforms: ['macOS', 'Windows', 'Linux'],
      features: ['Crash resistant', 'Fast iteration', 'Modern tooling'],
      buildSpeed: 'fast',
      buildNote: 'Fast incremental builds',
    };
  } else if (fw.id === 'juce') {
    return {
      displayName: 'JUCE',
      tagline: 'Industry-standard framework used by major plugin companies',
      icon: (className) => <CppIcon className={className} />,
      licenseType: 'conditional',
      licenseLabel: 'Free up to $50K',
      licenseNote: 'Commercial license required above $50K/year revenue',
      languageLabel: 'C++',
      platforms: ['macOS', 'Windows', 'Linux'],
      features: ['Industry standard', 'Most resources', 'Battle-tested'],
      buildSpeed: 'slow',
      buildNote: 'Slower C++ compilation',
    };
  } else if (fw.id === 'iplug2') {
    return {
      displayName: 'iPlug2',
      tagline: 'Lightweight framework with flexible UI options and permissive license',
      icon: (className) => <CppIcon className={className} />,
      licenseType: 'free',
      licenseLabel: 'Free for all use',
      licenseNote: 'Permissive license, no restrictions',
      languageLabel: 'C++',
      platforms: ['macOS', 'Windows'],
      features: ['Lightweight', 'Simple setup', 'Small footprint'],
      buildSpeed: 'slow',
      buildNote: 'Slower C++ compilation',
    };
  }
  // Default fallback
  return {
    displayName: fw.display_name,
    tagline: fw.description,
    icon: (className) => <RustIcon className={className} />,
    licenseType: 'free',
    licenseLabel: 'Check license',
    licenseNote: '',
    languageLabel: fw.language,
    platforms: ['macOS'],
    features: [],
    buildSpeed: 'slow',
    buildNote: '',
  };
}

// Install event type for streaming
interface InstallEvent {
  type: 'start' | 'output' | 'done' | 'error';
  step?: string;
  line?: string;
  success?: boolean;
  message?: string;
}

// Component for showing framework prerequisite warnings with install option
function PrerequisiteWarning({ warnings, onInstalled }: { warnings: string[]; onInstalled: () => void }) {
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [showOutput, setShowOutput] = useState(false);

  // Check if cmake is in the warnings
  const needsCmake = warnings.some(w => w.toLowerCase().includes('cmake'));

  const handleInstallCmake = async () => {
    setInstalling(true);
    setOutput([]);
    setShowOutput(true);

    let unlisten: UnlistenFn | null = null;

    try {
      unlisten = await listen<InstallEvent>('install-stream', (event) => {
        const data = event.payload;
        if (data.type === 'output' && data.line) {
          setOutput(prev => [...prev.slice(-20), data.line!]);
        } else if (data.type === 'done') {
          setInstalling(false);
          if (data.success) {
            onInstalled();
          }
        }
      });

      await installCmake();
    } catch (err) {
      setOutput(prev => [...prev, `Error: ${err}`]);
      setInstalling(false);
    } finally {
      if (unlisten) unlisten();
    }
  };

  return (
    <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-warning">Missing Requirements</p>
          <ul className="mt-1 text-xs text-text-secondary space-y-0.5">
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>

          {needsCmake && (
            <div className="mt-3">
              <button
                onClick={handleInstallCmake}
                disabled={installing}
                className="px-3 py-1.5 text-xs font-medium bg-warning/20 hover:bg-warning/30 text-warning border border-warning/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {installing ? (
                  <>
                    <Spinner size="sm" />
                    Installing CMake...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Install CMake via Homebrew
                  </>
                )}
              </button>

              {showOutput && output.length > 0 && (
                <div className="mt-2 p-2 bg-bg-primary rounded-md max-h-24 overflow-y-auto">
                  <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap">
                    {output.join('\n')}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NewProjectModal({ isOpen, onClose, onSubmit }: NewProjectModalProps) {
  // Step order changed: basic → framework → ui → components
  const [step, setStep] = useState<WizardStep>('basic');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<PluginTemplate>('effect');
  const [uiFramework, setUiFramework] = useState<UIFramework>('webview');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { vendorName, vendorUrl, vendorEmail } = useSettingsStore();

  // Framework selection
  const [frameworks, setFrameworks] = useState<LibraryFramework[]>([]);
  const [frameworksLoading, setFrameworksLoading] = useState(true);
  const [frameworksError, setFrameworksError] = useState<string | null>(null);
  const [frameworkId, setFrameworkId] = useState<string>('nih-plug');
  const [frameworkPrereqWarnings, setFrameworkPrereqWarnings] = useState<string[]>([]);

  // Load frameworks from library
  const loadFrameworks = useCallback(async () => {
    setFrameworksLoading(true);
    setFrameworksError(null);
    try {
      const fws = await invoke<LibraryFramework[]>('get_frameworks');
      // Sort frameworks: nih-plug first, then iplug2, then juce, then others alphabetically
      const frameworkOrder = ['nih-plug', 'iplug2', 'juce'];
      const sortedFws = [...fws].sort((a, b) => {
        const aIndex = frameworkOrder.indexOf(a.id);
        const bIndex = frameworkOrder.indexOf(b.id);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.id.localeCompare(b.id);
      });
      setFrameworks(sortedFws);
      // Default to first framework if none selected yet
      if (sortedFws.length > 0) {
        setFrameworkId(current => sortedFws.find(f => f.id === current) ? current : sortedFws[0].id);
      }
    } catch (err) {
      console.error('Failed to load frameworks:', err);
      setFrameworks([]);
      setFrameworksError(String(err));
    } finally {
      setFrameworksLoading(false);
    }
  }, []); // No dependencies - only load when modal opens

  // Load frameworks when modal opens
  useEffect(() => {
    if (isOpen) {
      loadFrameworks();
    }
  }, [isOpen, loadFrameworks]);

  // Get the selected framework object
  const selectedFramework = useMemo(() => {
    return frameworks.find(f => f.id === frameworkId);
  }, [frameworks, frameworkId]);

  // Get UI framework options based on selected framework
  const frameworkUiOptions = useMemo(() => {
    if (!selectedFramework) return UI_FRAMEWORK_OPTIONS;

    // Use JUCE-specific options for JUCE
    if (selectedFramework.id === 'juce') {
      return JUCE_UI_FRAMEWORK_OPTIONS;
    }

    // Use iPlug2-specific options for iPlug2
    if (selectedFramework.id === 'iplug2') {
      return IPLUG2_UI_FRAMEWORK_OPTIONS;
    }

    // For nih-plug, filter to available options
    return selectedFramework.ui_frameworks.map(ui => {
      const defaultOption = UI_FRAMEWORK_OPTIONS.find(o => o.id === ui.id);
      if (defaultOption) return defaultOption;
      return {
        id: ui.id as UIFramework,
        name: ui.name,
        tag: ui.id,
        description: ui.description,
        cpuUsage: 'light' as const,
        designControl: 'standard' as const,
        previewSupport: 'full' as const,
        previewNote: 'Preview available',
      };
    });
  }, [selectedFramework]);

  // Tour mode
  const tourActive = useTourStore((s) => s.isActive);
  const currentTourStep = useTourStore((s) => s.currentStep);
  const exitTour = useTourStore.getState().exitTour;
  const isTourMode = tourActive && (currentTourStep?.startsWith('new-plugin-') || currentTourStep?.startsWith('introduce-'));

  // Tour refs
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const typeSelectionRef = useRef<HTMLDivElement>(null);
  const effectTypeRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const nextUiButtonRef = useRef<HTMLButtonElement>(null);
  const frameworkSelectionRef = useRef<HTMLDivElement>(null);
  const webviewFrameworkRef = useRef<HTMLButtonElement>(null);
  const eguiFrameworkRef = useRef<HTMLButtonElement>(null);
  const componentsSelectionRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const skipButtonRef = useRef<HTMLButtonElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  // Register tour refs when modal is open
  useEffect(() => {
    if (isOpen) {
      registerTourRef('new-plugin-name-input', nameInputRef);
      registerTourRef('new-plugin-description-input', descriptionInputRef);
      registerTourRef('new-plugin-type-selection', typeSelectionRef);
      registerTourRef('new-plugin-type-effect', effectTypeRef);
      registerTourRef('new-plugin-next-button', nextButtonRef);
      registerTourRef('new-plugin-next-ui-button', nextUiButtonRef);
      registerTourRef('new-plugin-framework-selection', frameworkSelectionRef);
      registerTourRef('new-plugin-framework-webview', webviewFrameworkRef);
      registerTourRef('new-plugin-framework-egui', eguiFrameworkRef);
      registerTourRef('new-plugin-components-selection', componentsSelectionRef);
      registerTourRef('new-plugin-create-button', createButtonRef);
      registerTourRef('new-plugin-skip-button', skipButtonRef);
      registerTourRef('new-plugin-modal', modalContentRef);
      return () => {
        unregisterTourRef('new-plugin-name-input');
        unregisterTourRef('new-plugin-description-input');
        unregisterTourRef('new-plugin-type-selection');
        unregisterTourRef('new-plugin-type-effect');
        unregisterTourRef('new-plugin-next-button');
        unregisterTourRef('new-plugin-next-ui-button');
        unregisterTourRef('new-plugin-framework-selection');
        unregisterTourRef('new-plugin-framework-webview');
        unregisterTourRef('new-plugin-framework-egui');
        unregisterTourRef('new-plugin-components-selection');
        unregisterTourRef('new-plugin-create-button');
        unregisterTourRef('new-plugin-skip-button');
        unregisterTourRef('new-plugin-modal');
      };
    }
  }, [isOpen]);

  // Tour mode: pre-fill values
  useEffect(() => {
    if (isOpen && isTourMode && name === '') {
      setName('My Phaser');
      setTemplate('effect');
      setUiFramework('egui');
      setDescription('A phaser effect with rate and depth controls');
      setFrameworkId('nih-plug');
    }
  }, [isOpen, isTourMode]);

  // Check framework prerequisites
  useEffect(() => {
    if (!isOpen) {
      setFrameworkPrereqWarnings([]);
      return;
    }

    invoke<string[]>('check_framework_prerequisites', { frameworkId })
      .then(warnings => setFrameworkPrereqWarnings(warnings))
      .catch(() => setFrameworkPrereqWarnings([]));
  }, [isOpen, frameworkId]);

  // Get existing project names for duplicate checking
  const projects = useProjectStore((s) => s.projects);
  const existingFolderNames = useMemo(() =>
    projects.map(p => p.path.split('/').pop() || ''),
    [projects]
  );

  const handleNext = useCallback(() => {
    if (step === 'basic') {
      const nameError = validateName(name, existingFolderNames);
      if (nameError) {
        setError(nameError);
        return;
      }
      setError(null);
      setStep('framework');
    } else if (step === 'framework') {
      setError(null);
      // Reset UI framework to first available when changing frameworks
      if (frameworkUiOptions.length > 0) {
        setUiFramework(frameworkUiOptions[0].id);
      }
      setStep('ui');
    } else if (step === 'ui') {
      setError(null);
      setStep('components');
    }
  }, [step, name, existingFolderNames, frameworkUiOptions]);

  const handleBack = useCallback(() => {
    if (step === 'framework') {
      setStep('basic');
    } else if (step === 'ui') {
      setStep('framework');
    } else if (step === 'components') {
      setStep('ui');
    }
    setError(null);
  }, [step]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const folderName = toFolderName(name);
      await onSubmit({
        name: folderName,
        displayName: name.trim(),
        description,
        frameworkId,
        template,
        uiFramework,
        vendorName: vendorName || 'freqlab',
        vendorUrl: vendorUrl || '',
        vendorEmail: vendorEmail || '',
        components: selectedComponents.length > 0 ? selectedComponents : undefined,
      });
      // Reset state
      setName('');
      setDescription('');
      setTemplate('effect');
      setUiFramework('webview');
      setSelectedComponents([]);
      setFrameworkId('nih-plug');
      setStep('basic');
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [name, description, frameworkId, template, uiFramework, selectedComponents, vendorName, vendorUrl, vendorEmail, onSubmit, onClose]);

  const handleClose = useCallback(() => {
    if (isTourMode) {
      exitTour();
    }
    setName('');
    setDescription('');
    setTemplate('effect');
    setUiFramework('webview');
    setSelectedComponents([]);
    setFrameworkId('nih-plug');
    setStep('basic');
    setError(null);
    onClose();
  }, [isTourMode, exitTour, onClose]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.slice(0, 50);
    setName(value);
    setError(null);
  }, []);

  const toggleComponent = useCallback((id: string) => {
    setSelectedComponents(prev =>
      prev.includes(id)
        ? prev.filter(c => c !== id)
        : [...prev, id]
    );
  }, []);

  const components = useMemo(() =>
    template === 'effect' ? EFFECT_COMPONENTS : INSTRUMENT_COMPONENTS,
    [template]
  );

  // Step order for indicators
  const steps: WizardStep[] = ['basic', 'framework', 'ui', 'components'];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Plugin" size="lg" preventClose={isTourMode}>
      <div ref={modalContentRef} className="flex flex-col min-h-[435px]">
        {/* Step 1: Basic Info */}
        {step === 'basic' && (
          <div className="space-y-4">
            {/* Plugin Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
                Plugin Name
              </label>
              <input
                ref={nameInputRef}
                type="text"
                id="name"
                value={name}
                onChange={handleNameChange}
                placeholder="My Awesome Plugin"
                maxLength={50}
                className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                autoFocus
              />
              <div className="mt-1 flex justify-end">
                <span className={`text-xs ${name.length >= 45 ? 'text-warning' : 'text-text-muted'}`}>
                  {name.length}/50
                </span>
              </div>
            </div>

            {/* Plugin Type */}
            <div ref={typeSelectionRef}>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Plugin Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  ref={effectTypeRef}
                  type="button"
                  disabled={isTourMode}
                  onClick={() => {
                    setTemplate('effect');
                    setSelectedComponents([]);
                  }}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    template === 'effect'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-text-muted hover:bg-bg-tertiary/50'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      template === 'effect' ? 'bg-accent/20' : 'bg-bg-tertiary'
                    }`}>
                      <svg className={`w-4 h-4 ${template === 'effect' ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" d="M6 4v16M12 4v16M18 4v16" />
                        <rect x="4" y="6" width="4" height="3" rx="1" fill="currentColor" />
                        <rect x="10" y="12" width="4" height="3" rx="1" fill="currentColor" />
                        <rect x="16" y="9" width="4" height="3" rx="1" fill="currentColor" />
                      </svg>
                    </div>
                    <span className={`text-sm font-semibold ${template === 'effect' ? 'text-accent' : 'text-text-primary'}`}>
                      Effect
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">Processes audio - EQ, compressor, delay</p>
                </button>
                <button
                  type="button"
                  disabled={isTourMode}
                  onClick={() => {
                    setTemplate('instrument');
                    setSelectedComponents([]);
                  }}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    template === 'instrument'
                      ? 'border-accent bg-accent/5'
                      : isTourMode
                        ? 'border-border opacity-50 cursor-not-allowed'
                        : 'border-border hover:border-text-muted hover:bg-bg-tertiary/50'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      template === 'instrument' ? 'bg-accent/20' : 'bg-bg-tertiary'
                    }`}>
                      <svg className={`w-4 h-4 ${template === 'instrument' ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="M6 4v10M10 4v10M14 4v10M18 4v10" />
                        <rect x="5" y="4" width="2" height="6" fill="currentColor" />
                        <rect x="9" y="4" width="2" height="6" fill="currentColor" />
                        <rect x="13" y="4" width="2" height="6" fill="currentColor" />
                        <rect x="17" y="4" width="2" height="6" fill="currentColor" />
                      </svg>
                    </div>
                    <span className={`text-sm font-semibold ${template === 'instrument' ? 'text-accent' : 'text-text-primary'}`}>
                      Instrument
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">Generates sound - synth, sampler</p>
                </button>
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="description" className="text-sm font-medium text-text-secondary">
                  Description
                </label>
                <span className="text-xs text-text-muted">Helps the chat understand your vision</span>
              </div>
              <textarea
                ref={descriptionInputRef}
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 280))}
                placeholder="A warm analog-style compressor with soft knee compression..."
                rows={2}
                maxLength={280}
                className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none"
              />
              <div className="mt-1 flex justify-end">
                <span className={`text-xs ${description.length >= 260 ? 'text-warning' : 'text-text-muted'}`}>
                  {description.length}/280
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Framework Selection */}
        {step === 'framework' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-1">Choose Your Framework</h3>
              <p className="text-xs text-text-muted mb-4">
                Pick the programming language and framework for your plugin.
              </p>
              {frameworksLoading ? (
                <div className="flex items-center justify-center h-48">
                  <div className="flex items-center gap-3 text-text-secondary">
                    <Spinner size="sm" />
                    Loading frameworks...
                  </div>
                </div>
              ) : frameworks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-text-secondary gap-3">
                  <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm">{frameworksError ? 'Failed to load frameworks' : 'No frameworks available'}</p>
                  {frameworksError && (
                    <p className="text-xs text-text-muted max-w-xs text-center">{frameworksError}</p>
                  )}
                  <button
                    type="button"
                    onClick={loadFrameworks}
                    className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Try Again
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {frameworks.map((fw) => {
                    const isSelected = frameworkId === fw.id;
                    const isBlockedByTour = isTourMode && fw.id !== 'nih-plug';
                    const displayInfo = getFrameworkDisplayInfo(fw);

                    return (
                      <button
                        key={fw.id}
                        type="button"
                        onClick={() => {
                          if (isBlockedByTour) return;
                          setFrameworkId(fw.id);
                        }}
                        disabled={isBlockedByTour}
                        className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-accent bg-gradient-to-br from-accent/10 to-accent/5'
                            : 'border-border hover:border-text-muted hover:bg-bg-tertiary/50'
                        } ${isBlockedByTour ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {/* Selection indicator */}
                        {isSelected && (
                          <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}

                        <div className="flex-1 min-w-0 pr-8">
                          {/* Title row with language and license */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-semibold ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                              {displayInfo.displayName}
                            </span>
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-muted">
                              {displayInfo.languageLabel}
                            </span>
                            {/* License badge */}
                            <div className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                              displayInfo.licenseType === 'free'
                                ? 'bg-green-500/10 text-green-400'
                                : displayInfo.licenseType === 'conditional'
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-red-500/10 text-red-400'
                            }`}>
                              {displayInfo.licenseType === 'free' ? (
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                              )}
                              {displayInfo.licenseLabel}
                            </div>
                            {/* Build speed indicator */}
                            <div className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                              displayInfo.buildSpeed === 'fast'
                                ? 'bg-blue-500/10 text-blue-400'
                                : 'bg-orange-500/10 text-orange-400'
                            }`} title={displayInfo.buildNote}>
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              {displayInfo.buildSpeed === 'fast' ? 'Fast builds' : 'Slower builds'}
                            </div>
                          </div>
                          <p className="text-xs text-text-muted mt-1">{displayInfo.tagline}</p>

                          {/* Platforms and Features row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                            {/* Platforms */}
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              <span className="text-[10px] text-text-secondary">
                                {displayInfo.platforms.join(' · ')}
                              </span>
                            </div>

                            {/* Features */}
                            <div className="flex items-center gap-1.5">
                              {displayInfo.features.map((feature) => (
                                <span
                                  key={feature}
                                  className="px-1.5 py-0.5 text-[10px] rounded bg-accent/10 text-accent"
                                >
                                  {feature}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Formats row */}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span className="text-[10px] text-text-muted">Formats:</span>
                            {sortFormats(fw.outputs).map(({ key, displayName }) => (
                              <span
                                key={key}
                                className="px-2 py-0.5 text-[10px] rounded-md bg-bg-tertiary text-text-secondary"
                              >
                                {displayName}
                              </span>
                            ))}
                          </div>

                          {/* License note for conditional */}
                          {displayInfo.licenseType === 'conditional' && (
                            <p className="text-[10px] text-amber-400/80 mt-2">
                              {displayInfo.licenseNote}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Prerequisites warning */}
            {frameworkPrereqWarnings.length > 0 && (
              <PrerequisiteWarning
                warnings={frameworkPrereqWarnings}
                onInstalled={() => {
                  // Re-check prerequisites after installation
                  invoke<string[]>('check_framework_prerequisites', { frameworkId })
                    .then(warnings => setFrameworkPrereqWarnings(warnings))
                    .catch(() => {});
                }}
              />
            )}
          </div>
        )}

        {/* Step 3: UI Framework */}
        {step === 'ui' && (
          <>
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-1">Interface Style</h3>
              <p className="text-xs text-text-muted mb-4">
                How important is your plugin's visual appearance vs. CPU efficiency?
              </p>
              <div ref={frameworkSelectionRef} className="grid grid-cols-3 gap-3">
                {frameworkUiOptions.map((option) => {
                  const isBlockedByTour = isTourMode && option.id !== 'egui';
                  return (
                  <button
                    key={option.id}
                    ref={option.id === 'webview' ? webviewFrameworkRef : option.id === 'egui' ? eguiFrameworkRef : undefined}
                    type="button"
                    onClick={() => {
                      if (isBlockedByTour) return;
                      setUiFramework(option.id);
                    }}
                    className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left flex flex-col ${
                      uiFramework === option.id
                        ? 'border-accent bg-gradient-to-br from-accent/10 to-accent/5 shadow-lg shadow-accent/10'
                        : 'border-border hover:border-text-muted hover:bg-bg-tertiary/50'
                    } ${isBlockedByTour ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {/* Selection indicator */}
                    {uiFramework === option.id && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}

                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-all ${
                      uiFramework === option.id ? 'bg-accent/20' : 'bg-bg-tertiary'
                    }`}>
                      {getUIFrameworkIcon(option.id, `w-5 h-5 ${uiFramework === option.id ? 'text-accent' : 'text-text-muted'}`)}
                    </div>

                    {/* Title */}
                    <div className={`text-sm font-semibold mb-1 pr-6 ${
                      uiFramework === option.id ? 'text-accent' : 'text-text-primary'
                    }`}>
                      {option.name} <span className="text-[10px] font-normal text-text-muted">({option.tag})</span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-text-muted mb-3 flex-1">{option.description}</p>

                    {/* Trade-off badges */}
                    <div className="space-y-1.5">
                      <div className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                        uiFramework === option.id ? 'bg-bg-tertiary/80' : 'bg-bg-tertiary'
                      }`}>
                        <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-text-secondary">{CPU_LABELS[option.cpuUsage]}</span>
                      </div>
                      <div className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                        uiFramework === option.id ? 'bg-bg-tertiary/80' : 'bg-bg-tertiary'
                      }`}>
                        <DesignControlIcon type={option.designControl} className="w-3 h-3 text-violet-400 flex-shrink-0" />
                        <span className="text-text-secondary">{DESIGN_LABELS[option.designControl]}</span>
                      </div>
                      <div className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                        option.previewSupport === 'full'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {option.previewSupport === 'full' ? (
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        )}
                        <span className="text-[10px]">{option.previewNote}</span>
                      </div>
                    </div>
                  </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Step 4: Components */}
        {step === 'components' && (
          <>
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-medium text-text-secondary">Features to Develop</h3>
                <span className="text-xs text-text-muted">Optional - skip if unsure</span>
              </div>
              <div ref={componentsSelectionRef} className="grid grid-cols-2 gap-2">
                {components.map((component) => {
                  const isSelected = selectedComponents.includes(component.id);
                  return (
                    <button
                      key={component.id}
                      type="button"
                      onClick={() => {
                        if (isTourMode) return;
                        toggleComponent(component.id);
                      }}
                      disabled={isTourMode}
                      className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left group ${
                        isSelected
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-text-muted'
                      } ${isTourMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <div className={`w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          isSelected
                            ? 'border-accent bg-accent'
                            : 'border-text-muted/50 group-hover:border-text-muted'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-semibold ${
                            isSelected ? 'text-accent' : 'text-text-primary'
                          }`}>
                            {component.name}
                          </div>
                          <div className="text-xs text-text-muted mt-0.5">
                            {component.description}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selection summary */}
              {selectedComponents.length > 0 && (
                <div className="mt-3 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
                  <p className="text-xs text-accent">
                    {selectedComponents.length} feature{selectedComponents.length !== 1 ? 's' : ''} selected
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="mt-auto pt-4 space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-error-subtle border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {/* Step indicator */}
          <div className="flex justify-center gap-2">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'w-6 bg-accent'
                    : i < steps.indexOf(step)
                    ? 'w-1.5 bg-accent/50'
                    : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            {step === 'basic' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (isTourMode) return;
                    handleClose();
                  }}
                  disabled={isTourMode}
                  className={`flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 ${
                    isTourMode ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Cancel
                </button>
                <button
                  ref={nextButtonRef}
                  type="button"
                  onClick={() => {
                    if (isTourMode && currentTourStep !== 'new-plugin-next-basic') return;
                    handleNext();
                  }}
                  disabled={!name || (isTourMode && currentTourStep !== 'new-plugin-next-basic')}
                  className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-xl transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none"
                >
                  Next
                </button>
              </>
            )}
            {step === 'framework' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (isTourMode) return;
                    handleBack();
                  }}
                  disabled={isTourMode}
                  className={`flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 ${
                    isTourMode ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={frameworksLoading || frameworks.length === 0}
                  className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-xl transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none"
                >
                  Next
                </button>
              </>
            )}
            {step === 'ui' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (isTourMode) return;
                    handleBack();
                  }}
                  disabled={isTourMode}
                  className={`flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 ${
                    isTourMode ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Back
                </button>
                <button
                  ref={nextUiButtonRef}
                  type="button"
                  onClick={() => {
                    if (isTourMode && currentTourStep !== 'new-plugin-next-ui') return;
                    handleNext();
                  }}
                  disabled={isTourMode && currentTourStep !== 'new-plugin-next-ui'}
                  className={`flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25 ${
                    isTourMode && currentTourStep !== 'new-plugin-next-ui' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Next
                </button>
              </>
            )}
            {step === 'components' && (
              <>
                <button
                  ref={skipButtonRef}
                  type="button"
                  onClick={() => {
                    if (isTourMode) return;
                    handleBack();
                  }}
                  disabled={isSubmitting || isTourMode}
                  className={`flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 ${
                    isSubmitting || isTourMode ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Back
                </button>
                <button
                  ref={createButtonRef}
                  type="button"
                  onClick={() => {
                    if (isTourMode && currentTourStep !== 'new-plugin-create') return;
                    handleSubmit();
                  }}
                  disabled={isSubmitting || (isTourMode && currentTourStep !== 'new-plugin-create')}
                  className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-muted text-white font-medium rounded-xl transition-all duration-200 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Spinner size="sm" />}
                  Create
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
