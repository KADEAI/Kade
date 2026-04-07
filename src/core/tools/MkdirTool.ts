import * as path from "path"
import fs from "fs/promises"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface MkdirParams {
	path?: string
}

export class MkdirTool extends BaseTool<"mkdir"> {
	readonly name = "mkdir" as const

	parseLegacy(params: Partial<Record<string, string>>): MkdirParams {
		return {
			path: params.path || ".",
		}
	}

	async execute(params: MkdirParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const relPathStr = params.path?.trim() || "."
		const { handleError, pushToolResult } = callbacks

		try {
			const absolutePath = path.resolve(task.cwd, relPathStr)
			if (isPathOutsideWorkspace(absolutePath)) {
				task.consecutiveMistakeCount++
				task.recordToolError("mkdir")
				task.didToolFailInCurrentTurn = true
				pushToolResult(`Error: Path ${relPathStr} is outside workspace.`)
				return
			}

			const stat = await fs.stat(absolutePath)
			if (!stat.isDirectory()) {
				task.consecutiveMistakeCount++
				task.recordToolError("mkdir")
				task.didToolFailInCurrentTurn = true
				pushToolResult(`Error: ${relPathStr} is not a directory.`)
				return
			}

			const entries = await fs.readdir(absolutePath, { withFileTypes: true })
			task.consecutiveMistakeCount = 0

			const listing = entries
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
				.join("\n")

			pushToolResult(listing || "(empty directory)")
		} catch (error) {
			await handleError("listing directory", error)
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
