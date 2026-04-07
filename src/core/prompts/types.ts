import { ToolProtocol } from "@roo-code/types"

/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	maxConcurrentFileReads: number
	todoListEnabled: boolean
	subAgentToolEnabled?: boolean
	browserToolEnabled?: boolean
	computerUseToolEnabled?: boolean
	showVibeStyling?: boolean
	useAgentRules: boolean
	newTaskRequireTodos: boolean
	toolProtocol?: ToolProtocol
	/** Unified format variant: "simple" (tool name args) or "structured" (tool:name(args), default) */
	unifiedFormatVariant?: "simple" | "structured"
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
	disableBatchToolUse?: boolean
	maxToolCalls?: number
	/** When true, use minimal system prompt (experimental) */
	minimalSystemPrompt?: boolean
}
