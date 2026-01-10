import { ProjectList } from '../Projects'
import { useLayoutStore } from '../../stores/layoutStore'
import { useProjectBusyStore } from '../../stores/projectBusyStore'

interface SidebarProps {
    onNewPlugin: () => void
}

export function Sidebar({ onNewPlugin }: SidebarProps) {
    // Use selectors for reactive state
    const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed)
    const toggleSidebar = useLayoutStore.getState().toggleSidebar
    const anyBuildInProgress = useProjectBusyStore((s) => s.buildingPath !== null)

    return (
        <aside
            className={`${
                sidebarCollapsed ? 'w-16' : 'w-64'
            } bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 ease-in-out`}
        >
            {/* New Plugin Button */}
            <div className={`transition-all duration-300 ${sidebarCollapsed ? 'p-2' : 'p-4'}`}>
                <button
                    onClick={() => !anyBuildInProgress && onNewPlugin()}
                    disabled={anyBuildInProgress}
                    className={`${
                        sidebarCollapsed ? 'w-12 h-12 p-0 justify-center' : 'w-full px-4 py-2.5 justify-center gap-2'
                    } flex items-center font-medium rounded-xl transition-all duration-200 ${
                        anyBuildInProgress
                            ? 'bg-accent/50 text-white/50 cursor-not-allowed'
                            : 'bg-accent hover:bg-accent-hover text-white hover:shadow-lg hover:shadow-accent/25'
                    }`}
                    title={anyBuildInProgress ? 'Build in progress...' : sidebarCollapsed ? 'New Plugin' : undefined}
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
                            sidebarCollapsed
                                ? 'opacity-0 w-0 overflow-hidden'
                                : 'opacity-100 w-auto delay-150'
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
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">Projects</span>
            </div>

            {/* Project List */}
            <div className={`flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300 ${sidebarCollapsed ? 'px-1' : 'px-3'} pb-3`}>
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
                        <span className="text-text-muted px-2 py-0.5 bg-bg-tertiary rounded whitespace-nowrap">v0.1.4</span>
                    </div>
                    <button
                        onClick={toggleSidebar}
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
        </aside>
    )
}
