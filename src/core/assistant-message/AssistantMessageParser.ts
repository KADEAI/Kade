import { type ToolName, toolNames, type FileEntry } from "@roo-code/types"
import { TextContent, ToolUse, ToolParamName, toolParamNames } from "../../shared/tools"
import { AssistantMessageContent } from "./parseAssistantMessage"
import { KiloXmlHandler, PRIMARY_PARAMS, KILO_XML_ALIASES } from "./XmlToolParser"

/**
 * Parser for assistant messages. Maintains state between chunks
 * to avoid reprocessing the entire message on each update.
 */
export class AssistantMessageParser {
	private contentBlocks: AssistantMessageContent[] = []
	private currentTextContent: TextContent | undefined = undefined
	private currentTextContentStartIndex = 0
	private currentToolUse: ToolUse | undefined = undefined
	private currentToolUseStartIndex = 0
	private currentParamName: ToolParamName | undefined = undefined
	private currentParamValueStartIndex = 0
	private readonly MAX_ACCUMULATOR_SIZE = 1024 * 1024 // 1MB limit
	private readonly MAX_PARAM_LENGTH = 1024 * 100 // 100KB per parameter limit

	private accumulator = ""
	// kade_change: Add synthetic ID generation for EditHistoryService compatibility
	private currentTurnId = Date.now().toString()
	private toolCallCounter = 0
	private hasFinalizedTool = false

	// kade_change: Kilo-XML Shorthand State delegated to KiloXmlHandler
	private kiloHandler = new KiloXmlHandler()

	/**
	 * Initialize a new AssistantMessageParser instance.
	 */
	constructor() {
		this.reset()
	}

	/**
	 * Reset the parser state.
	 */
	public reset(): void {
		this.contentBlocks = []
		this.hasFinalizedTool = false
		this.currentTextContent = undefined
		this.currentTextContentStartIndex = 0
		this.currentToolUse = undefined
		this.currentToolUseStartIndex = 0
		this.currentParamName = undefined
		this.currentParamValueStartIndex = 0
		this.accumulator = ""
		// kade_change: Reset turn ID and counter for EditHistoryService
		this.currentTurnId = Date.now().toString()
		this.toolCallCounter = 0
		this.kiloHandler.reset()
	}

	/**
	 * Returns true if the parser has completed a tool call.
	 */
	public hasCompletedToolCall(): boolean {
		return this.hasFinalizedTool
	}

	/**
	 * Returns the current parsed content blocks
	 */

	public getContentBlocks(): AssistantMessageContent[] {
		// Return a shallow copy to prevent external mutation
		return this.contentBlocks.slice()
	}

	/**
	 * Process a new chunk of text and update the parser state.
	 * @param chunk The new chunk of text to process.
	 */
	public processChunk(chunk: string): AssistantMessageContent[] {
		const timestamp = Date.now();
		const chunkId = Math.random().toString(36).substr(2, 9);
		console.log(`[AssistantMessageParser] 📥 [${chunkId}] Processing chunk at ${timestamp}: "${chunk}" (length: ${chunk.length})`);
		console.log(`[AssistantMessageParser] 📊 [${chunkId}] Current state:`, {
			accumulatorLength: this.accumulator.length,
			contentBlocksCount: this.contentBlocks.length,
			hasCurrentTextContent: !!this.currentTextContent,
			hasCurrentToolUse: !!this.currentToolUse,
			currentParamName: this.currentParamName,
			accumulatorPreview: this.accumulator.length > 0 ? this.accumulator.substring(-100) : ""
		});

		if (this.accumulator.length + chunk.length > this.MAX_ACCUMULATOR_SIZE) {
			throw new Error("Assistant message exceeds maximum allowed size")
		}
		// Store the current length of the accumulator before adding the new chunk
		const accumulatorStartLength = this.accumulator.length

		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i]
			this.accumulator += char
			const currentPosition = accumulatorStartLength + i

