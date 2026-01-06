import { useState } from 'react';
import { Modal } from '../Common/Modal';
import { Spinner } from '../Common/Spinner';
import { useSettingsStore } from '../../stores/settingsStore';
import type { CreateProjectInput, PluginTemplate } from '../../types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

type WizardStep = 'basic' | 'components';

interface ComponentOption {
  id: string;
  name: string;
  description: string;
}

const EFFECT_COMPONENTS: ComponentOption[] = [
  { id: 'custom_gui', name: 'Custom GUI', description: 'Visual interface with nih_plug_vizia' },
  { id: 'preset_system', name: 'Preset System', description: 'Save and load preset functionality' },
  { id: 'param_smoothing', name: 'Parameter Smoothing', description: 'Smooth parameter interpolation' },
  { id: 'sidechain_input', name: 'Sidechain Input', description: 'Auxiliary audio input channel' },
  { id: 'oversampling', name: 'Oversampling', description: '2x/4x oversampling for quality' },
];

const INSTRUMENT_COMPONENTS: ComponentOption[] = [
  { id: 'custom_gui', name: 'Custom GUI', description: 'Visual interface with nih_plug_vizia' },
  { id: 'preset_system', name: 'Preset System', description: 'Save and load preset functionality' },
  { id: 'polyphony', name: 'Polyphony', description: 'Multi-voice architecture (8 voices)' },
  { id: 'velocity_layers', name: 'Velocity Layers', description: 'Velocity-sensitive response' },
  { id: 'adsr_envelope', name: 'ADSR Envelope', description: 'Attack/Decay/Sustain/Release' },
  { id: 'lfo', name: 'LFO Modulation', description: 'Low-frequency oscillator' },
];

export function NewProjectModal({ isOpen, onClose, onSubmit }: NewProjectModalProps) {
  const [step, setStep] = useState<WizardStep>('basic');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<PluginTemplate>('effect');
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
    const nameError = validateName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setError(null);
    setStep('components');
  };

  const handleBack = () => {
    setStep('basic');
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
        vendorName: vendorName || 'freqlab',
        vendorUrl: vendorUrl || '',
        vendorEmail: vendorEmail || '',
        components: selectedComponents.length > 0 ? selectedComponents : undefined,
      });
      // Reset state
      setName('');
      setDescription('');
      setTemplate('effect');
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
    setSelectedComponents([]);
    setStep('basic');
    setError(null);
    onClose();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
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

        {step === 'components' && (
          <>
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-1">Starter Components</h3>
              <p className="text-xs text-text-muted mb-4">
                Select optional features to include in your {template} plugin. You can always add these later.
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
          {(['basic', 'components'] as const).map((s, i) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step
                  ? 'w-6 bg-accent'
                  : i < (['basic', 'components'] as const).indexOf(step)
                  ? 'w-1.5 bg-accent/50'
                  : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          {step === 'basic' ? (
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
          ) : (
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
