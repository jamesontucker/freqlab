import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// All tour step IDs in order
export type TourStepId =
    | 'welcome'
    | 'click-new-plugin'
    | 'introduce-new-plugin-modal'
    | 'new-plugin-name'
    | 'introduce-plugin-type'
    | 'new-plugin-type'
    | 'new-plugin-description'
    | 'new-plugin-next-basic'
    | 'introduce-plugin-framework'
    | 'new-plugin-framework'
    | 'new-plugin-next-ui'
    | 'introduce-plugin-components'
    | 'new-plugin-create'
    | 'introduce-projects'
    | 'introduce-chat'
    | 'send-chat-message'
    | 'highlight-send-button'
    | 'wait-for-response'
    | 'show-version-message'
    | 'introduce-build'
    | 'introduce-auto-build'
    | 'click-build'
    | 'wait-for-build'
    | 'show-fix-error'
    | 'launch-plugin'
    | 'open-controls'
    | 'introduce-preview-panel'
    | 'select-sample'
    | 'click-play'
    | 'show-publish'
    | 'show-project-actions'
    | 'show-share'
    | 'show-settings'
    | 'complete'

// Step configuration
export interface TourStepConfig {
    id: TourStepId
    type: 'popup' | 'spotlight' | 'waiting'
    target?: string // Element ID in tour ref registry
    title?: string
    message: string
    position?: 'top' | 'bottom' | 'left' | 'right'
    advanceOn?: 'click' | 'input' | 'send' | 'chat-complete' | 'build-complete' | 'manual'
    suggestedValue?: string
    suggestedMessage?: string
    allowedTargets?: string[] // Additional targets allowed during this step
}