			// There should not be a param without a tool use.
			if (this.currentToolUse && this.currentParamName) {
				const currentParamValue = this.accumulator.slice(this.currentParamValueStartIndex)
				if (currentParamValue.length > this.MAX_PARAM_LENGTH) {
					// Reset to a safe state
					this.currentParamName = undefined
					this.currentParamValueStartIndex = 0
					continue
				}
				const paramClosingTag = `</${this.currentParamName}>`
				// Streamed param content: always write the currently accumulated value
				if (currentParamValue.endsWith(paramClosingTag)) {
					// End of param value.
					// Do not trim content parameters to preserve newlines, but strip first and last newline only
					const paramValue = currentParamValue.slice(0, -paramClosingTag.length)
					this.currentToolUse.params[this.currentParamName] =
						this.currentParamName === "content"
							? paramValue.replace(/^\n/, "") // FIXED: Don't trim final newline!
							: paramValue.trim()
					this.currentParamName = undefined
					continue
				} else {
					// Partial param value is accumulating.
					// Write the currently accumulated param content in real time
					this.currentToolUse.params[this.currentParamName] = currentParamValue
					continue
				}
			}

			// KILOCODE FIX: Positional content accumulation for write/edit_file shorthand.
			// When in positional content accumulation mode, every character (including < and >)
			// is treated as file content, NOT as tag delimiters.
			// IMPORTANT: We must still check for the tool closing tag to know when to stop.
			if (this.currentToolUse && this.kiloHandler.positionalContentAccumStartIndex !== undefined && this.kiloHandler.positionalContentParamName) {
				// Check for tool closing tag FIRST before accumulating
				const toolUseClosingTag = `</${this.kiloHandler.openedWithTag || this.currentToolUse.name}>`
				const isSymmetricalClosing = this.kiloHandler.openedWithTag && this.accumulator.endsWith(`<${this.kiloHandler.openedWithTag}>`)

				if (this.accumulator.endsWith(toolUseClosingTag) || isSymmetricalClosing) {
					// Tool is complete — finalize content (strip closing tag from content)
					let accumulatedContent = this.accumulator.slice(this.kiloHandler.positionalContentAccumStartIndex)
					// Remove the closing tag from the end of content
					if (isSymmetricalClosing) {
						accumulatedContent = accumulatedContent.slice(0, -(`<${this.kiloHandler.openedWithTag}>`).length)
					} else {
						accumulatedContent = accumulatedContent.slice(0, -toolUseClosingTag.length)
					}
					accumulatedContent = accumulatedContent.replace(/^<\n?/, "")
					accumulatedContent = accumulatedContent.replace(/>\s*$/, "")
					accumulatedContent = accumulatedContent.replace(/\n$/, "")
					this.currentToolUse.params[this.kiloHandler.positionalContentParamName] = accumulatedContent
					this.finalizeCurrentToolUse()
					continue
				}

				// Stream the accumulated content to the param in real time
				let accumulatedContent = this.accumulator.slice(this.kiloHandler.positionalContentAccumStartIndex)
				// Strip the leading bracket (<) and optional newline from shorthand format
				accumulatedContent = accumulatedContent.replace(/^<\n?/, "")
				this.currentToolUse.params[this.kiloHandler.positionalContentParamName] = accumulatedContent
				// Don't fall through to positional tag detection - we're in content mode
				continue
			}

			// No currentParamName.

