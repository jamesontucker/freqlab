import { useState } from 'react';
import { Modal } from '../Common/Modal';
import { Spinner } from '../Common/Spinner';
import { useSettingsStore } from '../../stores/settingsStore';
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
  tagline: string;
  description: string;
  performance: number;  // 1-5 stars
  uiQuality: number | null;  // 1-5 stars or null for N/A
  customization: number | null;  // 1-5 stars or null for N/A
  previewSupport: 'full' | 'none';
  previewNote: string;
}

const UI_FRAMEWORK_OPTIONS: UIFrameworkOption[] = [
  {
    id: 'webview',
    name: 'Advanced UI',
    tagline: 'Maximum visual flexibility (macOS only)',
    description: 'Best for plugins where appearance and user experience are top priorities. Currently macOS only—Windows/Linux support coming soon.',
    performance: 2.5,
    uiQuality: 5,
    customization: 5,
    previewSupport: 'full',
    previewNote: 'macOS only • Test and preview your plugin in real-time within freqlab',
  },
  {
    id: 'egui',
    name: 'Simple UI',
    tagline: 'Balanced performance and looks',
    description: 'Good middle ground between visual polish and CPU efficiency.',
    performance: 4.5,
    uiQuality: 3,
    customization: 3.5,
    previewSupport: 'full',
    previewNote: 'Test and preview your plugin in real-time within freqlab',
  },
  {
    id: 'headless',
    name: 'No Custom UI',
    tagline: 'Pure audio processing',
    description: 'Focus entirely on your audio algorithm. Your DAW provides basic controls.',
    performance: 5,
    uiQuality: null,
    customization: null,
    previewSupport: 'none',
    previewNote: 'Requires loading the plugin in a DAW to test and adjust parameters',
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

// Helper component to render star ratings (supports half stars)
function StarRating({ rating, max = 5 }: { rating: number | null; max?: number }) {
  if (rating === null) return <span className="text-text-muted">N/A</span>;

  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  const emptyStars = max - fullStars - (hasHalf ? 1 : 0);

  return (
    <span className="text-amber-400 inline-flex items-center">
      {'★'.repeat(fullStars)}
      {hasHalf && <span className="relative inline-block w-[0.6em]"><span className="absolute overflow-hidden w-[50%]">★</span><span className="text-text-muted">☆</span></span>}
      <span className="text-text-muted">{'☆'.repeat(emptyStars)}</span>
    </span>
  );
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

  const validateName = (value: string): string | null => {
    if (!value) return 'Name is required';
    if (value.length > 50) return 'Name too long (max 50 chars)';
    if (!/^[a-z]/.test(value)) return 'Must start with a lowercase letter';
    if (!/^[a-z][a-z0-9_-]*$/.test(value)) {
      return 'Only lowercase letters, numbers, hyphens, and underscores allowed';
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
      await onSubmit({
        name,
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
    // Sanitize input to valid plugin name:
    // 1. Lowercase everything
    // 2. Replace spaces with hyphens (for readability)
    // 3. Remove any remaining invalid characters
    // 4. Collapse multiple hyphens into one
    // 5. Remove leading/trailing hyphens
    const value = e.target.value
      .toLowerCase()
      .replace(/\s+/g, '-')           // spaces → hyphens
      .replace(/[^a-z0-9_-]/g, '')    // remove invalid chars
      .replace(/-+/g, '-')            // collapse multiple hyphens
      .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
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
    <Modal isOpen={isOpen} onClose={handleClose} title="New Plugin">
      <div className="space-y-5">
        {step === 'basic' && (
          <>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-2">
                Plugin Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={handleNameChange}
                placeholder="my-plugin"
                className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-text-muted">
                Lowercase letters, numbers, hyphens, and underscores only
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Plugin Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setTemplate('effect');
                    setSelectedComponents([]); // Reset components when changing type
                  }}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    template === 'effect'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-text-muted'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className={`w-4 h-4 ${template === 'effect' ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" d="M6 4v16M12 4v16M18 4v16" />
                      <rect x="4" y="6" width="4" height="3" rx="1" fill="currentColor" />
                      <rect x="10" y="12" width="4" height="3" rx="1" fill="currentColor" />
                      <rect x="16" y="9" width="4" height="3" rx="1" fill="currentColor" />
                    </svg>
                    <span className={`text-sm font-medium ${template === 'effect' ? 'text-accent' : 'text-text-primary'}`}>
                      Effect
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">Processes audio (EQ, delay)</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTemplate('instrument');
                    setSelectedComponents([]); // Reset components when changing type
                  }}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    template === 'instrument'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-text-muted'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className={`w-4 h-4 ${template === 'instrument' ? 'text-accent' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M6 4v10M10 4v10M14 4v10M18 4v10" />
                      <rect x="5" y="4" width="2" height="6" fill="currentColor" />
                      <rect x="9" y="4" width="2" height="6" fill="currentColor" />
                      <rect x="13" y="4" width="2" height="6" fill="currentColor" />
                      <rect x="17" y="4" width="2" height="6" fill="currentColor" />
                    </svg>
                    <span className={`text-sm font-medium ${template === 'instrument' ? 'text-accent' : 'text-text-primary'}`}>
                      Instrument
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">Generates sound from MIDI</p>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-text-secondary mb-2">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your plugin idea..."
                rows={3}
                className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none"
              />
              <p className="mt-1.5 text-xs text-text-muted">
                You can refine and add features through conversation
              </p>
            </div>
          </>
        )}

        {step === 'ui' && (
          <>
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-1">Interface Style</h3>
              <p className="text-xs text-text-muted mb-4">
                How important is your plugin's visual appearance vs. CPU efficiency?
              </p>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {UI_FRAMEWORK_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setUiFramework(option.id)}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      uiFramework === option.id
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-text-muted'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        uiFramework === option.id ? 'bg-accent/10' : 'bg-bg-tertiary'
                      }`}>
                        {getFrameworkIcon(option.id, `w-5 h-5 ${uiFramework === option.id ? 'text-accent' : 'text-text-muted'}`)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-sm font-medium ${
                            uiFramework === option.id ? 'text-accent' : 'text-text-primary'
                          }`}>
                            {option.name}
                          </span>
                          {uiFramework === option.id && (
                            <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <p className="text-xs text-text-muted/80 mb-2">{option.tagline}</p>
                        <p className="text-xs text-text-muted mb-3">{option.description}</p>

                        <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                          <div>
                            <span className="text-text-muted block mb-0.5">Performance</span>
                            <StarRating rating={option.performance} />
                          </div>
                          <div>
                            <span className="text-text-muted block mb-0.5">Visual Quality</span>
                            <StarRating rating={option.uiQuality} />
                          </div>
                          <div>
                            <span className="text-text-muted block mb-0.5">Customization</span>
                            <StarRating rating={option.customization} />
                          </div>
                        </div>

                        <div className={`flex items-start gap-2 text-xs p-2 rounded-lg ${
                          option.previewSupport === 'full' ? 'bg-green-500/10' : 'bg-amber-500/10'
                        }`}>
                          {option.previewSupport === 'full' ? (
                            <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          <span className={option.previewSupport === 'full' ? 'text-green-400' : 'text-amber-400'}>
                            {option.previewNote}
                          </span>
                        </div>
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
              <h3 className="text-sm font-medium text-text-secondary mb-1">Features to Develop</h3>
              <p className="text-xs text-text-muted mb-4">
                Choose features you'd like to build. Skip this if you're not sure yet.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {components.map((component) => (
                  <button
                    key={component.id}
                    type="button"
                    onClick={() => toggleComponent(component.id)}
                    className={`w-full p-3 rounded-xl border-2 transition-all text-left ${
                      selectedComponents.includes(component.id)
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-text-muted'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        selectedComponents.includes(component.id)
                          ? 'border-accent bg-accent'
                          : 'border-text-muted'
                      }`}>
                        {selectedComponents.includes(component.id) && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${
                          selectedComponents.includes(component.id) ? 'text-accent' : 'text-text-primary'
                        }`}>
                          {component.name}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {component.description}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-error-subtle border border-error/20 text-error text-sm">
            {error}
          </div>
        )}

        {/* Step indicator */}
        <div className="flex justify-center gap-2 pt-2">
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
        <div className="flex gap-3 pt-2">
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
    </Modal>
  );
}
