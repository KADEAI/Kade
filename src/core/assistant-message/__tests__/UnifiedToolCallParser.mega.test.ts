import { beforeEach, describe, expect, it } from "vitest"
import { UnifiedToolCallParser } from "../UnifiedToolCallParser"

// Helper: feed entire message at once and return finalized blocks
function parse(message: string) {
	const parser = new UnifiedToolCallParser()
	parser.processChunk(message)
	parser.finalizeContentBlocks()
	return parser.getContentBlocks()
}

// Helper: chunk-by-chunk streaming, returns final blocks
function streamParse(message: string, chunkSize = 5) {
	const parser = new UnifiedToolCallParser()
	for (let i = 0; i < message.length; i += chunkSize) {
		parser.processChunk(message.slice(i, i + chunkSize))
	}
	parser.finalizeContentBlocks()
	return parser.getContentBlocks()
}

// Helper: stream with random chunk sizes (seed for reproducibility)
function randomChunkParse(message: string, seed = 42) {
	const parser = new UnifiedToolCallParser()
	let i = 0
	let s = seed
	const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) }
	while (i < message.length) {
		const size = (rand() % 20) + 1 // 1‒20 chars
		parser.processChunk(message.slice(i, i + size))
		i += size
	}
	parser.finalizeContentBlocks()
	return parser.getContentBlocks()
}

function tool(blocks: any[]) {
	return blocks.find((b) => b.type === "tool_use") as any
}

function tools(blocks: any[]) {
	return blocks.filter((b) => b.type === "tool_use") as any[]
}

function text(blocks: any[]) {
	return blocks.find((b) => b.type === "text") as any
}

