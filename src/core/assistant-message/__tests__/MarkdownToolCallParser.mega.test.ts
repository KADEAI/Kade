import { beforeEach, describe, expect, it } from "vitest"
import { MarkdownToolCallParser } from "../MarkdownToolCallParser"

// Helper: feed entire message at once and return all blocks
function parse(message: string) {
	const parser = new MarkdownToolCallParser()
	parser.processChunk(message)
	parser.finalizeContentBlocks()
	return parser.getContentBlocks()
}

function parseWithParser(parser: MarkdownToolCallParser, message: string) {
	parser.processChunk(message)
	parser.finalizeContentBlocks()
	return parser.getContentBlocks()
}

function tool(blocks: any[]) {
	return blocks.find((b) => b.type === "tool_use" || b.type === "mcp_tool_use") as any
}

function tools(blocks: any[]) {
	return blocks.filter((b) => b.type === "tool_use" || b.type === "mcp_tool_use") as any[]
}

function textContent(blocks: any[]) {
	return blocks.filter((b) => b.type === "text").map((b: any) => b.content).join("").trim()
}

describe("MarkdownToolCallParser — MEGA GAUNTLET", () => {
	let parser: MarkdownToolCallParser

	beforeEach(() => {
		parser = new MarkdownToolCallParser()
	})

	describe("JSON Structure Resilience", () => {
		it("parses valid JSON write call", () => {
			const msg = JSON.stringify({ write: ["test.ts", "hello world"] })
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("write")
			expect(t.params.path).toBe("test.ts")
			expect(t.params.content).toBe("hello world")
		})

		it("parses JSON with weird spacing and newlines", () => {
			const msg = `  { \n "ls" \n : \n [ \n "src" \n ] \n }  `
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("list")
			expect(t.params.path).toBe("src")
		})

		it("handles multiple tools in one JSON block", () => {
			const msg = `{ "read": ["a.ts"], "ls": ["src"] }`
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts.map(t => t.name)).toContain("read")
			expect(ts.map(t => t.name)).toContain("list")
		})

		it("recovers from invalid JSON tokens preceding a valid JSON", () => {
			const msg = `Wait, ignore this: { invalid } \n Now do this: { "ls": ["src"] }`
			const blocks = parse(msg)
			expect(tool(blocks).name).toBe("list")
			expect(textContent(blocks)).toContain("Wait, ignore this:")
			expect(textContent(blocks)).toContain("Now do this:")
		})
	})

	describe("Hybrid & Legacy Edits", () => {
		it("parses hybrid edits (path and range header)", () => {
			const msg = `{ "edit": ["app.ts", "10-12:\nold val\nNew:\nnew val"] }`
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.nativeArgs.path).toBe("app.ts")
			expect(t.nativeArgs.edits[0].oldText.trim()).toBe("old val")
			expect(t.nativeArgs.edits[0].newText.trim()).toBe("new val")
		})

		it("parses legacy triple-string edits", () => {
			const msg = `{ "edit": ["app.ts", "5", { "old": "X", "new": "Y" }] }`
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.nativeArgs.edits[0].start_line).toBe(5)
			expect(t.nativeArgs.edits[0].oldText).toBe("X")
			expect(t.nativeArgs.edits[0].newText).toBe("Y")
		})

		it("handles nested batch edits", () => {
			const msg = `{ "edit": [ ["a.ts", "1: \n old \n New: \n new"], ["b.ts", "2: \n o \n New: \n n"] ] }`
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].params.path).toBe("a.ts")
			expect(ts[1].params.path).toBe("b.ts")
		})
	})

	describe("Text Extraction", () => {
		it("preserves text before, between and after JSON blocks", () => {
			const msg = `Starting.\n{ "ls": ["."] }\nMiddle text.\n{ "ls": ["src"] }\nEnding.`
			const blocks = parse(msg)
			const text = textContent(blocks)
			expect(text).toContain("Starting.")
			expect(text).toContain("Middle text.")
			expect(text).toContain("Ending.")
			expect(tools(blocks)).toHaveLength(2)
		})

		it("strips markdown code fences around JSON if present", () => {
			const msg = "Check this:\n```json\n{ \"ls\": [\"src\"] }\n```"
			const blocks = parse(msg)
			expect(textContent(blocks)).toBe("Check this:")
			expect(tool(blocks).name).toBe("list")
		})
	})

	describe("MCP Integration", () => {
		it("parses fenced MCP tool calls", () => {
			const p = new MarkdownToolCallParser()
			p.setMcpToolNames([{ compositeName: "mcp-server_test-tool", serverName: "mcp-server", toolName: "test-tool" }])
			const msg = "```mcp-server_test-tool\n{ \"arg\": 123 }\n```"
			const { blocks } = p.processChunk(msg)
			p.finalizeContentBlocks()
			const m = blocks.find(b => b.type === "mcp_tool_use") as any
			expect(m).toBeDefined()
			expect(m.name).toBe("mcp-server_test-tool")
			expect(m.arguments).toEqual({ arg: 123 })
		})
	})

	describe("Streaming & Partials", () => {
		it("correctly identifies partial write tools", () => {
			const msg = `{ "write": ["file.txt", "streaming content`
			const parser = new MarkdownToolCallParser()
			const { blocks } = parser.processChunk(msg)
			const t = tool(blocks)
			expect(t.partial).toBe(true)
			expect(t.params.content).toContain("streaming content")
		})

		it("completes a tool after streaming the closing parts", () => {
			const parser = new MarkdownToolCallParser()
			parser.processChunk(`{ "ls": [`)
			expect(tool(parser.getContentBlocks())).toBeUndefined()
			parser.processChunk(`"src"] }`)
			const t = tool(parser.getContentBlocks())
			expect(t).toBeDefined()
			expect(t.partial).toBe(false)
		})
		
		it("handles split tokens during hybrid edit streaming", () => {
			const parser = new MarkdownToolCallParser()
			parser.processChunk(`{ "edit": ["a.ts", "10:\nold\nNe`)
			const t1 = tool(parser.getContentBlocks())
			expect(t1.partial).toBe(true)
			
			parser.processChunk(`w:\nnew"] }`)
			const t2 = tool(parser.getContentBlocks())
			expect(t2.partial).toBe(false)
			expect(t2.nativeArgs.edits[0].newText.trim()).toBe("new")
		})
	})

	describe("Extreme Resilience", () => {
		it("handles JSON with raw newlines in strings", () => {
			const msg = `{ "write": ["f.ts", "line1\nline2\nline3"] }`
			const blocks = parse(msg)
			expect(tool(blocks).params.content).toBe("line1\nline2\nline3")
		})

		it("fixes missing commas in arrays", () => {
			const msg = `{ "read": ["a.ts" "1-10"] }`
			const blocks = parse(msg)
			expect(tool(blocks).params.lineRange).toBe("1-10")
		})

		it("recovers from malformed JSON at the end of message", () => {
			const msg = `{ "write": ["a.ts", "oops...`
			const blocks = parse(msg)
			expect(textContent(blocks)).toBeDefined()
		})
	})

	describe("The Ultimate Stress Test & Edge Cases", () => {
		it("Insane Batching: multiple tools and formats in one message", () => {
			parser.setMcpToolNames([{ compositeName: "grep", serverName: "core", toolName: "grep" }])
			const msg = [
				"I will first list files.",
				'{ "ls": ["src"] }',
				"Now I will read one.",
				'{ "read": ["package.json"] }',
				"Wait, I need to search for something first.",
				'```grep',
				'["src", "apiVersion"]',
				'```',
				"Okay, now I will edit several files.",
				'{ "edit": [ "a.ts", "10:\nold\nNew:\nnew", "b.ts", "20:\nfoo\nNew:\nbar" ] }',
				"And finally run a command.",
				'{ "bash": [".", "npm test"] }',
				"Done."
			].join("\n")

			const blocks = parseWithParser(parser, msg)
			const ts = blocks.filter(b => b.type === "tool_use")
			const mcps = blocks.filter((b: any) => b.type === "mcp_tool_use")
			
			expect(ts).toHaveLength(5) // ls, read, edit x2 (batch split), bash
			expect(mcps).toHaveLength(1) // grep (mcp)
			expect(textContent(blocks)).toContain("I will first list files.")
			expect(textContent(blocks)).toContain("Done.")
		})

		it("The 'Ghost in the Machine': ignores tool-like JSON inside code content", () => {
			const msg = `{ "write": ["repo.json", "{ \\"ls\\": [\\"src\\"] }"] }`
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].name).toBe("write")
			expect(ts[0].params.content).toBe('{ "ls": ["src"] }')
		})

		it("Handles models leaking raw brackets or trash after JSON", () => {
			const msg = `{ "ls": ["."] } ] } \n. \`\`\` \n prose after`
			const blocks = parse(msg)
			expect(tools(blocks)).toHaveLength(1)
			expect(textContent(blocks)).toContain("prose after")
		})

		it("Complex Hybrid Edit: mixed formats in a single batch call", () => {
			const msg = JSON.stringify({
				edit: [
					"hybrid.ts", "10-12:\nold\nNew:\nnew",
					"legacy.ts", "5", { "old": "X", "new": "Y" }
				]
			})
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(3) 
			expect(ts[0].nativeArgs.path).toBe("hybrid.ts")
			expect(ts[1].nativeArgs.path).toBe("legacy.ts")
		})

		it("Resilience against 'hallucinated' closing tags inside text", () => {
			const msg = `Here is the tool:\n{ "ls": ["."] }\n /ls \n wait I wasn't done.`
			const blocks = parse(msg)
			expect(tools(blocks)).toHaveLength(1)
			expect(textContent(blocks)).toContain("wait I wasn't done.")
		})

		it("Streaming Gauntlet: Tiny chunks of complex nested JSON", () => {
			const msg = `{ "write": ["a.ts", ${JSON.stringify("line1\nline2\nline3")}] }`
			const parser = new MarkdownToolCallParser()
			let lastBlocks: any[] = []
			for (let i = 0; i < msg.length; i += 2) {
				lastBlocks = parser.processChunk(msg.slice(i, i + 2)).blocks
			}
			parser.finalizeContentBlocks()
			const finalBlocks = parser.getContentBlocks()
			expect(tool(finalBlocks).params.content).toBe("line1\nline2\nline3")
		})
	})
})
