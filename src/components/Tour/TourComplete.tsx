import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface TourCompleteProps {
    onClose: () => void
}

/**
 * Celebration popup shown at the end of the guided tour.
 */
export function TourComplete({ onClose }: TourCompleteProps) {
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 50)
        return () => clearTimeout(timer)
    }, [])

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                style={{
                    opacity: isVisible ? 1 : 0,
                    transition: 'opacity 300ms ease-out'
                }}
            />

            {/* Card */}
            <div
                className="relative bg-bg-secondary rounded-2xl shadow-2xl border border-border max-w-md mx-4 overflow-hidden"
                style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
                    transition: 'opacity 300ms ease-out, transform 300ms ease-out'
                }}
            >
                {/* Decorative gradient header */}
                <div className="h-2 bg-gradient-to-r from-accent via-green-400 to-accent" />

                <div className="p-6">
                    {/* Celebration icon */}
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent/10 flex items-center justify-center">
                        <svg
                            className="w-8 h-8 text-accent"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
                            />
                        </svg>
                    </div>

                    {/* Content */}
                    <div className="text-center">
                        <h2 className="text-xl font-semibold text-text-primary mb-2">You're all set!</h2>
                        <p className="text-sm text-text-secondary leading-relaxed">
                            You've created your first audio plugin! Keep experimenting - describe new features in the
                            chat and iterate until your plugin is perfect.
                        </p>
                    </div>

                    {/* Tips for next steps */}
                    <div className="mt-5 p-3 rounded-lg bg-bg-tertiary/50 border border-border-subtle">
                        <p className="text-xs font-medium text-text-secondary mb-2">What's next?</p>
                        <ul className="space-y-1.5 text-xs text-text-muted">
                            <li className="flex items-start gap-2">
                                <span className="text-accent mt-0.5">•</span>
                                <span>Ask to tweak parameters or add new controls</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-accent mt-0.5">•</span>
                                <span>Describe changes in natural language - Chat will update the code</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-accent mt-0.5">•</span>
                                <span>Publish to your DAW when you're happy with it</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-accent mt-0.5">•</span>
                                <span>Create a new project to try an instrument or different effect</span>
                            </li>
                        </ul>
                    </div>

                    {/* Action */}
                    <div className="mt-5">
                        <button
                            onClick={onClose}
                            className="w-full py-2.5 px-4 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                        >
                            Start Creating
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}