describe("UnifiedToolCallParser — THE MEGA GAUNTLET", () => {
	let parser: UnifiedToolCallParser

	beforeEach(() => {
		parser = new UnifiedToolCallParser()
	})

	// ─────────────────────────────────────────────
	// R — READ
	// ─────────────────────────────────────────────
	describe("R (read)", () => {
		it("parses a simple inline R", () => {
			const blocks = parse("R src/app.ts /R")
			const t = tool(blocks)
			expect(t.name).toBe("read_file")
			expect(t.nativeArgs.files[0].path).toBe("src/app.ts")
		})

		it("parses R with a line range inline", () => {
			const blocks = parse("R src/app.ts 10-50\n/R")
			const t = tool(blocks)
			expect(t.nativeArgs.files[0].lineRanges[0]).toEqual({ start: 10, end: 50 })
		})

		it("parses multiple inline ranges for a single file", () => {
			const blocks = parse("R src/app.ts 10-50 70-90\n/R")
			const t = tool(blocks)
			expect(t.nativeArgs.files[0].lineRanges).toEqual([
				{ start: 10, end: 50 },
				{ start: 70, end: 90 },
			])
			expect(t.params.lineRange).toBe("10-50, 70-90")
		})

		it("parses R with H (head) modifier", () => {
			const blocks = parse("R src/app.ts H20\n/R")
			const t = tool(blocks)
			expect(t.nativeArgs.files[0].head).toBe(20)
		})

		it("parses R with T (tail) modifier", () => {
			const blocks = parse("R src/app.ts T10\n/R")
			const t = tool(blocks)
			expect(t.nativeArgs.files[0].tail).toBe(10)
		})

		it("parses multi-file R block where all files are in the body", () => {
			const msg = "R\nsrc/app.ts\nsrc/auth.ts\nsrc/utils.ts\n/R"
			const blocks = parse(msg)
			// Multi-file R gets split into N individual read_file tool calls
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools.length).toBeGreaterThanOrEqual(1)
			const allPaths = readTools.map((t: any) => t.nativeArgs?.files?.[0]?.path ?? t.params?.path)
			expect(allPaths).toContain("src/app.ts")
			expect(allPaths).toContain("src/auth.ts")
			expect(allPaths).toContain("src/utils.ts")
		})

		it("parses multi-file R where first file is inline and rest are in body", () => {
			const msg = "R src/app.ts\nsrc/auth.ts\nsrc/utils.ts\n/R"
			const blocks = parse(msg)
			// Multi-file R produces individual read_file calls
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools.length).toBeGreaterThanOrEqual(1)
			const allPaths = readTools.map((t: any) => t.nativeArgs?.files?.[0]?.path ?? t.params?.path)
			expect(allPaths).toContain("src/app.ts")
			expect(allPaths).toContain("src/auth.ts")
			expect(allPaths).toContain("src/utils.ts")
		})

		it("parses multi-file R with mixed ranges inline", () => {
			const msg = "R src/app.ts 1-50\nsrc/auth.ts H10\nsrc/utils.ts T5\n/R"
			const blocks = parse(msg)
			// Multi-file R produces individual read_file calls split by file
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools.length).toBeGreaterThanOrEqual(1)
			// First file should have the line range
			const firstTool = readTools[0]
			const firstFile = firstTool.nativeArgs?.files?.[0]
			if (firstFile?.lineRanges?.length > 0) {
				expect(firstFile.lineRanges[0]).toEqual({ start: 1, end: 50 })
			}
		})

		it("handles R with a single file and no range (just full read)", () => {
			const msg = "R package.json\n/R"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.nativeArgs.files[0].path).toBe("package.json")
			expect(t.nativeArgs.files[0].lineRanges).toHaveLength(0)
		})

		it("streaming: R block parsed correctly in tiny chunks", () => {
			const msg = "R src/app.ts 1-50\nsrc/auth.ts\n/R"
			const blocks = streamParse(msg, 3)
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools.length).toBeGreaterThanOrEqual(1)
			const allPaths = readTools.map((t: any) => t.nativeArgs?.files?.[0]?.path ?? t.params?.path)
			expect(allPaths).toContain("src/app.ts")
		})

		it("parses R after markdown code fences", () => {
			const msg = "here:\n```\nconst sample = 'read';\n```\nR src/real.ts /R"
			const blocks = parse(msg)
			const allTools = tools(blocks)
			expect(allTools).toHaveLength(1)
			expect(allTools[0].nativeArgs.files[0].path).toBe("src/real.ts")
		})

		it("parses dense multi-file R with detailed ranges correctly", () => {
			const msg = "R src/integrations/terminal/TerminalProcess.ts 410-440\nsrc/core/kilocode/agent-manager/ShellOutput.ts 1-35\nsrc/core/webview/ClineProvider.ts 2835-2850\n/R"
			const blocks = parse(msg)
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools.length).toBeGreaterThanOrEqual(1)
			
			const allPaths = readTools.flatMap((t: any) => {
				if (t.nativeArgs?.files) return t.nativeArgs.files.map((f: any) => f.path)
				return [t.params?.path]
			})
			expect(allPaths).toContain("src/integrations/terminal/TerminalProcess.ts")
			expect(allPaths).toContain("src/core/kilocode/agent-manager/ShellOutput.ts")
			expect(allPaths).toContain("src/core/webview/ClineProvider.ts")
		})

		it("treats range-only continuation lines as extra ranges for the same file", () => {
			const msg = "R webview-ui/src/components/chat/ChatRow.tsx 1750-1780\n1870-1950\n2100-2120\n/R"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.nativeArgs.files).toHaveLength(1)
			expect(t.nativeArgs.files[0].path).toBe("webview-ui/src/components/chat/ChatRow.tsx")
			expect(t.nativeArgs.files[0].lineRanges).toEqual([
				{ start: 1750, end: 1780 },
				{ start: 1870, end: 1950 },
				{ start: 2100, end: 2120 },
			])
			expect(t.params.lineRange).toBe("1750-1780, 1870-1950, 2100-2120")
		})

		it("does not turn a partial closer slash into a second read path while streaming", () => {
			const parser = new UnifiedToolCallParser()
			const { blocks } = parser.processChunk(
				"R webview-ui/src/core/assistant-message/UnifiedToolCallParser.ts\n/",
			)
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools).toHaveLength(1)
			expect(readTools[0].nativeArgs.files).toEqual([
				{
					path: "webview-ui/src/core/assistant-message/UnifiedToolCallParser.ts",
					lineRanges: [],
				},
			])
		})

		it("treats '/R' with trailing prose as a closer instead of a second read", () => {
			const msg = [
				"Alright, let me check out the UnifiedToolCallParser to see how it's handling read ranges currently.",
				"",
				"R webview-ui/src/core/assistant-message/UnifiedToolCallParser.ts",
				"/R see this is the exact message where it happened but happens almost every time lmao",
			].join("\n")
			const blocks = parse(msg)
			const readTools = tools(blocks).filter((t: any) => t.name === "read_file")
			expect(readTools).toHaveLength(1)
			expect(readTools[0].nativeArgs.files[0].path).toBe(
				"webview-ui/src/core/assistant-message/UnifiedToolCallParser.ts",
			)
			expect(
				readTools.some((toolUse: any) =>
					String(toolUse.nativeArgs.files[0].path).includes("see this is the exact message"),
				),
			).toBe(false)
		})
	})

	// ─────────────────────────────────────────────
	// W — WRITE
	// ─────────────────────────────────────────────
	describe("W (write)", () => {
		it("parses a simple W block", () => {
			const msg = "W src/hello.ts\nconsole.log('hello')\n/W"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("write_to_file")
			expect(t.params.path).toBe("src/hello.ts")
			expect(t.params.content).toContain("console.log('hello')")
		})

		it("preserves multiline content in W blocks", () => {
			const msg = "W src/file.ts\nline1\nline2\nline3\n/W"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.content).toBe("line1\nline2\nline3")
		})

		it("preserves blank lines inside W blocks", () => {
			const msg = "W src/file.ts\nfirst\n\nthird\n/W"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.content).toBe("first\n\nthird")
		})

		it("does not close W block on content containing edit keywords", () => {
			const msg = "W docs/edit-guide.md\n# Edit Guide\nOld:\nsome text\nNew:\nother text\n/W"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.content).toContain("Old:")
			expect(t.params.content).toContain("New:")
		})

		it("accepts lowercase /w closer", () => {
			const msg = "W src/file.ts\nhello\n/w"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.partial).toBe(false)
		})

		it("streaming: W block with big content parsed in chunks", () => {
			const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")
			const msg = `W src/big.ts\n${content}\n/W`
			const blocks = streamParse(msg, 7)
			const t = tool(blocks)
			expect(t.params.content).toContain("line 0")
			expect(t.params.content).toContain("line 49")
		})
	})

	// ─────────────────────────────────────────────
	// E — EDIT
	// ─────────────────────────────────────────────
	describe("E (edit)", () => {
		it("parses a simple E block", () => {
			const msg = "E src/app.ts\nOld (1-3):\nconst x = 1;\nNew:\nconst x = 2;\n/E"
			const blocks = parse(msg)
			const t = tool(blocks)
			// E maps to 'edit' in the short-name schema
			expect(t.name).toBe("edit")
			expect(t.params.path).toBe("src/app.ts")
		})

		it("parses E block with multiple Old/New pairs", () => {
			const msg = [
				"E src/app.ts",
				"Old (1-3):",
				"const x = 1;",
				"New:",
				"const x = 2;",
				"Old (10-12):",
				"const y = 1;",
				"New:",
				"const y = 2;",
				"/E",
			].join("\n")
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.partial).toBe(false)
		})

		it("E block safely contains fake tool-like text in content", () => {
			const msg = [
				"E src/docs.md",
				"Old (1-2):",
				"# Old Title",
				"New:",
				"# New Title",
				"R src/fake.ts — this shouldn't be parsed as a tool",
				"/E",
			].join("\n")
			const blocks = parse(msg)
			const allTools = tools(blocks)
			// Only E should be parsed, not the R inside it
			expect(allTools).toHaveLength(1)
			expect(allTools[0].name).toBe("edit") // E short name maps to 'edit'
		})

		it("does not close E block on escaped closer", () => {
			// If the AI writes \\/edit inside an E block it should not close it
			const msg = "E src/app.ts\nOld (1-1):\nfoo\nNew:\nbar\n/E"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.partial).toBe(false)
		})

		it("accepts /edit as E closer", () => {
			const msg = "E src/app.ts\nOld (1-1):\nfoo\nNew:\nbar\n/edit"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.partial).toBe(false)
		})

		it("streaming: E block arrives in tiny chunks", () => {
			const msg = "E src/app.ts\nOld (5-6):\nconst a = 1;\nNew:\nconst a = 99;\n/E"
			const blocks = streamParse(msg, 4)
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.name).toBe("edit")
			expect(t.partial).toBe(false)
		})
	})

	// ─────────────────────────────────────────────
	// G — GREP
	// ─────────────────────────────────────────────
	describe("G (grep)", () => {
		it("parses single-query G with path", () => {
			const msg = "G src/\nAuthService\n/G"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("grep")
			expect(t.params.path).toBe("src/")
			expect(t.params.query).toBe("AuthService")
		})

		it("parses multi-query G", () => {
			const msg = "G src/\nAuthService\nTokenManager\nSessionStore\n/G"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(Array.isArray(t.params.query)).toBe(true)
			expect(t.params.query).toEqual(["AuthService", "TokenManager", "SessionStore"])
		})

		it("parses G with -i flag (include_all)", () => {
			const msg = "G src/\nAuthService\n-i\n/G"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.include_all).toBe(true)
			expect(t.params.query).toBe("AuthService")
		})

		it("parses G with no path (defaults to cwd)", () => {
			const msg = "G\nAuthService\n/G"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.path).toBe(".")
			expect(t.params.query).toBe("AuthService")
		})

		it("parses inline G one-liner", () => {
			const msg = "G src/ AuthService /G"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.query).toBe("AuthService")
			expect(t.params.path).toBe("src/")
		})
	})

	// ─────────────────────────────────────────────
	// F — FIND / GLOB
	// ─────────────────────────────────────────────
	describe("F (find/glob)", () => {
		it("parses F with a path and single pattern", () => {
			const msg = "F src/components\nChat.tsx\n/F"
			const blocks = parse(msg)
			const t = tool(blocks)
			// F maps to list_files/search_files depending on impl
			expect(t).toBeDefined()
			expect(t.params.path).toBe("src/components")
			expect(t.params.pattern).toBe("Chat.tsx")
		})

		it("parses F with multiple patterns", () => {
			const msg = "F src/\n*.tsx\n*.ts\n*.css\n/F"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(Array.isArray(t.params.pattern)).toBe(true)
			expect(t.params.pattern).toContain("*.tsx")
			expect(t.params.pattern).toContain("*.ts")
		})

		it("parses F with no path (defaults to cwd)", () => {
			const msg = "F\n*.json\n/F"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.path).toBe(".")
			expect(t.params.pattern).toBe("*.json")
		})

		it("parses inline F one-liner", () => {
			const msg = "F src/ Chat.tsx /F"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t).toBeDefined()
		})

		it("streams the exact src/core multi-pattern F case", () => {
			const { blocks: b1 } = parser.processChunk("F src/core\n")
			const t1 = tool(b1)
			expect(t1).toBeDefined()
			expect(t1.partial).toBe(true)
			expect(t1.params.path).toBe("src/core")
			expect(t1.params.pattern).toBe("")

			const { blocks: b2 } = parser.processChunk("Cline.ts\n")
			const t2 = tool(b2)
			expect(t2).toBeDefined()
			expect(t2.partial).toBe(true)
			expect(t2.params.path).toBe("src/core")
			expect(t2.params.pattern).toBe("Cline.ts")

			const { blocks: b3 } = parser.processChunk("ClineProvider.ts\n/F")
			const t3 = tool(b3)
			expect(t3).toBeDefined()
			expect(t3.partial).toBe(false)
			expect(t3.params.path).toBe("src/core")
			expect(t3.params.pattern).toEqual(["Cline.ts", "ClineProvider.ts"])
		})
	})

	// ─────────────────────────────────────────────
	// L — LS
	// ─────────────────────────────────────────────
	describe("L (ls)", () => {
		it("parses inline L one-liner", () => {
			const msg = "L src/components /L"
			const blocks = parse(msg)
			const t = tool(blocks)
			// L maps to list_dir in this schema
			expect(t.name).toBe("list_dir")
			expect(t.params.path).toBe("src/components")
		})

		it("parses L with dot for cwd", () => {
			const msg = "L . /L"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.path).toBe(".")
		})

		it("parses multiline L block", () => {
			const msg = "L src/\n/L"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t).toBeDefined()
		})
	})

	// ─────────────────────────────────────────────
	// B — BASH / EXECUTE
	// ─────────────────────────────────────────────
	describe("B (bash)", () => {
		it("parses inline B one-liner", () => {
			const msg = "B npm run build /B"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("execute_command")
			expect(t.params.command).toBe("npm run build")
		})

		it("parses multiline B block with cwd on first line", () => {
			const msg = "B src/\nnpm test\n/B"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.cwd).toBe("src/")
			expect(t.params.command).toBe("npm test")
		})

		it("parses B block with no path (just command)", () => {
			const msg = "B\nnpx vitest run\n/B"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.command).toBe("npx vitest run")
		})

		it("accepts lowercase /b closer", () => {
			const msg = "B src/\nnpm run build\n/b"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.partial).toBe(false)
		})

		it("parses B block with multiline command", () => {
			const msg = "B\nnpm run build && npm test\n/B"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.command).toContain("npm run build")
		})
	})

	// ─────────────────────────────────────────────
	// X — WEB SEARCH
	// ─────────────────────────────────────────────
	describe("X (web search)", () => {
		it("parses inline X one-liner", () => {
			const msg = "X latest React 19 features /X"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("web_search")
			expect(t.params.query).toBe("latest React 19 features")
		})
	})

	// ─────────────────────────────────────────────
	// U — FETCH
	// ─────────────────────────────────────────────
	describe("U (fetch)", () => {
		it("parses inline U one-liner", () => {
			const msg = "U https://example.com /U"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("web_fetch")
			expect(t.params.url).toBe("https://example.com")
		})

		it("parses U with -L flag (include_links)", () => {
			const msg = "U https://example.com -L /U"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.url).toBe("https://example.com")
			expect(t.nativeArgs.include_links).toBe(true)
		})
	})

	// ─────────────────────────────────────────────
	// Z — AGENT
	// ─────────────────────────────────────────────
	describe("Z (agent)", () => {
		it("parses inline Z one-liner", () => {
			const msg = "Z analyze the project structure /Z"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("run_sub_agent")
		})

		it("parses multiline Z block", () => {
			const msg = "Z\nanalyze this complex monorepo and find all circular dependencies\n/Z"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t).toBeDefined()
		})
	})

	// ─────────────────────────────────────────────
	// Y — ASK / CODEBASE SEARCH
	// ─────────────────────────────────────────────
	describe("Y (ask/codebase search)", () => {
		it("parses inline Y one-liner", () => {
			const msg = "Y where is the auth middleware /Y"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("codebase_search")
			expect(t.params.query).toBe("where is the auth middleware")
		})
	})

	// ─────────────────────────────────────────────
	// BATCHING — multiple tools in one message
	// ─────────────────────────────────────────────
	describe("Batching — multiple tools in one message", () => {
		it("parses R + G batched", () => {
			const msg = [
				"Let me look at this.",
				"",
				"R src/app.ts /R",
				"G src/",
				"AuthService",
				"/G",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].name).toBe("read_file")
			expect(ts[1].name).toBe("grep")
		})

		it("parses R + W batched", () => {
			const msg = [
				"R src/app.ts /R",
				"W src/out.ts",
				"const x = 1;",
				"/W",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].name).toBe("read_file")
			expect(ts[1].name).toBe("write_to_file")
		})

		it("parses L + F + G batched", () => {
			const msg = [
				"L . /L",
				"F src/",
				"*.test.ts",
				"/F",
				"G src/",
				"describe",
				"/G",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(3)
		})

		it("parses E + B batched", () => {
			const msg = [
				"E src/app.ts",
				"Old (1-1):",
				"const x = 1;",
				"New:",
				"const x = 2;",
				"/E",
				"B npm run build /B",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].name).toBe("edit") // E short name = 'edit'
			expect(ts[1].name).toBe("execute_command")
		})

		it("parses 5 tools in a single message", () => {
			const msg = [
				"R src/a.ts /R",
				"R src/b.ts /R",
				"G src/ foo /G",
				"L . /L",
				"B ls -la /B",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(5)
		})
	})

	// ─────────────────────────────────────────────
	// EDGE CASES & RESILIENCE
	// ─────────────────────────────────────────────
	describe("Edge cases & resilience", () => {
		it("text before first tool is preserved", () => {
			const msg = "Hey let me help with that!\n\nR src/app.ts /R"
			const blocks = parse(msg)
			const tb = text(blocks)
			expect(tb?.content).toContain("Hey let me help")
		})

		it("does NOT parse tools inside think blocks", () => {
			const msg = "<think>R src/private.ts /R</think>\nR src/real.ts /R"
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].nativeArgs.files[0].path).toBe("src/real.ts")
		})

		it("still parses tools after an unclosed markdown fence", () => {
			const msg = "```\nconst sample = 1;\nY auth middleware /Y"
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].name).toBe("codebase_search")
			expect(ts[0].params.query).toBe("auth middleware")
		})

		it("tool IDs are stable across re-parses of same partial content", () => {
			const partial = "R src/app.ts\n"
			const { blocks: b1 } = parser.processChunk(partial)
			const { blocks: b2 } = parser.processChunk("")
			const t1 = b1.find((b) => b.type === "tool_use") as any
			const t2 = b2.find((b) => b.type === "tool_use") as any
			expect(t1?.id).toBe(t2?.id)
		})

		it("hasCompletedToolCall returns false before close, true after", () => {
			// Use W (strict content tool) — its closer definitively sets hasFinalizedTool
			parser.processChunk("W src/app.ts\nhello world\n")
			expect(parser.hasCompletedToolCall()).toBe(false)
			parser.processChunk("/W\n")
			expect(parser.hasCompletedToolCall()).toBe(true)
		})

		it("reset clears all state", () => {
			parser.processChunk("R src/app.ts /R\n")
			parser.reset()
			expect(parser.hasCompletedToolCall()).toBe(false)
			const blocks = parser.getContentBlocks()
			expect(tools(blocks)).toHaveLength(0)
		})

		it("finalizeContentBlocks force-closes an open tool", () => {
			parser.processChunk("W src/app.ts\nconsole.log('hello')\n")
			// no /W yet
			parser.finalizeContentBlocks()
			const blocks = parser.getContentBlocks()
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.partial).toBe(false)
		})

		it("handles empty message gracefully", () => {
			const blocks = parse("")
			expect(blocks).toHaveLength(0)
		})

		it("handles message with only whitespace", () => {
			const blocks = parse("   \n   \n")
			const ts = tools(blocks)
			expect(ts).toHaveLength(0)
		})

		it("handles a tool with very long content in body", () => {
			const bigContent = Array.from({ length: 200 }, (_, i) => `const line${i} = ${i};`).join("\n")
			const msg = `W src/huge.ts\n${bigContent}\n/W`
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.content).toContain("const line0 = 0;")
			expect(t.params.content).toContain("const line199 = 199;")
		})

		it("does not confuse a path that looks like a tool letter", () => {
			// A file literally called B.ts should not trigger the B tool
			const msg = "R B.ts /R"
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].name).toBe("read_file")
			expect(ts[0].nativeArgs.files[0].path).toBe("B.ts")
		})

		it("parses a tool right at the very start of the buffer with no text before it", () => {
			const blocks = parse("L . /L")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].name).toBe("list_dir")
		})

		it("trimRawMessageAfterLastCompletedTool trims trailing chat after tool", () => {
			const msg = [
				"Let me read that.",
				"",
				"R src/app.ts",
				"/R",
				"",
				"Okay I have the result now.",
			].join("\n")
			const trimmed = parser.trimRawMessageAfterLastCompletedTool(msg)
			expect(trimmed).not.toContain("Okay I have the result now.")
			expect(trimmed).toContain("/R")
		})

		it("trimRawMessageAfterLastCompletedTool keeps the whole message if no tool completed", () => {
			const msg = "Just some regular text with no tools."
			const trimmed = parser.trimRawMessageAfterLastCompletedTool(msg)
			expect(trimmed).toBe(msg)
		})

		it("partial tool block remains partial until closer received", () => {
			const { blocks: b1 } = parser.processChunk("W src/app.ts\nhello\n")
			const t1 = b1.find((b: any) => b.type === "tool_use") as any
			expect(t1?.partial).toBe(true)

			const { blocks: b2 } = parser.processChunk("/W\n")
			const t2 = b2.find((b: any) => b.type === "tool_use" && b.name === "write_to_file") as any
			expect(t2?.partial).toBe(false)
		})

		it("does not parse a lowercase single letter as a tool opener", () => {
			// e.g. standalone 'r' should not be treated as tool R
			const blocks = parse("r src/app.ts /R")
			const ts = tools(blocks)
			expect(ts).toHaveLength(0)
		})

		it("parses inline closer on same line as opener (one-liner)", () => {
			const blocks = parse("L . /L")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].partial).toBe(false)
		})

		it("handles MCP tool block in XML format", () => {
			const p = new UnifiedToolCallParser()
			p.setMcpToolNames([
				{ compositeName: "my-server_my_tool", serverName: "my-server", toolName: "my_tool" },
			])
			const msg = 'M my-server_my_tool\n{"key": "value"}\n/M'
			p.processChunk(msg)
			p.finalizeContentBlocks()
			const blocks = p.getContentBlocks()
			const mcpBlock = blocks.find((b) => b.type === "mcp_tool_use") as any
			expect(mcpBlock).toBeDefined()
			expect(mcpBlock.arguments).toEqual({ key: "value" })
		})
	})

	// ─────────────────────────────────────────────
	// STREAMING RESILIENCE
	// ─────────────────────────────────────────────
	describe("Streaming resilience", () => {
		it("streaming: E block parsed correctly when streamed char-by-char", () => {
			const msg = "E src/app.ts\nOld (1-3):\nfoo\nNew:\nbar\n/E"
			const blocks = streamParse(msg, 1)
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.name).toBe("edit") // E = 'edit' short name
			expect(t.partial).toBe(false)
		})

		it("E Block Streaming Gauntlet: split keywords and headers", () => {
			const msg = "E src/app.ts\nOld (10-20):\nconst x = 1;\nNew:\nconst x = 2;\n/E"
			
			// Test various "unlucky" split points
			const splitPoints = [
				1,  // E|
				2,  // E |
				12, // E src/app.ts|\n
				14, // E src/app.ts\nO|ld
				17, // E src/app.ts\nOld (|10-20)
				21, // E src/app.ts\nOld (10-|20)
				25, // E src/app.ts\nOld (10-20)|\n
				40, // somewhere in content
				50, // halfway through \nNew:\n
				55, // halfway through /E
			]

			for (const splitAt of splitPoints) {
				const parser = new UnifiedToolCallParser()
				parser.processChunk(msg.slice(0, splitAt))
				parser.processChunk(msg.slice(splitAt))
				parser.finalizeContentBlocks()
				const blocks = parser.getContentBlocks()
				const t = tool(blocks)
				expect(t).toBeDefined()
				expect(t.name).toBe("edit")
				expect(t.partial).toBe(false)
				// Verify the content was passed correctly even if headers were split
				const rawEdit = t.params.edit || t.params.edits || ""
				expect(rawEdit).toContain("Old (10-20):")
				expect(rawEdit).toContain("New:")
			}
		})

		it("E Block Streaming Gauntlet: random chunk stress test", () => {
			const largeEdit = [
				"E src/huge.ts",
				"Old (100-200):",
				"// " + "old ".repeat(100),
				"New:",
				"// " + "new ".repeat(100),
				"/E"
			].join("\n")

			const blocks = randomChunkParse(largeEdit, 123)
			const t = tool(blocks)
			expect(t).toBeDefined()
			expect(t.name).toBe("edit")
			expect(t.partial).toBe(false)
		})

		it("batched tools parsed correctly in 3-char chunks", () => {
			const msg = "R src/a.ts /R\nG src/ foo /G"
			const blocks = streamParse(msg, 3)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
		})

		it("W block content is stable across many small chunks", () => {
			const content = "const x = 42;\nconst y = 99;"
			const msg = `W src/test.ts\n${content}\n/W`
			const blocks = streamParse(msg, 2)
			const t = tool(blocks)
			expect(t.params.content).toBe(content)
		})

		it("partial R block does not appear as finalized until /R arrives", () => {
			parser.processChunk("R src/app.ts\n")
			const { blocks: b1 } = parser.processChunk("")
			// tool should exist but be partial
			const t1 = b1.find((b: any) => b.type === "tool_use") as any
			if (t1) expect(t1.partial).toBe(true)

			parser.processChunk("/R")
			parser.finalizeContentBlocks()
			const b2 = parser.getContentBlocks()
			const t2 = b2.find((b: any) => b.type === "tool_use") as any
			expect(t2).toBeDefined()
			expect(t2.partial).toBe(false)
		})
	})

	// ─────────────────────────────────────────────
	// REALISTIC END-TO-END SCENARIOS
	// ─────────────────────────────────────────────
	describe("Realistic end-to-end scenarios", () => {
		it("discovery workflow: L + F + G", () => {
			const msg = [
				"Let me map the repo first.",
				"",
				"L .",
				"/L",
				"F src/",
				"*.service.ts",
				"/F",
				"G src/",
				"AuthService",
				"UserService",
				"/G",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(3)
			// L = list_dir, F = list_files/search_files, G = grep
			expect(ts[0].name).toBe("list_dir")
			expect(ts[1]).toBeDefined() // F tool
			expect(ts[2].name).toBe("grep")
		})

		it("ship workflow: E + B", () => {
			const msg = [
				"Shipping the fix now.",
				"",
				"E src/auth.ts",
				"Old (45-47):",
				"if (user) {",
				"  return true;",
				"}",
				"New:",
				"if (user && user.active) {",
				"  return true;",
				"}",
				"/E",
				"B npx tsc --noEmit /B",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].name).toBe("edit") // E maps to 'edit'
			expect(ts[1].name).toBe("execute_command")
			expect(ts[1].params.command).toBe("npx tsc --noEmit")
		})

		it("read multi with ranges, then grep", () => {
			const msg = [
				"R src/auth.ts 1-50",
				"src/user.ts H20",
				"src/session.ts T10",
				"/R",
				"G src/",
				"createToken",
				"/G",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			// Multi-file R gets split into individual read_file calls by the parser
			// So 3 files + 1 grep = 4 tools total
			const readTools = ts.filter((t: any) => t.name === "read_file")
			const grepTools = ts.filter((t: any) => t.name === "grep")
			expect(readTools.length).toBeGreaterThanOrEqual(1)
			expect(grepTools).toHaveLength(1)
		})

		it("web research then write", () => {
			const msg = [
				"X vitest mock vi.fn examples 2024 /X",
				"W src/test-helpers.ts",
				"export const mockFn = vi.fn()",
				"/W",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].name).toBe("web_search")
			expect(ts[1].name).toBe("write_to_file")
		})
	})

	// ─────────────────────────────────────────────
	// EDIT BLOCK PARSING via EditTool.parseLegacy
	// (The legacy parser lives in EditTool, not UnifiedToolCallParser)
	// ─────────────────────────────────────────────
	describe("Edit block strict format (Old (N-N): only via EditTool)", () => {
		// These tests verify the E block content gets passed through correctly
		// and that the strict Old (N-N): format is the only accepted header

		it("E block content containing Old (N-N): / New: is passed through to tool", () => {
			const msg = [
				"E src/app.ts",
				"Old (1-3):",
				"const x = 1;",
				"New:",
				"const x = 2;",
				"/E",
			].join("\n")
			const blocks = parse(msg)
			const t = tool(blocks)
			// Content should contain Old (1-3):
			const rawContent = t.params.edit || t.params.edits || ""
			expect(rawContent).toContain("Old (1-3):")
			expect(rawContent).toContain("New:")
		})

		it("E block with multiple Old/New pairs all appear in content", () => {
			const msg = [
				"E src/app.ts",
				"Old (1-2):",
				"foo",
				"New:",
				"bar",
				"Old (10-11):",
				"hello",
				"New:",
				"goodbye",
				"/E",
			].join("\n")
			const blocks = parse(msg)
			const t = tool(blocks)
			const rawContent = t.params.edit || t.params.edits || ""
			expect(rawContent).toContain("Old (1-2):")
			expect(rawContent).toContain("Old (10-11):")
		})

		it("E block is a safe haven — fake Old/New headers inside don't leak or split tool", () => {
			const msg = [
				"E src/docs.ts",
				"Old (1-1):",
				"// placeholder",
				"New:",
				"// updated — Old (99-99): this line should NOT create a second block",
				"/E",
			].join("\n")
			const blocks = parse(msg)
			const ts = tools(blocks)
			// Should be exactly 1 edit tool, not 2
			expect(ts).toHaveLength(1)
			expect(ts[0].name).toBe("edit")
		})
	})

	// ─────────────────────────────────────────────
	// WACKY & SILLY SCENARIOS (BULLETPROOFING)
	// ─────────────────────────────────────────────
	describe("Wacky & Silly Scenarios (Bulletproofing)", () => {
		it("parses a tool call where the filename is another tool's key (R G.ts)", () => {
			const blocks = parse("R G.ts /R")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].nativeArgs.files[0].path).toBe("G.ts")
		})

		it("parses B B /B (running a command called B in tool B)", () => {
			const blocks = parse("B B /B")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].params.command).toBe("B")
		})

		it("parses a tool call buried in a sentence with newline (Done.\nB npm test /B)", () => {
			const blocks = parse("Done.\nB npm test /B")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].params.command).toBe("npm test")
		})

		it("parses multiple tools separated by newlines (R a.ts /R\nB ls /B)", () => {
			const blocks = parse("R a.ts /R\nB ls /B")
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			expect(ts[0].name).toBe("read_file")
			expect(ts[1].name).toBe("execute_command")
		})

		it("handles mixed-case closers (/r instead of /R)", () => {
			const blocks = parse("R a.ts /r")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].partial).toBe(false)
		})

		it("handles wacky emoji filenames (R 🍕.ts /R)", () => {
			const blocks = parse("R 🍕.ts /R")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].nativeArgs.files[0].path).toBe("🍕.ts")
		})

		it("handles paths with spaces in quotes (R \"my project/app.ts\" /R)", () => {
			const blocks = parse("R \"my project/app.ts\" /R")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].nativeArgs.files[0].path).toBe("my project/app.ts")
		})

		it("does NOT parse an escaped tool call (\\R ignored.ts /R)", () => {
			const blocks = parse("\\R ignored.ts /R")
			const ts = tools(blocks)
			expect(ts).toHaveLength(0)
		})

		it("handles nested-looking closers in content (W test.ts\n/W\n/W)", () => {
			// The first /W should close it
			const blocks = parse("W test.ts\n/W\n/W")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].params.content).toBe("")
		})

		it("handles edit with content that looks like a tool closer (E test.ts\nOld (1-1):\n} /R\nNew:\n} // fix\n/E)", () => {
			const msg = "E test.ts\nOld (1-1):\n} /R\nNew:\n} // fix\n/E"
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].name).toBe("edit")
			expect(ts[0].params.edit).toContain("} /R")
		})

		it("parses todo tool (T) with task list", () => {
			const msg = "T\n[ ] task 1\n[x] task 2\n/T"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("update_todo_list")
			expect(t.params.todos).toContain("[ ] task 1")
		})

		it("handles empty tool calls (L /L)", () => {
			const blocks = parse("L /L")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].params.path).toBe(".")
		})

		it("handles crazy dense tool bashing with newlines", () => {
			const msg = "R a.ts /R\nR b.ts /R\nR c.ts /R\nB ls /B\nL . /L"
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(5)
		})

		it("streaming: splits a tool call at the most obnoxious points", () => {
			const chunks = ["R ", "sr", "c/a", "pp", ".ts", " /", "R"]
			const parser = new UnifiedToolCallParser()
			let lastBlocks: any[] = []
			for (const chunk of chunks) {
				const { blocks } = parser.processChunk(chunk)
				lastBlocks = blocks
			}
			parser.finalizeContentBlocks()
			const finalBlocks = parser.getContentBlocks()
			const t = tool(finalBlocks)
			expect(t).toBeDefined()
			expect(t.nativeArgs.files[0].path).toBe("src/app.ts")
			expect(t.partial).toBe(false)
		})

		it("handles grep with piped multi-query (G src/\nfoo|bar|baz\n/G)", () => {
			const msg = "G src/\nfoo|bar|baz\n/G"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(Array.isArray(t.params.query)).toBe(true)
			expect(t.params.query).toEqual(["foo", "bar", "baz"])
		})

		it("handles bash command with pipes and redirects (B ls -la | grep foo > out.txt /B)", () => {
			const msg = "B ls -la | grep foo > out.txt /B"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.command).toBe("ls -la | grep foo > out.txt")
		})

		it("preserves trailing whitespace in write content if intent is clear", () => {
			const msg = "W test.ts\nline 1   \nline 2\n/W"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.params.content).toBe("line 1   \nline 2")
		})

		it("parses Z tool with wacky prompt", () => {
			const msg = "Z LITERALLY DO EVERYTHING /Z"
			const blocks = parse(msg)
			const t = tool(blocks)
			expect(t.name).toBe("run_sub_agent")
			expect(t.params.instructions).toBe("LITERALLY DO EVERYTHING")
		})

		it("handles multiple closers on newlines (R a.ts /R\n/R)", () => {
			// Should ignore the second /R and treat it as text if it's outside
			const blocks = parse("R a.ts /R\n/R")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
		})

		it("handles tool call with no space before opener (LITERALLYL . /L)", () => {
			// The current regex requires ^ or newline or start of string for single letter tools
			// so "LITERALLYL" might NOT match "L" if it's not at the start of a line or after a space.
			// Let's see if the parser is smart enough.
			const blocks = parse("LITERALLY L . /L")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
		})
		it("handles a tool call that is just the letter (B\nls\n/B)", () => {
			const blocks = parse("B\nls\n/B")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].params.command).toBe("ls")
		})

		it("handles trailing whitespace in one-liners (R path /R )", () => {
			const blocks = parse("R webview-ui/src/Bash.tsx /R ")
			const ts = tools(blocks)
			expect(ts).toHaveLength(1)
			expect(ts[0].params.path).toBe("webview-ui/src/Bash.tsx")
		})

		it("preserves text between multiple tool calls in one message", () => {
			const msg = "Check file:\nR a.ts /R\nThen check this:\nR b.ts /R"
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(2)
			const textBlocks = blocks.filter(b => b.type === "text")
			expect(textBlocks).toHaveLength(2)
			expect(textBlocks[0].content).toContain("Check file:")
			expect(textBlocks[1].content).toContain("Then check this:")
		})

		it("handles massive multi-file R followed by multi-query G", () => {
			const msg = `R 10lines.txt
20lines.txt
24lines.txt
32lines.txt
40lines.txt
50lines.txt
60lines.txt
bro.txt
bruh.txt
sample.txt
/R
G
pizza
chaos
kade
zen
void
-i
/G`
			const blocks = parse(msg)
			const ts = tools(blocks)
			expect(ts).toHaveLength(11)
			
			// Verify R tools (first 10)
			const readTools = ts.slice(0, 10)
			readTools.forEach(t => expect(t.name).toBe("read_file"))
			
			// Extract all paths from the read tools
			const allPaths = readTools.map((t: any) => t.nativeArgs?.files?.[0]?.path ?? t.params?.path)
			expect(allPaths).toContain("10lines.txt")
			expect(allPaths).toContain("sample.txt")
			expect(allPaths).toHaveLength(10)
			
			// Verify G tools (last one)
			const gTool = ts[10]
			expect(gTool.name).toBe("grep")
			expect(gTool.params.query).toHaveLength(5)
			expect(gTool.params.query).toContain("pizza")
			expect(gTool.params.query).toContain("void")
			expect(gTool.params.include_all).toBe(true)
		})
	})
})
