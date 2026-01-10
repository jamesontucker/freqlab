import { useState, useRef, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectMeta } from '../../types'
import { Modal } from '../Common/Modal'
import { Spinner } from '../Common/Spinner'

interface ProjectCardProps {
    project: ProjectMeta
    isActive: boolean
    isBusy: boolean
    busyType: 'claude' | 'build' | null
    collapsed?: boolean
    disabled?: boolean
    onClick: () => void
    onDelete: () => void
}

export const ProjectCard = memo(function ProjectCard({
    project,
    isActive,
    isBusy,
    busyType,
    collapsed = false,
    disabled = false,
    onClick,
    onDelete
}: ProjectCardProps) {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [showTooltip, setShowTooltip] = useState(false)
    const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
    const cardRef = useRef<HTMLDivElement>(null)

    // Truncate name for tooltip
    const truncatedName = project.name.length > 20 ? project.name.slice(0, 20) + '...' : project.name

    const handleMouseEnter = () => {
        if (collapsed && cardRef.current) {
            const rect = cardRef.current.getBoundingClientRect()
            setTooltipPosition({
                top: rect.top + rect.height / 2,
                left: rect.right + 8
            })
            setShowTooltip(true)
        }
    }
    // Memoize timeAgo to avoid recalculating on every render
    const timeAgoText = useMemo(() => {
        const date = new Date(project.updated_at)
        const now = new Date()
        const diff = now.getTime() - date.getTime()
        const minutes = Math.floor(diff / 60000)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) return `${days}d ago`
        if (hours > 0) return `${hours}h ago`
        if (minutes > 0) return `${minutes}m ago`
        return 'Just now'
    }, [project.updated_at])

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        setShowDeleteConfirm(true)
    }

    const handleConfirmDelete = async () => {
        setIsDeleting(true)
        try {
            await onDelete()
            setShowDeleteConfirm(false)
        } catch (err) {
            console.error('Failed to delete project:', err)
        } finally {
            setIsDeleting(false)
        }
    }

    // Get icon color based on template type (green when active, muted when inactive)
    // Collapsed mode: neutral until hovered, then shows type color
    const getIconColor = () => {
        if (isActive) {
            return 'text-accent'
        }
        // Neutral color, but hover shows type color (amber for instrument, blue for effect)
        const hoverColor =
            project.template === 'instrument' ? 'group-hover:text-amber-400' : 'group-hover:text-blue-400'
        return `text-text-muted ${hoverColor}`
    }

    // Get icon background based on template type (green when active, subtle when inactive)
    // Collapsed mode: neutral background until hovered, then shows type color
    const getIconBg = () => {
        if (isActive) {
            return 'bg-accent/20'
        }
        // Neutral background, hover shows type color hint
        const hoverBg = project.template === 'instrument' ? 'group-hover:bg-amber-500/15' : 'group-hover:bg-blue-500/15'
        return `bg-bg-tertiary ${hoverBg}`
    }

    // Render icon based on template type
    const renderIcon = () => {
        if (isBusy) {
            return <Spinner size="sm" className={getIconColor()} />
        }
        return project.template === 'instrument' ? (
            <svg
                className={`w-4 h-4 ${getIconColor()}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
            >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 4v10M10 4v10M14 4v10M18 4v10" />
                <rect x="5" y="4" width="2" height="6" fill="currentColor" />
                <rect x="9" y="4" width="2" height="6" fill="currentColor" />
                <rect x="13" y="4" width="2" height="6" fill="currentColor" />
                <rect x="17" y="4" width="2" height="6" fill="currentColor" />
            </svg>
        ) : (
            <svg
                className={`w-4 h-4 ${getIconColor()}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
            >
                <path strokeLinecap="round" d="M6 4v16M12 4v16M18 4v16" />
                <rect x="4" y="6" width="4" height="3" rx="1" fill="currentColor" />
                <rect x="10" y="12" width="4" height="3" rx="1" fill="currentColor" />
                <rect x="16" y="9" width="4" height="3" rx="1" fill="currentColor" />
            </svg>
        )
    }

    const handleClick = () => {
        if (!disabled) {
            onClick()
        }
    }

    return (
        <>
            <div
                ref={cardRef}
                onClick={handleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setShowTooltip(false)}
                className={`group text-left rounded-lg transition-all duration-200 ${
                    collapsed ? 'w-12 h-12 p-0' : 'w-full px-2.5 py-2'
                } ${
                    disabled && !isActive
                        ? 'opacity-50 cursor-not-allowed'
                        : isActive
                        ? 'bg-accent/10 cursor-pointer'
                        : 'hover:bg-bg-tertiary/50 cursor-pointer'
                }`}
                title={disabled && !collapsed ? 'Build in progress...' : undefined}
            >
                {/* Tooltip for collapsed state - rendered via portal */}
                {collapsed &&
                    showTooltip &&
                    createPortal(
                        <div
                            className={`fixed z-[9999] px-2 py-1 bg-bg-elevated rounded-md shadow-lg whitespace-nowrap pointer-events-none border ${
                                project.template === 'instrument' ? 'border-amber-500/50' : 'border-blue-500/50'
                            }`}
                            style={{
                                top: tooltipPosition.top,
                                left: tooltipPosition.left,
                                transform: 'translateY(-50%)'
                            }}
                        >
                            <span
                                className={`text-sm ${
                                    project.template === 'instrument' ? 'text-amber-400' : 'text-blue-400'
                                }`}
                            >
                                {truncatedName}
                            </span>
                        </div>,
                        document.body
                    )}
                <div
                    className={`flex items-center transition-all duration-200 ${
                        collapsed ? 'justify-center h-full' : 'gap-2.5'
                    }`}
                >
                    {/* Icon */}
                    <div
                        className={`rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                            collapsed ? 'w-full h-full' : 'w-8 h-8'
                        } ${getIconBg()}`}
                    >
                        {renderIcon()}
                    </div>

                    {/* Content */}
                    <div
                        className={`flex-1 min-w-0 transition-all duration-200 ${
                            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                        }`}
                    >
                        {/* Top row: Name */}
                        <div className="flex items-center gap-1.5">
                            <span
                                className={`text-sm font-medium truncate ${
                                    isActive ? 'text-accent' : 'text-text-primary'
                                }`}
                            >
                                {project.name}
                            </span>
                            {isBusy && (
                                <span className="text-[10px] text-amber-400 flex-shrink-0 animate-pulse">
                                    {busyType === 'claude' ? 'Working' : 'Building'}
                                </span>
                            )}
                        </div>

                        {/* Bottom row: Time + Delete */}
                        <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[11px] text-text-muted">{timeAgoText}</span>
                            <button
                                onClick={handleDeleteClick}
                                className="opacity-0 group-hover:opacity-100 p-0.5 -mr-0.5 ml-1 rounded text-text-muted hover:text-error transition-opacity flex-shrink-0"
                                title="Delete project"
                            >
                                <svg
                                    className="w-3 h-3"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <Modal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                title="Delete Project"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-text-secondary">
                        Are you sure you want to delete <strong className="text-text-primary">{project.name}</strong>?
                        This will permanently remove all project files and cannot be undone.
                    </p>
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setShowDeleteConfirm(false)}
                            disabled={isDeleting}
                            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirmDelete}
                            disabled={isDeleting}
                            className="px-4 py-2 text-sm font-medium text-white bg-error hover:bg-error/90 rounded-lg transition-colors flex items-center gap-2"
                        >
                            {isDeleting ? (
                                <>
                                    <Spinner size="sm" className="text-white" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete'
                            )}
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    )
})
