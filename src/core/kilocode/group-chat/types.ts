export interface AgentCardState {
	id: string
	role: "leader" | "worker" | "validator"
	name: string
	status: "idle" | "running" | "paused" | "completed" | "failed"
	currentAction?: string
	terminalOutput?: string
	branchName?: string
}

export interface TeamState {
	taskId: string
	taskDescription: string
	status: "idle" | "planning" | "working" | "validating" | "merging" | "completed"
	leader: AgentCardState | null
	workers: AgentCardState[]
	validator: AgentCardState | null
}

export type GroupChatMessage =
	| { type: "stateUpdate"; state: TeamState }
	| { type: "startTask"; task: string }
	| { type: "stopTask" }
