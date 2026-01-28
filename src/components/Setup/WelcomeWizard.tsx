import { useState } from 'react'
import { PrerequisitesCheck } from './PrerequisitesCheck'
import { DawSetup } from './DawSetup'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTourStore } from '../../stores/tourStore'
import { Modal } from '../Common/Modal'
import { CURRENT_LICENSE_VERSION } from '../../constants/license'
import { IS_MAC } from '../../lib/platform'

type WizardStep = 'welcome' | 'prerequisites' | 'daw-setup' | 'complete'

function WaveformIcon() {
    return (
        <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="80" height="80" rx="20" fill="url(#grad)" fillOpacity="0.15" />
            <path
                d="M20 40V35M26 40V30M32 40V25M38 40V20M44 40V25M50 40V30M56 40V35M62 40V32"
                stroke="url(#grad)"
                strokeWidth="3"
                strokeLinecap="round"
            />
            <path
                d="M20 40V45M26 40V50M32 40V55M38 40V60M44 40V55M50 40V50M56 40V45M62 40V48"
                stroke="url(#grad)"
                strokeWidth="3"
                strokeLinecap="round"
            />
            <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#2DA86E" />
                    <stop offset="1" stopColor="#36C07E" />
                </linearGradient>
            </defs>
        </svg>
    )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
    return (
        <div className="group p-3 rounded-lg bg-bg-tertiary/50 border border-border-subtle hover:border-accent/30 hover:bg-bg-tertiary transition-all duration-200">
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-md bg-accent-subtle flex items-center justify-center text-accent">
                    {icon}
                </div>
                <div>
                    <h3 className="text-sm font-medium text-text-primary">{title}</h3>
                    <p className="text-xs text-text-muted leading-relaxed">{description}</p>
                </div>
            </div>
        </div>
    )
}

