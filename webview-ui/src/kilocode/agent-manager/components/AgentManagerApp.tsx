
import React from "react"
import { Provider, useAtomValue, useAtom } from "jotai"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useAgentManagerMessages } from "../state/hooks"
import { useMessageQueueProcessor } from "../state/hooks/useMessageQueueProcessor"
import { selectedSessionIdAtom } from "../state/atoms/sessions"
import { isSidebarOpenAtom, sidebarWidthAtom } from "../state/atoms/ui"
import { SidebarHistory } from "./SidebarHistory"
import { SessionDetail } from "./SessionDetail"
import { TooltipProvider } from "../../../components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "../../../components/ui/standard-tooltip"
import "./AgentManagerApp.css"

const queryClient = new QueryClient()

/**
 * Root component for the Agent Manager webview.
 * Wraps everything in Jotai Provider and sets up message handling.
 */
export function AgentManagerApp() {
	return (
		<Provider>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
					<AgentManagerContent />
				</TooltipProvider>
			</QueryClientProvider>
		</Provider>
	)
}

function AgentManagerContent() {
	// Bridge VS Code IPC messages to Jotai state
	useAgentManagerMessages()

	// Get the currently selected session
	const selectedSessionId = useAtomValue(selectedSessionIdAtom)

	// Process the message queue for the selected session
	// Hook must always be called, but will skip processing if no session selected
	useMessageQueueProcessor(selectedSessionId)

	const isSidebarOpen = useAtomValue(isSidebarOpenAtom)
	const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
	const [isResizing, setIsResizing] = React.useState(false)

	const startResizing = React.useCallback(() => {
		setIsResizing(true)
	}, [])

	const stopResizing = React.useCallback(() => {
		setIsResizing(false)
	}, [])

	const resize = React.useCallback(
		(mouseMoveEvent: MouseEvent) => {
			if (isResizing) {
				const newWidth = mouseMoveEvent.clientX
				if (newWidth > 150 && newWidth < 600) {
					setSidebarWidth(newWidth)
				}
			}
		},
		[isResizing, setSidebarWidth],
	)

	React.useEffect(() => {
		window.addEventListener("mousemove", resize)
		window.addEventListener("mouseup", stopResizing)
		return () => {
			window.removeEventListener("mousemove", resize)
			window.removeEventListener("mouseup", stopResizing)
		}
	}, [resize, stopResizing])

	return (
		<div
			className={`agent-manager-container ${!isSidebarOpen ? "am-sidebar-closed" : ""}`}
			style={
				{
					"--am-sidebar-width": `${sidebarWidth}px`,
				} as React.CSSProperties
			}>
			{isSidebarOpen && (
				<>
					<SidebarHistory />
					<div className="am-sidebar-resizer" onMouseDown={startResizing} />
				</>
			)}
			<SessionDetail />
			{isResizing && <div className="am-resizing-overlay" />}
		</div>
	)
}
