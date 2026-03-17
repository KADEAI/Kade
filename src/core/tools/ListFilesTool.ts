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
	path: string
	recursive?: boolean
}

export class ListDirTool extends BaseTool<"list_dir"> {
	readonly name = "list_dir" as const

	parseLegacy(params: Partial<Record<string, string>>): ListDirParams {
		const recursiveRaw: string | undefined = params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		return {
			path: params.path || "",
			recursive,
		}
	}

	async execute(params: ListDirParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { path: relDirPath, recursive } = params
		const { askApproval, handleError, pushToolResult, removeClosingTag } = callbacks

		try {
			if (!relDirPath) {
				task.consecutiveMistakeCount++
				task.recordToolError("list_dir")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("list_dir", "path"))
				return
			}

			task.consecutiveMistakeCount = 0

			const absolutePath = path.resolve(task.cwd, relDirPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const [files, didHitLimit] = await listFiles(absolutePath, recursive || false, 200)
			const { showRooIgnoredFiles = false } = (await task.providerRef.deref()?.getState()) ?? {}

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
			)

			const sharedMessageProps: ClineSayTool = {
				tool: !recursive ? "listDirTopLevel" : "listDirRecursive",
				path: getReadablePath(task.cwd, relDirPath),
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

	override async handlePartial(task: Task, block: ToolUse<"list_dir">): Promise<void> {
		if (!block.partial) {
			return
		}

		const relDirPath: string | undefined = block.params.path
		const recursiveRaw: string | undefined = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		const absolutePath = relDirPath ? path.resolve(task.cwd, relDirPath) : task.cwd
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: !recursive ? "listDirTopLevel" : "listDirRecursive",
			path: getReadablePath(task.cwd, this.removeClosingTag("path", relDirPath, block.partial)),
			isOutsideWorkspace,
			id: block.id,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => { })
	}
}

export const listDirTool = new ListDirTool()
