import * as vscode from "vscode"
import { getUri } from "../../webview/getUri"
import { getNonce } from "../../webview/getNonce"
import { getViteDevServerConfig } from "../../webview/getViteDevServerConfig"
import { ClineProvider } from "../../webview/ClineProvider"
import { TeamState, AgentCardState } from "./types"

export class GroupChatProvider implements vscode.Disposable {
	public static readonly viewType = "kilo-code.GroupChatPanel"
	private static instance: GroupChatProvider | undefined

	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []

	// Team State
	private state: TeamState = {
		taskId: "",
		taskDescription: "",
		status: "idle",
		leader: { id: "leader-1", role: "leader", name: "Team Leader", status: "idle", currentAction: "Ready." },
		workers: [],
		validator: { id: "validator-1", role: "validator", name: "Validator", status: "idle", currentAction: "Standing by." },
	}

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly provider: ClineProvider,
	) {
		GroupChatProvider.instance = this
	}

	public static getInstance(): GroupChatProvider | undefined {
		return GroupChatProvider.instance
	}

	public async openPanel(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One)
			return
		}

		this.panel = vscode.window.createWebviewPanel(
			GroupChatProvider.viewType,
			"Group Chat",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri],
			},
		)

		this.panel.iconPath = {
			light: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "kilo-light.svg"),
			dark: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "kilo-dark.svg"),
		}

		this.panel.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(this.panel.webview)
				: this.getHtmlContent(this.panel.webview)

		this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables)

		// Send initial state
		this.updateFrontend()

		this.panel.onDidDispose(
			() => {
				this.panel = undefined
			},
			null,
			this.disposables,
		)

		this.outputChannel.appendLine("Group Chat panel opened")
	}

	private updateFrontend() {
		if (this.panel) {
			this.panel.webview.postMessage({ type: "stateUpdate", state: this.state })
		}
	}

	private async handleMessage(message: { type: string;[key: string]: unknown }): Promise<void> {
		this.outputChannel.appendLine(`Group Chat received message: ${JSON.stringify(message)}`)

		switch (message.type) {
			case "webviewReady":
				// Just send initial state, don't start Leader yet
				this.updateFrontend()
				break
			case "sendMessage":
				await this.handleUserChat(message.text as string, message.isBlitzMode as boolean)
				break
			case "stopLeader":
				await this.stopLeader()
				break
		}
	}

	private async stopLeader() {
		const { AgentManagerProvider } = await import("../agent-manager/AgentManagerProvider")
		const agentManager = AgentManagerProvider.getInstance()

		if (!agentManager) {
			this.outputChannel.appendLine("[GroupChat] No agent manager")
			return
		}

		const sessions = (agentManager as any).registry?.getSessions() || []
		this.outputChannel.appendLine(`[GroupChat] Searching ${sessions.length} sessions for teamId=${this.state.taskId}`)

		const leaderSession = sessions.find((s: any) => s.teamId === this.state.taskId && s.teamRole === "leader")

		if (leaderSession) {
			this.outputChannel.appendLine(`[GroupChat] Stopping session ${leaderSession.sessionId}`)

			// Use terminateProcess for graceful shutdown
			const ph = (agentManager as any).processHandler
			if (ph?.terminateProcess) {
				ph.terminateProcess(leaderSession.sessionId)
			}

			// Update registry
			(agentManager as any).registry?.updateSessionStatus(leaderSession.sessionId, "stopped")

			// Update UI
			if (this.state.leader) {
				this.state.leader.status = "paused"
				this.state.leader.currentAction = "Stopped by user"
			}
			this.updateFrontend()
		} else {
			this.outputChannel.appendLine("[GroupChat] Leader session not found")
		}
	}

	private async handleUserChat(text: string, isBlitzMode = false) {
		const { AgentManagerProvider } = await import("../agent-manager/AgentManagerProvider")
		const agentManager = AgentManagerProvider.getInstance()

		if (!agentManager) return

		// Find the actual session ID of the leader
		const sessions = (agentManager as any).registry?.getSessions() || []
		const leaderSession = sessions.find((s: any) => s.teamId === this.state.taskId && s.teamRole === "leader")

		if (leaderSession && leaderSession.status === "running") {
			// Leader is running - send the message via stdin
			await agentManager.sendMessage(leaderSession.sessionId, text)
			this.outputChannel.appendLine(`[GroupChat] Sent message to leader: ${text.slice(0, 50)}...`)
		} else {
			// No Leader or Leader completed - start a new session with this message as the prompt
			this.outputChannel.appendLine(`[GroupChat] Starting new Leader session with prompt: ${text.slice(0, 50)}...`)
			await this.startLeaderWithPrompt(text, agentManager, isBlitzMode)
		}
	}

	private async startLeaderWithPrompt(userPrompt: string, agentManager: any, isBlitzMode = false) {
		// Generate a team ID if not exists
		if (!this.state.taskId) {
			this.state.taskId = `team-${Date.now()}`
		}

		const teamId = this.state.taskId
		this.state.taskDescription = userPrompt
		this.state.status = "planning"

		this.state.leader = {
			id: `${teamId}-leader`,
			role: "leader",
			name: "Team Leader",
			status: "running",
			currentAction: isBlitzMode ? "Blitz Mode: Spawning workers..." : "Thinking...",
		}
		this.updateFrontend()

		let leaderPrompt = ""

		if (isBlitzMode) {
			// BLITZ MODE: Pure delegation, NO interaction
			leaderPrompt = `You are a DELEGATION ENGINE. 
The user wants: "${userPrompt}"

YOUR ONLY JOB:
1. Split this task into logical parallel sub-tasks (e.g., Frontend, Backend, Database).
2. IMMEDIATELY spawn workers using the 'run_sub_agent' tool.
   - Use 'parallelMode: true' for all workers.
   - Pass clear INSTRUCTIONS directly in the 'prompt' argument.
   - DO NOT create instruction files. Pass the text directly.
3. DO NOT CHAT. DO NOT PLAN. DO NOT WRITE CODE YOURSELF.
4. DO NOT ASK QUESTIONS. Just Execute.

Start spawning workers immediately.`
		} else {
			// CONVERSATIONAL MODE: Talk first
			leaderPrompt = `You are a TEAM LEADER for a software development squad.

The user said: "${userPrompt}"

IMPORTANT RULES:
1. ALWAYS start by asking clarifying questions. Do NOT assume you understand the full requirements.
2. Ask about specific features, tech preferences, and existing files.
3. Do NOT spawn workers until you have confirmed the plan with the user.
4. If the user request is vague (e.g., "hello"), ask what they want to build. DO NOT invent a project (like a todo app).
5. When ready to execute (ONLY after user confirms), use 'run_sub_agent' tool.
6. Keep responses SHORT and focused (under 3 sentences).

Start by greeting the user and asking 1-2 clarifying questions about their request.`
		}

		await agentManager.startAgentSession(leaderPrompt, {
			parallelMode: false,
			labelOverride: `👑 Leader`,
			teamId,
			teamRole: "leader",
			enableSubAgents: true,
		})

		// Start polling for updates
		this.subscribeToSessionUpdates(teamId, agentManager)
	}

	private subscribeToSessionUpdates(teamId: string, agentManager: InstanceType<typeof import("../agent-manager/AgentManagerProvider").AgentManagerProvider>) {
		// Store processed message IDs to avoid duplicates
		const processedMessageIds = new Set<string>()

		const pollInterval = setInterval(() => {
			// 1. Sync Sessions State
			const sessions = (agentManager as any).registry?.getSessions() || []
			const teamSessions = sessions.filter((s: any) => s.teamId === teamId)

			// Update Workers
			const workerSessions = teamSessions.filter((s: any) => s.teamRole === "worker")
			this.state.workers = workerSessions.map((s: any, i: number) => ({
				id: s.sessionId,
				role: "worker" as const,
				name: `Worker ${i + 1}: ${s.label?.replace("👷 Worker: ", "") || "Worker"}`,
				status: this.mapSessionStatus(s.status),
				currentAction: s.label || "Working...",
				branchName: s.parallelMode?.branch,
			}))

			// Update Leader Status
			const leaderSession = teamSessions.find((s: any) => s.teamRole === "leader")
			if (leaderSession && this.state.leader) {
				this.state.leader.status = this.mapSessionStatus(leaderSession.status)

				// 2. Sync Chat Messages from Leader
				// Access the internal messages map of AgentManager
				const messages = (agentManager as any).sessionMessages?.get(leaderSession.sessionId) || []

				messages.forEach((msg: any) => {
					// Skip partial (streaming) messages - only show complete ones
					if (msg.partial) return

					// We construct a unique ID for the message based on timestamp
					const msgId = `${msg.ts}`

					if (!processedMessageIds.has(msgId)) {
						if (msg.type === "say" && msg.say === "text" && msg.text) {
							// Forward Leader's text response to UI
							this.panel?.webview.postMessage({
								type: "chatMessage",
								text: msg.text
							})
							processedMessageIds.add(msgId)
						}
					}
				})
			}

			// Update Validator Status
			const validatorSession = teamSessions.find((s: any) => s.teamRole === "validator")
			if (validatorSession && this.state.validator) {
				this.state.validator.status = this.mapSessionStatus(validatorSession.status)
			}

			// Check if we should spawn validator (same logic as before) or just notify leader
			const allWorkersComplete = workerSessions.length > 0 && workerSessions.every((s: any) => s.status === "done" || s.status === "error")
			if (allWorkersComplete && this.state.status === "working") {
				this.state.status = "validating"
				// Note: In this new flow, the Leader might decide to spawn the validator itself,
				// or we can auto-spawn it. For now, let's auto-spawn to keep the flow moving.
				if (!validatorSession) {
					this.spawnValidator(teamId, agentManager)
				}
			}

			if (validatorSession?.status === "done") {
				this.state.status = "completed"
			}

			this.updateFrontend()
		}, 1000) // Poll faster for chat responsiveness

		this.disposables.push({ dispose: () => clearInterval(pollInterval) })
	}

	private async spawnValidator(teamId: string, agentManager: any) {
		this.state.validator = {
			id: `${teamId}-validator`,
			role: "validator",
			name: "Validator",
			status: "running",
			currentAction: "Merging and verifying...",
		}
		this.updateFrontend()

		const validatorPrompt = `You are the VALIDATOR. Review and merge the workers' branches.`
		await agentManager.startAgentSession(validatorPrompt, {
			parallelMode: true,
			labelOverride: `🛡️ Validator`,
			teamId,
			teamRole: "validator",
		})
	}

	private mapSessionStatus(status: string): "idle" | "running" | "paused" | "completed" | "failed" {
		switch (status) {
			case "running": return "running"
			case "done": return "completed"
			case "error": return "failed"
			case "stopped": return "paused"
			default: return "idle"
		}
	}

	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const viteConfig = await getViteDevServerConfig(webview)

		if (!viteConfig) {
			vscode.window.showErrorMessage(
				"Vite dev server is not running. Please run 'pnpm dev' in webview-ui directory or use 'pnpm build'.",
			)
			return this.getHtmlContent(webview)
		}

		const { localServerUrl, csp, reactRefreshScript } = viteConfig

		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"group-chat.css",
		])

		const scriptUri = `http://${localServerUrl}/src/kilocode/group-chat/index.tsx`

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<title>Group Chat</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefreshScript}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	private getHtmlContent(webview: vscode.Webview): string {
		const scriptUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"group-chat.js",
		])
		const baseStylesUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"group-chat.css",
		])

		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
	<title>Group Chat</title>
	<link rel="stylesheet" type="text/css" href="${baseStylesUri}">
	<link rel="stylesheet" type="text/css" href="${stylesUri}">
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
	}

	public dispose(): void {
		this.panel?.dispose()
		this.disposables.forEach((d) => d.dispose())
	}
}

