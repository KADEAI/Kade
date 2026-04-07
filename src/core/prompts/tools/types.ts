import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { Experiments } from "@roo-code/types"

export type ToolArgs = {
	cwd: string
	supportsBrowserUse?: boolean
	supportsComputerUse: boolean
	diffStrategy?: DiffStrategy
	browserViewportSize?: string
	mcpHub?: McpHub
	toolOptions?: any
	partialReadsEnabled?: boolean
	compact?: boolean
	settings?: Record<string, any>
	experiments?: Partial<Experiments>
}
