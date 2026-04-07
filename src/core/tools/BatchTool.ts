import type { ToolName } from "@roo-code/types"

import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser"
import { Task } from "../task/Task"
import type { ToolResponse, ToolUse } from "../../shared/tools"
import { resolveToolAlias } from "../../shared/tool-aliases"
import { BaseTool, type ToolCallbacks } from "./BaseTool"
import { buildBatchChildToolCallId } from "./batchToolCallId"
import { validateToolUse } from "./validateToolUse"

type BatchCall = {
	name: string
	arguments: Record<string, unknown>
}

type BatchParams = {
	calls: BatchCall[]
	missingParamName?: "calls" | "commands" | "tools" | "content"
	parseError?: string
	parseErrors?: Array<{
		index: number
		command: string
		error: string
	}>
}

const DISALLOWED_BATCH_CHILD_TOOLS = new Set(["batch", "attempt_completion", "switch_mode", "new_task"])

function stringifyToolResponse(content: ToolResponse): string {
	if (typeof content === "string") {
		return content
	}

	return (
		content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n\n") || "(tool did not return anything)"
	)
}

function createBatchError(message: string): string {
	return `Error: ${message}`
}

function hasOwnStringValue(record: Record<string, unknown>, ...keys: string[]): boolean {
	return keys.some((key) => typeof record[key] === "string" && record[key].trim().length > 0)
}

function describeNestedToolParseFailure(name: string, args: Record<string, unknown>): string {
	const resolvedName = resolveToolAlias(name)
	if (resolvedName !== "edit") {
		return `Unable to parse nested tool "${name}".`
	}

	const path = typeof args.path === "string" ? args.path.trim() : ""
	if (!path) {
		return 'Invalid nested edit call: "path" is required.'
	}

	const rawEdits = args.edit ?? args.edits
	const rawBlocks = Array.isArray(rawEdits) ? rawEdits : rawEdits !== undefined ? [rawEdits] : []
	if (rawBlocks.length > 0) {
		for (const [index, rawBlock] of rawBlocks.entries()) {
			if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) {
				return `Invalid nested edit block ${index + 1}: each block must be an object.`
			}

			const block = rawBlock as Record<string, unknown>
			const isDeleteBlock = typeof block.type === "string" && /^(?:rm|remove|delete|line_deletion)$/i.test(block.type)
			if (!isDeleteBlock && !hasOwnStringValue(block, "oldText", "old_text", "old_string")) {
				return `Invalid nested edit block ${index + 1}: "oldText" is required.`
			}
			if (!isDeleteBlock && !hasOwnStringValue(block, "newText", "new_text", "new_string")) {
				return `Invalid nested edit block ${index + 1}: "newText" is required.`
			}
		}
	}

	const isDeleteBlock = typeof args.type === "string" && /^(?:rm|remove|delete|line_deletion)$/i.test(args.type)
	if (!isDeleteBlock && !hasOwnStringValue(args, "oldText", "old_text", "old_string")) {
		return 'Invalid nested edit call: "oldText" is required.'
	}
	if (!isDeleteBlock && !hasOwnStringValue(args, "newText", "new_text", "new_string")) {
		return 'Invalid nested edit call: "newText" is required.'
	}

	return `Unable to parse nested tool "${name}".`
}

export class BatchTool extends BaseTool<"batch"> {
	readonly name = "batch" as const

	private parseRawBatchCalls(rawCalls: string): BatchCall[] {
		const parsed = JSON.parse(rawCalls)
		if (Array.isArray(parsed)) {
			return parsed.map((call) => ({
				name: String(call?.name ?? ""),
				arguments:
					call && typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments)
						? call.arguments
						: {},
			}))
		}

