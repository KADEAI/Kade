import Anthropic from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence"

export function mergeApiMessages(message1: ApiMessage, message2: Anthropic.Messages.MessageParam) {
	const content = new Array<Anthropic.ContentBlockParam>()
	if (typeof message1.content === "string") {
		content.push({ type: "text", text: message1.content })
	} else {
		content.push(...message1.content)
	}
	if (typeof message2.content === "string") {
		content.push({ type: "text", text: message2.content })
	} else {
		content.push(...message2.content)
	}
	return { ...message1, content }
}

export function addOrMergeUserContent(
	messages: Anthropic.ContentBlockParam[],
	newUserContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[],
) {
	const result = [...messages]
	// kilocode_change: We no longer merge user content into tool results. 
	// Environment details and user messages should always be at the top level of the content array
	// to ensure they are correctly filtered and managed by the history pruning systems.
	result.push(...newUserContent)
	return result
}

export function yieldPromise(ms: number = 0) {
	return new Promise<void>((resolve) => setTimeout(() => resolve(), ms))
}
