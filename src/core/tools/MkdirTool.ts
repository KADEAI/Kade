import * as path from "path"
import fs from "fs/promises"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface MkdirParams {
	path: string
}

export class MkdirTool extends BaseTool<"mkdir"> {
	readonly name = "mkdir" as const

	parseLegacy(params: Partial<Record<string, string>>): MkdirParams {
		return {
			path: params.path || "",
		}
	}

	async execute(params: MkdirParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { path: relPathStr } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!relPathStr) {
				task.consecutiveMistakeCount++
				task.recordToolError("mkdir")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("mkdir", "path"))
				return
			}

			task.consecutiveMistakeCount = 0

			const relPaths = relPathStr.split(",").map((p) => p.trim()).filter(Boolean)
			const results: string[] = []

			const sharedMessageProps: ClineSayTool = {
				tool: "mkdir",
				path: relPathStr, // Pass the whole string to show all in UI
				isOutsideWorkspace: relPaths.some(p => isPathOutsideWorkspace(path.resolve(task.cwd, p))),
			}

			const completeMessage = JSON.stringify({ ...sharedMessageProps, id: callbacks.toolCallId } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				pushToolResult("mkdir denied by user.")
				return
			}

			for (const relPath of relPaths) {
				const absolutePath = path.resolve(task.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

				if (isOutsideWorkspace) {
					results.push(`Error: Path ${relPath} is outside workspace.`)
					continue
				}

				try {
					await fs.mkdir(absolutePath, { recursive: true })
					results.push(`Successfully created directory: ${relPath}`)

					// Track file context for the created directory
					await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as any)
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					results.push(`Error creating ${relPath}: ${errorMsg}`)
				}
			}

			pushToolResult(results.join("\n"))
		} catch (error) {
			await handleError("creating directories", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"mkdir">): Promise<void> {
		if (!block.partial) {
			return
		}

		const relPathStr: string | undefined = block.params.path
		if (!relPathStr) return

		const absolutePath = path.resolve(task.cwd, relPathStr.split(",")[0]?.trim() || "")
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "mkdir",
			path: this.removeClosingTag("path", relPathStr, block.partial),
			isOutsideWorkspace,
			id: block.id,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => { })
	}
}

export const mkdirTool = new MkdirTool()
