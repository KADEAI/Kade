import React, { useEffect, useState } from "react"
import { vscode } from "../../agent-manager/utils/vscode"

// Define types outside the component or move to a separate types file
interface AgentCardState {
	id: string
	role: "leader" | "worker" | "validator"
	name: string
	status: "idle" | "running" | "paused" | "completed" | "failed"
	currentAction?: string
	terminalOutput?: string
	branchName?: string
}

interface TeamState {
	taskId: string
	taskDescription: string
	status: "idle" | "planning" | "working" | "validating" | "merging" | "completed"
	leader: AgentCardState | null
	workers: AgentCardState[]
	validator: AgentCardState | null
}

interface ChatMessage {
	role: "user" | "assistant"
	text: string
	ts: number
}

const AgentCard: React.FC<{ agent: AgentCardState; title: string }> = ({ agent, title }) => (
	<div className={`p-3 rounded border ${agent.status === 'running' ? 'border-vscode-focusBorder' : 'border-vscode-panel-border'} bg-vscode-editor-inactiveSelectionBackground text-xs`}>
		<div className="flex justify-between items-center mb-2">
			<h3 className="font-bold">{title}</h3>
			<span className={`px-1.5 py-0.5 rounded ${agent.status === 'running' ? 'bg-vscode-statusBarItem-warningBackground text-vscode-statusBarItem-warningForeground' :
				agent.status === 'completed' ? 'bg-vscode-testing-iconPassed text-white' : 'bg-vscode-badge-background text-vscode-badge-foreground'
				}`} style={{ fontSize: '10px' }}>
				{agent.status.toUpperCase()}
			</span>
		</div>
		<p className="font-mono opacity-80 mb-2 truncate">{agent.name}</p>
		{agent.branchName && (
			<div className="opacity-60 mb-2 flex items-center gap-1 overflow-hidden text-nowrap">
				<span className="codicon codicon-git-branch text-[10px]"></span>
				{agent.branchName}
			</div>
		)}
		<div className="bg-vscode-editor-background p-2 rounded font-mono h-20 overflow-y-auto whitespace-pre-wrap text-[10px] leading-tight">
			{agent.currentAction || agent.terminalOutput || "Waiting..."}
		</div>
	</div>
)

