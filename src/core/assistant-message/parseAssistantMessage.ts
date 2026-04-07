import { type ToolName, toolNames } from "@roo-code/types"
import { TextContent, ToolUse, McpToolUse, ToolParamName, toolParamNames } from "../../shared/tools"
import { reparseVulnerableParams } from "./XmlToolParser"

export type AssistantMessageContent = TextContent | ToolUse | McpToolUse

export function parseAssistantMessage(assistantMessage: string): AssistantMessageContent[] {
	let contentBlocks: AssistantMessageContent[] = []
	let currentTextContent: TextContent | undefined = undefined
	let currentTextContentStartIndex = 0
	let currentToolUse: ToolUse | undefined = undefined
	let currentToolUseStartIndex = 0
	let currentParamName: ToolParamName | undefined = undefined
	let currentParamValueStartIndex = 0
	for (let i = 0; i < assistantMessage.length; i++) {
		const accumulator = assistantMessage.slice(0, i + 1)

		// There should not be a param without a tool use.
		if (currentToolUse && currentParamName) {
			const currentParamValue = accumulator.slice(currentParamValueStartIndex)
			const paramClosingTag = `</${currentParamName}>`
			if (currentParamValue.endsWith(paramClosingTag)) {
				// End of param value.
				// Don't trim content parameters to preserve newlines, but strip first and last newline only
				let paramValue = currentParamValue.slice(0, -paramClosingTag.length)
				
				// Decode XML entities that models sometimes inject
				paramValue = paramValue
					.replace(/&amp;/g, "&")
					.replace(/&lt;/g, "<")
					.replace(/&gt;/g, ">")
					.replace(/&quot;/g, '"')
					.replace(/&apos;/g, "'")

				currentToolUse.params[currentParamName] =
					currentParamName === "content"
						? paramValue // Preserve exact content formatting for write/edit tools
						: paramValue.trim()
				currentParamName = undefined
				continue
			} else {
				// Partial param value is accumulating.
				continue
			}
		}

		// No currentParamName.

		if (currentToolUse) {
			const currentToolValue = accumulator.slice(currentToolUseStartIndex)
			const toolUseClosingTag = `</${currentToolUse.name}>`
			if (currentToolValue.endsWith(toolUseClosingTag)) {
				// End of a tool use.
				currentToolUse.partial = false
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined
				continue
			} else {
				const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`)
				for (const paramOpeningTag of possibleParamOpeningTags) {
					if (accumulator.endsWith(paramOpeningTag)) {
						// Start of a new parameter.
						currentParamName = paramOpeningTag.slice(1, -1) as ToolParamName
						currentParamValueStartIndex = accumulator.length
						break
					}
				}

				// There's no current param, and not starting a new param.

				// Special case for write where file contents could
				// contain the closing tag, in which case the param would have
				// closed and we end up with the rest of the file contents here.
				// To work around this, we get the string between the starting
				// content tag and the LAST content tag.
				// Use shared re-parsing for content/code blocks
				const contentParamName: ToolParamName = "content"
				if ((currentToolUse.name === "write" || currentToolUse.name === "new_rule") && accumulator.endsWith(`</${contentParamName}>`)) {
					const toolContent = accumulator.slice(currentToolUseStartIndex)
					reparseVulnerableParams(currentToolUse.params, toolContent)
				}

				// Partial tool value is accumulating.
				continue
			}
		}

		// No currentToolUse.

		let didStartToolUse = false
		const possibleToolUseOpeningTags = toolNames.map((name) => `<${name}>`)

		for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
			if (accumulator.endsWith(toolUseOpeningTag)) {
				// Start of a new tool use.
				currentToolUse = {
					type: "tool_use",
					name: toolUseOpeningTag.slice(1, -1) as ToolName,
					params: {},
					partial: true,
				}

				currentToolUseStartIndex = accumulator.length

				// This also indicates the end of the current text content.
				if (currentTextContent) {
					currentTextContent.partial = false

					// Remove the partially accumulated tool use tag from the
					// end of text (<tool).
					currentTextContent.content = currentTextContent.content
						.slice(0, -toolUseOpeningTag.slice(0, -1).length)
						.trim()

					contentBlocks.push(currentTextContent)
					currentTextContent = undefined
				}

				didStartToolUse = true
				break
			}
		}

		if (!didStartToolUse) {
			// No tool use, so it must be text either at the beginning or
			// between tools.
			if (currentTextContent === undefined) {
				currentTextContentStartIndex = i
			}

			currentTextContent = {
				type: "text",
				content: accumulator.slice(currentTextContentStartIndex).trim(),
				partial: true,
			}
		}
	}

	if (currentToolUse) {
		// Stream did not complete tool call, add it as partial.
		if (currentParamName) {
			// Tool call has a parameter that was not completed.
			// Don't trim content parameters to preserve newlines, but strip first and last newline only
			const paramValue = assistantMessage.slice(currentParamValueStartIndex)
			currentToolUse.params[currentParamName] =
				currentParamName === "content" ? paramValue : paramValue.trim()
		}

		contentBlocks.push(currentToolUse)
	}

	// NOTE: It doesn't matter if check for currentToolUse or
	// currentTextContent, only one of them will be defined since only one can
	// be partial at a time.
	if (currentTextContent) {
		// Stream did not complete text content, add it as partial.
		contentBlocks.push(currentTextContent)
	}

	return contentBlocks
}
