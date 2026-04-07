import Anthropic from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence"

export function trimLeadingWhitespaceInContent(
	content: Anthropic.Messages.MessageParam["content"],
): Anthropic.Messages.MessageParam["content"] {
	if (typeof content === "string") {
		return content.replace(/^\s+/, "")
	}

	if (Array.isArray(content)) {
		return content.map((block, index) => {
			if (index === 0 && block.type === "text") {
				return { ...block, text: block.text.replace(/^\s+/, "") }
			}
			return block
		})
	}

	return content
}

export function mergeApiMessages(message1: ApiMessage, message2: Anthropic.Messages.MessageParam) {
	const content = new Array<Anthropic.ContentBlockParam>()
	if (typeof message1.content === "string") {
		content.push({ type: "text", text: message1.content })
	} else {
		content.push(...message1.content)
	}
	if (typeof message2.content === "string") {
		content.push({ type: "text", text: message2.content.replace(/^\s+/, "") })
	} else {
		content.push(...(trimLeadingWhitespaceInContent(message2.content) as Anthropic.ContentBlockParam[]))
	}
	return { ...message1, content }
}

export function addOrMergeUserContent(
	messages: Anthropic.ContentBlockParam[],
	newUserContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[],
) {
	const result = [...messages]
	// kade_change: We no longer merge user content into tool results. 
	// Environment details and user messages should always be at the top level of the content array
	// to ensure they are correctly filtered and managed by the history pruning systems.
	result.push(...newUserContent)
	return result
}

export function yieldPromise(ms: number = 0) {
	return new Promise<void>((resolve) => setTimeout(() => resolve(), ms))
}