// Move component definition inside to avoid any export issues with HMR
export const GroupChatApp: React.FC = () => {
	const [input, setInput] = useState("")
	// Initialize with a welcome message from the Leader
	const [messages, setMessages] = useState<ChatMessage[]>([
		{ role: "assistant", text: "Hello! I'm your Team Leader. What project would you like us to build today?", ts: Date.now() }
	])
	const [state, setState] = useState<TeamState>({
		taskId: "",
		taskDescription: "",
		status: "idle",
		leader: { id: "leader-1", role: "leader", name: "Team Leader", status: "idle", currentAction: "Ready to orchestrate." },
		workers: [],
		validator: { id: "validator-1", role: "validator", name: "Validator", status: "idle", currentAction: "Standing by." }
	})

	const chatContainerRef = React.useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "stateUpdate") {
				setState(message.state)
			} else if (message.type === "chatMessage") {
				// Received a new message from the Leader agent
				setMessages(prev => [...prev, { role: "assistant", text: message.text, ts: Date.now() }])
			}
		}
		window.addEventListener("message", handleMessage)
		// Request initial state
		vscode.postMessage({ type: "webviewReady" })
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// Blitz Mode toggle state
	const [isBlitzMode, setIsBlitzMode] = useState(false)

	// Auto-scroll chat
	useEffect(() => {
		if (chatContainerRef.current) {
			chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
		}
	}, [messages])

	const handleSendMessage = () => {
		if (!input.trim()) return

		// Add user message to UI immediately
		const userMsg: ChatMessage = { role: "user", text: input, ts: Date.now() }
		setMessages(prev => [...prev, userMsg])

		// Send to extension to forward to Leader agent
		vscode.postMessage({ type: "sendMessage", text: input, isBlitzMode })

		setInput("")
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSendMessage()
		}
	}

	return (
		<div className="flex h-screen bg-vscode-editor-background text-vscode-editor-foreground overflow-hidden">
			{/* LEFT PANEL: Chat Interface */}
			<div className="w-1/3 min-w-[300px] flex flex-col border-r border-vscode-panel-border bg-vscode-sideBar-background">
				<div className="p-4 border-b border-vscode-panel-border bg-vscode-titleBar-activeBackground text-vscode-titleBar-activeForeground flex justify-between items-center">
					<h2 className="font-bold flex items-center gap-2">
						<span className="codicon codicon-comment-discussion"></span>
						Team Leader Chat
					</h2>
					<div className="flex items-center gap-3">
						<label className="flex items-center gap-1.5 cursor-pointer" title="Auto-Parallel Execution: No Pre-Planning">
							<span className="text-xs font-medium opacity-80">Blitz Mode</span>
							<div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${isBlitzMode ? 'bg-vscode-focusBorder' : 'bg-vscode-input-background border border-vscode-input-border'}`}
								onClick={() => setIsBlitzMode(!isBlitzMode)}>
								<div className={`w-3 h-3 rounded-full bg-white shadow-sm transform transition-transform ${isBlitzMode ? 'translate-x-4' : 'translate-x-0'}`} />
							</div>
						</label>

						{state.leader?.status === 'running' && (
							<button
								onClick={() => vscode.postMessage({ type: "stopLeader" })}
								className="w-6 h-6 rounded bg-red-600 hover:bg-red-700 flex items-center justify-center"
								title="Stop the Leader agent"
							>
								<div className="w-2.5 h-2.5 bg-white rounded-sm"></div>
							</button>
						)}
					</div>
				</div>

				<div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatContainerRef}>
					{messages.map((msg, i) => (
						<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
							<div className={`max-w-[85%] p-3 rounded-lg text-sm ${msg.role === 'user'
								? 'bg-vscode-button-background text-vscode-button-foreground'
								: 'bg-vscode-editor-inactiveSelectionBackground border border-vscode-panel-border'
								}`}>
								{msg.text}
							</div>
						</div>
					))}
				</div>

				<div className="p-4 border-t border-vscode-panel-border bg-vscode-editor-background">
					<div className="relative">
						<textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Describe your task or ask questions..."
							className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-2 pr-10 focus:outline-none focus:border-vscode-focusBorder h-24 resize-none font-sans text-sm"
						/>
						<button
							onClick={handleSendMessage}
							disabled={!input.trim()}
							className="absolute bottom-2 right-2 p-1.5 rounded hover:bg-vscode-editor-hoverHighlight text-vscode-textLink-activeForeground disabled:opacity-50"
						>
							<span className="codicon codicon-send"></span>
						</button>
					</div>
				</div>
			</div>

			{/* RIGHT PANEL: Team Board (Lanes) */}
			<div className="flex-1 flex flex-col h-full overflow-hidden bg-vscode-editor-background">
				<header className="p-4 border-b border-vscode-panel-border flex justify-between items-center bg-vscode-editor-background">
					<div>
						<h1 className="text-xl font-bold flex items-center gap-2">
							<span className="codicon codicon-organization"></span>
							Mission Control
						</h1>
					</div>
					<div className="flex items-center gap-4">
						<div className="text-right">
							<span className="text-xs opacity-50 block">STATUS</span>
							<span className="font-bold text-vscode-textLink-foreground uppercase tracking-wider text-sm">
								{state.status}
							</span>
						</div>
					</div>
				</header>

				<div className="flex-1 overflow-auto p-6">
					<div className="grid grid-rows-[auto_1fr_auto] gap-8 h-full relative min-h-[500px]">
						{/* Connecting Lines */}
						<div className="absolute inset-0 pointer-events-none flex justify-center">
							<div className="w-0.5 bg-vscode-panel-border h-full opacity-30"></div>
						</div>

						{/* 1. Team Leader Status */}
						<div className="relative z-10 flex justify-center">
							<div className="w-full max-w-lg">
								{state.leader && <AgentCard agent={state.leader} title="👑 Team Leader" />}
							</div>
						</div>

						{/* 2. Workers (Parallel Lanes) */}
						<div className="relative z-10 flex flex-col justify-center">
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
								{state.workers.length === 0 && (
									<div className="col-span-full text-center opacity-40 py-10 border-2 border-dashed border-vscode-panel-border rounded-lg">
										<p>No active workers yet.</p>
										<p className="text-xs mt-1">Discuss the plan with the Leader to start.</p>
									</div>
								)}
								{state.workers.map((worker, i) => (
									<AgentCard key={worker.id} agent={worker} title={`👷 Worker ${i + 1}`} />
								))}
							</div>
						</div>

						{/* 3. Validator */}
						<div className="relative z-10 flex justify-center">
							<div className="w-full max-w-lg">
								{state.validator && <AgentCard agent={state.validator} title="🛡️ Validator" />}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
