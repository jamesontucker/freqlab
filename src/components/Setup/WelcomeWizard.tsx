import { useState } from 'react';
import { PrerequisitesCheck } from './PrerequisitesCheck';
import { useSettingsStore } from '../../stores/settingsStore';

type WizardStep = 'welcome' | 'prerequisites' | 'complete';

function WaveformIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="80" height="80" rx="20" fill="url(#grad)" fillOpacity="0.15"/>
      <path d="M20 40V35M26 40V30M32 40V25M38 40V20M44 40V25M50 40V30M56 40V35M62 40V32"
            stroke="url(#grad)" strokeWidth="3" strokeLinecap="round"/>
      <path d="M20 40V45M26 40V50M32 40V55M38 40V60M44 40V55M50 40V50M56 40V45M62 40V48"
            stroke="url(#grad)" strokeWidth="3" strokeLinecap="round"/>
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6"/>
          <stop offset="1" stopColor="#a78bfa"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="group p-4 rounded-xl bg-bg-tertiary/50 border border-border-subtle hover:border-accent/30 hover:bg-bg-tertiary transition-all duration-200">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center text-accent">
          {icon}
        </div>
        <div>
          <h3 className="font-medium text-text-primary mb-1">{title}</h3>
          <p className="text-sm text-text-muted leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function WelcomeWizard() {
  const [step, setStep] = useState<WizardStep>('welcome');
  const setSetupComplete = useSettingsStore((state) => state.setSetupComplete);

  const handleComplete = () => {
    setSetupComplete(true);
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-8">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent pointer-events-none" />

      <div className="w-full max-w-lg relative">
        <div className="glass rounded-2xl border border-border p-8 shadow-2xl animate-fade-in">
          {step === 'welcome' && (
            <div className="space-y-8">
              {/* Logo & Title */}
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <WaveformIcon />
                </div>
                <div>
                  <h1 className="text-3xl font-bold gradient-text">freqlab</h1>
                  <p className="text-text-secondary mt-2">
                    Build VST plugins with AI assistance
                  </p>
                </div>
              </div>

              {/* Features */}
              <div className="space-y-3">
                <FeatureCard
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  }
                  title="Describe your plugin"
                  description="Tell Claude what you want to build in plain English"
                />
                <FeatureCard
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                  }
                  title="Iterate quickly"
                  description="Refine your plugin through natural conversation"
                />
                <FeatureCard
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                    </svg>
                  }
                  title="Build with one click"
                  description="Compile and test in your DAW instantly"
                />
              </div>

              {/* CTA Button */}
              <button
                onClick={() => setStep('prerequisites')}
                className="w-full py-3 px-4 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
              >
                Get Started
              </button>
            </div>
          )}

          {step === 'prerequisites' && (
            <PrerequisitesCheck onComplete={() => setStep('complete')} />
          )}

          {step === 'complete' && (
            <div className="text-center space-y-6 animate-fade-in">
              <div className="w-16 h-16 mx-auto rounded-full bg-success-subtle flex items-center justify-center">
                <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-text-primary">You're all set!</h1>
                <p className="text-text-secondary mt-2">
                  Everything is installed. Let's build some plugins!
                </p>
              </div>
              <button
                onClick={handleComplete}
                className="w-full py-3 px-4 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
              >
                Start Building
              </button>
            </div>
          )}

          {/* Step indicator */}
          <div className="flex justify-center gap-2 mt-8">
            {['welcome', 'prerequisites', 'complete'].map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'w-6 bg-accent'
                    : i < ['welcome', 'prerequisites', 'complete'].indexOf(step)
                    ? 'w-1.5 bg-accent/50'
                    : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Subtle branding */}
        <p className="text-center text-text-muted text-xs mt-6">
          Powered by Claude Code & nih-plug
        </p>
      </div>
    </div>
  );
}
