import type { ToolName } from "@roo-code/types"

import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser"
import type { McpToolUse, ToolUse } from "../../shared/tools"
import { buildBatchChildToolCallId } from "../tools/batchToolCallId"

type BatchCall = {
	name?: unknown
	arguments?: unknown
}

const STREAMABLE_GROUPED_CHILD_TOOLS = new Set([
	"write",
	"edit",
	"read",
	"list",
	"grep",
	"glob",
	"mkdir",
	"move_file",
	"bash",
	"fetch_instructions",
	"switch_mode",
	"new_task",
	"agent",
	"run_slash_command",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask",
	"todo",
	"generate_image",
	"attempt_completion",
])

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
}

export function getEffectiveStreamingToolUse(partialToolUse: ToolUse | McpToolUse): ToolUse | McpToolUse {
	if (partialToolUse.type !== "tool_use") {
		return partialToolUse
	}

	if (partialToolUse.name !== "batch") {
		return partialToolUse
	}

	const calls = (partialToolUse.nativeArgs as { calls?: BatchCall[] } | undefined)?.calls
	if (!Array.isArray(calls) || calls.length === 0) {
		return partialToolUse
	}

	let childIndex = -1
	let childCall: BatchCall | undefined
	for (let index = calls.length - 1; index >= 0; index--) {
		const call = calls[index]
		if (typeof call?.name === "string" && STREAMABLE_GROUPED_CHILD_TOOLS.has(call.name)) {
			childCall = call
			childIndex = index
			break
		}
	}

	if (!childCall || typeof childCall.name !== "string") {
		return partialToolUse
	}

	const childToolCallId = buildBatchChildToolCallId(partialToolUse.id, childIndex, childCall.name)

	const parsedChild = NativeToolCallParser.parseToolCall({
		id: childToolCallId || partialToolUse.id || "grouped_content_partial",
		name: childCall.name as ToolName,
		arguments: JSON.stringify(isObjectRecord(childCall.arguments) ? childCall.arguments : {}),
	})

	if (!parsedChild || parsedChild.type !== "tool_use") {
		return partialToolUse
	}

	parsedChild.partial = partialToolUse.partial
	parsedChild.id = childToolCallId || partialToolUse.id
	return parsedChild
}
