import { useState } from 'react';
import { Modal } from '../Common/Modal';
import { Spinner } from '../Common/Spinner';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import type { CreateProjectInput, PluginTemplate, UIFramework } from '../../types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

type WizardStep = 'basic' | 'ui' | 'components';

interface ComponentOption {
  id: string;
  name: string;
  description: string;
}

interface UIFrameworkOption {
  id: UIFramework;
  name: string;
  description: string;
  cpuUsage: 'minimal' | 'light' | 'moderate';
  designControl: 'full' | 'standard' | 'daw-only';
  previewSupport: 'full' | 'none';
  previewNote: string;
}

const UI_FRAMEWORK_OPTIONS: UIFrameworkOption[] = [
  {
    id: 'webview',
    name: 'Advanced UI (WebView)',
    description: 'Best for plugins where appearance and user experience are top priorities.',
    cpuUsage: 'moderate',
    designControl: 'full',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'egui',
    name: 'Simple UI (egui)',
    description: 'Good middle ground between visual polish and CPU efficiency.',
    cpuUsage: 'light',
    designControl: 'standard',
    previewSupport: 'full',
    previewNote: 'Real-time preview in freqlab',
  },
  {
    id: 'headless',
    name: 'No Custom UI',
    description: 'Focus entirely on your audio algorithm. Your DAW provides basic controls.',
    cpuUsage: 'minimal',
    designControl: 'daw-only',
    previewSupport: 'none',
    previewNote: 'Requires DAW to test parameters',
  },
];

// SVG icons for each framework option
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

