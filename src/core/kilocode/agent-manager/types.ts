import type { Session as RemoteSession } from "../../../shared/kilocode/cli-sessions/core/SessionClient"

/**
 * Agent Manager Types
 */

export type AgentStatus = "creating" | "running" | "done" | "error" | "stopped" | "paused"
export type SessionSource = "local" | "remote"

/**
 * Parallel mode (worktree) information for a session
 */
export interface ParallelModeInfo {
	enabled: boolean
	branch?: string // e.g., "add-authentication-1702734891234"
	worktreePath?: string // e.g., "/tmp/kilocode-worktree-add-auth..."
	completionMessage?: string // Merge instructions from CLI on completion
}

export interface AgentSession {
	sessionId: string
	label: string
	prompt: string
	status: AgentStatus
	startTime: number
	endTime?: number
	exitCode?: number
	error?: string
	logs: string[]
	pid?: number
	source: SessionSource
	parallelMode?: ParallelModeInfo
	gitUrl?: string
	teamId?: string
	teamRole?: "leader" | "worker" | "validator"
}

/**
 * Represents a session that is being created (waiting for CLI's session_created event)
 */
export interface PendingSession {
	prompt: string
	label: string
	startTime: number
	parallelMode?: boolean
	gitUrl?: string
	teamId?: string
	teamRole?: "leader" | "worker" | "validator"
}

// Re-export remote session shape from shared session client for consistency
export type { RemoteSession }

export interface WorkspaceFolder {
	id: string
	name: string
	isManual?: boolean
	gitUrl?: string
}

export interface WorkspaceConfig {
	manualFolders: WorkspaceFolder[]
	sessionToFolder: Record<string, string>
	collapsedFolders: string[] // List of collapsed folder IDs
}

export interface AgentManagerState {
	sessions: AgentSession[]
	selectedId: string | null
}

/**
 * Messages from Webview to Extension
 */
export type AgentManagerMessage =
	| { type: "agentManager.webviewReady" }
	| { type: "agentManager.startSession"; prompt: string; folderId?: string; parallelMode?: boolean; existingBranch?: string; teamId?: string; teamRole?: "leader" | "worker" | "validator" }
	| { type: "agentManager.stopSession"; sessionId: string }
	| { type: "agentManager.selectSession"; sessionId: string }
	| { type: "agentManager.refreshRemoteSessions" }
	| { type: "agentManager.listBranches" }
	| { type: "agentManager.updateWorkspaceConfig"; config: WorkspaceConfig }
	| { type: "agentManager.createFolder" }

/**
 * Messages from Extension to Webview
 */
export type AgentManagerExtensionMessage =
	| { type: "agentManager.state"; state: AgentManagerState }
	| { type: "agentManager.sessionUpdated"; session: AgentSession }
	| { type: "agentManager.sessionRemoved"; sessionId: string }
	| { type: "agentManager.error"; error: string }
	| { type: "agentManager.remoteSessions"; sessions: RemoteSession[] }
	| { type: "agentManager.branches"; branches: string[]; currentBranch?: string }
	| { type: "agentManager.workspaceConfig"; config: WorkspaceConfig }
