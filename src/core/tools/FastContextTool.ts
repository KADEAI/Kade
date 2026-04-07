import path from "path"
import * as childProcess from "child_process"
import * as readline from "readline"
import * as vscode from "vscode"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getBinPath } from "../../services/ripgrep"
import { readLines } from "../../integrations/misc/read-lines"
import { findLastIndex } from "../../shared/array"
import { BaseTool, ToolCallbacks } from "./BaseTool"

interface FastContextParams {
	query: string
	path?: string
}

interface FastContextOperation {
	type: "grep" | "read"
	label: string
	path: string
	status: "running" | "done" | "error"
	durationMs?: number
	resultCount?: number
}

interface FastContextState {
	query: string
	thinking: string
	operations: FastContextOperation[]
	results: FastContextResult[]
	status: "running" | "done"
}

interface FastContextResult {
	file: string
	startLine: number
	endLine: number
	content: string
	score: number
}

// ── Tuning constants ────────────────────────────────────────────────────────
const MAX_GREP_PATTERNS = 12
const MAX_readS = 20
const MAX_CONTEXT_LINES = 50
const MAX_RESULTS = 15
const MAX_TOTAL_LINES = 750
const MAX_MATCHES_PER_PATTERN_PER_FILE = 8
const MAX_RG_LINES = 2000
const CLUSTER_PADDING = 8
const CLUSTER_GAP_THRESHOLD = 15

// ── Exclude globs for ripgrep ───────────────────────────────────────────────
const RG_EXCLUDE_GLOBS = [
"!.*",
"!node_modules",
"!dist",
"!build",
"!out",
"!assets",
"!vendor",
"!target",
"!*.min.*",
"!*.map",
"!*-*.js", // Skip hashed production assets
"!*-*.css",
"!package-lock.json",
"!pnpm-lock.yaml",
"!yarn.lock",
"!*.snap",
"!*.svg",
"!*.lock",
"!*.log",
"!*.png",
"!*.jpg",
"!*.jpeg",
"!*.gif",
"!*.ico",
"!*.woff",
"!*.woff2",
"!*.ttf",
"!*.eot",
"!*.mp3",
"!*.wav",
"!*.mp4",
"!*.vsix",
"!*.zst",
"!*.tsbuildinfo",
"!CHANGELOG.md",
]

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const STOP_WORDS = new Set([
	"the", "a", "an", "is", "are", "was", "were", "be", "been",
	"being", "have", "has", "had", "do", "does", "did", "will",
	"would", "could", "should", "may", "might", "can", "shall",
	"how", "what", "where", "when", "why", "which", "who",
	"this", "that", "these", "those", "it", "its", "and", "or",
	"but", "not", "no", "in", "on", "at", "to", "for", "of",
	"with", "by", "from", "as", "into", "about", "between",
	"does", "used", "using", "use", "find", "get", "set",
	"look", "looking", "make", "makes", "made",
])

/**
 * Execute ripgrep with proper stderr handling.
 * rg writes warnings/info to stderr even on success — we must not reject on stderr.
 */
