import * as path from "path"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { listFiles } from "../../services/glob/list-files"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import * as fs from "fs/promises"
import { getBinPath, getLineCounts, getDirectoryMetadata } from "../../services/ripgrep"
import * as vscode from "vscode"

interface ListDirParams {
	path?: string | string[]
	recursive?: boolean
}

export class ListDirTool extends BaseTool<"list"> {
	readonly name = "list" as const
	private readonly MAX_LIST_RESULTS = 300

	parseLegacy(params: Partial<Record<string, string>>): ListDirParams {
		const recursiveRaw: string | undefined = params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		return {
			path: params.path || ".",
			recursive,
		}
	}

	async execute(params: ListDirParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const relDirPaths = (Array.isArray(params.path) ? params.path : [params.path || "."])
			.flatMap((value) =>
				typeof value === "string"
					? value
							.split(/[|,]/)
							.map((p) => p.trim())
							.filter(Boolean)
					: [],
			)
		const normalizedRelDirPaths = relDirPaths.length > 0 ? relDirPaths : ["."]
		const { recursive } = params
		const { askApproval, handleError, pushToolResult, removeClosingTag } = callbacks

		try {
			task.consecutiveMistakeCount = 0

			const absolutePaths = normalizedRelDirPaths.map((p) => path.resolve(task.cwd, p))
			const isOutsideWorkspace = absolutePaths.some((absolutePath) => isPathOutsideWorkspace(absolutePath))
			const { showRooIgnoredFiles = false } = (await task.providerRef.deref()?.getState()) ?? {}

			const results: string[] = []

			for (const [index, currentRelDirPath] of normalizedRelDirPaths.entries()) {
				const absolutePath = absolutePaths[index]
				const [files, didHitLimit] = await listFiles(absolutePath, recursive || false, this.MAX_LIST_RESULTS)

				let fileLines = new Map<string, number>()
				let directoryMetadata = new Map<string, { files: number, folders: number }>()
				const listedDirectories = files
					.filter((entry) => entry.endsWith("/"))
					.map((entry) => path.relative(absolutePath, entry))

				fileLines = await getLineCounts(absolutePath, files)
				directoryMetadata = await getDirectoryMetadata(absolutePath, listedDirectories)

				const result = formatResponse.formatFilesList(
					absolutePath,
					files,
					didHitLimit,
					task.rooIgnoreController,
					showRooIgnoredFiles,
					task.rooProtectedController,
					fileLines,
					directoryMetadata,
					didHitLimit,
					"tree",
				)

				if (normalizedRelDirPaths.length > 1) {
					results.push(`## ${currentRelDirPath}\n${result}`)
				} else {
					results.push(result)
				}
			}

			const result = results.join("\n\n")

			const sharedMessageProps: ClineSayTool = {
				tool: !recursive ? "listDirTopLevel" : "listDirRecursive",
				path: normalizedRelDirPaths.map((p) => getReadablePath(task.cwd, p)).join(", "),
				isOutsideWorkspace,
			}

			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: result, id: callbacks.toolCallId } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			pushToolResult(result)
		} catch (error) {
			await handleError("listing files", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"list">): Promise<void> {
		if (!block.partial) {
			return
		}

		const nativeArgs = block.nativeArgs as ListDirParams | undefined
		const relDirPathValue = nativeArgs?.path ?? block.params.path
		const recursiveRaw = nativeArgs?.recursive ?? block.params.recursive
		const recursive =
			typeof recursiveRaw === "boolean"
				? recursiveRaw
				: recursiveRaw?.toLowerCase() === "true"
		const normalizedPaths = (Array.isArray(relDirPathValue) ? relDirPathValue : [relDirPathValue || ""])
			.flatMap((value) =>
				Array.isArray(value)
					? value.filter((entry): entry is string => typeof entry === "string")
					: typeof value === "string"
						? [value]
						: [],
			)
			.map((value) => (value ? this.removeClosingTag("path", value, block.partial) : ""))
			.filter(Boolean)
		const isOutsideWorkspace = normalizedPaths
			.map((value) => path.resolve(task.cwd, value))
			.some((absolutePath) => isPathOutsideWorkspace(absolutePath))

		const sharedMessageProps: ClineSayTool = {
			tool: !recursive ? "listDirTopLevel" : "listDirRecursive",
			path: normalizedPaths.map((value) => getReadablePath(task.cwd, value)).join(", "),
			isOutsideWorkspace,
			id: block.id,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => { })
	}
}

export const listDirTool = new ListDirTool()
