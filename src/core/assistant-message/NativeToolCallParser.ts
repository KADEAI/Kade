import { type ToolName, toolNames, type FileEntry } from "@roo-code/types"
import {
	type ToolUse,
	type McpToolUse,
	type ToolParamName,
	toolParamNames,
	type NativeToolArgs,
} from "../../shared/tools"
import { resolveToolAlias } from "../../shared/tool-aliases" // kade_change
import { parseJSON } from "partial-json"
import type {
	ApiStreamToolCallStartChunk,
	ApiStreamToolCallDeltaChunk,
	ApiStreamToolCallEndChunk,
} from "../../api/transform/stream"
import { MCP_TOOL_PREFIX, MCP_TOOL_SEPARATOR, parseMcpToolName } from "../../utils/mcp-name"
import { convertFileEntries, extractParamsFromXml } from "./XmlToolParser"

/**
 * Helper type to extract properly typed native arguments for a given tool.
 * Returns the type from NativeToolArgs if the tool is defined there, otherwise never.
 */
type NativeArgsFor<TName extends ToolName> = TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : never

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read_file), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 */
/**
 * Event types returned from raw chunk processing.
 */
export type ToolCallStreamEvent = ApiStreamToolCallStartChunk | ApiStreamToolCallDeltaChunk | ApiStreamToolCallEndChunk

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read_file), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 *
 * This class also handles raw tool call chunk processing, converting
 * provider-level raw chunks into start/delta/end events.
 */
export class NativeToolCallParser {
	// Streaming state management for argument accumulation (keyed by tool call id)
	// Note: name is string to accommodate dynamic MCP tools (mcp_serverName_toolName)
	private static streamingToolCalls = new Map<
		string,
		{
			id: string
			name: string
			argumentsAccumulator: string
		}
	>()

	// Raw chunk tracking state (keyed by index from API stream)
	private static rawChunkTracker = new Map<
		number,
		{
			id: string
			name: string
			hasStarted: boolean
			deltaBuffer: string[]
		}
	>()

	// Turn-specific identifier to ensure tool call IDs are unique across turns
	private static currentTurnId = Date.now().toString()

	/**
	 * Process a raw tool call chunk from the API stream.
	 * Handles tracking, buffering, and emits start/delta/end events.
	 *
	 * This is the entry point for providers that emit tool_call_partial chunks.
	 * Returns an array of events to be processed by the consumer.
	 */
	public static processRawChunk(chunk: {
		index: number
		id?: string
		name?: string
		arguments?: string
	}): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []
		const { index, id, name, arguments: args } = chunk

		let tracked = this.rawChunkTracker.get(index)

		// Initialize new tool call tracking when we first receive a chunk for this index
		if (!tracked) {
			// If provider omitted id, or provided a non-globally-unique one (like 0 or edit-0),
			// make it unique for this turn. Standard OpenAI/Anthropic IDs (call_..., toolu_...)
			// are preserved as-is.
			const baseId = id || `generated-${index}`
			const uniqueId =
				baseId.startsWith("call_") || baseId.startsWith("toolu_") || baseId.startsWith("unified_")
					? baseId
					: `${this.currentTurnId}-${baseId}`

			tracked = {
				id: uniqueId,
				name: name || "",
				hasStarted: false,
				deltaBuffer: [],
			}
			this.rawChunkTracker.set(index, tracked)
		}

		if (!tracked) {
			return events
		}

		// Update name if present in chunk and not yet set
		if (name) {
			tracked.name = name
		}

		// Emit start event when we have the name
		if (!tracked.hasStarted && tracked.name) {
			events.push({
				type: "tool_call_start",
				id: tracked.id,
				name: tracked.name,
			})
			tracked.hasStarted = true

			// Flush buffered deltas
			for (const bufferedDelta of tracked.deltaBuffer) {
				events.push({
					type: "tool_call_delta",
					id: tracked.id,
					delta: bufferedDelta,
				})
			}
			tracked.deltaBuffer = []
		}

		// Emit delta event for argument chunks
		if (args) {
			if (tracked.hasStarted) {
				events.push({
					type: "tool_call_delta",
					id: tracked.id,
					delta: args,
				})
			} else {
				tracked.deltaBuffer.push(args)
			}
		}

