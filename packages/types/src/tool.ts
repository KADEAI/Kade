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
	"execute_command",
	"read_file",
	"write_to_file",
	"edit",
	"grep",
	"list_dir",
	"glob",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
	"codebase_search",
	// kade_change start
	"edit_file",
	"new_rule",
	"report_bug",
	"condense",
	"delete_file",
	"mkdir",
	"move_file",
	// kade_change end
	"update_todo_list",
	"run_slash_command",
	"generate_image",
	// kade_change start
	"run_sub_agent",
	"fast_context",
	// kade_change end
	"web_search",
	"web_fetch",
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
	UNIFIED: "unified",
	MARKDOWN: "markdown",
} as const

/**
 * Tool protocol type for system prompt generation
 * Derived from TOOL_PROTOCOL constants to ensure type safety
 */
export type ToolProtocol = (typeof TOOL_PROTOCOL)[keyof typeof TOOL_PROTOCOL]

export const toolProtocolSchema = z.enum([TOOL_PROTOCOL.UNIFIED, TOOL_PROTOCOL.MARKDOWN]) // kade_change

/**
 * Checks if the protocol is native (non-XML).
 *
 * @param protocol - The tool protocol to check
 * @returns True if protocol is native
 */
export function isNativeProtocol(protocol: ToolProtocol): boolean {
	return false
}

/**
 * Gets the effective protocol from settings or falls back to the default UNIFIED.
 * This function is safe to use in webview-accessible code as it doesn't depend on vscode module.
 *
 * @param toolProtocol - Optional tool protocol from settings
 * @returns The effective tool protocol (defaults to "unified")
 */
export function getEffectiveProtocol(toolProtocol?: ToolProtocol): ToolProtocol {
	return toolProtocol || TOOL_PROTOCOL.MARKDOWN
}