function execRipgrepSafe(bin: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const rgProcess = childProcess.spawn(bin, args)
		const rl = readline.createInterface({ input: rgProcess.stdout, crlfDelay: Infinity })

		let output = ""
		let lineCount = 0

		rl.on("line", (line) => {
			if (lineCount < MAX_RG_LINES) {
				output += line + "\n"
				lineCount++
			} else {
				rl.close()
				rgProcess.kill()
			}
		})

		rgProcess.stderr.on("data", () => {
			// rg writes to stderr for warnings and "no matches" — ignore
		})
		rl.on("close", () => {
			resolve(output)
		})
		rgProcess.on("error", (error: Error) => {
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

export class FastContextTool extends BaseTool<"fast_context"> {
	readonly name = "fast_context" as const

	parseLegacy(params: Partial<Record<string, string>>): FastContextParams {
		return {
			query: params.query || "",
			path: params.path,
		}
	}

	async execute(params: FastContextParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const { query, path: searchPath } = params

		if (!query) {
			task.consecutiveMistakeCount++
			task.recordToolError("fast_context")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("fast_context", "query"))
			return
		}

		task.consecutiveMistakeCount = 0

		const workspacePath = task.cwd
		const resolvedSearchPath = searchPath
			? path.resolve(workspacePath, searchPath)
			: workspacePath

		// Initialize state
		const state: FastContextState = {
			query,
			thinking: `Searching codebase for: "${query}"`,
			operations: [],
			results: [],
			status: "running",
		}

		// Ask for approval — this creates the single tool message in the chat.
		// handlePartial's streaming message gets replaced by this one.
		const sharedMessageProps: ClineSayTool = {
			tool: "fastContext",
			query,
			path: searchPath,
			content: JSON.stringify(state),
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		try {
			const vscodeAppRoot = vscode.env.appRoot
			const rgPath = await getBinPath(vscodeAppRoot)
			if (!rgPath) {
				throw new Error("Could not find ripgrep binary")
			}

			// Step 1: Generate search patterns from the query
			const { patterns, weights, fileLikeGlob } = this.generateSearchPatterns(query)

			// Step 2: Run parallel grep operations with match-count tracking for IDF
			const { fileMatches, patternMatchCounts } = await this.runParallelGreps(
				rgPath,
				patterns,
				weights,
				fileLikeGlob,
				resolvedSearchPath,
				workspacePath,
				task,
				state,
			)

			// Step 3: Apply IDF reweighting — patterns that matched fewer files are more valuable
			this.applyIdfReweighting(fileMatches, patternMatchCounts)

			// Step 4: Score and rank files
			const rankedFiles = this.rankFiles(fileMatches, workspacePath, query)

			// Step 5: Read top files to get context
			const topFiles = rankedFiles.slice(0, MAX_readS)
			await this.readTopFiles(topFiles, workspacePath, task, state)

			// Finalize
			state.status = "done"
			await this.broadcastState(task, state)

			// Format results for the AI
			const output = this.formatResultsForAI(state)
			pushToolResult(output)
		} catch (error) {
			state.status = "done"
			await this.broadcastState(task, state)
			await handleError("fast context search", error as Error)
		}
	}

	/**
	 * Generate regex search patterns from a natural language query.
	 *
	 * Strategy:
	 * 1. Extract meaningful keywords (filter stop words)
	 * 2. Build exact multi-word phrases (highest signal)
	 * 3. Build combined PascalCase/camelCase identifiers
	 * 4. Build bigram proximity patterns
	 * 5. Individual keywords as fallback (lowest weight)
	 *
	 * Weights are initial estimates — IDF reweighting after grep adjusts them
	 * based on actual match frequency.
	 */
	private generateSearchPatterns(query: string): { patterns: string[]; weights: number[]; fileLikeGlob?: string } {
		const patterns: string[] = []
		const weights: number[] = []

		const allWords = this.extractKeywords(query)
		const rawQueryTrimmed = query.trim()
		const lowerQueryTrimmed = rawQueryTrimmed.toLowerCase()
		const isFileLike = /[\/]/.test(rawQueryTrimmed) || /\.[a-z0-9]+$/.test(rawQueryTrimmed)
		let fileLikeGlob: string | undefined

		const add = (pattern: string, weight: number) => {
			if (!patterns.includes(pattern) && patterns.length < MAX_GREP_PATTERNS) {
				patterns.push(pattern)
				weights.push(weight)
			}
		}

		// ── File-like queries ────────────────────────────────────────────
		if (isFileLike && lowerQueryTrimmed.length > 2) {
			const baseRaw = path.basename(rawQueryTrimmed)
			const base = baseRaw.toLowerCase()
			const stem = base.replace(/\.[^.]+$/, "")
			const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : ""

			add(escapeRegExp(lowerQueryTrimmed), 5)
			if (baseRaw.length > 0) add(escapeRegExp(baseRaw), 5)

			if (stem.length > 0) {
				const tokens = stem.split(/[-_]/).filter(Boolean)
				const pascal = tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join("")
				if (pascal.length > 0) {
					add(pascal, 4)
					if (ext) add(pascal + ext, 4)
				}
			}

			if (baseRaw.length > 0) {
				fileLikeGlob = `*${baseRaw}*`
			}
		}

		// ── Multi-word exact phrase (highest signal for content search) ──
		if (allWords.length >= 2) {
			// 3-word phrase
			if (allWords.length >= 3) {
				const phrase3 = allWords.slice(0, 3).join("[\\s_-]+")
				add(phrase3, 5)
			}
			// 2-word phrases from adjacent pairs
			for (let i = 0; i < Math.min(allWords.length - 1, 3); i++) {
				const phrase2 = `${allWords[i]}[\\s_-]+${allWords[i + 1]}`
				add(phrase2, 4)
			}
		}

		// ── Combined PascalCase identifiers (very high signal) ──────────
		// Triple PascalCase
		if (allWords.length >= 3) {
			const triple = allWords.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("")
			if (triple.length > 6) add(triple, 5)
		}
		// Pair PascalCase
		for (let i = 0; i < Math.min(allWords.length - 1, 4); i++) {
			const w1 = allWords[i]
			const w2 = allWords[i + 1]
			const combo = w1.charAt(0).toUpperCase() + w1.slice(1) + w2.charAt(0).toUpperCase() + w2.slice(1)
			if (combo.length > 4) add(combo, 4)
		}

		// ── snake_case / kebab-case identifiers ─────────────────────────
		if (allWords.length >= 2) {
			for (let i = 0; i < Math.min(allWords.length - 1, 3); i++) {
				add(`${allWords[i]}_${allWords[i + 1]}`, 4)
				add(`${allWords[i]}-${allWords[i + 1]}`, 4)
			}
		}

		// ── Individual keywords (low weight — fallback signal) ──────────
		for (const word of allWords.slice(0, 5)) {
			if (word.length >= 4) {
				add(`\\b${escapeRegExp(word)}\\b`, 1)
			}
		}

		// ── PascalCase of individual long keywords ──────────────────────
		for (const word of allWords.slice(0, 4)) {
			if (word.length >= 5) {
				const pascal = word.charAt(0).toUpperCase() + word.slice(1)
				add(pascal, 2)
			}
		}

		return { patterns, weights, fileLikeGlob }
	}

	private extractKeywords(query: string): string[] {
		// Split on whitespace and common delimiters, extract camelCase parts too
		const raw = query
			.replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase
			.replace(/[^a-zA-Z0-9\s]/g, " ")
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 1 && !STOP_WORDS.has(w))

		// Deduplicate while preserving order
		const seen = new Set<string>()
		return raw.filter((w) => {
			if (seen.has(w)) return false
			seen.add(w)
			return true
		})
	}

	/**
	 * Run grep operations in parallel and stream results to UI.
	 * Returns both file matches and per-pattern match counts for IDF.
	 */
	private async runParallelGreps(
		rgPath: string,
		patterns: string[],
		patternWeights: number[],
		fileLikeGlob: string | undefined,
		searchPath: string,
		workspacePath: string,
		task: Task,
		state: FastContextState,
	): Promise<{
		fileMatches: Map<string, { lines: number[]; patternHits: Map<number, number> }>
		patternMatchCounts: number[]
	}> {
		const fileMatches = new Map<string, { lines: number[]; patternHits: Map<number, number> }>()
		const patternMatchCounts = new Array(patterns.length).fill(0)

		// If file-like, seed matches by filename glob even if contents don't match
		if (fileLikeGlob) {
			const op: FastContextOperation = {
				type: "grep",
				label: `files:${fileLikeGlob}`,
				path: searchPath,
				status: "running",
			}
			state.operations.push(op)
			await this.broadcastState(task, state)
			const start = Date.now()
			try {
				const args = ["--files", "--iglob", fileLikeGlob, searchPath]
				const out = await execRipgrepSafe(rgPath, args)
				let count = 0
				for (const line of out.split("\n")) {
					const filePath = line.trim()
					if (!filePath) continue
					count++
					if (!fileMatches.has(filePath)) {
						fileMatches.set(filePath, { lines: [], patternHits: new Map() })
					}
					const entry = fileMatches.get(filePath)!
					// Use pattern index -1 for filename matches (not subject to IDF)
					entry.patternHits.set(-1, (entry.patternHits.get(-1) ?? 0) + 5)
				}
				op.status = "done"
				op.durationMs = Date.now() - start
				op.resultCount = count
			} catch {
				op.status = "error"
				op.durationMs = Date.now() - start
				op.resultCount = 0
			}
			await this.broadcastState(task, state)
		}

		const excludeArgs = RG_EXCLUDE_GLOBS.flatMap((g) => ["--glob", g])

		const grepPromises = patterns.map(async (pattern, patternIdx) => {
			const op: FastContextOperation = {
				type: "grep",
				label: pattern,
				path: searchPath,
				status: "running",
			}
			state.operations.push(op)
			await this.broadcastState(task, state)

			const startTime = Date.now()

			try {
				const rgArgs = [
					"--json",
					"-e", pattern,
					"-i",
					"--context", "0",
					...excludeArgs,
					searchPath,
				]

				const output = await execRipgrepSafe(rgPath, rgArgs)
				let matchCount = 0
				const filesHit = new Set<string>()
				const perFileHits = new Map<string, number>()

				if (output) {
					for (const line of output.split("\n")) {
						if (!line.trim()) continue
						try {
							const parsed = JSON.parse(line)
							if (parsed.type === "match") {
								matchCount++
								const filePath = parsed.data.path.text
								const lineNum = parsed.data.line_number
								filesHit.add(filePath)

								const fileHits = perFileHits.get(filePath) ?? 0
								if (fileHits >= MAX_MATCHES_PER_PATTERN_PER_FILE) continue
								perFileHits.set(filePath, fileHits + 1)

								if (!fileMatches.has(filePath)) {
									fileMatches.set(filePath, { lines: [], patternHits: new Map() })
								}
								const entry = fileMatches.get(filePath)!
								entry.lines.push(lineNum)
								entry.patternHits.set(patternIdx, (entry.patternHits.get(patternIdx) ?? 0) + 1)
							}
						} catch {
							// skip malformed lines
						}
					}
				}

				patternMatchCounts[patternIdx] = filesHit.size

				op.status = "done"
				op.durationMs = Date.now() - startTime
				op.resultCount = matchCount
			} catch {
				op.status = "error"
				op.durationMs = Date.now() - startTime
				op.resultCount = 0
			}

			await this.broadcastState(task, state)
		})

		await Promise.all(grepPromises)
		return { fileMatches, patternMatchCounts }
	}

	/**
	 * Apply IDF (Inverse Document Frequency) reweighting.
	 *
	 * Patterns that match many files are noisy — their per-hit contribution
	 * should be reduced. Patterns matching few files are highly specific
	 * and should be boosted.
	 *
	 * IDF = log(totalFiles / filesMatchedByPattern)
	 * Clamped to [0.1, 3.0] to prevent extreme values.
	 */
	private applyIdfReweighting(
		fileMatches: Map<string, { lines: number[]; patternHits: Map<number, number> }>,
		patternMatchCounts: number[],
	): void {
		const totalFiles = Math.max(fileMatches.size, 1)

		for (const [, data] of fileMatches) {
			let totalScore = 0
			for (const [patternIdx, hitCount] of data.patternHits) {
				if (patternIdx === -1) {
					// Filename matches — not subject to IDF
					totalScore += hitCount
					continue
				}
				const filesHit = patternMatchCounts[patternIdx] ?? 1
				const idf = Math.min(3.0, Math.max(0.1, Math.log(totalFiles / Math.max(filesHit, 1))))
				totalScore += hitCount * idf
			}
			// Store the IDF-weighted score back (abuse patternHits map with special key)
			data.patternHits.set(-2, totalScore)
		}
	}

	/**
	 * Rank files by IDF-weighted score and file-level heuristics.
	 */
	private rankFiles(
		fileMatches: Map<string, { lines: number[]; patternHits: Map<number, number> }>,
		workspacePath: string,
		query: string,
	): Array<{ file: string; lines: number[]; score: number }> {
		const keywords = this.extractKeywords(query)

		const ranked = Array.from(fileMatches.entries())
			.map(([file, data]) => {
				const idfScore = data.patternHits.get(-2) ?? 0
				return {
					file,
					lines: [...new Set(data.lines)].sort((a, b) => a - b),
					score: this.scoreFile(file, idfScore, data.lines, keywords),
				}
			})
			.sort((a, b) => b.score - a.score)

		return ranked
	}

	private scoreFile(file: string, idfScore: number, lines: number[], keywords: string[]): number {
		let score = idfScore

		// Boost files whose filename contains query keywords
		const lowerFile = path.basename(file).toLowerCase()
		let filenameBoost = 1
		for (const kw of keywords) {
			if (kw.length >= 3 && lowerFile.includes(kw)) {
				filenameBoost += 0.5
			}
		}
		score *= filenameBoost

		// Reward match diversity: many unique line locations > repeated matches on same line
		const uniqueLines = new Set(lines).size
		const totalMatches = Math.max(lines.length, 1)
		const diversity = uniqueLines / totalMatches
		score *= (0.6 + diversity * 0.4)

		// Penalize non-source files
		const lowerPath = file.toLowerCase()
		// Test file penalty - keep them but ensure source code always wins
		if (
			lowerPath.includes("/__tests__/") ||
			lowerPath.includes("/tests/") ||
			lowerPath.includes("/test/") ||
			lowerFile.includes(".spec.") ||
			lowerFile.includes(".test.") ||
			lowerFile.startsWith("test_") ||
			lowerFile.endsWith("_test.go")
		) {
			score *= 0.1
		}

		// Documentation / changelog penalty
		if (
			lowerFile.endsWith(".md") ||
			lowerFile.endsWith(".txt") ||
			lowerFile.endsWith(".rst")
		) {
			score *= 0.4
		}
	// KILOCODE FIX: Toxic asset penalty
		const toxicDirs = ["/dist/", "/build/", "/out/", "/assets/", "/node_modules/", "/vendor/", "/target/"]
		const isHashedAsset = /-[a-z0-9]{8,}\.(js|css)$/.test(lowerFile)
		const isMinified = lowerFile.includes(".min.")

		if (toxicDirs.some(dir => lowerPath.includes(dir)) || isHashedAsset || isMinified) {
			// Slash score to ensure these never reach the 'read' phase
			score *= 0.01
		}

		// Generated / vendored file penalty
		if (
			lowerPath.includes("/generated/") ||
			lowerPath.includes("/.turbo/") ||
			lowerPath.includes("/coverage/") ||
			lowerFile.endsWith(".d.ts")
		) {
			score *= 0.2
		}

		// Boost source code files slightly
		if (
			lowerFile.endsWith(".ts") ||
			lowerFile.endsWith(".tsx") ||
			lowerFile.endsWith(".js") ||
			lowerFile.endsWith(".jsx") ||
			lowerFile.endsWith(".py") ||
			lowerFile.endsWith(".go") ||
			lowerFile.endsWith(".rs") ||
			lowerFile.endsWith(".java") ||
			lowerFile.endsWith(".kt")
		) {
			score *= 1.2
		}

		return score
	}

	/**
	 * Read the top-ranked files and extract relevant line ranges.
	 */
	private async readTopFiles(
		files: Array<{ file: string; lines: number[]; score: number }>,
		workspacePath: string,
		task: Task,
		state: FastContextState,
	): Promise<void> {
		const readPromises = files.map(async ({ file, lines, score }) => {
			const relPath = path.relative(workspacePath, file)
			const op: FastContextOperation = {
				type: "read",
				label: relPath,
				path: file,
				status: "running",
			}
			state.operations.push(op)
			await this.broadcastState(task, state)

			const startTime = Date.now()

			try {
				// Find clusters of nearby lines to read
				const clusters = this.clusterLines(lines, MAX_CONTEXT_LINES)

				for (const cluster of clusters) {
					const { start, end } = cluster
					const content = await readLines(file, end, start)

					if (content) {
						state.results.push({
							file: relPath,
							startLine: start,
							endLine: end,
							content: content.trimEnd(),
							score,
						})
					}
				}

				op.status = "done"
				op.durationMs = Date.now() - startTime
			} catch {
				op.status = "error"
				op.durationMs = Date.now() - startTime
			}

			await this.broadcastState(task, state)
		})

		await Promise.all(readPromises)

		// Sort results by score descending, then limit total lines and count
		state.results.sort((a, b) => b.score - a.score)
		const limited: FastContextResult[] = []
		let totalLines = 0
		for (const result of state.results) {
			const lineCount = result.content.split("\n").length
			if (totalLines + lineCount > MAX_TOTAL_LINES && limited.length > 0) break
			limited.push(result)
			totalLines += lineCount
			if (limited.length >= MAX_RESULTS) break
		}
		state.results = limited
	}

	/**
	 * Cluster nearby line numbers into ranges for reading.
	 */
	private clusterLines(
		lines: number[],
		maxContextLines: number,
	): Array<{ start: number; end: number }> {
		if (lines.length === 0) return []

		const sorted = [...lines].sort((a, b) => a - b)
		const clusters: Array<{ start: number; end: number }> = []

		let clusterStart = Math.max(1, sorted[0] - CLUSTER_PADDING)
		let clusterEnd = sorted[0] + CLUSTER_PADDING

		for (let i = 1; i < sorted.length; i++) {
			const lineStart = sorted[i] - CLUSTER_PADDING
			const lineEnd = sorted[i] + CLUSTER_PADDING

			if (lineStart <= clusterEnd + CLUSTER_GAP_THRESHOLD) {
				// Merge with current cluster
				clusterEnd = Math.max(clusterEnd, lineEnd)
			} else {
				// Start new cluster
				clusters.push({ start: clusterStart, end: clusterEnd })
				clusterStart = Math.max(1, lineStart)
				clusterEnd = lineEnd
			}
		}
		clusters.push({ start: clusterStart, end: clusterEnd })

		// Limit total lines read per file
		const limited: Array<{ start: number; end: number }> = []
		let totalLinesRead = 0
		for (const c of clusters) {
			const size = c.end - c.start + 1
			if (totalLinesRead + size > maxContextLines && limited.length > 0) break
			limited.push(c)
			totalLinesRead += size
		}

		return limited.length > 0 ? limited : clusters.slice(0, 2)
	}

	/**
	 * Format results for the AI to consume.
	 */
	private formatResultsForAI(state: FastContextState): string {
		if (state.results.length === 0) {
			return "No relevant code found for the given query."
		}

		const sections: string[] = []
		sections.push(`Results for query: ${state.query} (${state.results.length} matches)\n`)

		for (const result of state.results) {
			sections.push(`File: ${result.file}\nLines ${result.startLine}-${result.endLine}:`)
			// Add line numbers to content
			const lines = result.content.split("\n")
			const numbered = lines.map((line, i) => `${result.startLine + i}→${line}`)
			sections.push(numbered.join("\n"))
			sections.push("\n---")
		}

		return sections.join("\n").trim()
	}

	/**
	 * Broadcast current state to the webview for live UI updates.
	 */
	private async broadcastState(task: Task, state: FastContextState): Promise<void> {
		const message: ClineSayTool = {
			tool: "fastContext",
			query: state.query,
			content: JSON.stringify(state),
		}

		try {
			const provider = task.providerRef.deref()
			if (provider) {
				// Update the last fastContext message in the chat
				const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
					try {
						const parsed = JSON.parse(m.text || "{}")
						return (m.say === "tool" || m.ask === "tool") && parsed.tool === "fastContext"
					} catch {
						return false
					}
				})

				if (lastMsgIndex !== -1) {
					const msg = task.clineMessages[lastMsgIndex]
					msg.text = JSON.stringify(message)
					await task.updateClineMessage(msg)
				}
			}
		} catch {
			// Non-critical: UI update failure shouldn't break the tool
		}
	}

}

export const fastContextTool = new FastContextTool()
