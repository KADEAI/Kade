import React, { useRef, useEffect, useState, useCallback } from "react"
import { AgentSession } from "../state/atoms/sessions"

interface VirtualizedSessionListProps {
	sessions: AgentSession[]
	selectedId: string | null
	machineUiState: Record<string, { showSpinner: boolean; isActive: boolean }>
	onSelectSession: (id: string) => void
	renderSession: (session: AgentSession, isSelected: boolean, uiState: any) => React.ReactNode
	itemHeight?: number
	overscan?: number
}

export function VirtualizedSessionList({
	sessions,
	selectedId,
	machineUiState,
	onSelectSession,
	renderSession,
	itemHeight = 60,
	overscan = 5,
}: VirtualizedSessionListProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [scrollTop, setScrollTop] = useState(0)
	const [containerHeight, setContainerHeight] = useState(0)

	// Update container height on mount and resize
	useEffect(() => {
		if (!containerRef.current) return
		
		const updateHeight = () => {
			if (containerRef.current) {
				setContainerHeight(containerRef.current.clientHeight)
			}
		}
		
		updateHeight()
		const resizeObserver = new ResizeObserver(updateHeight)
		resizeObserver.observe(containerRef.current)
		
		return () => resizeObserver.disconnect()
	}, [])

	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		setScrollTop(e.currentTarget.scrollTop)
	}, [])

	// Calculate visible range
	const totalHeight = sessions.length * itemHeight
	const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
	const endIndex = Math.min(
		sessions.length,
		Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
	)

	const visibleSessions = sessions.slice(startIndex, endIndex)
	const offsetY = startIndex * itemHeight

	return (
		<div
			ref={containerRef}
			className="am-virtualized-list"
			onScroll={handleScroll}
			style={{ 
				height: '100%', 
				overflowY: 'auto',
				position: 'relative'
			}}
		>
			<div style={{ height: totalHeight, position: 'relative' }}>
				<div style={{ transform: `translateY(${offsetY}px)` }}>
					{visibleSessions.map((session) => (
						<div key={session.sessionId} style={{ height: itemHeight }}>
							{renderSession(
								session,
								selectedId === session.sessionId,
								machineUiState[session.sessionId]
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	)
}