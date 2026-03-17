import path from "path"
import * as vscode from "vscode"
import { glob } from "glob"
import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getLineCounts, getBinPath } from "../../services/ripgrep/index"
import { DIRS_TO_IGNORE } from "../../services/glob/constants"

interface GlobParams {
	path: string
	pattern?: string | string[]
	extension?: string
	case_insensitive?: boolean
}

export class GlobTool extends BaseTool<"glob"> {
	readonly name = "glob" as const

	parseLegacy(params: Partial<Record<string, string>>): { path: string; pattern: string } {
		return {
			path: params.path || "",
			pattern: params.pattern || "",
		}
	}

	async execute(params: GlobParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		const relDirPath = params.path
		let pattern = params.pattern
		const extension = params.extension
		const isCaseInsensitive = params.case_insensitive !== false // Default to true

		if (!relDirPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("glob")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("glob", "path"))
			return
		}

		// If extension is provided, generate pattern from it
		if (extension) {
			pattern = `**/*.${extension}`
		}

		// Auto-expand simple patterns to globs for better UX
		if (pattern) {
			const expandPattern = (p: string) => {
				// If pattern starts with ".", treat as extension: .ts -> **/*.ts
				if (p.startsWith(".") && !p.includes("*") && !p.includes("?")) {
					return `**/*${p}`
				}
				// If pattern is a simple name (no wildcards, no path separators), wrap it to find it anywhere
				else if (!p.includes("*") && !p.includes("?") && !p.includes("/") && !p.includes("\\")) {
					return `**/*${p}*`
				}
				return p
			}

			if (Array.isArray(pattern)) {
				pattern = pattern.map(expandPattern)
			} else {
				pattern = expandPattern(pattern)
			}
		}

		if (!pattern) {
			task.consecutiveMistakeCount++
			task.recordToolError("glob")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("glob", "pattern or extension"))
			return
		}

		task.consecutiveMistakeCount = 0

		const absolutePath = path.resolve(task.cwd, relDirPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "glob",
			path: getReadablePath(task.cwd, relDirPath),
			pattern: Array.isArray(pattern) ? pattern.join(", ") : pattern,
			isOutsideWorkspace,
			id: callbacks.toolCallId,
		}

		try {
			const MAX_RESULTS = 200
			const patterns = Array.isArray(pattern) ? pattern : [pattern]
			const limitPerPattern = Math.floor(MAX_RESULTS / patterns.length)
			
			let allMatches: string[] = []
			let totalFound = 0
			
			// Search each pattern individually with per-pattern limit
			for (const p of patterns) {
				const matches = await glob(p, {
					cwd: absolutePath,
					dot: true,
					nocase: isCaseInsensitive,
					ignore: DIRS_TO_IGNORE.map((d) => (d.startsWith("!") ? d.slice(1) : d)).flatMap((d) => [
						d,
						`**/${d}/**`,
						`${d}/**`,
					]),
					absolute: true,
					follow: true,
					mark: true, // Adds a / to directory matches
				})
				
				totalFound += matches.length
				// Take only up to the per-pattern limit
				allMatches.push(...matches.slice(0, limitPerPattern))
			}
			
			// Deduplicate in case patterns overlap
			const matches = [...new Set(allMatches)]
			const wasTruncated = totalFound > matches.length

			if (matches.length === 0) {
				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					content: "No results found matching pattern.",
					id: callbacks.toolCallId,
				} satisfies ClineSayTool)
				const didApprove = await askApproval("tool", completeMessage)

				if (!didApprove) {
					return
				}

				pushToolResult("No results found matching pattern.")
				return
			}

			// Calculate line counts for file matches
			const fileLines = await getLineCounts(absolutePath)

			// Format results using shared formatFilesList
			const result = formatResponse.formatFilesList(
				absolutePath,
				matches,
				false,
				task.rooIgnoreController,
				false, // Don't show ignored files in glob results
				undefined,
				fileLines,
				undefined,
			)

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				content: result,
				id: callbacks.toolCallId,
			} satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			const patternString = Array.isArray(pattern) ? pattern.join(", ") : pattern
			const truncatedCount = totalFound - matches.length
			const truncationNote = wasTruncated 
				? `\n\n(Showing ${matches.length} of ${totalFound} total matches - ${truncatedCount} file${truncatedCount === 1 ? '' : 's'} truncated. Results limited to ${MAX_RESULTS} files${patterns.length > 1 ? `, split evenly across ${patterns.length} patterns` : ""}. Please use more specific patterns or file_names to hone in on what you're searching for.)`
				: ""
			pushToolResult(
				`Found ${matches.length} result${matches.length === 1 ? "" : "s"} matching pattern "${patternString}"${truncationNote}:\n\n${result}`,
			)
		} catch (error) {
			await handleError("searching files with glob pattern", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"glob">): Promise<void> {
		if (!block.partial) {
			return
		}

		const nativeArgs = block.nativeArgs as Partial<GlobParams> | undefined
		const relDirPath = nativeArgs?.path || block.params.path
		const patternValue = nativeArgs?.pattern || nativeArgs?.extension || block.params.pattern || (block.params as any).extension
		const pattern = Array.isArray(patternValue) ? patternValue.join(", ") : patternValue

		if (!relDirPath && !pattern) {
			return
		}

		const normalizedPath = this.removeClosingTag("path", relDirPath || "", block.partial)
		const absolutePath = normalizedPath ? path.resolve(task.cwd, normalizedPath) : task.cwd

		const sharedMessageProps: ClineSayTool = {
			tool: "glob",
			path: normalizedPath ? getReadablePath(task.cwd, normalizedPath) : "",
			pattern: pattern ? this.removeClosingTag("pattern", pattern, block.partial) : "",
			isOutsideWorkspace: normalizedPath ? isPathOutsideWorkspace(absolutePath) : false,
			id: block.id,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => {})
	}
}

export const globTool = new GlobTool()
