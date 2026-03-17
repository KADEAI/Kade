import React, { useState, useMemo, useCallback } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	selectedSessionIdAtom,
	isRefreshingRemoteSessionsAtom,
	pendingSessionAtom,
	type AgentSession,
	mergedSessionsAtom,
} from "../state/atoms/sessions"
import {
	groupedSessionsAtom,
	collapsedFoldersAtom,
	manualFoldersAtom,
	sessionToFolderAtom,
	selectedFolderIdAtom,
	workspaceConfigLoadedAtom,
	type WorkspaceFolder,
} from "../state/atoms/workspaces"
import { sessionMachineUiStateAtom } from "../state/atoms/stateMachine"
import { isSidebarOpenAtom } from "../state/atoms/ui"
import { vscode } from "../utils/vscode"
import { formatRelativeTime, createRelativeTimeLabels } from "../utils/timeUtils"
import { VirtualizedSessionList } from "./VirtualizedSessionList"
import {
	Plus,
	Loader2,
	RefreshCw,
	GitBranch,
	Folder,
	Share2,
	PanelLeftClose,
	ChevronDown,
	ChevronRight,
	Inbox,
	Settings,
	Book,
	MessageSquare,
	History,
} from "lucide-react"
import "./SidebarHistory.css"

// Performance constants
const MAX_SESSIONS_PER_FOLDER = 50
const SESSION_ITEM_HEIGHT = 60

// Easter egg constants (simplified version)
const ODYSSEY_STORY = [
	{ emoji: "👍", message: "Thanks for the feedback!", effect: "shake-sm", specialEvent: null },
	{ emoji: "🎉", message: "You're awesome!", effect: "rainbow", specialEvent: "confetti" },
	{ emoji: "🤖", message: "Bleep bloop!", effect: "glitch-sm", specialEvent: null },
	{ emoji: "🌈", message: "Spectacular!", effect: "rainbow", specialEvent: null },
	{ emoji: "🔥", message: "Fire feedback!", effect: "shake-md", specialEvent: null },
]

