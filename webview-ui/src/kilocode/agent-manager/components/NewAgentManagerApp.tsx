
import React from "react"
import { Provider, useAtomValue, useAtom } from "jotai"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useAgentManagerMessages } from "../state/hooks"
import { useMessageQueueProcessor } from "../state/hooks/useMessageQueueProcessor"
import { selectedSessionIdAtom } from "../state/atoms/sessions"
import { isSidebarOpenAtom, sidebarWidthAtom } from "../state/atoms/ui"
import { SidebarHistoryNew } from "./SidebarHistoryNew"
import { ChatPage } from "./ChatPage"
import { TooltipProvider } from "../../../components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "../../../components/ui/standard-tooltip"
import { ToolThemeProvider } from "../../../context/ToolThemeContext"
import "./AgentManagerApp.css"

const queryClient = new QueryClient()

/**
 * Root component for the New Agent Manager webview.
 * Replaces the old AgentManagerApp with a structure matching Claudify.
 */
export function NewAgentManagerApp() {
    return (
        <Provider>
            <QueryClientProvider client={queryClient}>
                <TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
                    <ToolThemeProvider>
                        <AgentManagerContent />
                    </ToolThemeProvider>
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

    // New Layout: Sidebar + ChatPage (instead of SessionDetail)
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
                    <SidebarHistoryNew />
                    <div className="am-sidebar-resizer" onMouseDown={startResizing} />
                </>
            )}
            <ChatPage />
            {isResizing && <div className="am-resizing-overlay" />}
        </div>
    )
}
