import { useState } from 'react'
import { Modal } from '../Common/Modal'

interface AboutModalProps {
    isOpen: boolean
    onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
    const [nihPlugLicenseOpen, setNihPlugLicenseOpen] = useState(false)
    const [termsOpen, setTermsOpen] = useState(false)

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="About freqlab" size="md">
            <div className="flex flex-col items-center text-center">
                {/* Logo/Icon */}
                <div className="w-20 h-20 bg-bg-tertiary rounded-2xl flex items-center justify-center mb-4 overflow-hidden">
                    <svg className="w-20 h-20" viewBox="0 0 1024 1024" fill="none">
                        <defs>
                            <linearGradient
                                id="aboutWaveGrad"
                                x1="200"
                                y1="200"
                                x2="824"
                                y2="824"
                                gradientUnits="userSpaceOnUse"
                            >
                                <stop stopColor="#2DA86E" />
                                <stop offset="1" stopColor="#36C07E" />
                            </linearGradient>
                        </defs>
                        <rect width="1024" height="1024" rx="200" className="fill-bg-tertiary" />
                        <path d="M256 512V400" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M336 512V320" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M416 512V240" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M496 512V180" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M576 512V240" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M656 512V320" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M736 512V400" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M816 512V360" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M256 512V624" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M336 512V704" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M416 512V784" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M496 512V844" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M576 512V784" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M656 512V704" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M736 512V624" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                        <path d="M816 512V664" stroke="url(#aboutWaveGrad)" strokeWidth="48" strokeLinecap="round" />
                    </svg>
                </div>

                {/* App Links */}
                <div className="flex flex-wrap justify-center gap-3 mb-4">
                    <a
                        href="https://freqlab.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                            />
                        </svg>
                        <span className="text-sm font-medium">freqlab.app</span>
                    </a>
                    <a
                        href="https://freqlab.app/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary hover:bg-bg-elevated text-text-primary rounded-lg transition-colors border border-border"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                            />
                        </svg>
                        <span className="text-sm font-medium">Docs</span>
                    </a>
                    <a
                        href="https://github.com/jamesontucker/freqlab"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary hover:bg-bg-elevated text-text-primary rounded-lg transition-colors border border-border"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        <span className="text-sm font-medium">GitHub</span>
                    </a>
                </div>

                {/* Creator */}
                <p className="text-text-secondary mb-3">
                    Created by <span className="text-text-primary font-medium">nanoshrine</span>
                </p>

                {/* Social Links */}
                <div className="flex gap-3 mb-6">
                    <a
                        href="https://x.com/nanoshrine"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-bg-tertiary hover:bg-bg-elevated rounded-lg transition-colors"
                        title="X (Twitter)"
                    >
                        <svg
                            className="w-5 h-5 text-text-secondary hover:text-text-primary"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                        >
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                    </a>
                    <a
                        href="https://www.instagram.com/nanoshrine/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-bg-tertiary hover:bg-bg-elevated rounded-lg transition-colors"
                        title="Instagram"
                    >
                        <svg
                            className="w-5 h-5 text-text-secondary hover:text-text-primary"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                        >
                            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                        </svg>
                    </a>
                    <a
                        href="https://nanoshrine.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-bg-tertiary hover:bg-bg-elevated rounded-lg transition-colors"
                        title="Website"
                    >
                        <svg
                            className="w-5 h-5 text-text-secondary hover:text-text-primary"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                            />
                        </svg>
                    </a>
                </div>

                {/* Divider */}
                <div className="w-full h-px bg-border mb-6" />

                {/* nih-plug info */}
                <p className="text-text-secondary text-sm mb-4">
                    freqlab uses <span className="text-text-primary font-medium">nih-plug</span> for VST/CLAP plugin
                    development.
                </p>

                {/* Expandable sections */}
                <div className="w-full space-y-2 mb-6">
                    {/* nih-plug License */}
                    <button
                        onClick={() => setNihPlugLicenseOpen(!nihPlugLicenseOpen)}
                        className="w-full flex items-center justify-between p-3 bg-bg-tertiary hover:bg-bg-elevated rounded-lg transition-colors text-left"
                    >
                        <span className="text-sm text-text-primary font-medium">nih-plug & Plugin Licensing</span>
                        <svg
                            className={`w-4 h-4 text-text-muted transition-transform ${
                                nihPlugLicenseOpen ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {nihPlugLicenseOpen && (
                        <div className="p-4 bg-bg-tertiary rounded-lg text-left space-y-2">
                            <p className="text-sm text-text-secondary">
                                The <span className="text-text-primary">nih-plug framework</span> is licensed under the
                                permissive <span className="text-text-primary">ISC license</span>.
                            </p>
                            <p className="text-sm text-text-secondary">
                                However, the <span className="text-text-primary">VST3 bindings</span> are licensed under{' '}
                                <span className="text-text-primary">GPL-3.0</span>. This means any VST3 plugins built
                                with nih-plug must comply with GPL-3.0 terms.
                            </p>
                            <p className="text-sm text-text-muted text-xs">
                                CLAP-only plugins are not subject to this requirement.
                            </p>
                            <a
                                href="https://github.com/robbert-vdh/nih-plug/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block mt-2 text-sm text-accent hover:text-accent-hover transition-colors"
                            >
                                View nih-plug on GitHub →
                            </a>
                        </div>
                    )}

                    {/* freqlab Terms */}
                    <button
                        onClick={() => setTermsOpen(!termsOpen)}
                        className="w-full flex items-center justify-between p-3 bg-bg-tertiary hover:bg-bg-elevated rounded-lg transition-colors text-left"
                    >
                        <span className="text-sm text-text-primary font-medium">freqlab Terms of Use</span>
                        <svg
                            className={`w-4 h-4 text-text-muted transition-transform ${termsOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {termsOpen && (
                        <div className="p-3 bg-bg-tertiary rounded-lg text-left space-y-3 max-h-48 overflow-y-auto">
                            <div>
                                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-0.5">
                                    License
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    freqlab is licensed under{' '}
                                    <a
                                        href="https://polyformproject.org/licenses/shield/1.0.0/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-accent hover:text-accent-hover"
                                    >
                                        PolyForm Shield 1.0.0
                                    </a>
                                    . Source available on{' '}
                                    <a
                                        href="https://github.com/jamesontucker/freqlab"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-accent hover:text-accent-hover"
                                    >
                                        GitHub
                                    </a>
                                </p>
                            </div>
                            <div>
                                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-0.5">
                                    Plugin Output
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    VST3 plugins must be GPL-3.0 due to VST3 binding licensing. You may sell plugins but
                                    must provide source on request.
                                </p>
                            </div>
                            <div>
                                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-0.5">
                                    No Warranty
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    Provided "as is" without warranty. Use at your own risk. Not responsible for system
                                    issues, AI-generated code errors, or any damages.
                                </p>
                            </div>
                            <div>
                                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-0.5">
                                    Third-Party Assets
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    You are responsible for ensuring you have proper rights and licenses for any assets
                                    included in your plugins (fonts, images, samples, etc.).
                                </p>
                            </div>
                            <div>
                                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-0.5">
                                    AI-Generated Code
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    Claude generates the plugin code. While templates include safety measures, always
                                    review generated code before distributing. You are responsible for understanding
                                    and verifying the code in your plugins.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Version */}
                <p className="text-text-muted text-xs">Version 0.3.0</p>
            </div>
        </Modal>
    )
}
