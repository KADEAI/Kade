
import React, { useRef, useEffect } from "react"
import { useAtomValue, useAtom } from "jotai"
import {
    selectedSessionAtom,
    pendingSessionAtom,
} from "../state/atoms/sessions"
import { selectedSessionMachineStateAtom } from "../state/atoms/stateMachine"
import { isSidebarOpenAtom } from "../state/atoms/ui"
import { MessageList } from "./MessageList"
import { ChatInput } from "./ChatInput"
import { PanelLeftOpen, Terminal, AlertCircle, Loader2, Folder, GitBranch } from "lucide-react"
import { vscode } from "../utils/vscode"
import { useTranslation } from "react-i18next"
import { formatRelativeTime, createRelativeTimeLabels } from "../utils/timeUtils"
import { AgentManagerExtensionStateAdapter } from "./AgentManagerExtensionStateAdapter"
import { SessionDetail } from "./SessionDetail" // Reusing portions or logic where needed, but keeping separate if distinct

/**
 * ChatPage acts as the main content area for the Agent Manager.
 * It displays the chat history and input for the selected session,
 * mimicking the layout of the main extension sidebar chat.
 */
export function ChatPage() {
    const { t } = useTranslation("agentManager")
    const selectedSession = useAtomValue(selectedSessionAtom)
    const pendingSession = useAtomValue(pendingSessionAtom)
    const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
    const selectedSessionState = useAtomValue(selectedSessionMachineStateAtom)

    // If no session is selected, we could show an empty state or the "New Agent" form.
    // We'll reuse the logic from SessionDetail for now, but wrapped in this new layout.

    if (!selectedSession && !pendingSession) {
        // New Agent Form
        // We can reuse the NewAgentForm component from SessionDetail inside here,
        // or extract it. For now, let's just render SessionDetail which handles the "New" case nicely.
        return <SessionDetail />
    }

    if (pendingSession && !selectedSession) {
        return <SessionDetail /> // SessionDetail handles pending state too
    }

    if (!selectedSession) return null

    const isActive = selectedSessionState === "streaming" || selectedSessionState === "creating"
    // const showSpinner = isActive // Simplified logic
    // Actually relying on machineUiState in sub-components usually.

    const isWorktree = selectedSession.parallelMode?.enabled
    const branchName = selectedSession.parallelMode?.branch
    const isProvisionalSession = selectedSession.sessionId.startsWith("provisional-")

    return (
        <div className="am-session-detail">
            <AgentManagerExtensionStateAdapter sessionId={selectedSession.sessionId}>
                {/* Header - Matching Claudify/Main Chat Header Style */}
                <div className="am-detail-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        {!isSidebarOpen && (
                            <button
                                className="am-icon-btn"
                                onClick={() => setIsSidebarOpen(true)}
                                title="Expand Sidebar">
                                <PanelLeftOpen size={14} />
                            </button>
                        )}
                        <span className="am-header-title" style={{ fontWeight: 500, fontSize: '13px' }}>
                            {selectedSession.label}
                        </span>
                    </div>

                    <div className="am-header-actions" style={{ display: 'flex', gap: '8px' }}>
                        {!isProvisionalSession && (
                            <button
                                className="am-icon-btn"
                                onClick={() => {
                                    vscode.postMessage({
                                        type: "agentManager.showTerminal",
                                        sessionId: selectedSession.sessionId,
                                    })
                                }}
                                title={t("sessionDetail.openTerminal")}>
                                <Terminal size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Error Banner */}
                {selectedSession.status === "error" && selectedSession.error && (
                    <div className="am-session-error-banner" role="alert">
                        <AlertCircle size={16} />
                        <span>{selectedSession.error}</span>
                    </div>
                )}

                {/* Messages Area */}
                <div className="am-messages-viewport">
                    <MessageList sessionId={selectedSession.sessionId} />
                </div>

                {/* Input Area */}
                <ChatInput
                    sessionId={selectedSession.sessionId}
                    sessionLabel={selectedSession.label}
                    isActive={isActive}
                    showCancel={isActive}
                    showFinishToBranch={!!isWorktree && selectedSession.status === "running"}
                    worktreeBranchName={branchName}
                    sessionStatus={selectedSession.status}
                />
            </AgentManagerExtensionStateAdapter>
        </div>
    )
}