// Tour steps configuration
export const TOUR_STEPS: TourStepConfig[] = [
    {
        id: 'welcome',
        type: 'popup',
        title: 'Welcome to freqlab!',
        message: 'Ready to create your first audio plugin? This quick tour will walk you through the basics.'
    },
    {
        id: 'click-new-plugin',
        type: 'spotlight',
        target: 'new-plugin-button',
        message: 'Click here to create your first plugin',
        position: 'right',
        advanceOn: 'click'
    },
    {
        id: 'introduce-new-plugin-modal',
        type: 'spotlight',
        target: 'new-plugin-modal',
        title: 'Create Your Plugin',
        message: "This wizard will guide you through setting up your new plugin. You'll choose a name, type, interface style, and optional features.",
        position: 'right',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-name',
        type: 'spotlight',
        target: 'new-plugin-name-input',
        message: 'We\'ve named your plugin "My Phaser". You can change it if you\'d like!',
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'introduce-plugin-type',
        type: 'spotlight',
        target: 'new-plugin-type-selection',
        title: 'Plugin Types',
        message: 'When creating a plugin, you\'ll choose between an Effect or an Instrument as your starting point.',
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-type',
        type: 'spotlight',
        target: 'new-plugin-type-effect',
        message: 'We\'ve selected "Effect" for this tour - perfect for our phaser plugin!',
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-description',
        type: 'spotlight',
        target: 'new-plugin-description-input',
        message: "We've added a short description to help guide the chat.",
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-next-basic',
        type: 'spotlight',
        target: 'new-plugin-next-button',
        message: 'Click Next to choose your UI framework.',
        position: 'top',
        advanceOn: 'click',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'introduce-plugin-framework',
        type: 'spotlight',
        target: 'new-plugin-framework-selection',
        title: 'Interface Styles',
        message: 'You can choose how your plugin looks - from fully custom designs to simple built-in controls.',
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-framework',
        type: 'spotlight',
        target: 'new-plugin-framework-egui',
        message: 'We\'ve pre-selected "Simple UI" for easy, fast development. Perfect for getting started!',
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-next-ui',
        type: 'spotlight',
        target: 'new-plugin-next-ui-button',
        message: 'Click Next to continue to the final step.',
        position: 'top',
        advanceOn: 'click',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'introduce-plugin-components',
        type: 'spotlight',
        target: 'new-plugin-components-selection',
        title: 'Starter Features',
        message: 'You can optionally add common features like presets, parameter smoothing, or polyphony to your plugin template.',
        position: 'bottom',
        advanceOn: 'manual',
        allowedTargets: ['new-plugin-modal']
    },
    {
        id: 'new-plugin-create',
        type: 'spotlight',
        target: 'new-plugin-create-button',
        message:
            'We\'ll skip the optional components for now - you can explore those later! Click "Create" to set up your project.',
        position: 'top',
        advanceOn: 'click',
        allowedTargets: ['new-plugin-modal', 'new-plugin-skip-button']
    },
    {
        id: 'introduce-projects',
        type: 'spotlight',
        target: 'projects-list',
        title: 'Your Projects',
        message: 'Your new project appears here! You can create multiple plugins and switch between them anytime. Each project has its own chat history and versions.',
        position: 'right',
        advanceOn: 'manual'
    },
    {
        id: 'introduce-chat',
        type: 'spotlight',
        target: 'chat-panel',
        title: 'Your Workspace',
        message: 'This is where the magic happens! Tell the chat what you want and it will write the code. Each response creates a new version you can build and preview.',
        position: 'left',
        advanceOn: 'manual'
    },
    {
        id: 'send-chat-message',
        type: 'spotlight',
        target: 'chat-input-container',
        message: "We've prepared your first message. This tells the chat what plugin to create.",
        position: 'top',
        advanceOn: 'manual',
        suggestedMessage: 'Create a phaser effect with rate and depth controls',
        allowedTargets: ['chat-input-container']
    },
    {
        id: 'highlight-send-button',
        type: 'spotlight',
        target: 'chat-send-button',
        message: 'Click to send your message.',
        position: 'top',
        advanceOn: 'click',
        allowedTargets: ['chat-input-container']
    },
    {
        id: 'wait-for-response',
        type: 'waiting',
        message: 'Please wait while your plugin is being created...',
        advanceOn: 'chat-complete'
    },
    {
        id: 'show-version-message',
        type: 'spotlight',
        target: 'chat-panel',
        title: 'Version Created!',
        message:
            'Your first version is ready! Each chat response that modifies code creates a new version. You can click any version to restore it.',
        position: 'left',
        advanceOn: 'manual'
    },
    {
        id: 'introduce-build',
        type: 'spotlight',
        target: 'build-button',
        title: 'Building Your Plugin',
        message: 'This button compiles your plugin code into a working audio plugin you can test and use.',
        position: 'bottom',
        advanceOn: 'manual'
    },
    {
        id: 'introduce-auto-build',
        type: 'spotlight',
        target: 'auto-build-toggle',
        title: 'Auto Build',
        message: 'Pro tip: Enable Auto Build and your plugin will automatically compile after each chat response. Great for rapid iteration!',
        position: 'bottom',
        advanceOn: 'manual'
    },
    {
        id: 'click-build',
        type: 'spotlight',
        target: 'build-button',
        message: "Now let's build your plugin! Click Build to compile it.",
        position: 'bottom',
        advanceOn: 'click'
    },
    {
        id: 'wait-for-build',
        type: 'waiting',
        message: 'Building your plugin...',
        advanceOn: 'build-complete'
    },
    {
        id: 'show-fix-error',
        type: 'spotlight',
        target: 'fix-error-button',
        title: 'Oops!',
        message:
            "Looks like the chat broke something - it happens occasionally! No worries, just click this button and we'll automatically ask the chat to fix it.",
        position: 'bottom',
        advanceOn: 'click'
    },
    {
        id: 'launch-plugin',
        type: 'spotlight',
        target: 'launch-plugin-toggle',
        message: 'Click "Launch Plugin" to load your plugin and hear it in action!',
        position: 'bottom',
        advanceOn: 'click'
    },
    {
        id: 'open-controls',
        type: 'spotlight',
        target: 'controls-button',
        message: 'Open the Controls panel to test your plugin with different audio sources',
        position: 'bottom',
        advanceOn: 'click'
    },
    {
        id: 'introduce-preview-panel',
        type: 'spotlight',
        target: 'preview-panel',
        title: 'Audio Preview',
        message: "This is where you test your plugin! Choose different audio sources, adjust parameters, and hear your changes in real-time.",
        position: 'left',
        advanceOn: 'manual'
    },
    {
        id: 'select-sample',
        type: 'spotlight',
        target: 'sample-select',
        message: 'Click "Drums" to load a drum loop and hear how your phaser affects the sound!',
        position: 'left',
        advanceOn: 'click',
        allowedTargets: ['preview-panel']
    },
    {
        id: 'click-play',
        type: 'spotlight',
        target: 'play-button',
        message: 'Hit play to hear your plugin in action! Then try adjusting the phaser controls.',
        position: 'left',
        advanceOn: 'click'
    },
    {
        id: 'show-publish',
        type: 'spotlight',
        target: 'publish-button',
        message:
            "When you're happy with your plugin, click Publish to copy it to your DAW's plugin folder. Then just rescan plugins in your DAW!",
        position: 'bottom',
        advanceOn: 'manual'
    },
    {
        id: 'show-project-actions',
        type: 'spotlight',
        target: 'project-actions-button',
        title: 'Project Actions',
        message:
            'Use this menu to manage your project - edit settings, open in your code editor, reveal in Finder, or delete.',
        position: 'bottom',
        advanceOn: 'manual'
    },
    {
        id: 'show-share',
        type: 'spotlight',
        target: 'share-button',
        message:
            'Use Share & Import to export your projects as zip files (including chat history and plugin code) or import projects shared by others.',
        position: 'bottom',
        advanceOn: 'manual'
    },
    {
        id: 'show-settings',
        type: 'spotlight',
        target: 'settings-button',
        message:
            'Check out Settings to configure audio devices, DAW paths, branding, and more. You can also restart this tour anytime!',
        position: 'bottom',
        advanceOn: 'manual'
    },
    {
        id: 'complete',
        type: 'popup',
        title: "You're all set!",
        message:
            "You've created your first audio plugin! Keep experimenting - describe new features in the chat and iterate until your plugin is perfect."
    }
]

