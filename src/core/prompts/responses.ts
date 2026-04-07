import { Anthropic } from "@anthropic-ai/sdk"
import * as path from "path"
import * as diff from "diff"
import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../ignore/RooIgnoreController"
import { RooProtectedController } from "../protect/RooProtectedController"
import * as vscode from "vscode"
import { ToolProtocol, isNativeProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import { Package } from "../../shared/package"
import { formatBytes } from "../../utils/format"
import { addLineNumbers } from "../../integrations/misc/extract-text"

export const NATIVE_READ_SECTION_SEPARATOR = "\n\n----- READ SECTION BREAK -----\n\n"
export const NATIVE_READ_RESULT_SEPARATOR = "\n\n========== NEXT READ RESULT ==========\n\n"

export function wrapNativeReadResult(path: string, body: string): string {
	const trimmedBody = body.trimEnd() || "(tool did not return anything)"
	return [
		`Read result for ${path}`,
		"Read Content:",
		trimmedBody,
		"EOF",
	].join("\n")
}

export function joinNativeReadSections(sections: string[]): string {
	return sections.filter(Boolean).join(NATIVE_READ_SECTION_SEPARATOR)
}

export function joinNativeReadResults(results: string[]): string {
	return results.filter(Boolean).join(NATIVE_READ_RESULT_SEPARATOR)
}

export function formatNativeFileReadback(path: string, content: string): string {
	if (content.length === 0) {
		return wrapNativeReadResult(path, "Note: File is empty")
	}

	const rawLines = content.split(/\r?\n/)
	const lineCount =
		content.endsWith("\n") || content.endsWith("\r\n")
			? Math.max(0, rawLines.length - 1)
			: rawLines.length
	const numbered = addLineNumbers(content).trimEnd()
	return wrapNativeReadResult(path, `Lines 1-${lineCount}:\n${numbered}`)
}

export const HISTORY_CONTENT_PLACEMENT_PLACEHOLDER =
	"Content placed in paired result below"
export const WRITE_HISTORY_PREVIEW_LENGTH = 10
export const WRITE_HISTORY_PREVIEW_SUFFIX = "..... see result for rest of write"
export const EDIT_HISTORY_PREVIEW_LENGTH = 7
export const EDIT_HISTORY_PREVIEW_SUFFIX = "..."

export function formatWriteHistoryPlaceholder(
	path: string,
	content?: string,
	closer: string = "EOF",
): string {
	return [`Write ${path}`, formatWriteHistoryPlaceholderBody(content), closer].join("\n")
}

export interface EditHistorySyntax {
	oldHeader: string
	newHeader: string
	closer: string
	oldRangeStyle: "space" | "bracket" | "paren" | "double-colon"
}

function matchRedactableEditHeader(
	line: string,
): {
	kind: "old" | "new"
	headerLine: string
	headerToken: string
	rangeStyle?: EditHistorySyntax["oldRangeStyle"]
} | null {
	const trimmed = line.trim()
	if (!trimmed) {
		return null
	}

	const bracketMatch = trimmed.match(/^([A-Za-z]+)\s*\[\s*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?\s*\]\s*:/)
	if (bracketMatch) {
		const token = bracketMatch[1]
		const headerLine = `${token}[${bracketMatch[2]}${bracketMatch[3] ? `-${bracketMatch[3]}` : ""}]:`
		if (/^(search|oldtext|oldtxt|otxt)$/i.test(token)) {
			return { kind: "old", headerLine, headerToken: token, rangeStyle: "bracket" }
		}
		if (/^(replace|newtext|newtxt|ntxt)$/i.test(token)) {
			return { kind: "new", headerLine: `${token}:`, headerToken: token }
		}
	}

	const parenMatch = trimmed.match(/^([A-Za-z]+)\s*\(\s*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?\s*\)\s*:/)
	if (parenMatch) {
		const token = parenMatch[1]
		const headerLine = `${token}(${parenMatch[2]}${parenMatch[3] ? `-${parenMatch[3]}` : ""}):`
		if (/^(search|oldtext|oldtxt|otxt)$/i.test(token)) {
			return { kind: "old", headerLine, headerToken: token, rangeStyle: "paren" }
		}
		if (/^(replace|newtext|newtxt|ntxt)$/i.test(token)) {
			return { kind: "new", headerLine: `${token}:`, headerToken: token }
		}
	}

	const doubleColonMatch = trimmed.match(/^([A-Za-z]+)\s*:\s*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?\s*:/)
	if (doubleColonMatch) {
		const token = doubleColonMatch[1]
		const headerLine = `${token}:${doubleColonMatch[2]}${doubleColonMatch[3] ? `-${doubleColonMatch[3]}` : ""}:`
		if (/^(search|oldtext|oldtxt|otxt)$/i.test(token)) {
			return { kind: "old", headerLine, headerToken: token, rangeStyle: "double-colon" }
		}
		if (/^(replace|newtext|newtxt|ntxt)$/i.test(token)) {
			return { kind: "new", headerLine: `${token}:`, headerToken: token }
		}
	}

	const spacedMatch = trimmed.match(/^([A-Za-z]+)\s+(\d+)(?:(?:[-]|,[\t ]*)(\d+))?\s*:/)
	if (spacedMatch) {
		const token = spacedMatch[1]
		const headerLine = `${token} ${spacedMatch[2]}${spacedMatch[3] ? `-${spacedMatch[3]}` : ""}:`
		if (/^(search|oldtext|oldtxt|otxt)$/i.test(token)) {
			return { kind: "old", headerLine, headerToken: token, rangeStyle: "space" }
		}
		if (/^(replace|newtext|newtxt|ntxt)$/i.test(token)) {
			return { kind: "new", headerLine: `${token}:`, headerToken: token }
		}
	}

	const plainMatch = trimmed.match(/^([A-Za-z]+)\s*:/)
	if (!plainMatch) {
		return null
	}

	const token = plainMatch[1]
	if (/^(search|oldtext|oldtxt|otxt)$/i.test(token)) {
		return { kind: "old", headerLine: `${token}:`, headerToken: token, rangeStyle: "space" }
	}
	if (/^(replace|newtext|newtxt|ntxt)$/i.test(token)) {
		return { kind: "new", headerLine: `${token}:`, headerToken: token }
	}

	return null
}

function buildEditHeaderLine(
	headerToken: string,
	rangeStyle: EditHistorySyntax["oldRangeStyle"],
	startLine?: number,
	endLine?: number,
): string {
	if (startLine === undefined) {
		return `${headerToken}:`
	}

	const range = endLine === undefined || endLine === startLine ? `${startLine}` : `${startLine}-${endLine}`
	switch (rangeStyle) {
		case "bracket":
			return `${headerToken}[${range}]:`
		case "paren":
			return `${headerToken}(${range}):`
		case "double-colon":
			return `${headerToken}:${range}:`
		case "space":
		default:
			return `${headerToken} ${range}:`
	}
}

export function inferEditHistorySyntax(
	editBody?: string,
	explicitCloser?: string,
): EditHistorySyntax {
	const syntax: EditHistorySyntax = {
		oldHeader: "oldText",
		newHeader: "newText",
		closer: explicitCloser || "EOF",
		oldRangeStyle: "space",
	}

	if (!editBody) {
		return syntax
	}

	for (const line of editBody.split(/\r?\n/)) {
		const matched = matchRedactableEditHeader(line)
		if (!matched) {
			continue
		}

		if (matched.kind === "old") {
			syntax.oldHeader = matched.headerToken
			if (matched.rangeStyle) {
				syntax.oldRangeStyle = matched.rangeStyle
			}
		} else {
			syntax.newHeader = matched.headerToken
		}

		if (syntax.oldHeader !== "oldText" && syntax.newHeader !== "newText") {
			break
		}
	}

	return syntax
}

export function formatEditHistoryPlaceholder(
	path: string,
	editBody?: string,
	options?: {
		closer?: string
	},
): string {
	const syntax = inferEditHistorySyntax(editBody, options?.closer)
	return [
		`Edit ${path}`,
		editBody ? redactEditHistoryBody(editBody) : formatEditHistoryPlaceholderBody(),
		syntax.closer,
	].join("\n")
}

export function formatWriteHistoryPlaceholderBody(content?: string): string {
	const preview = typeof content === "string" ? content.replace(/\r\n/g, "\n").slice(0, WRITE_HISTORY_PREVIEW_LENGTH) : ""
	return `${preview}${WRITE_HISTORY_PREVIEW_SUFFIX}`
}

export function formatEditHistoryPreview(content?: string): string {
	const normalized =
		typeof content === "string"
			? content.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim()
			: ""
	if (!normalized) {
		return "(empty)"
	}

	if (normalized.length <= EDIT_HISTORY_PREVIEW_LENGTH) {
		return normalized
	}

	return `${normalized.slice(0, EDIT_HISTORY_PREVIEW_LENGTH)}${EDIT_HISTORY_PREVIEW_SUFFIX}`
}

export function formatEditHistoryPlaceholderBody(
	syntax: Pick<EditHistorySyntax, "oldHeader" | "newHeader" | "oldRangeStyle"> = {
		oldHeader: "Search",
		newHeader: "Replace",
		oldRangeStyle: "space",
	},
): string {
	return [
		HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
		buildEditHeaderLine(syntax.oldHeader, syntax.oldRangeStyle, 1, 6),
		`${syntax.newHeader}:`,
	].join("\n")
}

const EDIT_HISTORY_HEADER_REGEX = /^\s*(search|replace|oldText|newText|oldtxt|newtxt|otxt|ntxt)\b.*$/i

function normalizeEditHistoryHeader(line: string): string {
	return matchRedactableEditHeader(line)?.headerLine ?? line.trim()
}

export function redactEditHistoryBody(editBody: string): string {
	const lines = editBody.split(/\r?\n/)
	const headerIndexes = lines.reduce<number[]>((indexes, line, index) => {
		if (EDIT_HISTORY_HEADER_REGEX.test(line)) {
			indexes.push(index)
		}
		return indexes
	}, [])

	if (headerIndexes.length === 0) {
		return formatEditHistoryPlaceholderBody()
	}

	const redacted: string[] = []
	redacted.push(HISTORY_CONTENT_PLACEMENT_PLACEHOLDER)
	for (let i = 0; i < headerIndexes.length; i++) {
		const headerIndex = headerIndexes[i]
		redacted.push(normalizeEditHistoryHeader(lines[headerIndex]))
	}

	return redacted.join("\n")
}

const LEGACY_WRITE_HISTORY_PLACEHOLDER_REGEX =
	/^<<<WRITE_HISTORY_PLACEHOLDER path="(.+)">>>$/

const LEGACY_EDIT_HISTORY_PLACEHOLDER_REGEX =
	/^<<<EDIT_HISTORY_PLACEHOLDER path="(.+)">>>$/

const LEGACY_WRITE_HISTORY_SENTENCE_REGEX =
	/^\[write content for '(.+)' has been placed into the result after success\. See the paired tool result for the canonical post-write file snapshot with line numbers\.\]$/i

const LEGACY_EDIT_HISTORY_SENTENCE_REGEX =
	/^\[edit blocks for '(.+)' has been placed into the result after success\. See the paired tool result for the canonical applied Previous\/New blocks with line ranges\.\]$/i

function escapePlaceholderPath(path: string): string {
	return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isWriteHistoryPlaceholderBody(content: string): boolean {
	const normalized = content.replace(/\r\n/g, "\n").trimEnd()
	if (normalized.toLowerCase() === HISTORY_CONTENT_PLACEMENT_PLACEHOLDER.toLowerCase()) {
		return true
	}

	if (!normalized.endsWith(WRITE_HISTORY_PREVIEW_SUFFIX)) {
		return false
	}

	return normalized.length - WRITE_HISTORY_PREVIEW_SUFFIX.length <= WRITE_HISTORY_PREVIEW_LENGTH
}

export function isWriteHistoryPlaceholder(content: string, expectedPath?: string): boolean {
	const trimmed = content.trim()
	const legacyMatch =
		trimmed.match(LEGACY_WRITE_HISTORY_PLACEHOLDER_REGEX) ||
		trimmed.match(LEGACY_WRITE_HISTORY_SENTENCE_REGEX)
	if (legacyMatch) {
		return expectedPath ? legacyMatch[1] === expectedPath : true
	}

	if (!expectedPath && isWriteHistoryPlaceholderBody(trimmed)) {
		return true
	}

	const structuredMatch = trimmed.match(/^Write (.+)\r?\n([\s\S]*?)\r?\n(?:EOF|ETXT)$/i)
	if (!structuredMatch) {
		return false
	}

	const [, path, body] = structuredMatch
	if (expectedPath && path !== expectedPath) {
		return false
	}

	return isWriteHistoryPlaceholderBody(body)
}

export function isEditHistoryPlaceholder(content: string, expectedPath?: string): boolean {
	const trimmed = content.trim()
	const legacyMatch =
		trimmed.match(LEGACY_EDIT_HISTORY_PLACEHOLDER_REGEX) ||
		trimmed.match(LEGACY_EDIT_HISTORY_SENTENCE_REGEX)
	if (legacyMatch) {
		return expectedPath ? legacyMatch[1] === expectedPath : true
	}

	if (!expectedPath) {
		if (isRedactedEditHistoryBody(trimmed)) {
			return true
		}
	}

	const structuredPrefix = expectedPath
		? new RegExp(
				`^Edit ${escapePlaceholderPath(expectedPath)}\\r?\\n([\\s\\S]*?)\\r?\\n(?:EOF|ETXT)$`,
				"i",
			)
		: /^Edit (.+)\r?\n([\s\S]*?)\r?\n(?:EOF|ETXT)$/i
	const structuredMatch = trimmed.match(structuredPrefix)
	if (!structuredMatch) {
		return false
	}

	const body = structuredMatch[expectedPath ? 1 : 2]
	return isRedactedEditHistoryBody(body)
}

function isRedactedEditHistoryBody(content: string): boolean {
	const lines = content.trim().split(/\r?\n/)
	if (lines.length === 0) {
		return false
	}

	const hasSharedPlaceholderLine =
		lines[0].trim().toLowerCase() ===
		HISTORY_CONTENT_PLACEMENT_PLACEHOLDER.toLowerCase()
	const contentLines = hasSharedPlaceholderLine ? lines.slice(1) : lines
	const headerIndexes = contentLines.reduce<number[]>((indexes, line, index) => {
		if (EDIT_HISTORY_HEADER_REGEX.test(line)) {
			indexes.push(index)
		}
		return indexes
	}, [])

	if (headerIndexes.length === 0) {
		return false
	}

	let sawOldText = false
	let sawNewText = false

	for (let i = 0; i < headerIndexes.length; i++) {
		const headerIndex = headerIndexes[i]
		const headerLine = contentLines[headerIndex]
		if (/^\s*(search|oldText|oldtxt|otxt)\b/i.test(headerLine)) {
			sawOldText = true
		}
		if (/^\s*(replace|newText|newtxt|ntxt)\b/i.test(headerLine)) {
			sawNewText = true
		}

		const nextHeaderIndex =
			i + 1 < headerIndexes.length ? headerIndexes[i + 1] : contentLines.length
		const body = contentLines.slice(headerIndex + 1, nextHeaderIndex).join("\n").trim()
		if (hasSharedPlaceholderLine) {
			if (body.length > 0) {
				return false
			}
		} else if (body !== HISTORY_CONTENT_PLACEMENT_PLACEHOLDER) {
			return false
		}
	}

	return sawOldText && sawNewText
}

export interface EditResultBlockSummary {
	index: number
	oldText?: string
	newText?: string
	startLine?: number
	endLine?: number
	status?: "applied" | "failed"
	error?: string
	oldTextPreview?: string
}

function getDisplayedLineCount(content: string): number {
	if (content.length === 0) {
		return 0
	}

	const rawLines = content.split(/\r?\n/)
	return content.endsWith("\n") || content.endsWith("\r\n")
		? Math.max(0, rawLines.length - 1)
		: rawLines.length
}

function formatLineRangeLabel(startLine?: number, endLine?: number): string {
	if (startLine === undefined) {
		return "range unknown"
	}
	if (endLine === undefined || endLine === startLine) {
		return `line ${startLine}`
	}
	return `lines ${startLine}-${endLine}`
}

function formatEditBlockContent(label: string, content: string, startLine?: number, endLine?: number): string[] {
	const parts = [`${label} (${formatLineRangeLabel(startLine, endLine)}):`]
	if (content.length === 0) {
		parts.push("(empty)")
		return parts
	}

	if (startLine !== undefined) {
		parts.push(addLineNumbers(content, startLine).trimEnd())
	} else {
		parts.push(content.trimEnd())
	}

	return parts
}

export function buildAppliedEditBlocksFromContents(
	previousContent: string,
	nextContent: string,
): EditResultBlockSummary[] {
	if (previousContent === nextContent) {
		return []
	}

	const changes = diff.diffLines(previousContent, nextContent)
	const blocks: EditResultBlockSummary[] = []
	let previousLine = 1
	let nextLine = 1
	let index = 1

	for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
		const change = changes[changeIndex]

		if (!change.added && !change.removed) {
			const unchangedLineCount = getDisplayedLineCount(change.value)
			previousLine += unchangedLineCount
			nextLine += unchangedLineCount
			continue
		}

		const previousStartLine = previousLine
		const nextStartLine = nextLine
		let oldText = ""
		let newText = ""
		let oldLineCount = 0
		let newLineCount = 0

		while (changeIndex < changes.length) {
			const part = changes[changeIndex]
			if (!part.added && !part.removed) {
				break
			}

			const partLineCount = getDisplayedLineCount(part.value)
			if (part.removed) {
				oldText += part.value
				oldLineCount += partLineCount
				previousLine += partLineCount
			} else if (part.added) {
				newText += part.value
				newLineCount += partLineCount
				nextLine += partLineCount
			}

			changeIndex++
		}

		changeIndex--

		const startLine = oldLineCount > 0 ? previousStartLine : nextStartLine
		const endLine = oldLineCount > 0 ? previousStartLine + oldLineCount - 1 : startLine

		blocks.push({
			index: index++,
			status: "applied",
			startLine,
			endLine,
			oldText,
			newText,
		})
	}

	return blocks
}

export function formatNativeEditResult(
	path: string,
	blocks: EditResultBlockSummary[],
	options?: {
		editCount?: number
		problems?: string
		syntax?: EditHistorySyntax
	},
): string {
	const sections: string[] = [`File: ${path}`]

	if (options?.editCount !== undefined) {
		sections.push(`Edit Count: ${options.editCount}`)
	}

	for (const block of blocks) {
		const status = block.status ?? "applied"
		sections.push(
			status === "failed"
				? `Index="${block.index}" (failed):`
				: `Index="${block.index}":`,
		)

		if (status === "failed") {
			sections.push(`Error: ${block.error || "Unknown error"}`)
			if (block.oldTextPreview) {
				sections.push(`Previous content preview:\n${block.oldTextPreview}`)
			}
			continue
		}

		const oldEndLine = block.endLine ?? block.startLine
		const newLineCount = getDisplayedLineCount(block.newText ?? "")
		const newStartLine = block.startLine
		const newEndLine =
			newStartLine !== undefined && newLineCount > 0
				? newStartLine + newLineCount - 1
				: newStartLine

		sections.push(
			...formatEditBlockContent(
				"Previous content",
				block.oldText ?? "",
				block.startLine,
				oldEndLine,
			),
		)
		sections.push(
			...formatEditBlockContent(
				"New content",
				block.newText ?? "",
				newStartLine,
				newEndLine,
			),
		)
	}

	if (options?.problems) {
		sections.push(options.problems.trim())
	}

	sections.push("EOF")

	return sections.join("\n")
}

export const formatResponse = {
	// kade_change start
	duplicateFileReadNotice: () =>
		`[[NOTE] This file read has been removed to save space in the context window. Refer to the latest file read for the most up to date version of this file.]`,

	contextTruncationNotice: () =>
		`[NOTE] Some previous conversation history has been removed to manage the context window. The initial request and the most recent exchanges have been retained for continuity.`,

	condense: () =>
		`The conversation has been condensed to save space. This summary covers the key points of our discussion so far.\n<explicit_instructions type="condense_response">Please respond by briefly asking the user what they'd like to focus on next. You can reference the summary provided, but keep your response concise and avoid making assumptions about continuing work unless the user directs you to.</explicit_instructions>`,
	// kade_change end
	toolDenied: (protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "denied",
				message: "The user denied this operation.",
			})
		}
		return `The user denied this operation.`
	},

	toolDeniedWithFeedback: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "denied",
				message: "The user denied this operation and provided the following feedback",
				feedback: feedback,
			})
		}
		if ((protocol as string) === "unified" || (protocol as string) === "markdown") {
			return `The user denied this operation and provided the following feedback:\n\n${feedback}`
		}
		return `The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`
	},

	toolApprovedWithFeedback: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "approved",
				message: "The user approved this operation and provided the following context",
				feedback: feedback,
			})
		}
		if ((protocol as string) === "unified" || (protocol as string) === "markdown") {
			return `The user approved this operation and provided the following context:\n\n${feedback}`
		}
		return `The user approved this operation and provided the following context:\n<feedback>\n${feedback}\n</feedback>`
	},

	toolError: (error?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "error",
				message: "The tool execution failed",
				error: error,
			})
		}
		return `The tool execution failed with the following error:\n${error}`
	},

	rooIgnoreError: (path: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "error",
				type: "access_denied",
				message: "Access blocked by .kadeignore",
				path: path,
				suggestion: "Try to continue without this file, or ask the user to update the .kadeignore file",
			})
		}
		return `Access to ${path} is blocked by the .kadeignore file settings. You must try to continue in the task without using this file, or ask the user to update the .kadeignore file.`
	},

	noToolsUsed: (protocol?: ToolProtocol) => {
		const instructions = getToolInstructionsReminder(protocol)

		// kade_change start: Less aggressive about forcing task completion
		return `[NOTE] You did not use a tool in your previous response.

${instructions}

# What to do now

- If you just completed work and the user seems satisfied, inform them conversationally.
- If you need information from the user, use ask_followup_question.
- If there's more work to do, use the appropriate tool.
- If you were just having a conversation or answering a question, that's fine - not every response needs a tool.

(This is an automated message.)`
		// kade_change end
	},


	tooManyMistakes: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "guidance",
				message: "You seem to be having trouble proceeding",
				feedback: feedback,
			})
		}
		if ((protocol as string) === "unified") {
			return `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n\n${feedback}`
		}
		return `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n${feedback}\n</feedback>`
	},

	missingToolParameterError: (paramName: string, protocol?: ToolProtocol) => {
		const instructions = getToolInstructionsReminder(protocol)

		return `Missing value for required parameter '${paramName}'. Please retry with complete response.\n\n${instructions}`
	},

	invalidMcpToolArgumentError: (serverName: string, toolName: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "error",
				type: "invalid_argument",
				message: "Invalid JSON argument",
				server: serverName,
				tool: toolName,
				suggestion: "Please retry with a properly formatted JSON argument",
			})
		}
		return `Invalid JSON argument used with ${serverName} for ${toolName}. Please retry with a properly formatted JSON argument.`
	},

	unknownMcpToolError: (serverName: string, toolName: string, availableTools: string[], protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "error",
				type: "unknown_tool",
				message: "Tool does not exist on server",
				server: serverName,
				tool: toolName,
				available_tools: availableTools.length > 0 ? availableTools : [],
				suggestion: "Please use one of the available tools or check if the server is properly configured",
			})
		}
		const toolsList = availableTools.length > 0 ? availableTools.join(", ") : "No tools available"
		return `Tool '${toolName}' does not exist on server '${serverName}'.\n\nAvailable tools on this server: ${toolsList}\n\nPlease use one of the available tools or check if the server is properly configured.`
	},

	unknownMcpServerError: (serverName: string, availableServers: string[], protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.UNIFIED)) {
			return JSON.stringify({
				status: "error",
				type: "unknown_server",
				message: "Server is not configured",
				server: serverName,
				available_servers: availableServers.length > 0 ? availableServers : [],
			})
		}
		const serversList = availableServers.length > 0 ? availableServers.join(", ") : "No servers available"
		return `Server '${serverName}' is not configured. Available servers: ${serversList}`
	},

	toolResult: (
		text: string,
		images?: string[],
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		const systemText = text
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text: systemText }
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return systemText
		}
	},

	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	formatFilesList: (
		absolutePath: string,
		files: string[],
		didHitLimit: boolean,
		rooIgnoreController: RooIgnoreController | undefined,
		showRooIgnoredFiles: boolean,
		rooProtectedController?: RooProtectedController,
		fileLines?: Map<string, number>,
		directoryMetadata?: Map<string, { files: number, folders: number }>,
		isCompact: boolean = false,
		displayStyle: "flat" | "tree" = "flat",
	): string => {
		const sorted = files
			.map((file) => {
				const relativePath = path.relative(absolutePath, file).split(path.sep).join("/")
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			.sort((a, b) => {
				// Prioritize folders
				const aIsDir = a.endsWith("/")
				const bIsDir = b.endsWith("/")
				if (aIsDir && !bIsDir) return -1
				if (!aIsDir && bIsDir) return 1
				return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
			})

		if (files.length === 0) {
			return "No files found."
		}

		const isIgnoredPath = (file: string) => {
			const absoluteFilePath = path.resolve(absolutePath, file)
			return rooIgnoreController ? !rooIgnoreController.validateAccess(absoluteFilePath) : false
		}

		const formatLine = (file: string, isFolder: boolean, useBaseName = false) => {
			const absoluteFilePath = path.resolve(absolutePath, file)
			const isIgnored = isIgnoredPath(file)
			const normalizedFile = isFolder && file.endsWith("/") ? file.slice(0, -1) : file
			const displayName = useBaseName
				? (isFolder ? `${path.basename(normalizedFile)}/` : path.basename(normalizedFile))
				: file

			let meta = ""
			if (isIgnored) {
				meta = ` ${LOCK_TEXT_SYMBOL}`
			} else if (rooProtectedController?.isWriteProtected(absoluteFilePath)) {
				meta = " 🛡️"
			} else if (isFolder) {
				const dm = directoryMetadata?.get(normalizedFile)
				if (dm) {
					const fileCount = dm.files
					meta = ` (${fileCount >= 1000 ? "1000+" : fileCount} files)`
				}
			} else {
				const lines = fileLines?.get(absoluteFilePath)
				if (lines !== undefined) meta = `|L${lines}`
			}

			return `${displayName}${meta}`
		}

		const visibleEntries = sorted.filter((file) => {
			const isIgnored = isIgnoredPath(file)
			return !isIgnored || showRooIgnoredFiles
		})

		if (visibleEntries.length === 0) {
			return "No files found."
		}

		if (displayStyle === "tree") {
			type TreeNode = {
				name: string
				relativePath: string
				isFolder: boolean
				children: Map<string, TreeNode>
			}

			const root = new Map<string, TreeNode>()
			const visibleFolderCount = visibleEntries.filter((entry) => entry.endsWith("/")).length

			for (const entry of visibleEntries) {
				const normalizedEntry = entry.endsWith("/") ? entry.slice(0, -1) : entry
				const parts = normalizedEntry.split("/").filter(Boolean)
				let currentLevel = root
				let currentPath = ""

				for (const [index, part] of parts.entries()) {
					const isFolder = index < parts.length - 1 || entry.endsWith("/")
					currentPath = currentPath ? `${currentPath}/${part}` : part
					const nodePath = isFolder ? `${currentPath}/` : currentPath

					if (!currentLevel.has(part)) {
						currentLevel.set(part, {
							name: part,
							relativePath: nodePath,
							isFolder,
							children: new Map<string, TreeNode>(),
						})
					}

					const node = currentLevel.get(part)!
					if (isFolder) {
						node.isFolder = true
						node.relativePath = `${currentPath}/`
					}
					currentLevel = node.children
				}
			}

			const sortNodes = (nodes: Map<string, TreeNode>) =>
				Array.from(nodes.values()).sort((a, b) => {
					if (a.isFolder !== b.isFolder) {
						return a.isFolder ? -1 : 1
					}
					return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
				})

			const renderNodes = (nodes: Map<string, TreeNode>, prefix = ""): string[] =>
				sortNodes(nodes).flatMap((node, index, sortedNodes) => {
					const isLast = index === sortedNodes.length - 1
					const connector = isLast ? "`-- " : "|-- "
					const childPrefix = `${prefix}${isLast ? "    " : "|   "}`
					const line = `${prefix}${connector}${formatLine(node.relativePath, node.isFolder, true)}`

					if (node.children.size === 0) {
						return [line]
					}

					return [line, ...renderNodes(node.children, childPrefix)]
				})

			let output = `Total files: ${files.length}${didHitLimit ? "+" : ""}, Total folders: ${visibleFolderCount}\n`
			output += `(file_name|L = line count)\n\n`
			output += ".\n"
			output += renderNodes(root).join("\n")

			if (didHitLimit) {
				output += `\n\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
			}

			return output.trim()
		}

		// Categories
		const folders: string[] = []
		const commonProjectFiles: string[] = []
		const configFiles: string[] = []
		const textFiles: string[] = []
		const imageFiles: string[] = []
		const otherFiles: string[] = []
		const hiddenFiles: string[] = []

		const languageBuckets: Record<string, string[]> = {
			"TypeScript Files": [],
			"JavaScript Files": [],
			"Python Files": [],
			"Go Files": [],
			"Rust Files": [],
			"Java Files": [],
			"C/C++ Files": [],
			"C# Files": [],
			"PHP Files": [],
			"Ruby Files": [],
			"Swift Files": [],
			"Kotlin Files": [],
			"Dart Files": [],
			"Scala Files": [],
			"Elixir Files": [],
			"Haskell Files": [],
			"Lua Files": [],
			"R Files": [],
			"Vue Files": [],
			"Svelte Files": [],
			"Shell Files": [],
			"SQL Files": [],
		}

		// Image extensions
		const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff"])
		const languageByExt: Record<string, keyof typeof languageBuckets> = {
			// TypeScript
			".ts": "TypeScript Files",
			".tsx": "TypeScript Files",
			".mts": "TypeScript Files",
			".cts": "TypeScript Files",
			// JavaScript
			".js": "JavaScript Files",
			".jsx": "JavaScript Files",
			".mjs": "JavaScript Files",
			".cjs": "JavaScript Files",
			// Python
			".py": "Python Files",
			".ipynb": "Python Files",
			// Go
			".go": "Go Files",
			// Rust
			".rs": "Rust Files",
			// Java
			".java": "Java Files",
			// C/C++
			".c": "C/C++ Files",
			".cc": "C/C++ Files",
			".cpp": "C/C++ Files",
			".cxx": "C/C++ Files",
			".h": "C/C++ Files",
			".hpp": "C/C++ Files",
			".hh": "C/C++ Files",
			".hxx": "C/C++ Files",
			// C#
			".cs": "C# Files",
			// PHP
			".php": "PHP Files",
			// Ruby
			".rb": "Ruby Files",
			".rake": "Ruby Files",
			// Swift
			".swift": "Swift Files",
			// Kotlin
			".kt": "Kotlin Files",
			".kts": "Kotlin Files",
			// Dart
			".dart": "Dart Files",
			// Scala
			".scala": "Scala Files",
			// Elixir
			".ex": "Elixir Files",
			".exs": "Elixir Files",
			// Haskell
			".hs": "Haskell Files",
			".lhs": "Haskell Files",
			// Lua
			".lua": "Lua Files",
			// R
			".r": "R Files",
			".rmd": "R Files",
			// Vue / Svelte
			".vue": "Vue Files",
			".svelte": "Svelte Files",
			// Shell
			".sh": "Shell Files",
			".bash": "Shell Files",
			".zsh": "Shell Files",
			".fish": "Shell Files",
			// SQL
			".sql": "SQL Files",
		}
		// Text extensions (simplified check for common text files)
		const textExts = new Set([
			".txt", ".md", ".json", ".css", ".html",
			".xml", ".yaml", ".yml", ".bat", ".pl", ".ini", ".conf", ".env",
			".log", ".csv", ".toml", ".lock"
		])
		// Text files without reliable extensions
		const textFileNames = new Set([
			"dockerfile", "makefile", "readme", "readme.md", "changelog", "license",
		])
		// Common project files that should be surfaced prominently
		const commonProjectFileNames = new Set([
			"package.json",
			"package-lock.json",
			"pnpm-lock.yaml",
			"yarn.lock",
			"bun.lockb",
			"bun.lock",
			"npm-shrinkwrap.json",
			"tsconfig.json",
			"jsconfig.json",
			"composer.json",
			"cargo.toml",
			"go.mod",
			"go.sum",
			"pyproject.toml",
			"requirements.txt",
			"pipfile",
			"pipfile.lock",
			"gemfile",
			"gemfile.lock",
			"mix.exs",
			"mix.lock",
			"dockerfile",
			"makefile",
			"readme",
			"readme.md",
			"changelog",
			"license",
		])
		// Config files should have their own bucket
		const configExts = new Set([
			".toml", ".yaml", ".yml", ".ini", ".conf", ".cfg", ".config", ".env", ".properties",
		])
		const commonConfigFileNames = new Set([
			".editorconfig",
			".gitignore",
			".gitattributes",
			".prettierrc",
			".prettierrc.json",
			".prettierrc.js",
			".prettierrc.cjs",
			".prettierrc.yaml",
			".eslintrc",
			".eslintrc.json",
			".eslintrc.js",
			".eslintrc.cjs",
			".npmrc",
			".nvmrc",
			".dockerignore",
			"vite.config.ts",
			"vite.config.js",
			"webpack.config.js",
			"webpack.config.ts",
			"rollup.config.js",
			"rollup.config.ts",
			"postcss.config.js",
			"tailwind.config.js",
			"tailwind.config.ts",
			"eslint.config.js",
			"eslint.config.ts",
			"jest.config.js",
			"jest.config.ts",
			"vitest.config.ts",
			"vitest.config.js",
			"babel.config.js",
			"babel.config.cjs",
		])

		const sortByExtensionThenName = (arr: string[]) =>
			arr.sort((a, b) => {
				const extA = path.extname(a).toLowerCase()
				const extB = path.extname(b).toLowerCase()
				if (extA !== extB) return extA.localeCompare(extB, undefined, { sensitivity: "base" })

				const nameA = path.basename(a).toLowerCase()
				const nameB = path.basename(b).toLowerCase()
				if (nameA !== nameB) return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" })

				return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
			})

		for (const file of sorted) {
			const absoluteFilePath = path.resolve(absolutePath, file)
			const isIgnored = isIgnoredPath(file)
			if (isIgnored && !showRooIgnoredFiles) continue

			const name = path.basename(file)
			const lowerName = name.toLowerCase()
			const ext = path.extname(file).toLowerCase()

			if (file.endsWith("/")) {
				folders.push(file)
			} else if (name.startsWith(".")) {
				hiddenFiles.push(file)
			} else if (commonProjectFileNames.has(lowerName)) {
				commonProjectFiles.push(file)
			} else if (configExts.has(ext) || commonConfigFileNames.has(lowerName)) {
				configFiles.push(file)
			} else if (lowerName.endsWith(".d.ts")) {
				languageBuckets["TypeScript Files"].push(file)
			} else if (languageByExt[ext]) {
				languageBuckets[languageByExt[ext]].push(file)
			} else if (imageExts.has(ext)) {
				imageFiles.push(file)
			} else if (textExts.has(ext) || textFileNames.has(lowerName)) {
				textFiles.push(file)
			} else {
				otherFiles.push(file)
			}
		}

		for (const key of Object.keys(languageBuckets)) {
			sortByExtensionThenName(languageBuckets[key])
		}
		sortByExtensionThenName(commonProjectFiles)
		sortByExtensionThenName(configFiles)
		sortByExtensionThenName(textFiles)
		sortByExtensionThenName(imageFiles)
		sortByExtensionThenName(otherFiles)
		sortByExtensionThenName(hiddenFiles)

		let output = `Total files: ${files.length}${didHitLimit ? "+" : ""}, Total folders: ${folders.length}\n`
		output += `(file_name|L = line count)\n\n`

		// Folders & Hidden (User example put folders near top, slightly ambiguous, but let's do Folders -> Hidden -> Types)
		// Actually, user example had: ".kilocode" (hidden folder) at top under "Hidden files ... Folders".
		// Let's grouping Logic:
		// 1. Folders
		// 2. Python
		// 3. Text
		// 4. Images
		// 5. Other
		// 6. Hidden

		const allLines: string[] = []

		if (folders.length > 0) {
			folders.forEach(f => allLines.push(formatLine(f, true)))
		}

		if (commonProjectFiles.length > 0) {
			commonProjectFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		if (configFiles.length > 0) {
			configFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		const languageSectionOrder: Array<{ key: keyof typeof languageBuckets, icon: string }> = [
			{ key: "TypeScript Files", icon: "🔷" },
			{ key: "JavaScript Files", icon: "🟨" },
			{ key: "Python Files", icon: "🐍" },
			{ key: "Go Files", icon: "🐹" },
			{ key: "Rust Files", icon: "🦀" },
			{ key: "Java Files", icon: "☕" },
			{ key: "C/C++ Files", icon: "🧩" },
			{ key: "C# Files", icon: "🎯" },
			{ key: "PHP Files", icon: "🐘" },
			{ key: "Ruby Files", icon: "💎" },
			{ key: "Swift Files", icon: "🕊" },
			{ key: "Kotlin Files", icon: "🧪" },
			{ key: "Dart Files", icon: "🎯" },
			{ key: "Scala Files", icon: "🔺" },
			{ key: "Elixir Files", icon: "🧪" },
			{ key: "Haskell Files", icon: "λ" },
			{ key: "Lua Files", icon: "🌙" },
			{ key: "R Files", icon: "📊" },
			{ key: "Vue Files", icon: "🟩" },
			{ key: "Svelte Files", icon: "🟧" },
			{ key: "Shell Files", icon: "💻" },
			{ key: "SQL Files", icon: "🗄" },
		]
		for (const section of languageSectionOrder) {
			const filesForLang = languageBuckets[section.key]
			if (filesForLang.length > 0) {
				filesForLang.forEach(f => allLines.push(formatLine(f, false)))
			}
		}

		if (textFiles.length > 0) {
			textFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		if (imageFiles.length > 0) {
			const imgByType: Record<string, string[]> = {}
			imageFiles.forEach(f => {
				const ext = path.extname(f).toUpperCase().slice(1) || "OTHER"
				if (!imgByType[ext]) imgByType[ext] = []
				imgByType[ext].push(f)
			})
			for (const type of Object.keys(imgByType).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))) {
				const fileList = sortByExtensionThenName(imgByType[type])
				fileList.forEach(f => allLines.push(formatLine(f, false)))
			}
		}

		if (otherFiles.length > 0) {
			otherFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		if (hiddenFiles.length > 0) {
			hiddenFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		output += allLines.join("\n") + "\n"

		if (didHitLimit) {
			output += `\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
		}

		return output.trim()
	},

	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		// strings cannot be undefined or diff throws exception
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "", undefined, undefined, {
			context: 3,
		})
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	},
}

// to avoid circular dependency
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
			// data:image/png;base64,base64string
			const [rest, base64] = dataUrl.split(",")
			const mimeType = rest.split(":")[1].split(";")[0]
			return {
				type: "image",
				source: { type: "base64", media_type: mimeType, data: base64 },
			} as Anthropic.ImageBlockParam
		})
		: []
}

const toolUseInstructionsReminder = `

`

const toolUseInstructionsReminderNative = `

`

const toolUseInstructionsReminderUnified = ""

/**
 * Gets the appropriate tool use instructions reminder based on the protocol.
 *
 * @param protocol - Optional tool protocol, defaults to XML if not provided
 * @returns The tool use instructions reminder text
 */
function getToolInstructionsReminder(protocol?: ToolProtocol): string {
	const effectiveProtocol = protocol ?? TOOL_PROTOCOL.UNIFIED
	if (effectiveProtocol === "unified") {
		return toolUseInstructionsReminderUnified
	}
	return isNativeProtocol(effectiveProtocol) ? toolUseInstructionsReminderNative : toolUseInstructionsReminder
}
