import { useState } from 'react'
import { PrerequisitesCheck } from './PrerequisitesCheck'
import { DawSetup } from './DawSetup'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTourStore } from '../../stores/tourStore'

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
    const setSetupComplete = useSettingsStore((state) => state.setSetupComplete)
    const startTour = useTourStore((state) => state.startTour)

    const handleComplete = () => {
        setSetupComplete(true)
    }

    const handleStartTour = () => {
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
                                        Audio plugin creation engine for macOS
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

                            {/* CTA Button */}
                            <button
                                onClick={() => setStep('prerequisites')}
                                className="w-full py-2.5 px-4 text-sm bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-accent/25"
                            >
                                Get Started
                            </button>
                        </div>
                    )}

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