			if (this.currentToolUse) {
				const currentToolValue = this.accumulator.slice(this.currentToolUseStartIndex)
				const toolUseClosingTag = `</${this.kiloHandler.openedWithTag || this.currentToolUse.name}>`
				const isSymmetricalClosing = this.kiloHandler.openedWithTag && this.accumulator.endsWith(`<${this.kiloHandler.openedWithTag}>`)

				if (this.accumulator.endsWith(toolUseClosingTag) || isSymmetricalClosing) {
					this.finalizeCurrentToolUse()
					continue
				} else {
					// kade_change: Check for Kilo-XML Positional Delimiter Tags
					if (char === ">") {
						const lastOpenBracket = this.accumulator.lastIndexOf("<")
						if (lastOpenBracket !== -1) {
							const tagContent = this.accumulator.slice(lastOpenBracket + 1, -1)
							// If it's not a known closing tag, starts with /, or is a known parameter, treat as positional
							if (tagContent && !tagContent.startsWith("/") && !toolParamNames.includes(tagContent as ToolParamName)) {
								if (this.currentToolUse.name === "read") {
									this.kiloHandler.handleReadVariadic(tagContent, this.currentToolUse)
									continue
								}

								const primaryParams = PRIMARY_PARAMS[this.currentToolUse.name]
								if (primaryParams && this.kiloHandler.positionalParamIndex < primaryParams.length) {
									const paramName = primaryParams[this.kiloHandler.positionalParamIndex++] as ToolParamName

									// KILOCODE FIX: For content-heavy params (write content, edit_file edit),
									// switch to content accumulation mode instead of treating each > as a delimiter.
									// The content param is the LAST positional param and contains the file body.
									const isContentParam =
										(this.currentToolUse.name === "write" && paramName === "content") ||
										(this.currentToolUse.name === "edit_file" && paramName === "edit")

									if (isContentParam) {
										// Don't set param from tagContent (it's just the first tag inside the content).
										// Instead, start accumulating from the position of the < that opened this tag.
										const lastOpenBracketPos = this.accumulator.lastIndexOf("<", this.accumulator.length - tagContent.length - 2)
										this.kiloHandler.positionalContentAccumStartIndex = lastOpenBracketPos !== -1 ? lastOpenBracketPos : this.accumulator.length
										this.kiloHandler.positionalContentParamName = paramName
										// Set initial content value
										let initialContent = this.accumulator.slice(this.kiloHandler.positionalContentAccumStartIndex)
										initialContent = initialContent.replace(/^<\n?/, "")
										this.currentToolUse.params[paramName] = initialContent
										continue
									}

									this.currentToolUse.params[paramName] = tagContent
									continue
								}
							}
						}
					}

					const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`)
					for (const paramOpeningTag of possibleParamOpeningTags) {
						if (this.accumulator.endsWith(paramOpeningTag)) {
							// Start of a new parameter.
							const paramName = paramOpeningTag.slice(1, -1)
							if (!toolParamNames.includes(paramName as ToolParamName)) {
								// Handle invalid parameter name gracefully
								continue
							}
							this.currentParamName = paramName as ToolParamName
							this.currentParamValueStartIndex = this.accumulator.length
							break
						}
					}
					// Partial tool value is accumulating.
					continue
				}
			}

			// No currentToolUse.

			const allPotentialToolTags = [...toolNames, ...Object.keys(KILO_XML_ALIASES)]
			const possibleToolUseOpeningTags = allPotentialToolTags.map((name) => `<${name}>`)
			let didStartToolUse = false

			for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
				if (this.accumulator.endsWith(toolUseOpeningTag)) {
					// Extract and validate the tool name
					const extractedToolName = toolUseOpeningTag.slice(1, -1)
					const canonicalName = this.kiloHandler.getCanonicalToolName(extractedToolName)

					// Check if the extracted tool name is valid
					if (!toolNames.includes(canonicalName as ToolName)) {
						// Invalid tool name, treat as plain text and continue
						continue
					}

					// Start of a new tool use.
					this.kiloHandler.openedWithTag = extractedToolName
					this.kiloHandler.positionalParamIndex = 0
					// kade_change: Add synthetic xml_ prefixed ID for EditHistoryService
					// This allows edit tracking without polluting API history with JSON tool_use blocks
					const toolCallId = `xml_${this.currentTurnId}_${extractedToolName}_${this.toolCallCounter++}`
					this.currentToolUse = {
						type: "tool_use",
						name: canonicalName as ToolName,
						originalName: extractedToolName,
						params: {},
						partial: true,
						toolUseId: toolCallId, // For EditHistoryService - not used in API
						id: toolCallId, // Stable ID for UI deduplication
					} as ToolUse

					this.currentToolUseStartIndex = this.accumulator.length

					// This also indicates the end of the current text content.
					if (this.currentTextContent) {
						this.currentTextContent.partial = false

						// Remove the partially accumulated tool use tag from the
						// end of text (<tool).
						this.currentTextContent.content = this.currentTextContent.content
							.slice(0, -toolUseOpeningTag.slice(0, -1).length)
							.trim()

						// No need to push, currentTextContent is already in contentBlocks
						this.currentTextContent = undefined
					}

					// Immediately push new tool_use block as partial
					let idx = this.contentBlocks.findIndex((block) => block === this.currentToolUse)
					if (idx === -1) {
						this.contentBlocks.push(this.currentToolUse)
					}

					didStartToolUse = true
					break
				}
			}

			if (!didStartToolUse) {
				// No tool use, so it must be text either at the beginning or
				// between tools.
				if (this.currentTextContent === undefined) {
					// If this is the first chunk and we're at the beginning of processing,
					// set the start index to the current position in the accumulator
					this.currentTextContentStartIndex = currentPosition

					// Create a new text content block and add it to contentBlocks
					this.currentTextContent = {
						type: "text",
						content: this.cleanTextContent(this.accumulator.slice(this.currentTextContentStartIndex)),
						partial: true,
					}

					// Add the new text content to contentBlocks immediately
					// Ensures it appears in the UI right away
					this.contentBlocks.push(this.currentTextContent)
				} else {
					// Update the existing text content
					this.currentTextContent.content = this.cleanTextContent(this.accumulator.slice(this.currentTextContentStartIndex))
				}
			}
		}
		// Do not call finalizeContentBlocks() here.
		// Instead, update any partial blocks in the array and add new ones as they're completed.
		// This matches the behavior of the original parseAssistantMessage function.
		const result = this.getContentBlocks()
		console.log(`[AssistantMessageParser] 📤 Returning ${result.length} content blocks:`, result.map((block, i) => ({
			index: i,
			type: block.type,
			name: (block as any).name,
			partial: block.partial,
			...(block.type === "tool_use" ? {
				paramsKeys: Object.keys((block as any).params || {}),
				...((block as any).name === "write" ? {
					contentLength: (block as any).params?.content?.length || 0,
					contentLineCount: (block as any).params?.content ? (block as any).params.content.split('\n').length : 0,
					path: (block as any).params?.path
				} : {})
			} : {})
		})));
		return result
	}

	private cleanTextContent(text: string): string {
		// Remove standing markdown separators (---, ***, etc.) that are just noise between blocks
		// We match them if they are on their own line or the only content
		return text.replace(/^(?:\s*[-*_~=]{3,}\s*)+$/gm, "").trim()
	}

	/**
	 * Finalize any partial content blocks.
	 * Should be called after processing the last chunk.
	 */
	public finalizeContentBlocks(): void {
		// Mark all partial blocks as complete
		for (const block of this.contentBlocks) {
			if (block.partial) {
				block.partial = false
			}
			if (block.type === "text" && typeof block.content === "string") {
				block.content = this.cleanTextContent(block.content)
			}
		}
	}

	private finalizeCurrentToolUse(): void {
		if (!this.currentToolUse) return

		console.log(`[AssistantMessageParser] 🔧 Tool use ending for ${this.currentToolUse.name}, delegating to KiloXmlHandler`)
		const toolContent = this.accumulator.slice(this.currentToolUseStartIndex)

		this.kiloHandler.finalizeToolUse(this.currentToolUse, toolContent, this.accumulator)

		this.currentToolUse.partial = false
		this.currentToolUse = undefined
		this.kiloHandler.reset()
	}
}
