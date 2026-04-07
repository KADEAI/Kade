import { Anthropic } from "@anthropic-ai/sdk"
import os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"

// Extended content block types to support new Anthropic API features
interface ReasoningBlock {
	type: "reasoning"
	text: string
}

type ExtendedContentBlock = Anthropic.Messages.ContentBlockParam | ReasoningBlock

export async function downloadTask(dateTs: number, conversationHistory: Anthropic.MessageParam[], systemPrompt?: string) {
	// File name
	const date = new Date(dateTs)
	const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase()
	const day = date.getDate()
	const year = date.getFullYear()
	let hours = date.getHours()
	const minutes = date.getMinutes().toString().padStart(2, "0")
	const seconds = date.getSeconds().toString().padStart(2, "0")
	const ampm = hours >= 12 ? "pm" : "am"
	hours = hours % 12
	hours = hours ? hours : 12 // the hour '0' should be '12'
	const fileName = `kilo_code_task_${month}-${day}-${year}_${hours}-${minutes}-${seconds}-${ampm}.md` // kade_change

	// Generate markdown
	let markdownContent = conversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block as ExtendedContentBlock)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")

	if (systemPrompt) {
		markdownContent = `${systemPrompt}${markdownContent}`
	}

	// Prompt user for save location
	const saveUri = await vscode.window.showSaveDialog({
		filters: { Markdown: ["md"] },
		defaultUri: vscode.Uri.file(path.join(os.homedir(), "Downloads", fileName)),
	})

	if (saveUri) {
		// Write content to the selected location
		await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdownContent))
		vscode.window.showTextDocument(saveUri, { preview: true })
	}
}

export function formatContentBlockToMarkdown(block: ExtendedContentBlock): string {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return `[Image]`
		case "tool_use": {
			let input: string
			const rawInput =
				(block as any).historyInput &&
				typeof (block as any).historyInput === "object" &&
				(block as any).historyInput !== null
					? ((block as any).historyInput as Record<string, any>)
					: block.input
			if (typeof rawInput === "object" && rawInput !== null) {
				const compactedInput = NativeToolCallParser.compactToolInputForHistory(
					block.name,
					rawInput as Record<string, any>,
				)
				input = JSON.stringify(compactedInput, null, 2)
			} else {
				input = String(rawInput)
			}
			return `[Tool Use: ${block.name}]\n${input}`
		}
		case "tool_result": {
			// For now we're not doing tool name lookup since we don't use tools anymore
			// const toolName = findToolName(block.tool_use_id, messages)
			const toolName = "Tool"
			if (typeof block.content === "string") {
				return `[${toolName}${block.is_error ? " (Error)" : ""}]\n${block.content}`
			} else if (Array.isArray(block.content)) {
				return `[${toolName}${block.is_error ? " (Error)" : ""}]\n${block.content
					.map((contentBlock) => formatContentBlockToMarkdown(contentBlock))
					.join("\n")}`
			} else {
				return `[${toolName}${block.is_error ? " (Error)" : ""}]`
			}
		}
		case "reasoning":
			return `[Reasoning]\n${block.text}`
		default:
			return `[Unexpected content type: ${block.type}]`
	}
}

export function findToolName(toolCallId: string, messages: Anthropic.MessageParam[]): string {
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "tool_use" && block.id === toolCallId) {
					return block.name
				}
			}
		}
	}
	return "Unknown Tool"
}
