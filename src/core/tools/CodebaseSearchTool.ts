import * as vscode from "vscode"
import path from "path"

import { Task } from "../task/Task"
import { CodeIndexManager } from "../../services/code-index/manager"
import { getWorkspacePath } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { VectorStoreSearchResult } from "../../services/code-index/interfaces"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface CodebaseSearchParams {
	query: string | string[]
	path?: string
	tests?: boolean
}

export class CodebaseSearchTool extends BaseTool<"codebase_search"> {
	readonly name = "codebase_search" as const

	parseLegacy(params: Partial<Record<string, string>>): { query: string; path?: string } {
		let query = params.query
		let directoryPrefix = params.path

		if (directoryPrefix) {
			directoryPrefix = path.normalize(directoryPrefix)
		}

		return {
			query: query || "",
			path: directoryPrefix,
		}
	}

	async execute(params: CodebaseSearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks
		let { query: queryOrQueries, path: directoryPrefix, tests: includeTests } = params
		const queries = (Array.isArray(queryOrQueries) ? queryOrQueries : [queryOrQueries]).filter(q => q && q.trim() !== "")

		const workspacePath = task.cwd && task.cwd.trim() !== "" ? task.cwd : getWorkspacePath()

		if (!workspacePath) {
			await handleError("codebase_search", new Error("Could not determine workspace path."))
			return
		}

		if (queries.length === 0) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("codebase_search", "query"))
			return
		}

		// kilocode_change start
		// we don't always get relative path here
		if (directoryPrefix && path.isAbsolute(directoryPrefix)) {
			directoryPrefix = path.relative(workspacePath, directoryPrefix)
		}
		// kilocode_change end

		const sharedMessageProps = {
			tool: "codebaseSearch",
			query: queries.join(", "),
			path: directoryPrefix,
			isOutsideWorkspace: false,
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0



		try {
			const context = task.providerRef.deref()?.context
			if (!context) {
				throw new Error("Extension context is not available.")
			}

			const manager = CodeIndexManager.getInstance(context)

			if (!manager) {
				throw new Error("CodeIndexManager is not available.")
			}

			if (!manager.isFeatureEnabled) {
				throw new Error("Code Indexing is disabled in the settings.")
			}
			if (!manager.isFeatureConfigured) {
				throw new Error("Code Indexing is not configured (Missing OpenAI Key or Qdrant URL).")
			}

			// kilocode_change start
			const status = manager.getCurrentStatus() as any
			let warningMessage = ""

			// Allow searches if we have any data (cached or from Qdrant)
			const hasData = status.hasData || status.processedItems > 0 || status.systemStatus === "Indexed"

			if (!hasData && status.systemStatus !== "Indexing") {
				const defaultStatusMessage = "Code indexing has not started"
				const normalizedMessage = status.message || defaultStatusMessage

				// Return helpful error if truly no index exists
				await task.say("codebase_search_result", JSON.stringify({
					tool: "codebaseSearch",
					content: { error: `Index unavailable: ${normalizedMessage}. Please wait for indexing to start.` }
				}))

				pushToolResult(
					formatResponse.toolError(
						`Semantic search unavailable: ${normalizedMessage}. Please wait for indexing to start.`
					),
				)
				return
			}

			if (status.systemStatus === "Indexing") {
				const percent = status.totalItems > 0 ? Math.round((status.processedItems / status.totalItems) * 100) : 0
				warningMessage = `Index is updating (${percent}% complete). Results may be partial.`
			} else if (status.systemStatus === "Error") {
				const percent = status.totalItems > 0 ? Math.round((status.processedItems / status.totalItems) * 100) : 0
				warningMessage = `Index encountered an error at ${percent}% completion. Results shown are partial (from previous successful indexing). Error: ${status.message}`
			}
			// kilocode_change end

			const allQueryResults = await Promise.all(
				queries.map(async (query) => {
					const searchResults = await manager.searchIndex(query, directoryPrefix)
					const filteredResults = searchResults.filter((result) => {
						if (!result.payload || !result.payload.filePath) return false
						
						if (includeTests) return true

						const filePath = result.payload.filePath.toLowerCase()
						const ext = path.extname(filePath)

						// Skip documentation and text files
						if (ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === ".map") {
							return false
						}

						// Skip test/spec files and directories
						if (
							filePath.includes(".test.") ||
							filePath.includes(".spec.") ||
							filePath.includes("/__tests__/") ||
							filePath.includes("/tests/") ||
							filePath.includes("/test/")
						) {
							return false
						}

						// Skip lock files and coverage
						if (
							filePath.endsWith("package-lock.json") ||
							filePath.endsWith("pnpm-lock.yaml") ||
							filePath.endsWith("yarn.lock") ||
							filePath.includes("/coverage/") ||
							filePath.includes("/.nyc_output/")
						) {
							return false
						}

						return true
					})
					return { query, results: filteredResults }
				}),
			)

			if (allQueryResults.every((qr) => !qr.results || qr.results.length === 0)) {
				pushToolResult("No relevant code snippets found for the provided queries.")
				return
			}

			const finalJsonPayload = {
				tool: "codebaseSearch",
				content: {
					queries: allQueryResults.map(({ query, results }) => ({
						query,
						results: (results || [])
							.map((result) => {
								if (!result.payload || !("filePath" in result.payload)) return null
								return {
									filePath: vscode.workspace.asRelativePath(result.payload.filePath, false),
									score: result.score,
									startLine: result.payload.startLine,
									endLine: result.payload.endLine,
									codeChunk: result.payload.codeChunk.trim(),
								}
							})
							.filter((r): r is NonNullable<typeof r> => r !== null),
					})),
				},
			}

			await task.say("codebase_search_result", JSON.stringify(finalJsonPayload))

			const output = formatSearchResults(finalJsonPayload.content.queries)
			const finalOutput = warningMessage ? `[WARNING: ${warningMessage}]\n\n${output}` : output

			pushToolResult(finalOutput)
		} catch (error: any) {
			await handleError("codebase_search", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"codebase_search">): Promise<void> {
		const queryOrQueries: string | string[] | undefined = block.params.query
		const directoryPrefix: string | undefined = block.params.path

		const query = Array.isArray(queryOrQueries) ? queryOrQueries.join(", ") : queryOrQueries

		const sharedMessageProps = {
			tool: "codebaseSearch",
			query: query,
			path: directoryPrefix,
			isOutsideWorkspace: false,
		}

		await task.say("tool", JSON.stringify(sharedMessageProps), undefined, block.partial).catch(() => { })
	}
}

export const codebaseSearchTool = new CodebaseSearchTool()




function formatSearchResults(
	queries: {
		query: string
		results: {
			filePath: string
			score: number
			startLine: number
			endLine: number
			codeChunk: string
		}[]
	}[],
): string {
	return queries
		.map(({ query, results }) => {
			let queryOutput = `For query: "${query}"\n`
			if (results.length === 0) {
				queryOutput += "No relevant code snippets found."
			} else {
				// Group by file
				const groupedResults: { [key: string]: typeof results } = {}
				results.forEach((result) => {
					if (!groupedResults[result.filePath]) {
						groupedResults[result.filePath] = []
					}
					groupedResults[result.filePath].push(result)
				})

				queryOutput += Object.entries(groupedResults)
					.map(([filePath, rawChunks]) => {
						const fileHeader = `File: ${filePath}`

						// Merge chunks logic
						const lineMap = new Map<number, string>()
						const scoreMap = new Map<number, number>()

						rawChunks.forEach((chunk) => {
							const lines = chunk.codeChunk.split("\n")
							lines.forEach((line, index) => {
								const lineNumber = chunk.startLine + index
								lineMap.set(lineNumber, line)
								const currentMax = scoreMap.get(lineNumber) || 0
								scoreMap.set(lineNumber, Math.max(currentMax, chunk.score))
							})
						})

						const sortedLines = Array.from(lineMap.keys()).sort((a, b) => a - b)
						const mergedChunks: { start: number; end: number; score: number; content: string }[] = []

						if (sortedLines.length > 0) {
							let currentStart = sortedLines[0]
							let currentEnd = sortedLines[0]
							let currentContent = [lineMap.get(currentStart)!]
							let currentMaxScore = scoreMap.get(currentStart)!

							for (let i = 1; i < sortedLines.length; i++) {
								const lineNum = sortedLines[i]
								if (lineNum === currentEnd + 1) {
									// Contiguous
									currentEnd = lineNum
									currentContent.push(lineMap.get(lineNum)!)
									currentMaxScore = Math.max(currentMaxScore, scoreMap.get(lineNum)!)
								} else {
									// Break
									mergedChunks.push({
										start: currentStart,
										end: currentEnd,
										score: currentMaxScore,
										content: currentContent.join("\n"),
									})
									currentStart = lineNum
									currentEnd = lineNum
									currentContent = [lineMap.get(lineNum)!]
									currentMaxScore = scoreMap.get(lineNum)!
								}
							}
							// Push last chunk
							mergedChunks.push({
								start: currentStart,
								end: currentEnd,
								score: currentMaxScore,
								content: currentContent.join("\n"),
							})
						}

						const formattedChunks = mergedChunks
							.map(
								(chunk) =>
									`**Lines ${chunk.start}-${chunk.end} (Score: ${chunk.score.toFixed(2)})**\n${chunk.content}`,
							)
							.join("\n\n")

						return `${fileHeader}\n${formattedChunks}`
					})
					.join("\n\n")
			}
			return queryOutput
		})
		.join("\n\n")
}
