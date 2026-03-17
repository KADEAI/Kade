import { beforeEach, describe, expect, it } from "vitest"

import { UnifiedToolCallParser } from "../UnifiedToolCallParser"

describe("UnifiedToolCallParser", () => {
	let parser: UnifiedToolCallParser

	beforeEach(() => {
		parser = new UnifiedToolCallParser()
		parser.setMcpToolNames([
			{
				compositeName: "poly-mcp_file_tree",
				serverName: "poly-mcp",
				toolName: "file_tree",
			},
		])
	})

	it("parses MCP tool blocks that use the M <name> ... /M single-letter form", () => {
		const message = [
			"I'll inspect the workspace first.",
			"",
			"M poly-mcp_file_tree",
			'{"path": ".", "max_depth": 3}',
			"/M",
		].join("\n")

		const { blocks } = parser.processChunk(message)
		const textBlock = blocks.find((block) => block.type === "text") as any
		const toolBlock = blocks.find((block) => block.type === "mcp_tool_use") as any

		expect(textBlock?.content).toContain("I'll inspect the workspace first.")
		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("poly-mcp_file_tree")
		expect(toolBlock.serverName).toBe("poly-mcp")
		expect(toolBlock.toolName).toBe("file_tree")
		expect(toolBlock.arguments).toEqual({ path: ".", max_depth: 3 })
		expect(toolBlock.partial).toBe(false)
	})

	it("parses a single-letter tool after a closed markdown code fence", () => {
		const message = [
			"Here is the snippet:",
			"",
			"```ts",
			"const x = 1;",
			"```",
			"",
			"Y auth provider flow",
			"/Y",
		].join("\n")

		const { blocks } = parser.processChunk(message)
		const textBlock = blocks.find((block) => block.type === "text") as any
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(textBlock).toBeDefined()
		expect(textBlock.content.match(/```/g)?.length).toBe(2)
		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("codebase_search")
		expect(toolBlock.params.query).toBe("auth provider flow")
	})

	it("parses a single-letter tool after an unclosed markdown code fence", () => {
		const parser = new UnifiedToolCallParser()
		const firstChunk = ["Here is the snippet:", "", "```ts", "const x = 1;"].join(
			"\n",
		)
		const secondChunk = ["", "Y auth provider flow", "/Y"].join("\n")

		parser.processChunk(firstChunk)
		const { blocks } = parser.processChunk(secondChunk)
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("codebase_search")
		expect(toolBlock.params.query).toBe("auth provider flow")
	})

	it("parses single-letter ask blocks with Y as codebase_search", () => {
		const message = ["I’m going to search semantically first.", "", "Y auth provider flow", "/Y"].join("\n")

		const { blocks } = parser.processChunk(message)
		const textBlock = blocks.find((block) => block.type === "text") as any
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(textBlock?.content).toContain("I’m going to search semantically first.")
		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("codebase_search")
		expect(toolBlock.originalName).toBe("Y")
		expect(toolBlock.params.query).toBe("auth provider flow")
		expect(toolBlock.nativeArgs.query).toBe("auth provider flow")
	})

	it("parses grep include-all short flag without changing the query", () => {
		const message = ["G src/ AuthService -i", "/G"].join("\n")

		const { blocks } = parser.processChunk(message)
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("grep")
		expect(toolBlock.params.query).toBe("AuthService")
		expect(toolBlock.params.path).toBe("src/")
		expect(toolBlock.params.include_all).toBe(true)
		expect(toolBlock.nativeArgs.include_all).toBe(true)
	})

	it("marks single-letter G queries as regex searches", () => {
		const message = ["G src/ toolResult.*is_error", "/G"].join("\n")

		const { blocks } = parser.processChunk(message)
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("grep")
		expect(toolBlock.params.query).toBe("toolResult.*is_error")
		expect(toolBlock.params.literal).toBe(false)
		expect(toolBlock.nativeArgs.literal).toBe(false)
	})

	it("does not seed wildcard patterns for partial single-letter F blocks", () => {
		const firstPass = parser.processChunk("F src/\n")
		const partialTool = firstPass.blocks.find((block) => block.type === "tool_use") as any

		expect(partialTool).toBeDefined()
		expect(partialTool.name).toBe("glob")
		expect(partialTool.partial).toBe(true)
		expect(partialTool.params.path).toBe("src/")
		expect(partialTool.params.pattern).toBe("")

		const secondPass = parser.processChunk("ClineMessage\nExtensionMessage\n/F")
		const finalTool = secondPass.blocks.find((block) => block.type === "tool_use") as any

		expect(finalTool).toBeDefined()
		expect(finalTool.partial).toBe(false)
		expect(finalTool.params.path).toBe("src/")
		expect(finalTool.params.pattern).toEqual(["ClineMessage", "ExtensionMessage"])
	})

	it("parses fetch -L as include_links without polluting the URL", () => {
		const message = ["U https://example.com/docs -L", "/U"].join("\n")

		const { blocks } = parser.processChunk(message)
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("web_fetch")
		expect(toolBlock.params.url).toBe("https://example.com/docs")
		expect(toolBlock.params.include_links).toBe("true")
		expect(toolBlock.nativeArgs.url).toBe("https://example.com/docs")
		expect(toolBlock.nativeArgs.include_links).toBe(true)
	})

	it("parses stacked hybrid edit blocks with colon and New headers", () => {
		const edits = (parser as any).parseEditBlocks(`245:
const score = 1;
New:
const score = 2;
250 - 252:
function draw() {
  return 1;
}
New:
function draw() {
  return 2;
}`)

		expect(edits).toHaveLength(2)
		expect(edits[0]).toMatchObject({
			start_line: 245,
			end_line: 245,
			oldText: "const score = 1;",
			newText: "const score = 2;",
		})
		expect(edits[1]).toMatchObject({
			start_line: 250,
			end_line: 252,
		})
	})

	it("preserves raw multiline replacement text with indentation and braces", () => {
		const edits = (parser as any).parseEditBlocks(`149-160:
            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
            }
New:
            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
                this.y = canvas.height + 50;
                this.vx = (Math.random() - 0.5) * 4;
                this.vy = -(20 + Math.random() * 12);
            }`)

		expect(edits[0].newText).toBe(`            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
                this.y = canvas.height + 50;
                this.vx = (Math.random() - 0.5) * 4;
                this.vy = -(20 + Math.random() * 12);
            }`)
	})

	it("preserves blank lines inside replacement blocks", () => {
		const edits = (parser as any).parseEditBlocks(`10:
function test() {}
New:
function test() {

  return {
    ok: true,
  };
}`)

		expect(edits[0].newText).toBe(`function test() {

  return {
    ok: true,
  };
}`)
	})

	it("keeps multiple multiline New blocks separated", () => {
		const edits = (parser as any).parseEditBlocks(`11-13:
body {
  color: blue;
}
New:
body {
  color: brown;
  background-image:
    linear-gradient(red, orange),
    linear-gradient(blue, green);
}
20:
.card { display: block; }
New:
.card {
  display: grid;
  gap: 12px;
}`)

		expect(edits).toHaveLength(2)
		expect(edits[0].newText).toContain("\n  background-image:\n")
		expect(edits[1].newText).toBe(`.card {
  display: grid;
  gap: 12px;
}`)
	})

	it("does not absorb the New marker into adjacent brace content", () => {
		const edits = (parser as any).parseEditBlocks(`30-34:
if (ready) {
  run();
}
New:
if (ready) {
  run();
  finish();
}`)

		expect(edits[0].oldText.includes("}New:")).toBe(false)
		expect(edits[0].newText.includes("\n  finish();\n")).toBe(true)
	})

	it("parses bare range headers without a leading dash or trailing colon", () => {
		const edits = (parser as any).parseEditBlocks(`10-12
const score = 1;
const lives = 3;
New:
const score = 2;
const lives = 4;`)

		expect(edits).toHaveLength(1)
		expect(edits[0]).toMatchObject({
			start_line: 10,
			end_line: 12,
			oldText: `const score = 1;
const lives = 3;`,
			newText: `const score = 2;
const lives = 4;`,
		})
	})

	it("accepts lowercase closers for multiline B command blocks", () => {
		const message = [
			"I'll run the build from the app directory.",
			"",
			"B src/components",
			"npm run build",
			"/b",
		].join("\n")

		const { blocks } = parser.processChunk(message)
		const toolBlock = blocks.find((block) => block.type === "tool_use") as any

		expect(toolBlock).toBeDefined()
		expect(toolBlock.name).toBe("execute_command")
		expect(toolBlock.originalName).toBe("B")
		expect(toolBlock.partial).toBe(false)
		expect(toolBlock.params.cwd).toBe("src/components")
		expect(toolBlock.params.command).toBe("npm run build")
	})

	it("trims trailing chat text after a completed unified tool call", () => {
		const rawMessage = [
			"I'll inspect the file first.",
			"",
			"R src/app.ts",
			"/R",
			"",
			"Here is what the tool returned and what I'll do next.",
		].join("\n")

		expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe([
			"I'll inspect the file first.",
			"",
			"R src/app.ts",
			"/R",
		].join("\n"))
	})

	it("drops a partial next unified tool from history trimming after a completed tool call", () => {
		const rawMessage = [
			"Starting with a read.",
			"",
			"R src/app.ts",
			"/R",
			"",
			"W src/app.ts",
			"const broken = true;",
		].join("\n")

		expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe([
			"Starting with a read.",
			"",
			"R src/app.ts",
			"/R",
		].join("\n"))
	})
})
