import { ProjectList } from '../Projects'
import { useLayoutStore } from '../../stores/layoutStore'

interface SidebarProps {
    onNewPlugin: () => void
}

export function Sidebar({ onNewPlugin }: SidebarProps) {
    const { sidebarCollapsed, toggleSidebar } = useLayoutStore()

    return (
        <aside
            className={`${
                sidebarCollapsed ? 'w-16' : 'w-64'
            } bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 ease-in-out`}
        >
            {/* New Plugin Button */}
            <div className={sidebarCollapsed ? 'p-2' : 'p-4'}>
                <button
                    onClick={onNewPlugin}
                    className={`${
                        sidebarCollapsed ? 'w-12 h-12 p-0 justify-center' : 'w-full px-4 py-2.5 justify-center gap-2'
                    } flex items-center bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25`}
                    title={sidebarCollapsed ? 'New Plugin' : undefined}
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
                    {!sidebarCollapsed && <span>New Plugin</span>}
                </button>
            </div>

            {/* Projects Label */}
            {!sidebarCollapsed && (
                <div className="px-4 py-2">
                    <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Projects</span>
                </div>
            )}

            {/* Project List */}
            <div className={`flex-1 overflow-y-auto ${sidebarCollapsed ? 'px-1' : 'px-3'} pb-3`}>
                <ProjectList collapsed={sidebarCollapsed} />
            </div>

            {/* Footer with Collapse Button */}
            <div className={`${sidebarCollapsed ? 'p-2' : 'p-4'} border-t border-border`}>
                <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
                    {!sidebarCollapsed && (
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-text-muted">freqlab</span>
                            <span className="text-text-muted px-2 py-0.5 bg-bg-tertiary rounded">v0.1.3</span>
                        </div>
                    )}
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
