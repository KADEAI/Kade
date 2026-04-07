import type { ToolName, ModeConfig } from "@roo-code/types"
import { toolNames as validToolNames } from "@roo-code/types"

import { Mode, isToolAllowedForMode } from "../../shared/modes"
import { parseMcpToolName } from "../../utils/mcp-name"

/**
 * Checks if a tool name is a valid, known tool.
 * Note: This does NOT check if the tool is allowed for a specific mode,
 * only that the tool actually exists.
 */
export function isValidToolName(toolName: string): toolName is ToolName {
	// Check if it's a valid static tool
	if ((validToolNames as readonly string[]).includes(toolName)) {
		return true
	}

	// SPECIAL CASE: agent is a valid tool
	if (toolName === "agent") {
		return true
	}

	// Check if it's a dynamic MCP tool (mcp--serverName--toolName format)
	if (parseMcpToolName(toolName) !== null) {
		return true
	}

	return false
}

export function validateToolUse(
	toolName: ToolName,
	mode: Mode,
	customModes?: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, unknown>,
	experiments?: Record<string, boolean>,
	includedTools?: string[],
): void {
	// First, check if the tool name is actually a valid/known tool
	// This catches completely invalid tool names like "edit_file" that don't exist
	if (!isValidToolName(toolName)) {
		throw new Error(
			`Unknown tool "${toolName}". This tool does not exist. Please use one of the available tools: ${validToolNames.join(", ")}.`,
		)
	}

	// Then check if the tool is allowed for the current mode
	if (
		!isToolAllowedForMode(
			toolName,
			mode,
			customModes ?? [],
			toolRequirements,
			toolParams,
			experiments,
			includedTools,
		)
	) {
		throw new Error(`Tool "${toolName}" is not allowed in ${mode} mode.`)
	}
}