export function SidebarHistory() {
	const { t } = useTranslation("agentManager")
	const groupedSessions = useAtomValue(groupedSessionsAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)
	const isRefreshing = useAtomValue(isRefreshingRemoteSessionsAtom)
	const setIsRefreshing = useSetAtom(isRefreshingRemoteSessionsAtom)
	const machineUiState = useAtomValue(sessionMachineUiStateAtom)
	const setIsSidebarOpen = useSetAtom(isSidebarOpenAtom)
	const [collapsedFolders, setCollapsedFolders] = useAtom(collapsedFoldersAtom)
	const [manualFolders, setManualFolders] = useAtom(manualFoldersAtom)
	const sessionToFolder = useAtomValue(sessionToFolderAtom)
	const workspaceConfigLoaded = useAtomValue(workspaceConfigLoadedAtom)
	const mergedSessions = useAtomValue(mergedSessionsAtom)

	// Easter egg state
	const [clickCount, setClickCount] = useState(() => {
		const saved = localStorage.getItem('kilocode-feedback-odyssey')
		return saved ? parseInt(saved, 10) : 0
	})
	const [showEasterEgg, setShowEasterEgg] = useState(false)
	const [currentSpecialEvent, setCurrentSpecialEvent] = useState<string | null>(null)

	// Persist workspace config whenever it changes
	React.useEffect(() => {
		if (!workspaceConfigLoaded) return

		vscode.postMessage({
			type: "agentManager.updateWorkspaceConfig",
			config: {
				manualFolders,
				sessionToFolder,
				collapsedFolders: Array.from(collapsedFolders),
			},
		})
	}, [manualFolders, sessionToFolder, collapsedFolders, workspaceConfigLoaded])

	// Persist click count
	React.useEffect(() => {
		localStorage.setItem('kilocode-feedback-odyssey', clickCount.toString())
	}, [clickCount])

	const setSelectedFolderId = useSetAtom(selectedFolderIdAtom)

	// Calculate total messages across all sessions
	const totalMessages = useMemo(() => {
		return mergedSessions.length
	}, [mergedSessions])

	const handleNewSession = useCallback((folderId: string | null = null) => {
		setSelectedId(null)
		setSelectedFolderId(folderId)
	}, [setSelectedId, setSelectedFolderId])

	const handleSelectSession = useCallback((id: string) => {
		setSelectedId(id)
		vscode.postMessage({ type: "agentManager.selectSession", sessionId: id })
	}, [setSelectedId])

	const handleRefresh = useCallback(() => {
		if (isRefreshing) return
		setIsRefreshing(true)
		vscode.postMessage({ type: "agentManager.refreshRemoteSessions" })
	}, [isRefreshing, setIsRefreshing])

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

	const handleFeedbackClick = useCallback(() => {
		const newCount = clickCount + 1
		setClickCount(newCount)
		setShowEasterEgg(true)

		const stage = ODYSSEY_STORY[Math.max(0, Math.min(newCount - 1, ODYSSEY_STORY.length - 1))]
		if (stage.specialEvent) {
			setCurrentSpecialEvent(stage.specialEvent)
			setTimeout(() => {
				setCurrentSpecialEvent(null)
			}, 2000)
		}

		if (newCount < 10 && !stage.specialEvent) {
			setTimeout(() => {
				setShowEasterEgg(false)
			}, 4000)
		}
	}, [clickCount])

	const handleResetOdyssey = useCallback(() => {
		setClickCount(0)
		setShowEasterEgg(false)
		setCurrentSpecialEvent(null)
	}, [])

	const handleNavigate = useCallback((page: string) => {
		if (page === 'settings') {
			vscode.postMessage({ type: "agentManager.navigate", page: "settings" })
		}
	}, [])

	const isNewAgentSelected = selectedId === null && !pendingSession
	const activeSection = 'workspaces' // Simplified - always show workspaces

	const inboxGroup = groupedSessions.find((g) => g.folder.id === "inbox")
	const workspaceGroups = groupedSessions.filter((g) => g.folder.id !== "inbox")

	const odysseyStage = ODYSSEY_STORY[Math.max(0, Math.min(clickCount - 1, ODYSSEY_STORY.length - 1))]

	return (
		<div className="am-sidebar">
			<div className="am-sidebar-history">
				<div className="am-sidebar-scroll-content">
					<div className="am-sidebar-section">
						<div
							className={`am-sidebar-item am-inbox-item ${selectedId === null && !isNewAgentSelected ? "am-selected" : ""}`}
							onClick={() => toggleFolder("inbox")}>
							<div className="am-item-left">
								<Inbox size={16} />
								<span className="am-sidebar-label">Inbox</span>
							</div>
							<div className="am-unread-badge">{totalMessages}</div>
						</div>
						{!collapsedFolders.has("inbox") && inboxGroup && (
							<div className="am-folder-contents" style={{ maxHeight: '400px' }}>
								{inboxGroup.sessions.length > MAX_SESSIONS_PER_FOLDER ? (
									<VirtualizedSessionList
										sessions={inboxGroup.sessions}
										selectedId={selectedId}
										machineUiState={machineUiState}
										onSelectSession={handleSelectSession}
										renderSession={(session, isSelected, uiState) => (
											<SessionItem
												session={session}
												isSelected={isSelected}
												uiState={uiState}
												onSelect={() => handleSelectSession(session.sessionId)}
											/>
										)}
										itemHeight={SESSION_ITEM_HEIGHT}
									/>
								) : (
									inboxGroup.sessions.map((session) => (
										<SessionItem
											key={session.sessionId}
											session={session}
											isSelected={selectedId === session.sessionId}
											uiState={machineUiState[session.sessionId]}
											onSelect={() => handleSelectSession(session.sessionId)}
										/>
									))
								)}
							</div>
						)}
						<button className="am-start-btn" onClick={() => handleNewSession(null)}>
							<Plus size={16} />
							<span className="am-sidebar-label">Start conversation</span>
						</button>
					</div>

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
									<div className="am-folder-contents" style={{ maxHeight: '400px' }}>
										{group.sessions.length > MAX_SESSIONS_PER_FOLDER ? (
											<VirtualizedSessionList
												sessions={group.sessions}
												selectedId={selectedId}
												machineUiState={machineUiState}
												onSelectSession={handleSelectSession}
												renderSession={(session, isSelected, uiState) => (
													<SessionItem
														session={session}
														isSelected={isSelected}
														uiState={uiState}
														onSelect={() => handleSelectSession(session.sessionId)}
													/>
												)}
												itemHeight={SESSION_ITEM_HEIGHT}
											/>
										) : (
											group.sessions.map((session) => (
												<SessionItem
													key={session.sessionId}
													session={session}
													isSelected={selectedId === session.sessionId}
													uiState={machineUiState[session.sessionId]}
													onSelect={() => handleSelectSession(session.sessionId)}
												/>
											))
										)}
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
					<div className="am-sidebar-item am-feedback-row">
						<div className="am-feedback-btn" onClick={handleFeedbackClick}>
							<MessageSquare size={16} />
							<span>Provide Feedback</span>
						</div>
						<button className="am-reset-odyssey-btn" onClick={handleResetOdyssey} title="Reset Odyssey (Debug)">
							<History size={16} />
						</button>
					</div>
				</div>
			</div>

			{showEasterEgg && (
				<div className="am-easter-egg-overlay" onClick={() => setShowEasterEgg(false)}>
					{currentSpecialEvent === "confetti" && (
						<div className="am-confetti-cannon">
							{Array.from({ length: 50 }, (_, i) => (
								<div
									key={i}
									className="am-confetti"
									style={{
										backgroundColor: [
											"#f44336",
											"#e91e63",
											"#9c27b0",
											"#673ab7",
											"#3f51b5",
											"#2196f3",
											"#03a9f4",
											"#00bcd4",
											"#009688",
											"#4caf50",
											"#8bc34a",
											"#cddc39",
											"#ffeb3b",
											"#ffc107",
											"#ff9800",
											"#ff5722",
										][Math.floor(Math.random() * 16)],
										left: Math.random() * 100 + "%",
										width: 8 + Math.random() * 12 + "px",
										height: 8 + Math.random() * 12 + "px",
										animationDelay: Math.random() * 2 + "s",
										"--rotation": `${Math.floor(Math.random() * 360)}deg`,
										"--drift": `${Math.random() * 600 - 300}px`,
									} as React.CSSProperties}
								/>
							))}
						</div>
					)}
					<div className={`am-easter-egg-content ${odysseyStage.effect} ${currentSpecialEvent || ""}`}>
						<div className="am-easter-egg-emoji">{odysseyStage.emoji}</div>
						<div className="am-easter-egg-message">{odysseyStage.message}</div>
					</div>
				</div>
			)}
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
	const [showShareConfirm, setShowShareConfirm] = useState(false)
	const [isHovered, setIsHovered] = useState(false)

	const showSpinner = uiState?.showSpinner ?? false
	const isActive = uiState?.isActive ?? false
	const isWorktree = session.parallelMode?.enabled
	const branchName = session.parallelMode?.branch
	const isCompleted = session.status === "done"

	const handleShareClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowShareConfirm(true)
	}

	const handleShareConfirm = (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowShareConfirm(false)
		setIsHovered(false)
		vscode.postMessage({ type: "agentManager.sessionShare", sessionId: session.sessionId })
	}

	const handleShareCancel = (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowShareConfirm(false)
		setIsHovered(false)
	}

	return (
		<div
			className={`am-session-item ${isSelected ? 'am-selected' : ''}`}
			onClick={onSelect}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => !showShareConfirm && setIsHovered(false)}
			style={{ position: 'relative' }}
		>
			{session.status === "creating" && (
				<div className="am-status-icon am-creating" title={t("status.creating")}>
					<Loader2 size={14} className="am-spinning" />
				</div>
			)}
			{showSpinner && (
				<div className="am-status-icon am-running" title={t("status.running")}>
					<Loader2 size={14} className="am-spinning" />
				</div>
			)}
			<div className="am-session-content">
				<div className="am-session-title" title={session.label}>{session.label}</div>
				<div className="am-session-meta">
					{session.status === "creating" && isActive
						? t("status.creating")
						: formatRelativeTime(session.startTime, timeLabels)}
					{isWorktree && (
						<span className="am-worktree-indicator" title={branchName || t("sidebar.worktree")}>
							<GitBranch size={10} />
							{branchName ? (
								<span className="am-branch-name">
									{branchName.length > 20 ? branchName.slice(0, 20) + "..." : branchName}
								</span>
							) : (
								<span>{t("sidebar.worktree")}</span>
							)}
						</span>
					)}
					{!isWorktree && (
						<span className="am-workspace-indicator" title={t("sidebar.local")}>
							<Folder size={10} />
						</span>
					)}
				</div>
				{isWorktree && isCompleted && <div className="am-ready-to-merge">{t("sidebar.readyToMerge")}</div>}
			</div>
			{(isHovered || showShareConfirm) && (
				<button
					className="am-share-btn"
					onClick={handleShareClick}
					title={t("sidebar.shareSession")}
					aria-label={t("sidebar.shareSession")}
				>
					<Share2 size={14} />
				</button>
			)}
			{showShareConfirm && (
				<div
					className="am-share-confirm"
					onClick={(e) => e.stopPropagation()}
				>
					<div className="text-sm mb-2">{t("sidebar.shareConfirmMessage")}</div>
					<div className="flex gap-2">
						<button
							className="am-share-confirm-btn am-yes"
							onClick={handleShareConfirm}
						>
							{t("sidebar.shareConfirmYes")}
						</button>
						<button
							className="am-share-confirm-btn am-no"
							onClick={handleShareCancel}
						>
							{t("sidebar.shareConfirmNo")}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