		if (parsed && Array.isArray((parsed as { calls?: unknown[] }).calls)) {
			return (parsed as { calls: Array<{ name?: unknown; arguments?: unknown }> }).calls.map((call) => ({
				name: String(call?.name ?? ""),
				arguments:
					call && typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments)
						? (call.arguments as Record<string, unknown>)
						: {},
			}))
		}

		throw new Error("batch expects a JSON array or an object with a calls array")
	}

	private parseGroupedRouterCalls(rawActions: string, groupedName: "tools" | "content"): BatchParams {
		const parsedActions = JSON.parse(rawActions)
		const parsedToolUse = NativeToolCallParser.parseToolCall({
			id: `legacy_${groupedName}_batch`,
			name: groupedName as ToolName,
			arguments: JSON.stringify({ [groupedName]: parsedActions }),
		})

		const calls =
			parsedToolUse?.type === "tool_use" &&
			parsedToolUse.nativeArgs &&
			typeof parsedToolUse.nativeArgs === "object" &&
			Array.isArray((parsedToolUse.nativeArgs as { calls?: BatchCall[] }).calls)
				? (parsedToolUse.nativeArgs as { calls: BatchCall[] }).calls
				: []

		return {
			calls,
			missingParamName: groupedName,
		}
	}

	parseLegacy(params: Partial<Record<string, string>>): BatchParams {
		if (params.calls) {
			return {
				calls: this.parseRawBatchCalls(params.calls),
				missingParamName: "calls",
			}
		}

		if (params.tools) {
			return {
				...this.parseGroupedRouterCalls(params.tools, "tools"),
			}
		}

		if (params.content) {
			return {
				...this.parseGroupedRouterCalls(params.content, "content"),
			}
		}

		return { calls: [], missingParamName: "calls" }
	}

	async execute(params: BatchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const calls = Array.isArray(params.calls) ? params.calls : []
		const preludeErrors = Array.isArray(params.parseErrors) ? params.parseErrors : []

		if (calls.length === 0 && preludeErrors.length === 0) {
			task.consecutiveMistakeCount++
			task.recordToolError("batch")
			if (params.parseError) {
				callbacks.pushToolResult(createBatchError(params.parseError))
				return
			}
			callbacks.pushToolResult(
				await task.sayAndCreateMissingParamError("batch", params.missingParamName ?? "calls"),
			)
			return
		}

		const state = await task.providerRef.deref()?.getState()
		const mode = await task.getTaskMode()
		const includedTools = task.api.getModel().info?.includedTools?.map((tool) => resolveToolAlias(tool))
		const sections: string[] = []

		for (const parseFailure of preludeErrors) {
			task.consecutiveMistakeCount++
			task.recordToolError("batch", parseFailure.error)
			sections.push(
				`[${parseFailure.index + 1}] tool\n${createBatchError(parseFailure.error)}\nCommand: ${parseFailure.command}`,
			)
		}

		for (const [index, call] of calls.entries()) {
			const fallbackName = typeof call?.name === "string" && call.name.trim() ? call.name.trim() : "(invalid)"
			const heading = `[${index + 1}] ${fallbackName}`

			if (!call || typeof call !== "object") {
				task.consecutiveMistakeCount++
				sections.push(`${heading}\n${createBatchError("Each batch entry must be an object.")}`)
				continue
			}

			if (typeof call.name !== "string" || !call.name.trim()) {
				task.consecutiveMistakeCount++
				sections.push(`${heading}\n${createBatchError('Each batch entry must include a non-empty "name".')}`)
				continue
			}

			if (
				call.arguments !== undefined &&
				(typeof call.arguments !== "object" || call.arguments === null || Array.isArray(call.arguments))
			) {
				task.consecutiveMistakeCount++
				sections.push(`${heading}\n${createBatchError('Each batch entry must include an object-valued "arguments".')}`)
				continue
			}

			const resolvedChildName = resolveToolAlias(call.name.trim())
			if (DISALLOWED_BATCH_CHILD_TOOLS.has(resolvedChildName)) {
				task.consecutiveMistakeCount++
				sections.push(
					`${heading}\n${createBatchError(`Tool "${call.name}" cannot run inside batch.`)}`,
				)
				continue
			}

			const childToolCallId = buildBatchChildToolCallId(callbacks.toolCallId, index, call.name.trim())
			const parsedChild = NativeToolCallParser.parseToolCall({
				id: childToolCallId ?? `batch_${Date.now()}_${index}`,
				name: call.name.trim() as ToolName,
				arguments: JSON.stringify(call.arguments ?? {}),
			})

			if (!parsedChild || parsedChild.type !== "tool_use") {
				task.consecutiveMistakeCount++
				sections.push(
					`${heading}\n${createBatchError(describeNestedToolParseFailure(call.name.trim(), (call.arguments as Record<string, unknown>) ?? {}))}`,
				)
				continue
			}

			try {
				validateToolUse(
					parsedChild.name as ToolName,
					mode,
					state?.customModes ?? [],
					{ apply_diff: task.diffEnabled },
					parsedChild.params,
					state?.experiments,
					includedTools,
				)
			} catch (error) {
				task.consecutiveMistakeCount++
				task.recordToolError(parsedChild.name as ToolName, error instanceof Error ? error.message : String(error))
				sections.push(
					`${heading}\n${createBatchError(error instanceof Error ? error.message : String(error))}`,
				)
				continue
			}

			const childResults: string[] = []
			let childError: string | undefined
			task.recordToolUsage(parsedChild.name as ToolName)

			const childCallbacks: ToolCallbacks = {
				...callbacks,
				toolCallId: childToolCallId,
				handleError: async (action, error) => {
					const errorMessage = error instanceof Error ? error.message : String(error)
					childError = `Error ${action}: ${errorMessage}`
					task.recordToolError(parsedChild.name as ToolName, childError)
				},
				pushToolResult: (content) => {
					childResults.push(stringifyToolResponse(content))
				},
			}

			await this.executeNestedTool(task, parsedChild, childCallbacks)

			if (childError) {
				childResults.push(childError)
			}

			sections.push(
				`${parsedChild.originalName && parsedChild.originalName !== parsedChild.name ? `[${index + 1}] ${parsedChild.originalName} -> ${parsedChild.name}` : `[${index + 1}] ${parsedChild.name}`
				}\n${childResults.filter(Boolean).join("\n\n") || "(tool did not return anything)"}`,
			)

			if (task.didRejectTool) {
				break
			}
		}

		callbacks.pushToolResult(sections.join("\n\n"))
	}

	private async executeNestedTool(task: Task, block: ToolUse, callbacks: ToolCallbacks): Promise<void> {
		switch (block.name) {
			case "read": {
				const { readFileTool } = await import("./ReadFileTool")
				await readFileTool.handle(task, block as ToolUse<"read">, callbacks)
				return
			}
			case "write": {
				const { writeToFileTool } = await import("./WriteToFileTool")
				await writeToFileTool.handle(task, block as ToolUse<"write">, callbacks)
				return
			}
			case "edit": {
				const { editTool } = await import("./EditTool")
				await editTool.handle(task, block as ToolUse<"edit">, callbacks)
				return
			}
			case "list": {
				const { listDirTool } = await import("./ListFilesTool")
				await listDirTool.handle(task, block as ToolUse<"list">, callbacks)
				return
			}
			case "grep": {
				const { grepTool } = await import("./SearchFilesTool")
				await grepTool.handle(task, block as ToolUse<"grep">, callbacks)
				return
			}
			case "glob": {
				const { globTool } = await import("./GlobTool")
				await globTool.handle(task, block as ToolUse<"glob">, callbacks)
				return
			}
			case "ask": {
				const { codebaseSearchTool } = await import("./CodebaseSearchTool")
				await codebaseSearchTool.handle(task, block as ToolUse<"ask">, callbacks)
				return
			}
			case "bash": {
				const { executeCommandTool } = await import("./ExecuteCommandTool")
				await executeCommandTool.handle(task, block as ToolUse<"bash">, callbacks)
				return
			}
			case "todo": {
				const { updateTodoListTool } = await import("./UpdateTodoListTool")
				await updateTodoListTool.handle(task, block as ToolUse<"todo">, callbacks)
				return
			}
			case "web": {
				const { webSearchTool } = await import("./WebSearchTool")
				await webSearchTool.handle(task, block as ToolUse<"web">, callbacks)
				return
			}
			case "fetch": {
				const { webFetchTool } = await import("./FetchTool")
				await webFetchTool.handle(task, block as ToolUse<"fetch">, callbacks)
				return
			}
			case "browser_action": {
				const { browserActionTool } = await import("./BrowserActionTool")
				await browserActionTool(
					task,
					block,
					callbacks.askApproval,
					callbacks.handleError,
					callbacks.pushToolResult,
					callbacks.removeClosingTag,
				)
				return
			}
			case "computer_action": {
				const { computerActionTool } = await import("./ComputerActionTool")
				await computerActionTool.handle(task, block as ToolUse<"computer_action">, callbacks)
				return
			}
			case "access_mcp_resource": {
				const { accessMcpResourceTool } = await import("./accessMcpResourceTool")
				await accessMcpResourceTool.handle(task, block as ToolUse<"access_mcp_resource">, callbacks)
				return
			}
			case "generate_image": {
				const { generateImageTool } = await import("./GenerateImageTool")
				await generateImageTool.handle(task, block as ToolUse<"generate_image">, callbacks)
				return
			}
			case "mkdir": {
				const { mkdirTool } = await import("./MkdirTool")
				await mkdirTool.handle(task, block as ToolUse<"mkdir">, callbacks)
				return
			}
			case "move_file": {
				const { moveFileTool } = await import("./MoveFileTool")
				await moveFileTool.handle(task, block as ToolUse<"move_file">, callbacks)
				return
			}
			case "agent": {
				const { runSubAgentTool } = await import("./RunSubAgentTool")
				await runSubAgentTool.handle(task, block as ToolUse<"agent">, callbacks)
				return
			}
			case "run_slash_command": {
				const { runSlashCommandTool } = await import("./RunSlashCommandTool")
				await runSlashCommandTool.handle(task, block as ToolUse<"run_slash_command">, callbacks)
				return
			}
			case "use_mcp_tool": {
				const { useMcpToolTool } = await import("./UseMcpToolTool")
				await useMcpToolTool.handle(task, block as ToolUse<"use_mcp_tool">, callbacks)
				return
			}
			default:
				throw new Error(`Tool "${block.name}" is not supported inside batch.`)
		}
	}
}

export const batchTool = new BatchTool()