// Get step index for progress tracking
export function getStepIndex(stepId: TourStepId): number {
    return TOUR_STEPS.findIndex((s) => s.id === stepId)
}

// Get total spotlight/actionable steps (excluding welcome/complete popups and waiting states)
export function getActionableStepCount(): number {
    return TOUR_STEPS.filter((s) => s.type === 'spotlight').length
}

// Get current actionable step number (1-indexed)
export function getActionableStepNumber(stepId: TourStepId): number {
    const actionableSteps = TOUR_STEPS.filter((s) => s.type === 'spotlight')
    const index = actionableSteps.findIndex((s) => s.id === stepId)
    return index >= 0 ? index + 1 : 0
}

interface TourState {
    // Core state
    isActive: boolean
    currentStep: TourStepId | null
    completedSteps: TourStepId[]
    tourCompleted: boolean // Persisted - shown completion once

    // Actions
    startTour: () => void
    exitTour: () => void
    advanceToStep: (step: TourStepId) => void
    advanceToNextStep: () => void
    completeTour: () => void
    resetTour: () => void // For dev settings

    // Helpers
    getCurrentStepConfig: () => TourStepConfig | null
    isStepActive: (step: TourStepId) => boolean
    shouldBlockInteraction: (elementId: string) => boolean
}

export const useTourStore = create<TourState>()(
    persist(
        (set, get) => ({
            isActive: false,
            currentStep: null,
            completedSteps: [],
            tourCompleted: false,

            startTour: () => {
                set({
                    isActive: true,
                    currentStep: 'welcome',
                    completedSteps: []
                })
            },

            exitTour: () => {
                set({
                    isActive: false,
                    currentStep: null
                })
            },

            advanceToStep: (step) => {
                const { currentStep, completedSteps } = get()
                const newCompleted =
                    currentStep && !completedSteps.includes(currentStep)
                        ? [...completedSteps, currentStep]
                        : completedSteps

                set({
                    currentStep: step,
                    completedSteps: newCompleted
                })
            },

            advanceToNextStep: () => {
                const { currentStep } = get()
                if (!currentStep) return

                const currentIndex = TOUR_STEPS.findIndex((s) => s.id === currentStep)
                if (currentIndex >= 0 && currentIndex < TOUR_STEPS.length - 1) {
                    const nextStep = TOUR_STEPS[currentIndex + 1]
                    get().advanceToStep(nextStep.id)
                }
            },

            completeTour: () => {
                set({
                    isActive: false,
                    currentStep: null,
                    tourCompleted: true
                })
            },

            resetTour: () => {
                set({
                    isActive: false,
                    currentStep: null,
                    completedSteps: [],
                    tourCompleted: false
                })
            },

            getCurrentStepConfig: () => {
                const { currentStep } = get()
                if (!currentStep) return null
                return TOUR_STEPS.find((s) => s.id === currentStep) || null
            },

            isStepActive: (step) => {
                return get().currentStep === step
            },

            shouldBlockInteraction: (elementId) => {
                const { isActive, currentStep } = get()
                if (!isActive || !currentStep) return false

                const stepConfig = TOUR_STEPS.find((s) => s.id === currentStep)
                if (!stepConfig) return false

                // Current step's target is always allowed
                if (stepConfig.target === elementId) return false

                // Check if element is in allowedTargets
                if (stepConfig.allowedTargets?.includes(elementId)) return false

                // Exit button is always allowed
                if (elementId === 'tour-exit') return false

                // Block everything else
                return true
            }
        }),
        {
            name: 'freqlab-tour',
            // Only persist tourCompleted, not active tour state
            partialize: (state) => ({ tourCompleted: state.tourCompleted })
        }
    )
)