export function WelcomeWizard() {
    const [step, setStep] = useState<WizardStep>('welcome')
    const [termsAccepted, setTermsAccepted] = useState(false)
    const [termsModalOpen, setTermsModalOpen] = useState(false)
    const setSetupComplete = useSettingsStore((state) => state.setSetupComplete)
    const setAcceptedLicenseVersion = useSettingsStore((state) => state.setAcceptedLicenseVersion)
    const startTour = useTourStore((state) => state.startTour)

    const handleComplete = () => {
        setAcceptedLicenseVersion(CURRENT_LICENSE_VERSION)
        setSetupComplete(true)
    }

    const handleStartTour = () => {
        setAcceptedLicenseVersion(CURRENT_LICENSE_VERSION)
        setSetupComplete(true)
        startTour()
    }

    return (
        <div className="min-h-screen bg-bg-primary flex items-center justify-center p-8">
            {/* Background gradient */}
            <div className="fixed inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent pointer-events-none" />

            <div className="w-full max-w-lg relative">
                <div className="glass rounded-2xl border border-border p-6 shadow-2xl animate-fade-in max-h-[calc(100vh-120px)] overflow-y-auto">
                    {step === 'welcome' && (
                        <div className="space-y-5">
                            {/* Logo & Title */}
                            <div className="text-center space-y-2">
                                <div className="flex justify-center">
                                    <WaveformIcon />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold gradient-text">freqlab</h1>
                                    <p className="text-sm text-text-secondary mt-1">
                                        Audio plugin creation engine
                                    </p>
                                </div>
                            </div>

                            {/* Features */}
                            <div className="space-y-2">
                                <FeatureCard
                                    icon={
                                        <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            strokeWidth={1.5}
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                                            />
                                        </svg>
                                    }
                                    title="Describe your plugin"
                                    description="Tell freqlab what you want to build"
                                />
                                <FeatureCard
                                    icon={
                                        <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            strokeWidth={1.5}
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                                            />
                                        </svg>
                                    }
                                    title="Iterate quickly"
                                    description="Refine your plugin through natural conversation"
                                />
                                <FeatureCard
                                    icon={
                                        <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            strokeWidth={1.5}
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
                                            />
                                        </svg>
                                    }
                                    title="Build with one click"
                                    description="Compile and publish to your DAW instantly"
                                />
                            </div>

                            {/* Subscription notice */}
                            <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-center">
                                <p className="text-xs text-text-secondary">
                                    <span className="font-medium text-warning">Claude Pro or Max required</span>
                                    {' - '}
                                    <a
                                        href="https://claude.ai/login"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-accent hover:underline"
                                    >
                                        Login now
                                    </a>
                                </p>
                            </div>

                            {/* Terms acceptance */}
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <div className="relative flex-shrink-0 mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={termsAccepted}
                                        onChange={(e) => setTermsAccepted(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-4 h-4 border border-border rounded bg-bg-tertiary peer-checked:bg-accent peer-checked:border-accent transition-colors flex items-center justify-center">
                                        {termsAccepted && (
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                <span className="text-xs text-text-secondary leading-relaxed">
                                    I agree to the{' '}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            setTermsModalOpen(true)
                                        }}
                                        className="text-accent hover:underline"
                                    >
                                        Terms of Use
                                    </button>
                                </span>
                            </label>

                            {/* CTA Button */}
                            <button
                                onClick={() => setStep('prerequisites')}
                                disabled={!termsAccepted}
                                className={`w-full py-2.5 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${
                                    termsAccepted
                                        ? 'bg-accent hover:bg-accent-hover text-white hover:shadow-lg hover:shadow-accent/25'
                                        : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                                }`}
                            >
                                Get Started
                            </button>
                        </div>
                    )}

                    {/* Terms Modal */}
                    <Modal isOpen={termsModalOpen} onClose={() => setTermsModalOpen(false)} title="Terms of Use" size="md">
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                            <div>
                                <h4 className="text-sm font-semibold text-text-primary mb-1">License</h4>
                                <p className="text-sm text-text-secondary">
                                    freqlab is licensed under{' '}
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
                                    VST3 plugins must be GPL-3.0 due to VST3 binding licensing. You may sell plugins but
                                    must provide source code on request. CLAP-only plugins are not subject to this requirement.
                                </p>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-text-primary mb-1">No Warranty</h4>
                                <p className="text-sm text-text-secondary">
                                    Provided "as is" without warranty. Use at your own risk. Not responsible for system
                                    issues, AI-generated code errors, or any damages.
                                </p>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-text-primary mb-1">Third-Party Assets</h4>
                                <p className="text-sm text-text-secondary">
                                    You are responsible for ensuring you have proper rights and licenses for any assets
                                    included in your plugins (fonts, images, samples, etc.). Do not use copyrighted or
                                    commercially-licensed materials without appropriate permissions.
                                </p>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-text-primary mb-1">AI-Generated Code</h4>
                                <p className="text-sm text-text-secondary">
                                    Claude generates the plugin code. While templates include safety measures, always
                                    review generated code before distributing. You are responsible for understanding
                                    and verifying the code in your plugins.
                                </p>
                            </div>

                            <div className="pt-2">
                                <button
                                    onClick={() => setTermsModalOpen(false)}
                                    className="w-full py-2 px-4 text-sm bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </Modal>

                    {step === 'prerequisites' && <PrerequisitesCheck onComplete={() => setStep('daw-setup')} />}

                    {step === 'daw-setup' && (
                        <DawSetup onComplete={() => setStep('complete')} onBack={() => setStep('prerequisites')} />
                    )}

                    {step === 'complete' && (
                        <div className="space-y-5 animate-fade-in">
                            {/* Header */}
                            <div className="text-center">
                                <div className="w-10 h-10 mx-auto rounded-full bg-success-subtle flex items-center justify-center mb-2">
                                    <svg
                                        className="w-5 h-5 text-success"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-semibold text-text-primary">You&apos;re all set!</h2>
                                <p className="text-xs text-text-secondary mt-0.5">Here&apos;s how freqlab works</p>
                            </div>

                            {/* Workflow Steps */}
                            <div className="space-y-2">
                                {[
                                    {
                                        icon: (
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={1.5}
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                                                />
                                            </svg>
                                        ),
                                        label: 'Describe',
                                        desc: 'Chat about what you want your plugin to do'
                                    },
                                    {
                                        icon: (
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={1.5}
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
                                                />
                                            </svg>
                                        ),
                                        label: 'Build',
                                        desc: 'Click Build to compile your plugin'
                                    },
                                    {
                                        icon: (
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={1.5}
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                                                />
                                            </svg>
                                        ),
                                        label: 'Launch Plugin',
                                        desc: 'Test it with the built-in audio controls'
                                    },
                                    {
                                        icon: (
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={1.5}
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                                                />
                                            </svg>
                                        ),
                                        label: 'Iterate',
                                        desc: "Refine through conversation until it's perfect"
                                    },
                                    {
                                        icon: (
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={1.5}
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                                                />
                                            </svg>
                                        ),
                                        label: 'Publish',
                                        desc: "Send it to your DAW when you're happy"
                                    }
                                ].map((step, i, arr) => (
                                    <div key={step.label} className="flex items-center gap-3">
                                        <div className="flex flex-col items-center">
                                            <div className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-accent">
                                                {step.icon}
                                            </div>
                                            {i < arr.length - 1 && <div className="w-0.5 h-2 bg-border mt-1" />}
                                        </div>
                                        <div className="flex-1 pb-2">
                                            <span className="text-sm font-medium text-text-primary">{step.label}</span>
                                            <span className="text-xs text-text-muted ml-2">{step.desc}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* macOS file access note */}
                            {IS_MAC && (
                            <div className="p-3 rounded-lg bg-bg-tertiary/30 border border-border-subtle">
                                <div className="flex items-start gap-2">
                                    <svg className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                    </svg>
                                    <p className="text-xs text-text-muted leading-relaxed">
                                        <span className="font-medium text-text-secondary">macOS permissions:</span> If you see repeated &quot;access data from other apps&quot; prompts, enable <span className="text-text-secondary">freqlab</span> in{' '}
                                        <span className="text-text-secondary">System Settings → Privacy & Security → Full Disk Access</span>.
                                    </p>
                                </div>
                            </div>
                            )}

                            {/* CTAs */}
                            <div className="space-y-2">
                                <button
                                    onClick={handleStartTour}
                                    className="w-full py-2.5 px-4 text-sm bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-accent/25 flex items-center justify-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                                    </svg>
                                    Take Guided Tour
                                </button>
                                <button
                                    onClick={handleComplete}
                                    className="w-full py-2 px-4 text-sm text-text-muted hover:text-text-secondary font-medium transition-colors"
                                >
                                    Skip, I'll explore on my own
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step indicator */}
                    <div className="flex justify-center gap-2 mt-6">
                        {['welcome', 'prerequisites', 'daw-setup', 'complete'].map((s, i) => (
                            <div
                                key={s}
                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                    s === step
                                        ? 'w-6 bg-accent'
                                        : i < ['welcome', 'prerequisites', 'daw-setup', 'complete'].indexOf(step)
                                        ? 'w-1.5 bg-accent/50'
                                        : 'w-1.5 bg-border'
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* Subtle branding */}
                <p className="text-center text-text-muted text-xs mt-6">a nanoshrine experiment</p>
            </div>
        </div>
    )
}
