import { describe, expect, it } from "vitest"

import {
	formatEditHistoryPreview,
	formatWriteHistoryPlaceholderBody,
} from "../../../core/prompts/responses"
import { formatContentBlockToMarkdown } from "../export-markdown"

describe("formatContentBlockToMarkdown", () => {
	it("compacts grouped native content tool calls in markdown exports", () => {
		const markdown = formatContentBlockToMarkdown({
			type: "tool_use",
			id: "call_content_1",
			name: "content",
			input: {
				calls: [
					{
						name: "write",
						arguments: {
							path: "sample.txt",
							content: "This is a sample text file.\n\nHello, world!\n",
						},
					},
				],
			},
		} as any)

		expect(markdown).toContain("[Tool Use: content]")
		expect(markdown).toContain('"content": [')
		expect(markdown).toContain('"path": "sample.txt"')
		expect(markdown).toContain(`"write": "${formatWriteHistoryPlaceholderBody("This is a sample text file.\n\nHello, world!\n")}"`)
		expect(markdown).toContain(formatWriteHistoryPlaceholderBody("This is a sample text file.\n\nHello, world!\n"))
		expect(markdown).not.toContain("This is a sample text file.")
		expect(markdown).not.toContain("Hello, world!")
	})

	it("compacts grouped native flat edit tool calls in markdown exports", () => {
		const markdown = formatContentBlockToMarkdown({
			type: "tool_use",
			id: "call_content_2",
			name: "content",
			input: {
				calls: [
					{
						name: "edit",
						arguments: {
							path: "sample.txt",
							lineRange: "1-4",
							oldText:
								"This is a sample text file.\n\nIt was created as an example.\nHave a great day!\n",
							newText:
								"This is a sample text file.\n\nIt has now been edited as an example.\nHope you're having an awesome day!\n",
						},
					},
				],
			},
		} as any)

		expect(markdown).toContain("[Tool Use: content]")
		expect(markdown).toContain('"content": [')
		expect(markdown).toContain(`"oldText": "${formatEditHistoryPreview("This is a sample text file.\n\nIt was created as an example.\nHave a great day!\n")}"`)
		expect(markdown).toContain(`"newText": "${formatEditHistoryPreview("This is a sample text file.\n\nIt has now been edited as an example.\nHope you're having an awesome day!\n")}"`)
		expect(markdown).not.toContain("It was created as an example.")
		expect(markdown).not.toContain("Hope you're having an awesome day!")
	})

	it("preserves execute command strings in markdown exports while redacting write bodies", () => {
		const markdown = formatContentBlockToMarkdown({
			type: "tool_use",
			id: "call_execute_1",
			name: "execute",
			input: {
				commands: [
					"read src/app.ts:H20",
					"write sample.txt\nThis is a sample text file.\nIt contains multiple lines.",
				],
			},
		} as any)

		expect(markdown).toContain("[Tool Use: execute]")
		expect(markdown).toContain('"commands": [')
		expect(markdown).toContain('"read:src/app.ts:H20"')
		expect(markdown).toContain(`write:sample.txt|${formatWriteHistoryPlaceholderBody("This is a sample text file.\nIt contains multiple lines.")}`)
		expect(markdown).not.toContain("This is a sample text file.")
		expect(markdown).not.toContain('"commands": []')
	})

	it("prefers preserved historyInput over normalized nativeArgs in markdown exports", () => {
		const markdown = formatContentBlockToMarkdown({
			type: "tool_use",
			id: "call_execute_2",
			name: "execute",
			input: {
				calls: [],
				missingParamName: "commands",
			},
			historyInput: {
				commands: ["list ."],
			},
		} as any)

		expect(markdown).toContain("[Tool Use: execute]")
		expect(markdown).toContain('"commands": [')
		expect(markdown).toContain('"list:."')
		expect(markdown).not.toContain('"commands": []')
	})

	it("preserves grouped tool call strings in markdown exports", () => {
		const markdown = formatContentBlockToMarkdown({
			type: "tool_use",
			id: "call_tool_1",
			name: "tool",
			input: {
				calls: [],
				missingParamName: "calls",
			},
			historyInput: {
				calls: ["read:src/package.json:1-40", "grep:src:authservice"],
			},
		} as any)

		expect(markdown).toContain("[Tool Use: tool]")
		expect(markdown).toContain('"calls": [')
		expect(markdown).toContain('"read:src/package.json:L1-40"')
		expect(markdown).toContain('"grep:src:authservice"')
		expect(markdown).not.toContain('"calls": []')
	})
})
