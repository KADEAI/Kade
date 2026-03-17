import React, { useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	selectedSessionIdAtom,
	isRefreshingRemoteSessionsAtom,
	pendingSessionAtom,
	type AgentSession,
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
} from "lucide-react"

export function SessionSidebar() {
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

	const setSelectedFolderId = useSetAtom(selectedFolderIdAtom)

	const handleNewSession = (folderId: string | null = null) => {
		setSelectedId(null)
		setSelectedFolderId(folderId)
	}

	const handleSelectSession = (id: string) => {
		setSelectedId(id)
		vscode.postMessage({ type: "agentManager.selectSession", sessionId: id })
	}

	const handleRefresh = () => {
		if (isRefreshing) return // Prevent multiple clicks while loading
		setIsRefreshing(true)
		vscode.postMessage({ type: "agentManager.refreshRemoteSessions" })
	}

	const toggleFolder = (folderId: string) => {
		const newCollapsed = new Set(collapsedFolders)
		if (newCollapsed.has(folderId)) {
			newCollapsed.delete(folderId)
		} else {
			newCollapsed.add(folderId)
		}
		setCollapsedFolders(newCollapsed)
	}

	const handleAddFolder = (e: React.MouseEvent) => {
		e.stopPropagation()
		vscode.postMessage({ type: "agentManager.createFolder" })
	}

	const isNewAgentSelected = selectedId === null && !pendingSession

	const inboxGroup = groupedSessions.find((g) => g.folder.id === "inbox")
	const workspaceGroups = groupedSessions.filter((g) => g.folder.id !== "inbox")

	return (
		<div className="am-sidebar">
			<div className="am-sidebar-header">
				<span>{t("sidebar.title")}</span>
				<div style={{ display: "flex", gap: "4px" }}>
					<button
						className="am-icon-btn"
						onClick={handleRefresh}
						disabled={isRefreshing}
						title={t("sidebar.refresh")}>
						{isRefreshing ? <Loader2 size={14} className="am-spinning" /> : <RefreshCw size={14} />}
					</button>
					<button
						className="am-icon-btn"
						onClick={() => setIsSidebarOpen(false)}
						title="Collapse Sidebar">
						<PanelLeftClose size={14} />
					</button>
				</div>
			</div>

			<div className="am-sidebar-scroll-content">
				{/* Inbox Style Item at top if exists */}
				{inboxGroup && (
					<div
						className={`am-inbox-item ${selectedId === null && !isNewAgentSelected ? "" : ""}`}
						onClick={() => toggleFolder("inbox")}>
						<div className="flex items-center gap-2">
							<Inbox size={16} />
							<span>Inbox</span>
						</div>
						{inboxGroup.sessions.length > 0 && (
							<span className="am-inbox-count">{inboxGroup.sessions.length}</span>
						)}
					</div>
				)}

				{!collapsedFolders.has("inbox") &&
					inboxGroup?.sessions.map((session) => (
						<SessionItem
							key={session.sessionId}
							session={session}
							isSelected={selectedId === session.sessionId}
							uiState={machineUiState[session.sessionId]}
							onSelect={() => handleSelectSession(session.sessionId)}
						/>
					))}

				<div
					className={`am-new-agent-item ${isNewAgentSelected ? "am-selected" : ""}`}
					onClick={() => handleNewSession(null)}>
					<Plus size={16} />
					<span>{t("sidebar.newAgent")}</span>
				</div>

				<div className="am-sidebar-section-header am-workspaces-header">
					<span>Workspaces</span>
					<button className="am-icon-btn" onClick={handleAddFolder} title="Add Workspace">
						<Plus size={14} />
					</button>
				</div>

				<div className="am-workspace-list">
					{workspaceGroups.length === 0 && !pendingSession ? (
						<div className="am-no-sessions">
							<p>{t("sidebar.emptyState")}</p>
						</div>
					) : (
						workspaceGroups.map((group) => (
							<div key={group.folder.id} className="am-folder-group">
								<div className="am-folder-header" onClick={() => toggleFolder(group.folder.id)}>
									<div className="flex items-center gap-1 min-w-0">
										{collapsedFolders.has(group.folder.id) ? (
											<ChevronRight size={14} />
										) : (
											<ChevronDown size={14} />
										)}
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
									<div className="am-folder-sessions">
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
						))
					)}

					{/* Show pending session at the very bottom if not grouped yet */}
					{pendingSession && (
						<PendingSessionItem
							pendingSession={pendingSession}
							isSelected={selectedId === null}
							onSelect={() => setSelectedId(null)}
						/>
					)}
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
		<div className={`am-session-item pending ${isSelected ? "am-selected" : ""}`} onClick={onSelect}>
			<div className="am-status-icon creating" title={t("status.creating")}>
				<Loader2 size={14} className="am-spinning" />
			</div>
			<div className="am-session-content">
				<div className="am-session-label">{pendingSession.label}</div>
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
			className={`am-session-item ${isSelected ? "am-selected" : ""}`}
			onClick={onSelect}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => !showShareConfirm && setIsHovered(false)}>
			{session.status === "creating" && (
				<div className="am-status-icon creating" title={t("status.creating")}>
					<Loader2 size={14} className="am-spinning" />
				</div>
			)}
			{showSpinner && (
				<div className="am-status-icon running" title={t("status.running")}>
					<Loader2 size={14} className="am-spinning" />
				</div>
			)}
			<div className="am-session-content">
				<div className="am-session-label">{session.label}</div>
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
					className="w-5 h-5 border-none bg-transparent rounded-[3px] cursor-pointer flex items-center justify-center -mt-0.5 hover:bg-vscode-toolbar-hoverBackground"
					onClick={handleShareClick}
					title={t("sidebar.shareSession")}
					aria-label={t("sidebar.shareSession")}>
					<Share2 size={14} />
				</button>
			)}
			{showShareConfirm && (
				<div
					className="absolute top-full left-2 right-2 mt-1 p-3 bg-vscode-dropdown-background border border-vscode-dropdown-border rounded z-[100] shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
					onClick={(e) => e.stopPropagation()}>
					<div className="text-sm mb-2">{t("sidebar.shareConfirmMessage")}</div>
					<div className="flex gap-2">
						<button
							className="px-3 py-1 rounded-sm text-xs cursor-pointer border border-transparent transition-colors duration-150 bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground"
							onClick={handleShareConfirm}>
							{t("sidebar.shareConfirmYes")}
						</button>
						<button
							className="px-3 py-1 rounded-sm text-xs cursor-pointer border border-transparent transition-colors duration-150 bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground"
							onClick={handleShareCancel}>
							{t("sidebar.shareConfirmNo")}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
