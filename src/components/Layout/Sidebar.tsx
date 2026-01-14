import { useRef, useEffect } from 'react'
import { ProjectList } from '../Projects'
import { useLayoutStore } from '../../stores/layoutStore'
import { useProjectBusyStore } from '../../stores/projectBusyStore'
import { usePreviewStore } from '../../stores/previewStore'
import { useTipsStore } from '../../stores/tipsStore'
import { useTourStore } from '../../stores/tourStore'
import { Tip } from '../Common/Tip'
import { registerTourRef, unregisterTourRef } from '../../utils/tourRefs'

interface SidebarProps {
    onNewPlugin: () => void
}

export function Sidebar({ onNewPlugin }: SidebarProps) {
    const collapseButtonRef = useRef<HTMLButtonElement>(null)
    const newPluginButtonRef = useRef<HTMLButtonElement>(null)
    const projectsListRef = useRef<HTMLDivElement>(null)

    // Register tour refs
    useEffect(() => {
        registerTourRef('new-plugin-button', newPluginButtonRef)
        registerTourRef('projects-list', projectsListRef)
        return () => {
            unregisterTourRef('new-plugin-button')
            unregisterTourRef('projects-list')
        }
    }, [])

    // Use selectors for reactive state
    const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed)
    const toggleSidebar = useLayoutStore.getState().toggleSidebar
    const anyBuildInProgress = useProjectBusyStore((s) => s.buildingPath !== null)
    const previewIsOpen = usePreviewStore((s) => s.isOpen)
    const markTipShown = useTipsStore.getState().markTipShown

    // Tour state - block new plugin button during tour except when it's the target
    const tourActive = useTourStore((s) => s.isActive)
    const currentTourStep = useTourStore((s) => s.currentStep)
    const newPluginBlocked = tourActive && currentTourStep !== 'click-new-plugin'

    // When user collapses sidebar, also mark the tip as shown
    const handleToggleSidebar = () => {
        if (!sidebarCollapsed) {
            // User is collapsing - mark tip as shown so it won't appear again
            markTipShown('collapse-sidebar')
        }
        toggleSidebar()
    }

    return (
        <aside
            className={`${
                sidebarCollapsed ? 'w-16' : 'w-64'
            } bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 ease-in-out`}
        >
            {/* New Plugin Button */}
            <div className={`transition-all duration-300 ${sidebarCollapsed ? 'p-2' : 'p-4'}`}>
                <button
                    ref={newPluginButtonRef}
                    onClick={() => !anyBuildInProgress && !newPluginBlocked && onNewPlugin()}
                    disabled={anyBuildInProgress || newPluginBlocked}
                    className={`${
                        sidebarCollapsed ? 'w-12 h-12 p-0 justify-center' : 'w-full px-4 py-2.5 justify-center gap-2'
                    } flex items-center font-medium rounded-xl transition-all duration-200 ${
                        anyBuildInProgress || newPluginBlocked
                            ? 'bg-accent/50 text-white/50 cursor-not-allowed'
                            : 'bg-accent hover:bg-accent-hover text-white hover:shadow-lg hover:shadow-accent/25'
                    }`}
                    title={
                        newPluginBlocked
                            ? 'Complete the current step first'
                            : anyBuildInProgress
                            ? 'Build in progress...'
                            : sidebarCollapsed
                            ? 'New Plugin'
                            : undefined
                    }
                >
                    <svg
                        className="w-5 h-5 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span
                        className={`transition-all duration-300 ${
                            sidebarCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto delay-150'
                        }`}
                    >
                        New Plugin
                    </span>
                </button>
            </div>

            {/* Projects Label */}
            <div
                className={`px-4 py-2 transition-all duration-300 overflow-hidden ${
                    sidebarCollapsed ? 'opacity-0 h-0 py-0' : 'opacity-100 h-auto delay-150'
                }`}
            >
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">
                    Projects
                </span>
            </div>

            {/* Project List */}
            <div
                ref={projectsListRef}
                className={`flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300 ${
                    sidebarCollapsed ? 'px-1' : 'px-3'
                } pb-3`}
            >
                <ProjectList collapsed={sidebarCollapsed} />
            </div>

            {/* Footer with Collapse Button */}
            <div className={`transition-all duration-300 ${sidebarCollapsed ? 'p-2' : 'p-4'} border-t border-border`}>
                <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
                    <div
                        className={`flex items-center gap-2 text-xs transition-all duration-300 overflow-hidden ${
                            sidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto delay-150'
                        }`}
                    >
                        <span className="text-text-muted whitespace-nowrap">freqlab</span>
                        <span className="text-text-muted px-2 py-0.5 bg-bg-tertiary rounded whitespace-nowrap">
                            v0.1.8
                        </span>
                    </div>
                    <button
                        ref={collapseButtonRef}
                        onClick={handleToggleSidebar}
                        className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        <svg
                            className={`w-4 h-4 transition-transform duration-300 ${
                                sidebarCollapsed ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Tip for collapsing sidebar - shows when preview is open and sidebar not collapsed */}
            <Tip
                tipId="collapse-sidebar"
                targetRef={collapseButtonRef}
                message="Need more space? Collapse the sidebar to focus on your plugin."
                position="right"
                showCondition={previewIsOpen && !sidebarCollapsed}
                delayMs={3000}
                icon="lightbulb"
            />
        </aside>
    )
}
