import { z } from "zod"

/**
 * ToolGroup
 */

export const toolGroups = ["read", "edit", "browser", "command", "mcp", "modes", "external"] as const


export const toolGroupsSchema = z.enum(toolGroups)

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * ToolName
 */

export const toolNames = [
	"bash",
	"batch",
	"read",
	"write",
	"edit",
	"grep",
	"list",
	"glob",
	"browser_action",
	"computer_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
	"ask",
	// kade_change start
	"edit_file",
	"new_rule",
	"report_bug",
	"condense",
	"delete_file",
	"mkdir",
	"move_file",
	// kade_change end
	"todo",
	"run_slash_command",
	"generate_image",
	// kade_change start
	"agent",
	"fast_context",
	// kade_change end
	"web",
	"fetch",
	"research_web",
	"wrap",
] as const


export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>

/**
 * Tool protocol constants
 */
export const TOOL_PROTOCOL = {
	JSON: "json",
	UNIFIED: "unified",
	MARKDOWN: "markdown",
} as const

export const FORCED_CODE_BLOCK_TOOL_PROTOCOL_PROVIDERS = [
	"aihubmix",
	"bluesminds",
	"kiro",
	"opencode",
	"ovhcloud",
	"zed",
] as const

/**
 * Tool protocol type for system prompt generation
 * Derived from TOOL_PROTOCOL constants to ensure type safety
 */
export type ToolProtocol = (typeof TOOL_PROTOCOL)[keyof typeof TOOL_PROTOCOL]

export const toolProtocolSchema = z.enum([TOOL_PROTOCOL.JSON, TOOL_PROTOCOL.UNIFIED, TOOL_PROTOCOL.MARKDOWN]) // kade_change

/**
 * Checks if the protocol uses provider-native JSON tool calling.
 *
 * @param protocol - The tool protocol to check
 * @returns True if protocol is native
 */
export function isNativeProtocol(protocol: ToolProtocol): boolean {
	return protocol === TOOL_PROTOCOL.JSON
}

/**
 * Gets the effective protocol from settings or falls back to the default JSON/native protocol.
 * This function is safe to use in webview-accessible code as it doesn't depend on vscode module.
 *
 * @param toolProtocol - Optional tool protocol from settings
 * @returns The effective tool protocol (defaults to "json")
 */
export function getEffectiveProtocol(toolProtocol?: ToolProtocol): ToolProtocol {
	return toolProtocol || TOOL_PROTOCOL.JSON
}

export function providerForcesCodeBlockToolProtocol(provider?: string): boolean {
	return !!provider && FORCED_CODE_BLOCK_TOOL_PROTOCOL_PROVIDERS.includes(provider as any)
}
