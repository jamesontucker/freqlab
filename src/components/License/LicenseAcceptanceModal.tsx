import { useState } from 'react';
import { Modal } from '../Common/Modal';
import { useSettingsStore } from '../../stores/settingsStore';
import { CURRENT_LICENSE_VERSION } from '../../constants/license';

interface LicenseAcceptanceModalProps {
  isOpen: boolean;
}

export function LicenseAcceptanceModal({ isOpen }: LicenseAcceptanceModalProps) {
  const [accepted, setAccepted] = useState(false);
  const setAcceptedLicenseVersion = useSettingsStore((state) => state.setAcceptedLicenseVersion);

  const handleContinue = () => {
    if (accepted) {
      setAcceptedLicenseVersion(CURRENT_LICENSE_VERSION);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      title="Updated Terms of Use"
      size="md"
      preventClose
    >
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-bg-tertiary/50 border border-border-subtle">
          <p className="text-sm text-text-secondary mb-4">
            freqlab has updated its license terms. Please review and accept the new terms to continue using the app.
          </p>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-text-primary mb-1">License</h4>
              <p className="text-sm text-text-secondary">
                freqlab is now licensed under{' '}
                <a
                  href="https://polyformproject.org/licenses/shield/1.0.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  PolyForm Shield 1.0.0
                </a>
                . Source code is available on{' '}
                <a
                  href="https://github.com/jamesontucker/freqlab"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  GitHub
                </a>
                .
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-text-primary mb-1">Plugin Output</h4>
              <p className="text-sm text-text-secondary">
                VST3 plugins must be GPL-3.0 due to VST3 binding licensing. You may sell plugins but must provide source code on request. CLAP-only plugins are not subject to this requirement.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-text-primary mb-1">No Warranty</h4>
              <p className="text-sm text-text-secondary">
                Provided "as is" without warranty. Use at your own risk. Not responsible for system issues, AI-generated code errors, or any damages.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-text-primary mb-1">Third-Party Assets</h4>
              <p className="text-sm text-text-secondary">
                You are responsible for ensuring you have proper rights and licenses for any assets included in your plugins (fonts, images, samples, etc.). Do not use copyrighted or commercially-licensed materials without appropriate permissions.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-text-primary mb-1">AI-Generated Code</h4>
              <p className="text-sm text-text-secondary">
                The AI assistant generates the plugin code. While templates include safety measures, always review generated code before distributing. You are responsible for understanding and verifying the code in your plugins.
              </p>
            </div>
          </div>
        </div>

        {/* Terms acceptance */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative flex-shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-4 h-4 border border-border rounded bg-bg-tertiary peer-checked:bg-accent peer-checked:border-accent transition-colors flex items-center justify-center">
              {accepted && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
          <span className="text-sm text-text-secondary leading-relaxed">
            I have read and agree to the updated Terms of Use
          </span>
        </label>

        {/* CTA Button */}
        <button
          onClick={handleContinue}
          disabled={!accepted}
          className={`w-full py-2.5 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${
            accepted
              ? 'bg-accent hover:bg-accent-hover text-white hover:shadow-lg hover:shadow-accent/25'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
          }`}
        >
          Continue to freqlab
        </button>
      </div>
    </Modal>
  );
}