function HeadlessIcon({ className }: { className?: string }) {
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

function getFrameworkIcon(id: UIFramework, className?: string) {
  switch (id) {
    case 'webview': return <WebViewIcon className={className} />;
    case 'egui': return <EguiIcon className={className} />;
    case 'headless': return <HeadlessIcon className={className} />;
  }
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

// Design creativity icons - distinct icons for each level
function DesignControlIcon({ type, className }: { type: UIFrameworkOption['designControl']; className?: string }) {
  switch (type) {
    case 'full':
      // Sparkles - unlimited creative possibilities (3D, WebGL, etc.)
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      );
    case 'standard':
      // Palette - some creative options but standardized
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
        </svg>
      );
    case 'daw-only':
      // Window/app frame - host provides the UI
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

export function NewProjectModal({ isOpen, onClose, onSubmit }: NewProjectModalProps) {
  const [step, setStep] = useState<WizardStep>('basic');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<PluginTemplate>('effect');
  const [uiFramework, setUiFramework] = useState<UIFramework>('webview');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { vendorName, vendorUrl, vendorEmail } = useSettingsStore();

  // Get existing project names for duplicate checking
  const projects = useProjectStore((s) => s.projects);
  const existingFolderNames = projects.map(p => p.path.split('/').pop() || '');

  // Convert display name to folder-safe name (used when creating project)
  const toFolderName = (displayName: string): string => {
    return displayName
      .toLowerCase()
      .replace(/[\s-]+/g, '_')        // spaces/hyphens → underscores
      .replace(/[^a-z0-9_]/g, '')     // remove invalid chars
      .replace(/_+/g, '_')            // collapse multiple underscores
      .replace(/^_+|_+$/g, '');       // trim leading/trailing underscores
  };

  const validateName = (displayName: string): string | null => {
    if (!displayName.trim()) return 'Name is required';
    if (displayName.length > 50) return 'Name too long (max 50 chars)';

    // Validate the converted folder name
    const folderName = toFolderName(displayName);
    if (!folderName) return 'Name must contain at least one letter or number';
    if (!/^[a-z]/.test(folderName)) return 'Name must start with a letter';

    // Check for duplicate names
    if (existingFolderNames.includes(folderName)) {
      return 'A project with this name already exists';
    }

    return null;
  };

  const handleNext = () => {
    if (step === 'basic') {
      const nameError = validateName(name);
      if (nameError) {
        setError(nameError);
        return;
      }
      setError(null);
      setStep('ui');
    } else if (step === 'ui') {
      setError(null);
      setStep('components');
    }
  };

  const handleBack = () => {
    if (step === 'ui') {
      setStep('basic');
    } else if (step === 'components') {
      setStep('ui');
    }
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const folderName = toFolderName(name);
      await onSubmit({
        name: folderName,                     // Folder-safe name for filesystem
        displayName: name.trim(),             // Original user-typed name for display
        description,
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
      setStep('basic');
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    // Reset state when closing
    setName('');
    setDescription('');
    setTemplate('effect');
    setUiFramework('webview');
    setSelectedComponents([]);
    setStep('basic');
    setError(null);
    onClose();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow user to type freely, just enforce max length
    const value = e.target.value.slice(0, 50);
    setName(value);
    setError(null);
  };

  const toggleComponent = (id: string) => {
    setSelectedComponents(prev =>
      prev.includes(id)
        ? prev.filter(c => c !== id)
        : [...prev, id]
    );
  };

  const components = template === 'effect' ? EFFECT_COMPONENTS : INSTRUMENT_COMPONENTS;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Plugin" size="lg">
      <div className="flex flex-col min-h-[435px]">
        {step === 'basic' && (
          <div className="space-y-4">
            {/* Plugin Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
                Plugin Name
              </label>
              <input
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
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Plugin Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
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
                  onClick={() => {
                    setTemplate('instrument');
                    setSelectedComponents([]);
                  }}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    template === 'instrument'
                      ? 'border-accent bg-accent/5'
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

        {step === 'ui' && (
          <>
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-1">Interface Style</h3>
              <p className="text-xs text-text-muted mb-4">
                How important is your plugin's visual appearance vs. CPU efficiency?
              </p>
              <div className="grid grid-cols-3 gap-3">
                {UI_FRAMEWORK_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setUiFramework(option.id)}
                    className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left flex flex-col ${
                      uiFramework === option.id
                        ? 'border-accent bg-gradient-to-br from-accent/10 to-accent/5 shadow-lg shadow-accent/10'
                        : 'border-border hover:border-text-muted hover:bg-bg-tertiary/50'
                    }`}
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
                      {getFrameworkIcon(option.id, `w-5 h-5 ${uiFramework === option.id ? 'text-accent' : 'text-text-muted'}`)}
                    </div>

                    {/* Title */}
                    <div className={`text-sm font-semibold mb-1 pr-6 ${
                      uiFramework === option.id ? 'text-accent' : 'text-text-primary'
                    }`}>
                      {option.name}
                    </div>

                    {/* Description */}
                    <p className="text-xs text-text-muted mb-3 flex-1">{option.description}</p>

                    {/* Trade-off badges - stacked vertically */}
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
                ))}
              </div>
            </div>
          </>
        )}

        {step === 'components' && (
          <>
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-medium text-text-secondary">Features to Develop</h3>
                <span className="text-xs text-text-muted">Optional - skip if unsure</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {components.map((component) => {
                  const isSelected = selectedComponents.includes(component.id);
                  return (
                    <button
                      key={component.id}
                      type="button"
                      onClick={() => toggleComponent(component.id)}
                      className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left group ${
                        isSelected
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-text-muted'
                      }`}
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

        {/* Footer - always at bottom */}
        <div className="mt-auto pt-4 space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-error-subtle border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {/* Step indicator */}
          <div className="flex justify-center gap-2">
            {(['basic', 'ui', 'components'] as const).map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'w-6 bg-accent'
                    : i < (['basic', 'ui', 'components'] as const).indexOf(step)
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
                onClick={handleClose}
                className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!name}
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
                onClick={handleBack}
                className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
              >
                Next
              </button>
            </>
          )}
          {step === 'components' && (
            <>
              <button
                type="button"
                onClick={handleBack}
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary font-medium rounded-xl border border-border transition-all duration-200 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
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
