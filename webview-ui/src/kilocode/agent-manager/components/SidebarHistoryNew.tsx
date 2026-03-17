
import React, { useState, useMemo, useCallback } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
    selectedSessionIdAtom,
    pendingSessionAtom,
    mergedSessionsAtom,
    type AgentSession,
} from "../state/atoms/sessions"
import {
    groupedSessionsAtom,
    collapsedFoldersAtom,
    manualFoldersAtom,
    sessionToFolderAtom,
    selectedFolderIdAtom,
} from "../state/atoms/workspaces"
import { sessionMachineUiStateAtom } from "../state/atoms/stateMachine"
import { vscode } from "../utils/vscode"
import { formatRelativeTime, createRelativeTimeLabels } from "../utils/timeUtils"
import {
    Plus,
    Loader2,
    GitBranch,
    Folder,
    ChevronDown,
    ChevronRight,
    Inbox,
    Settings,
    Book,
    MessageSquare,
    History,
} from "lucide-react"
import "./SidebarHistory.css"

export function SidebarHistoryNew() {
    const { t } = useTranslation("agentManager")
    const groupedSessions = useAtomValue(groupedSessionsAtom)
    const pendingSession = useAtomValue(pendingSessionAtom)
    const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)
    const machineUiState = useAtomValue(sessionMachineUiStateAtom)
    const [collapsedFolders, setCollapsedFolders] = useAtom(collapsedFoldersAtom)
    const mergedSessions = useAtomValue(mergedSessionsAtom)
    const setSelectedFolderId = useSetAtom(selectedFolderIdAtom)

    // Calculate total messages
    const totalMessages = useMemo(() => mergedSessions.length, [mergedSessions])

    const handleNewSession = useCallback((folderId: string | null = null) => {
        setSelectedId(null)
        setSelectedFolderId(folderId)
    }, [setSelectedId, setSelectedFolderId])

    const handleSelectSession = useCallback((id: string) => {
        setSelectedId(id)
        vscode.postMessage({ type: "agentManager.selectSession", sessionId: id })
    }, [setSelectedId])

    const toggleFolder = useCallback((folderId: string) => {
        const newCollapsed = new Set(collapsedFolders)
        if (newCollapsed.has(folderId)) {
            newCollapsed.delete(folderId)
        } else {
            newCollapsed.add(folderId)
        }
        setCollapsedFolders(newCollapsed)
    }, [collapsedFolders, setCollapsedFolders])

    const handleAddFolder = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        vscode.postMessage({ type: "agentManager.createFolder" })
    }, [])

    const handleNavigate = useCallback((page: string) => {
        if (page === 'settings') {
            vscode.postMessage({ type: "agentManager.navigate", page: "settings" })
        }
    }, [])

    const isNewAgentSelected = selectedId === null && !pendingSession
    const inboxGroup = groupedSessions.find((g) => g.folder.id === "inbox")
    const workspaceGroups = groupedSessions.filter((g) => g.folder.id !== "inbox")

    return (
        <div className="am-sidebar">
            <div className="am-sidebar-history">
                <div className="am-sidebar-scroll-content">

                    {/* Inbox Section */}
                    <div className="am-sidebar-section">
                        <div
                            className={`am-sidebar-item am-inbox-item ${selectedId === "inbox-global" ? "am-selected" : ""}`}
                            onClick={() => {
                                toggleFolder("inbox")
                                // If not already selected, we can use this to show "all history" if we want, 
                                // but for now let's just use it to toggle.
                            }}>
                            <div className="am-item-left">
                                <Inbox size={16} />
                                <span className="am-sidebar-label">Inbox</span>
                            </div>
                            <div className="am-unread-badge">{totalMessages}</div>
                        </div>
                        {!collapsedFolders.has("inbox") && (
                            <div className="am-folder-contents">
                                {mergedSessions.map((session) => (
                                    <SessionItem
                                        key={session.sessionId}
                                        session={session}
                                        isSelected={selectedId === session.sessionId}
                                        uiState={machineUiState[session.sessionId]}
                                        onSelect={() => handleSelectSession(session.sessionId)}
                                    />
                                ))}
                            </div>
                        )}
                        <button className="am-start-btn" onClick={() => handleNewSession(null)}>
                            <Plus size={16} />
                            <span className="am-sidebar-label">Start conversation</span>
                        </button>
                    </div>

                    {/* Workspaces Section */}
                    <div className="am-sidebar-section am-workspaces-section">
                        <div className="am-workspaces-header">
                            <span className="am-section-title">Workspaces</span>
                            <button className="am-icon-btn" onClick={handleAddFolder} title="Add Workspace">
                                <Plus size={14} />
                            </button>
                        </div>
                        {workspaceGroups.map((group) => (
                            <div key={group.folder.id} className="am-workspace-folder">
                                <div className="am-folder-header" onClick={() => toggleFolder(group.folder.id)}>
                                    <div className="flex items-center gap-1 min-w-0">
                                        {collapsedFolders.has(group.folder.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                        <span className="am-folder-name" title={group.folder.name}>
                                            {group.folder.name}
                                        </span>
                                    </div>
                                    <button
                                        className="am-folder-add-btn"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleNewSession(group.folder.id)
                                        }}
                                        title="Start conversation in workspace">
                                        <Plus size={14} />
                                    </button>
                                </div>
                                {!collapsedFolders.has(group.folder.id) && (
                                    <div className="am-folder-contents">
                                        {group.sessions.map((session) => (
                                            <SessionItem
                                                key={session.sessionId}
                                                session={session}
                                                isSelected={selectedId === session.sessionId}
                                                uiState={machineUiState[session.sessionId]}
                                                onSelect={() => handleSelectSession(session.sessionId)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {pendingSession && (
                            <PendingSessionItem
                                pendingSession={pendingSession}
                                isSelected={selectedId === null}
                                onSelect={() => setSelectedId(null)}
                            />
                        )}
                    </div>
                </div>

                {/* Bottom Section */}
                <div className="am-sidebar-bottom">
                    <a
                        href="https://stackoverflow.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="am-bottom-item">
                        <Book size={16} />
                        <span className="am-sidebar-label">Knowledge</span>
                    </a>
                    <div className="am-bottom-item" onClick={() => handleNavigate("settings")}>
                        <Settings size={16} />
                        <span className="am-sidebar-label">Settings</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

function PendingSessionItem({
    pendingSession,
    isSelected,
    onSelect,
}: {
    pendingSession: { label: string; startTime: number }
    isSelected: boolean
    onSelect: () => void
}) {
    const { t } = useTranslation("agentManager")

    return (
        <div className={`am-session-item am-pending ${isSelected ? 'am-selected' : ''}`} onClick={onSelect}>
            <div className="am-status-icon am-creating" title={t("status.creating")}>
                <Loader2 size={14} className="am-spinning" />
            </div>
            <div className="am-session-content">
                <div className="am-session-title">{pendingSession.label}</div>
                <div className="am-session-meta">{t("status.creating")}</div>
            </div>
        </div>
    )
}

function SessionItem({
    session,
    isSelected,
    uiState,
    onSelect,
}: {
    session: AgentSession
    isSelected: boolean
    uiState: { showSpinner: boolean; isActive: boolean } | undefined
    onSelect: () => void
}) {
    const { t } = useTranslation("agentManager")
    const timeLabels = useMemo(() => createRelativeTimeLabels(t), [t])
    const showSpinner = uiState?.showSpinner ?? false
    const isWorktree = session.parallelMode?.enabled
    const branchName = session.parallelMode?.branch

    return (
        <div
            className={`am-session-item ${isSelected ? 'am-selected' : ''}`}
            onClick={onSelect}
            style={{ position: 'relative' }}
        >
            {showSpinner && (
                <div className="am-status-icon am-running" title={t("status.running")}>
                    <Loader2 size={14} className="am-spinning" />
                </div>
            )}
            <div className="am-session-content">
                <div className="am-session-title" title={session.label}>{session.label}</div>
                <div className="am-session-meta">
                    {formatRelativeTime(session.startTime, timeLabels)}
                    {isWorktree && (
                        <span className="am-worktree-indicator" title={branchName || t("sidebar.worktree")}>
                            <GitBranch size={10} />
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
