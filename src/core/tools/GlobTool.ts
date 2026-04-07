import path from "path"
import fs from "fs"
import * as vscode from "vscode"
import { glob } from "glob"
import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getReadablePath, resolveRecursivePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getLineCounts, getBinPath } from "../../services/ripgrep/index"
import { DIRS_TO_IGNORE } from "../../services/glob/constants"
import { splitGlobPatternList } from "../../shared/globPatterns"

interface GlobParams {
	path?: string | string[]
	pattern?: string | string[]
	extension?: string
	case_insensitive?: boolean
}

export class GlobTool extends BaseTool<"glob"> {
	readonly name = "glob" as const

	parseLegacy(params: Partial<Record<string, string>>): { path?: string | string[]; pattern: string } {
		return {
			path: params.path || ".",
			pattern: params.pattern || params.query || "",
		}
	}

	async execute(params: GlobParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

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
		let pattern = params.pattern
		const extension = params.extension
		const isCaseInsensitive = params.case_insensitive !== false // Default to true

		// If extension is provided, generate pattern from it
		if (extension) {
			pattern = `**/*.${extension}`
		}

		// Support comma-separated pattern lists while preserving brace globs like
		// "*.{ts,tsx}". Top-level legacy pipe splitting still works for compatibility.
		if (pattern) {
			const normalizedPatterns = splitGlobPatternList(pattern, {
				allowLegacyPipe: true,
			})
			if (normalizedPatterns.length > 1) {
				pattern = normalizedPatterns
			} else if (normalizedPatterns.length === 1) {
				pattern = normalizedPatterns[0]
			}
		}

		// Auto-expand simple patterns to globs for better UX
		if (pattern) {
			const expandPattern = (p: string) => {
				// If pattern starts with ".", treat as extension: .ts -> **/*.ts
				if (p.startsWith(".") && !p.includes("*") && !p.includes("?")) {
					return `**/*${p}`
				}
				// If pattern is a bare wildcard file pattern like "*.ts" or "foo*.tsx",
				// search recursively instead of only in the cwd root.
				else if (
					!p.includes("/") &&
					!p.includes("\\") &&
					(p.includes("*") || p.includes("?"))
				) {
					return `**/${p}`
				}
				// If pattern looks like an exact file name (no wildcards, no path separators, has a dot),
				// search for that exact file name anywhere in the tree.
				else if (!p.includes("*") && !p.includes("?") && !p.includes("/") && !p.includes("\\") && p.includes(".")) {
					return `**/${p}`
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

		try {
			const MAX_RESULTS = 200
			const patterns = Array.isArray(pattern) ? pattern : [pattern]
			const limitPerPattern = Math.floor(MAX_RESULTS / patterns.length)
			const displayPaths: string[] = []
			const resultSections: string[] = []
			let anyOutsideWorkspace = false

			for (const relDirPath of normalizedRelDirPaths) {
				let searchPath = relDirPath
				let searchNotice: string | undefined
				let absolutePath = path.resolve(task.cwd, searchPath)

				if (!fs.existsSync(absolutePath)) {
					const { resolvedPath, notice } = await resolveRecursivePath(task.cwd, relDirPath)
					const resolvedAbsolutePath = path.resolve(task.cwd, resolvedPath)

					if (fs.existsSync(resolvedAbsolutePath)) {
						searchPath = resolvedPath
						absolutePath = resolvedAbsolutePath
						searchNotice = notice
					} else if (relDirPath !== ".") {
						searchPath = "."
						absolutePath = task.cwd
						searchNotice = `Note: Search path "${relDirPath}" was not found. Searched the workspace root instead.`
					}
				}

				displayPaths.push(getReadablePath(task.cwd, searchPath))
				anyOutsideWorkspace = anyOutsideWorkspace || isPathOutsideWorkspace(absolutePath)

				let allMatches: string[] = []
				let totalFound = 0
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
						mark: true,
					})

					totalFound += matches.length
					allMatches.push(...matches.slice(0, limitPerPattern))
				}

				const matches = [...new Set(allMatches)]
				if (matches.length === 0) {
					resultSections.push(`## ${searchPath}\n${searchNotice ? `${searchNotice}\n\n` : ""}No results found matching pattern.`)
					continue
				}

				const fileLines = await getLineCounts(absolutePath)
				const result = formatResponse.formatFilesList(
					absolutePath,
					matches,
					false,
					task.rooIgnoreController,
					false,
					undefined,
					fileLines,
					undefined,
				)

				const wasTruncated = totalFound > matches.length
				const patternString = Array.isArray(pattern) ? pattern.join(", ") : pattern
				const truncatedCount = totalFound - matches.length
				const truncationNote = wasTruncated
					? `\n\n(Showing ${matches.length} of ${totalFound} total matches - ${truncatedCount} file${truncatedCount === 1 ? '' : 's'} truncated. Results limited to ${MAX_RESULTS} files${patterns.length > 1 ? `, split evenly across ${patterns.length} patterns` : ""}. Please use more specific patterns or file_names to hone in on what you're searching for.)`
					: ""
				resultSections.push(`## ${searchPath}\n${searchNotice ? `${searchNotice}\n\n` : ""}Found ${matches.length} result${matches.length === 1 ? "" : "s"} matching pattern "${patternString}"${truncationNote}:\n\n${result}`)
			}

			const finalResult = resultSections.join("\n\n")
			const sharedMessageProps: ClineSayTool = {
				tool: "glob",
				path: displayPaths.join(", "),
				pattern: Array.isArray(pattern) ? pattern.join(", ") : pattern,
				isOutsideWorkspace: anyOutsideWorkspace,
				id: callbacks.toolCallId,
			}

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				content: finalResult,
				id: callbacks.toolCallId,
			} satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			pushToolResult(finalResult)
		} catch (error) {
			await handleError("searching files with glob pattern", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"glob">): Promise<void> {
		if (!block.partial) {
			return
		}

		const nativeArgs = block.nativeArgs as Partial<GlobParams> | undefined
		const relDirPathValue = nativeArgs?.path || block.params.path
		const patternValue = nativeArgs?.pattern || nativeArgs?.extension || block.params.pattern || (block.params as any).extension
		const pattern = Array.isArray(patternValue) ? patternValue.join(", ") : patternValue

		if (!relDirPathValue && !pattern) {
			return
		}

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
		const normalizedPattern = Array.isArray(patternValue)
			? patternValue.filter((value): value is string => typeof value === "string").join(", ")
			: typeof patternValue === "string"
				? patternValue
				: ""

		const sharedMessageProps: ClineSayTool = {
			tool: "glob",
			path: normalizedPaths.map((value) => getReadablePath(task.cwd, value)).join(", "),
			pattern: normalizedPattern ? this.removeClosingTag("pattern", normalizedPattern, block.partial) : "",
			isOutsideWorkspace: normalizedPaths
				.map((value) => path.resolve(task.cwd, value))
				.some((absolutePath) => isPathOutsideWorkspace(absolutePath)),
			id: block.id,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => {})
	}
}

export const globTool = new GlobTool()