		return events
	}

	/**
	 * Process stream finish reason.
	 * Emits end events when finish_reason is 'tool_calls'.
	 */
	public static processFinishReason(finishReason: string | null | undefined): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []

		if (finishReason === "tool_calls" && this.rawChunkTracker.size > 0) {
			for (const [, tracked] of this.rawChunkTracker.entries()) {
				events.push({
					type: "tool_call_end",
					id: tracked.id,
				})
			}
		}

		return events
	}

	/**
	 * Finalize any remaining tool calls that weren't explicitly ended.
	 * Should be called at the end of stream processing.
	 */
	public static finalizeRawChunks(): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []

		if (this.rawChunkTracker.size > 0) {
			for (const [, tracked] of this.rawChunkTracker.entries()) {
				if (tracked.hasStarted) {
					events.push({
						type: "tool_call_end",
						id: tracked.id,
					})
				}
			}
			this.rawChunkTracker.clear()
		}

		return events
	}

	/**
	 * Clear all raw chunk tracking state.
	 * Should be called when a new API request starts.
	 */
	public static clearRawChunkState(): void {
		this.rawChunkTracker.clear()
		this.currentTurnId = Date.now().toString()
	}

	/**
	 * Start streaming a new tool call.
	 * Initializes tracking for incremental argument parsing.
	 * Accepts string to support both ToolName and dynamic MCP tools (mcp_serverName_toolName).
	 */
	public static startStreamingToolCall(id: string, name: string): void {
		// CRITICAL: Resolve tool alias IMMEDIATELY before storing
		// This prevents 'read' from being treated as invalid and causing catastrophic misparsing
		const resolvedName = resolveToolAlias(name)

		this.streamingToolCalls.set(id, {
			id,
			name: resolvedName,
			argumentsAccumulator: "",
		})
	}

	/**
	 * Clear all streaming tool call state.
	 * Should be called when a new API request starts to prevent memory leaks
	 * from interrupted streams.
	 */
	public static clearAllStreamingToolCalls(): void {
		this.streamingToolCalls.clear()
	}

	/**
	 * Check if there are any active streaming tool calls.
	 * Useful for debugging and testing.
	 */
	public static hasActiveStreamingToolCalls(): boolean {
		return this.streamingToolCalls.size > 0
	}

	/**
	 * Process a chunk of JSON arguments for a streaming tool call.
	 * Uses partial-json-parser to extract values from incomplete JSON immediately.
	 * Returns a partial ToolUse with currently parsed parameters.
	 */
	public static processStreamingChunk(id: string, chunk: string): ToolUse | null {
		const toolCall = this.streamingToolCalls.get(id)
		if (!toolCall) {
			console.warn(`[NativeToolCallParser] Received chunk for unknown tool call: ${id}`)
			return null
		}

		// Accumulate the JSON string
		toolCall.argumentsAccumulator += chunk

		// For dynamic MCP tools, we don't return partial updates - wait for final
		const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
		if (toolCall.name.startsWith(mcpPrefix)) {
			return null
		}

		// kade_change: AGGRESSIVE attempt_completion streaming - bypass JSON parsing entirely
		// This treats the result field as raw text stream for immediate character-by-character updates
		if (toolCall.name.includes("attempt_completion")) {
			console.log(`[NativeToolCallParser] Processing attempt_completion chunk: "${chunk}"`);
			console.log(`[NativeToolCallParser] Current accumulator: "${toolCall.argumentsAccumulator}"`);
			const result = this.extractAttemptCompletionResult(toolCall);
			if (result && result.nativeArgs && 'result' in result.nativeArgs) {
				const attemptCompletionArgs = result.nativeArgs as { result: string };
				console.log(`[NativeToolCallParser] Extracted result: "${attemptCompletionArgs.result}"`);
			} else {
				console.log(`[NativeToolCallParser] No result extracted from chunk`);
			}
			return result;
		}

		// Parse whatever we can from the incomplete JSON!
		try {
			let partialArgs = parseJSON(toolCall.argumentsAccumulator)
			return this.createFromPartialArgs(toolCall, partialArgs)
		} catch {
			// FALLBACK: Hybrid Protocol Recovery (The "Annoying Ass Issue" Fix)

			// 1. XML Recovery Path
			if (toolCall.argumentsAccumulator.trim().startsWith("<")) {
				const partialArgs = this.extractArgumentsFromTags(toolCall.argumentsAccumulator)
				if (Object.keys(partialArgs).length > 0) {
					return this.createFromPartialArgs(toolCall, partialArgs)
				}
			}

			// 2. Unified Protocol Recovery Path
			// If JSON parsing fails but the accumulator looks like a Unified Protocol call
			// (e.g. "edit;index.html\nOld:..."), we manually extract the bits.
			// Strip thinking blocks and handle potential backticks
			const recoveryText = toolCall.argumentsAccumulator.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim()
			const unifiedMatch = recoveryText.match(/^(?:`{1,3}(?:tool\s+)?(\w+)?\r?\n)?\s*\(?(\w+)\b;?([^ \n\r)]*)/)
			if (unifiedMatch) {
				const shortName = unifiedMatch[1]
				const argsPart = unifiedMatch[2]

				// Re-use logic for mapping and populating
				const resolvedName = resolveToolAlias(shortName) as ToolName
				// We create a dummy ToolUse to populate via the mapping logic if needed,
				// but for streaming update we just need the basic params.
				const params: any = {}
				if (shortName === "edit") {
					const parts = argsPart.split(" ").filter(Boolean)
					params.path = parts[0]
				} else if (shortName === "read" || shortName === "write") {
					params.path = argsPart
				}

				// For 'edit', we also check for the diffuse content in the rest of the accumulator
				// Optimization: Cache edits for performance to avoid O(N^2) scans
				let editsMatch = (toolCall as any).lastEditsMatch
				if (!editsMatch || toolCall.argumentsAccumulator.length > ((toolCall as any).lastAccumulatorLength || 0) + 100) {
					editsMatch = toolCall.argumentsAccumulator.match(
						/(?:Old|SEARCH)[\t ]*:?[\t ]*\r?\n([\s\S]*?)\r?\n(?:New|REPLACE)[\t ]*:?[\t ]*\r?\n([\s\S]*?)(?=\r?\n(?:Old|SEARCH)|\r?\n\(done\)|$)/gi,
					)
						; (toolCall as any).lastEditsMatch = editsMatch
						; (toolCall as any).lastAccumulatorLength = toolCall.argumentsAccumulator.length
				}

				const nativeArgs: any = { ...params }

				// Handle 'write' content extraction
				if (shortName === "write") {
					const contentStart = toolCall.argumentsAccumulator.indexOf(")") + 1
					if (contentStart > 0) {
						let content = toolCall.argumentsAccumulator.slice(contentStart).trim()
						// Strip leading/trailing code blocks if present
						const mdMatch = content.match(/```(?:\w+)?\r?\n([\s\S]*?)```/)
						if (mdMatch) content = mdMatch[1].trim()
						nativeArgs.content = content
					}
				}

				if (editsMatch) {
					nativeArgs.edits = editsMatch
						.map((m: string) => {
							const innerMatched = m.match(
								/(?:Old|SEARCH)[\t ]*:?[\t ]*\r?\n([\s\S]*?)\r?\n(?:New|REPLACE)[\t ]*:?[\t ]*\r?\n([\s\S]*)/i,
							)
							if (!innerMatched) return null

							const clean = (t: string) => {
								let text = t.trim()
								const mdMatch = text.match(/```(?:\w+)?\r?\n([\s\S]*?)```/)
								if (mdMatch) return mdMatch[1].trim()
								if (text.startsWith("```")) {
									const nl = text.indexOf("\n")
									text = nl !== -1 ? text.slice(nl + 1) : text.slice(3)
									if (text.endsWith("```")) text = text.slice(0, -3)
									text = text.trim()
								}
								const transition = text.match(/\r?\n\r?\n([A-Z][a-zA-Z',! ]{3,}\b[\s\S]*)$/)
								if (transition && !/[{};<>\[\]=]/.test(transition[1].slice(0, 30))) {
									text = text.slice(0, transition.index)
								}
								return text.trim()
							}

							return {
								oldText: clean(innerMatched[1]),
								newText: clean(innerMatched[2]),
							}
						})
						.filter(Boolean)
				}

				return {
					type: "tool_use",
					id: toolCall.id,
					name: resolvedName,
					params: params,
					nativeArgs: nativeArgs,
					partial: true,
				}
			}
			return null
		}
	}

	private static createFromPartialArgs(toolCall: any, partialArgs: any): ToolUse | null {
		// Resolve tool alias to canonical name
		const resolvedName = resolveToolAlias(toolCall.name) as ToolName
		// Preserve original name if it differs from resolved (i.e., it was an alias)
		const originalName = toolCall.name !== resolvedName ? toolCall.name : undefined

		// Create partial ToolUse with extracted values
		return this.createPartialToolUse(
			toolCall.id,
			resolvedName,
			partialArgs || {},
			true, // partial
			originalName,
		)
	}

	/**
	 * Aggressive regex extraction for attempt_completion result streaming.
	 * Bypasses JSON parsing entirely to treat the result field as raw text stream.
	 * This enables immediate character-by-character streaming without JSON buffering delays.
	 */
	private static extractAttemptCompletionResult(toolCall: {
		id: string
		name: string
		argumentsAccumulator: string
	}): ToolUse | null {
		console.log(`[extractAttemptCompletionResult] Starting extraction for accumulator: "${toolCall.argumentsAccumulator}"`);

		// Multiple regex patterns to handle different JSON formatting scenarios
		const patterns = [
			// Most aggressive: captures everything after "result": " to the end
			/"result"\s*:\s*"(.*)/s,
			// Standard: {"result": "content"} - handles escaped quotes properly
			/"result"\s*:\s*"([^"]*(?:\\.[^"]*)*)/s,
			// Handle single quotes
			/'result'\s*:\s*'(.*)/s
		]

		let extractedContent = ""

		for (const pattern of patterns) {
			const match = toolCall.argumentsAccumulator.match(pattern)
			if (match) {
				console.log(`[extractAttemptCompletionResult] Pattern matched: ${pattern.toString()}, extracted: "${match[1]}"`);
				extractedContent = match[1]
				break
			}
		}

		if (!extractedContent) {
			console.log(`[extractAttemptCompletionResult] No content extracted, returning null`);
			return null // No result content found yet
		}

		// Aggressive unescaping to get raw text immediately
		const originalContent = extractedContent // Keep original for checking
		let content = extractedContent
			.replace(/\\"/g, '"')
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t')
			.replace(/\\r/g, '\r')
			.replace(/\\b/g, '\b')
			.replace(/\\f/g, '\f')
			.replace(/\\\\/g, '\\')

		// Remove any trailing JSON artifacts that might indicate end of string
		// Be careful not to remove legitimate escaped quotes
		// Check if content ends with escaped quote pattern (like \"\"} which is \" followed by "})
		const endsWithEscapedQuotePattern = originalContent.endsWith('\\"') || /\\"\s*"\s*}\s*$/.test(originalContent);

		if (!endsWithEscapedQuotePattern) {
			// Only remove trailing quotes if the content doesn't end with an escaped quote pattern
			content = content
				.replace(/"\s*}\s*$/s, '') // Remove trailing " }
				.replace(/'}\s*$/s, '')   // Remove trailing '}
				.replace(/"}\s*$/s, '')   // Remove trailing "}
				.replace(/"\s*$/s, '')    // Remove trailing "
				.replace(/'\s*$/s, '');    // Remove trailing '
		} else {
			// Content ends with escaped quote pattern, remove only the non-escaped parts
			content = content
				.replace(/}\s*$/s, '')     // Remove trailing }
				.replace(/"\s*$/s, '')     // Remove trailing non-escaped "
				.replace(/'\s*$/s, '');     // Remove trailing ' (if any)
		}

		// Create partial ToolUse with immediately extracted content
		const result = this.createPartialToolUse(
			toolCall.id,
			"attempt_completion",
			{ result: content },
			true, // partial
			undefined,
		)
		console.log(`[extractAttemptCompletionResult] Returning ToolUse with result: "${content}"`);
		return result
	}

	/**
	 * Finalize a streaming tool call.
	 * Parses the complete JSON and returns the final ToolUse or McpToolUse.
	 */
	public static finalizeStreamingToolCall(id: string): ToolUse | McpToolUse | null {
		const toolCall = this.streamingToolCalls.get(id)
		if (!toolCall) {
			console.warn(`[NativeToolCallParser] Attempting to finalize unknown tool call: ${id}`)
			return null
		}

		// Parse the complete accumulated JSON
		// Cast to any for the name since parseToolCall handles both ToolName and dynamic MCP tools
		const finalToolUse = this.parseToolCall({
			id: toolCall.id,
			name: toolCall.name as ToolName,
			arguments: toolCall.argumentsAccumulator,
		})

		// Clean up streaming state
		this.streamingToolCalls.delete(id)

		return finalToolUse
	}

	/**
	 * Convert raw file entries from API (with line_ranges) to FileEntry objects
	 * (with lineRanges). Handles multiple formats for compatibility:
	 *
	 * New tuple format: { path: string, line_ranges: [[1, 50], [100, 150]] }
	 * Object format: { path: string, line_ranges: [{ start: 1, end: 50 }] }
	 * Legacy string format: { path: string, line_ranges: ["1-50"] }
	 *
	 * Returns: { path: string, lineRanges: [{ start: 1, end: 50 }] }
	 */
	private static convertFileEntries(files: any[]): FileEntry[] {
		return convertFileEntries(files)
	}

	/**
	 * Extracts arguments from XML-style tags (Recovery path).
	 */
	private static extractArgumentsFromTags(text: string): Record<string, any> {
		const rawParams = extractParamsFromXml(text)
		const args: Record<string, any> = { ...rawParams }

		// Recovery for files: if we found a <path> but no files array yet
		if (args.path && !args.files) {
			args.files = [{ path: args.path }]
		}

		return args
	}

	/**
	 * Create a partial ToolUse from currently parsed arguments.
	 * Used during streaming to show progress.
	 * @param originalName - The original tool name as called by the model (if different from canonical name)
	 */
	private static createPartialToolUse(
		id: string,
		name: ToolName,
		partialArgs: Record<string, any>,
		partial: boolean,
		originalName?: string,
	): ToolUse | null {
		// Build legacy params for display
		// NOTE: For streaming partial updates, we MUST populate params even for complex types
		// because tool.handlePartial() methods rely on params to show UI updates
		const params: Partial<Record<ToolParamName, string>> = {}

		for (const [key, value] of Object.entries(partialArgs)) {
			if (toolParamNames.includes(key as ToolParamName)) {
				params[key as ToolParamName] = typeof value === "string" ? value : JSON.stringify(value)
			}
		}

		// Build partial nativeArgs based on what we have so far
		let nativeArgs: any = undefined

		switch (name) {
			case "read_file":
				if (partialArgs.files && Array.isArray(partialArgs.files)) {
					nativeArgs = { files: this.convertFileEntries(partialArgs.files) }
				} else if (partialArgs.path) {
					nativeArgs = { files: [{ path: partialArgs.path }] }
				}
				break

			case "attempt_completion":
				if (partialArgs.result) {
					nativeArgs = { result: partialArgs.result }
				}
				break

			case "execute_command":
				if (partialArgs.command) {
					nativeArgs = {
						command: partialArgs.command,
						cwd: partialArgs.cwd,
					}
				}
				break

			case "write_to_file":
				if (partialArgs.path || partialArgs.content) {
					nativeArgs = {
						path: partialArgs.path,
						content: partialArgs.content,
					}
				}
				break



			case "browser_action":
				if (partialArgs.action !== undefined) {
					nativeArgs = {
						action: partialArgs.action,
						url: partialArgs.url,
						coordinate: partialArgs.coordinate,
						size: partialArgs.size,
						text: partialArgs.text,
						path: partialArgs.path,
					}
				}
				break

			case "codebase_search":
				if (partialArgs.query !== undefined) {
					nativeArgs = {
						query: partialArgs.query,
						path: partialArgs.path,
					}
				}
				break

			case "fetch_instructions":
				if (partialArgs.task !== undefined) {
					nativeArgs = {
						task: partialArgs.task,
					}
				}
				break

			case "generate_image":
				if (partialArgs.prompt !== undefined || partialArgs.path !== undefined) {
					nativeArgs = {
						prompt: partialArgs.prompt,
						path: partialArgs.path,
						image: partialArgs.image,
					}
				}
				break

			case "run_slash_command":
				if (partialArgs.command !== undefined) {
					nativeArgs = {
						command: partialArgs.command,
						args: partialArgs.args,
					}
				}
				break

			case "grep":
				if (partialArgs.path !== undefined || partialArgs.query !== undefined || partialArgs.regex !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						query: partialArgs.query || partialArgs.regex, // Support both old and new
						file_pattern: partialArgs.file_pattern,
						context_lines: partialArgs.context_lines,
						literal: partialArgs.literal,
					}
				}
				break

			case "switch_mode":
				if (partialArgs.mode_slug !== undefined || partialArgs.reason !== undefined) {
					nativeArgs = {
						mode_slug: partialArgs.mode_slug,
						reason: partialArgs.reason,
					}
				}
				break

			case "update_todo_list":
				if (partialArgs.todos !== undefined) {
					nativeArgs = {
						todos: partialArgs.todos,
					}
				}
				break

			case "use_mcp_tool":
				if (partialArgs.server_name !== undefined || partialArgs.tool_name !== undefined) {
					nativeArgs = {
						server_name: partialArgs.server_name,
						tool_name: partialArgs.tool_name,
						arguments: partialArgs.arguments,
					}
				}
				break

			case "edit":
				if (partialArgs.file_path !== undefined || partialArgs.edits !== undefined || partialArgs.edit !== undefined) {
					// Support both 'edits' and 'edit' parameter names
					let rawEdits = partialArgs.edits || partialArgs.edit;
					let processedEdits = rawEdits;

					// RECOVERY PATH: Handle double-encoded JSON string
					if (typeof rawEdits === "string") {
						try {
							processedEdits = JSON.parse(rawEdits);
						} catch (e) {
							// Keep as string if parsing fails
						}
					}

					nativeArgs = {
						path: partialArgs.path || partialArgs.file_path,
						edit: processedEdits,
					}
				}
				break



			default:
				break
		}

		const result: ToolUse = {
			type: "tool_use" as const,
			name,
			params,
			partial,
			nativeArgs,
		}

		// Preserve original name for API history when an alias was used
		if (originalName) {
			result.originalName = originalName
		}

		return result
	}

	/**
	 * Convert a native tool call chunk to a ToolUse object.
	 *
	 * @param toolCall - The native tool call from the API stream
	 * @returns A properly typed ToolUse object
	 */
	public static parseToolCall<TName extends ToolName>(toolCall: {
		id: string
		name: TName
		arguments: string
	}): ToolUse<TName> | McpToolUse | null {
		// Check if this is a dynamic MCP tool (mcp--serverName--toolName)
		const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
		if (typeof toolCall.name === "string" && toolCall.name.startsWith(mcpPrefix)) {
			return this.parseDynamicMcpTool(toolCall)
		}

		// Resolve tool alias to canonical name (e.g., "edit_file" -> "apply_diff", "temp_edit_file" -> "search_and_replace")
		const resolvedName = resolveToolAlias(toolCall.name as string) as TName

		// Validate tool name (after alias resolution)
		if (!toolNames.includes(resolvedName as ToolName)) {
			console.error(`Invalid tool name: ${toolCall.name} (resolved: ${resolvedName})`)
			console.error(`Valid tool names:`, toolNames)
			return null
		}

		try {
			// Parse the arguments JSON string
			const args = JSON.parse(toolCall.arguments)
			return this.parseFromArgs<TName>(toolCall, args, resolvedName)
		} catch {
			// FALLBACK: Hybrid Protocol Recovery (The "Annoying Ass Issue" Fix)

			// 1. XML Recovery Path
			if (toolCall.arguments.trim().startsWith("<")) {
				const args = this.extractArgumentsFromTags(toolCall.arguments)
				if (Object.keys(args).length > 0) {
					return this.parseFromArgs<TName>(toolCall, args, resolvedName)
				}
			}

			// 2. Unified Protocol Recovery Path
			// This handles the finalization of tools that used raw Unified text instead of JSON
			// Strip thinking blocks and handle potential backticks
			const recoveryText = toolCall.arguments.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim()
			const unifiedMatch = recoveryText.match(/^(?:`{1,3}(?:\w+)?\r?\n)?\s*\(?(\w+)\b;?([^ \n\r)]*)/)
			if (unifiedMatch) {
				const shortName = unifiedMatch[1]
				const argsPart = unifiedMatch[2]
				const params: any = {}
				if (shortName === "edit") {
					const parts = argsPart.split(" ").filter(Boolean)
					params.path = parts[0]
				} else if (shortName === "read" || shortName === "write") {
					params.path = argsPart
				}

				const editsMatch = toolCall.arguments.match(
					/(?:Old|SEARCH)[\t ]*:?[\t ]*\r?\n([\s\S]*?)\r?\n(?:New|REPLACE)[\t ]*:?[\t ]*\r?\n([\s\S]*?)(?=\r?\n(?:Old|SEARCH)|\r?\n\(done\)|$)/gi,
				)
				const nativeArgs: any = { ...params }

				// Handle 'write' content extraction
				if (shortName === "write") {
					const contentStart = toolCall.arguments.indexOf(")") + 1
					if (contentStart > 0) {
						let content = toolCall.arguments.slice(contentStart).trim()
						// Strip leading/trailing code blocks if present
						const mdMatch = content.match(/```(?:\w+)?\r?\n([\s\S]*?)```/)
						if (mdMatch) content = mdMatch[1].trim()
						nativeArgs.content = content
					}
				}

				if (editsMatch) {
					nativeArgs.edits = editsMatch
						.map((m) => {
							const innerMatched = m.match(
								/(?:Old|SEARCH)[\t ]*:?[\t ]*\r?\n([\s\S]*?)\r?\n(?:New|REPLACE)[\t ]*:?[\t ]*\r?\n([\s\S]*)/i,
							)
							if (!innerMatched) return null

							const clean = (t: string) => {
								let text = t.trim()
								const mdMatch = text.match(/```(?:\w+)?\r?\n([\s\S]*?)```/)
								if (mdMatch) return mdMatch[1].trim()
								if (text.startsWith("```")) {
									const nl = text.indexOf("\n")
									text = nl !== -1 ? text.slice(nl + 1) : text.slice(3)
									if (text.endsWith("```")) text = text.slice(0, -3)
									text = text.trim()
								}
								return text.trim()
							}

							return { oldText: clean(innerMatched[1]), newText: clean(innerMatched[2]) }
						})
						.filter(Boolean)
				}

				return {
					type: "tool_use",
					id: toolCall.id,
					name: resolvedName as any,
					params: params,
					nativeArgs: nativeArgs,
					partial: false,
				} as any
			}
			return null
		}
	}

	private static parseFromArgs<TName extends ToolName>(toolCall: any, args: any, resolvedName: TName): ToolUse<TName> | McpToolUse | null {
		try {
			// Native execution path uses nativeArgs instead, which has proper typing.
			const params: Partial<Record<ToolParamName, string>> = {}

			for (const [key, value] of Object.entries(args)) {
				// Skip complex parameters that have been migrated to nativeArgs.
				// For read_file, the 'files' parameter is a FileEntry[] array that can't be
				// meaningfully stringified. The properly typed data is in nativeArgs instead.
				if (resolvedName === "read_file" && key === "files") {
					continue
				}

				// Validate parameter name
				if (!toolParamNames.includes(key as ToolParamName)) {
					console.warn(`Unknown parameter '${key}' for tool '${resolvedName}'`)
					console.warn(`Valid param names:`, toolParamNames)
					continue
				}

				// Convert to string for legacy params format
				const stringValue = typeof value === "string" ? value : JSON.stringify(value)
				params[key as ToolParamName] = stringValue
			}

			// Build typed nativeArgs for tools that support it.
			// This switch statement serves two purposes:
			// 1. Validation: Ensures required parameters are present before constructing nativeArgs
			// 2. Transformation: Converts raw JSON to properly typed structures
			//
			// Each case validates the minimum required parameters and constructs a properly typed
			// nativeArgs object. If validation fails, nativeArgs remains undefined and the tool
			// will fall back to legacy parameter parsing if supported.
			let nativeArgs: NativeArgsFor<TName> | undefined = undefined

			switch (resolvedName) {
				case "read_file":
					if (args.files && Array.isArray(args.files)) {
						nativeArgs = { files: this.convertFileEntries(args.files) } as NativeArgsFor<TName>
					} else if (args.path) {
						// Support top-level single file read for convenience
						const entry: FileEntry = { path: args.path }
						if (args.line_ranges && Array.isArray(args.line_ranges)) {
							entry.lineRanges = this.convertFileEntries([{ path: args.path, line_ranges: args.line_ranges }])[0].lineRanges
						} else if (args.start_line !== undefined && args.end_line !== undefined) {
							const start = Number(args.start_line)
							const end = Number(args.end_line)
							if (!isNaN(start) && !isNaN(end)) {
								entry.lineRanges = [{ start, end }]
							}
						}
						nativeArgs = { files: [entry] } as NativeArgsFor<TName>
					}
					break

				case "attempt_completion":
					if (args.result) {
						nativeArgs = { result: args.result } as NativeArgsFor<TName>
					}
					break

				case "execute_command":
					if (args.command) {
						nativeArgs = {
							command: args.command,
							cwd: args.cwd,
						} as NativeArgsFor<TName>
					}
					break

				// kade_change start
				case "edit":
					// Allow tolerant path resolution
					const editFilePath = args.file_path || args.path;
					// Support both 'edits' and 'edit' parameter names
					let rawEdits = args.edits || args.edit;

					// Robustly handle both single edit objects and arrays
					if (editFilePath && rawEdits) {
						let editsArray: any[] | undefined = undefined

						// RECOVERY PATH: Handle double-encoded JSON string (e.g., edits: "[{...}]")
						// This fixes the "Annoying Ass Issue" where backslashes cause parsing failures
						if (typeof rawEdits === "string") {
							try {
								const parsed = JSON.parse(rawEdits)
								if (Array.isArray(parsed)) {
									editsArray = parsed
								} else if (typeof parsed === "object" && parsed !== null) {
									editsArray = [parsed]
								}
								console.log(`[NativeToolCallParser] Successfully parsed double-encoded edits string`)
							} catch (e) {
								console.warn(`[NativeToolCallParser] Failed to parse edits string:`, e)
							}
						} else if (Array.isArray(rawEdits)) {
							editsArray = rawEdits
						} else if (typeof rawEdits === "object" && rawEdits !== null) {
							editsArray = [rawEdits]
						}

						if (editsArray) {
							nativeArgs = {
								path: editFilePath,
								edit: editsArray,
							} as NativeArgsFor<TName>
						}
					}
					break
				case "condense":
				case "edit_file":
				case "delete_file":
				case "new_rule":
				case "report_bug":
					break
				// kade_change end



				case "browser_action":
					if (args.action !== undefined) {
						nativeArgs = {
							action: args.action,
							url: args.url,
							coordinate: args.coordinate,
							size: args.size,
							text: args.text,
							path: args.path,
						} as NativeArgsFor<TName>
					}
					break

				case "codebase_search":
					if (args.query !== undefined) {
						nativeArgs = {
							query: args.query,
							path: args.path,
						} as NativeArgsFor<TName>
					}
					break

				case "fetch_instructions":
					if (args.task !== undefined) {
						nativeArgs = {
							task: args.task,
						} as NativeArgsFor<TName>
					}
					break

				case "generate_image":
					if (args.prompt !== undefined && args.path !== undefined) {
						nativeArgs = {
							prompt: args.prompt,
							path: args.path,
							image: args.image,
						} as NativeArgsFor<TName>
					}
					break

				case "run_slash_command":
					if (args.command !== undefined) {
						nativeArgs = {
							command: args.command,
							args: args.args,
						} as NativeArgsFor<TName>
					}
					break

				case "grep":
					if (args.path !== undefined && (args.query !== undefined || args.regex !== undefined)) {
						nativeArgs = {
							path: args.path,
							query: args.query || args.regex, // Support both old and new
							file_pattern: args.file_pattern,
							context_lines: args.context_lines,
							literal: args.literal,
						} as NativeArgsFor<TName>
					}
					break

				case "switch_mode":
					if (args.mode_slug !== undefined && args.reason !== undefined) {
						nativeArgs = {
							mode_slug: args.mode_slug,
							reason: args.reason,
						} as NativeArgsFor<TName>
					}
					break

				case "update_todo_list":
					if (args.todos !== undefined) {
						nativeArgs = {
							todos: args.todos,
						} as NativeArgsFor<TName>
					}
					break

				case "write_to_file":
					if (args.path !== undefined && args.content !== undefined) {
						nativeArgs = {
							path: args.path,
							content: args.content,
						} as NativeArgsFor<TName>
					}
					break

				case "use_mcp_tool":
					if (args.server_name !== undefined && args.tool_name !== undefined) {
						nativeArgs = {
							server_name: args.server_name,
							tool_name: args.tool_name,
							arguments: args.arguments,
						} as NativeArgsFor<TName>
					}
					break

				case "access_mcp_resource":
					if (args.server_name !== undefined && args.uri !== undefined) {
						nativeArgs = {
							server_name: args.server_name,
							uri: args.uri,
						} as NativeArgsFor<TName>
					}
					break



				default:
					break
			}

			const result: ToolUse<TName> = {
				type: "tool_use" as const,
				name: resolvedName,
				params,
				partial: false, // Native tool calls are always complete when yielded
				nativeArgs,
			}

			// Preserve original name for API history when an alias was used
			if (toolCall.name !== resolvedName) {
				result.originalName = toolCall.name
			}

			return result
		} catch (error: any) {
			console.error(
				`Failed to parse tool call arguments: ${error instanceof Error ? error.message : String(error)}`,
			)

			console.error(`Tool call: ${JSON.stringify(toolCall, null, 2)}`)
			return null
		}
	}

	/**
	 * Parse dynamic MCP tools (named mcp--serverName--toolName).
	 * These are generated dynamically by getMcpServerTools() and are returned
	 * as McpToolUse objects that preserve the original tool name.
	 *
	 * In native mode, MCP tools are NOT converted to use_mcp_tool - they keep
	 * their original name so it appears correctly in API conversation history.
	 * The use_mcp_tool wrapper is only used in XML mode.
	 */
	public static parseDynamicMcpTool(toolCall: { id: string; name: string; arguments: string }): McpToolUse | null {
		try {
			// Parse the arguments - these are the actual tool arguments passed directly
			const args = JSON.parse(toolCall.arguments || "{}")

			// Extract server_name and tool_name from the tool name itself
			// Format: mcp--serverName--toolName (using -- separator)
			const parsed = parseMcpToolName(toolCall.name)
			if (!parsed) {
				console.error(`Invalid dynamic MCP tool name format: ${toolCall.name}`)
				return null
			}

			const { serverName, toolName } = parsed

			const result: McpToolUse = {
				type: "mcp_tool_use" as const,
				id: toolCall.id,
				// Keep the original tool name (e.g., "mcp--serverName--toolName") for API history
				name: toolCall.name,
				serverName,
				toolName,
				arguments: args,
				partial: false,
			}

			return result
		} catch (error) {
			console.error(`Failed to parse dynamic MCP tool:`, error)
			return null
		}
	}
}
