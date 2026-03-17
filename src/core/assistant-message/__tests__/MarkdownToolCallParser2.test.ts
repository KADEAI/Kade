import { describe, it, expect, beforeEach } from "vitest"
import { MarkdownToolCallParser } from "../MarkdownToolCallParser2"

describe("MarkdownToolCallParser2 - Single Letter Syntax", () => {
    let parser: MarkdownToolCallParser

    beforeEach(() => {
        parser = new MarkdownToolCallParser()
    })

    it("should parse a simple single-letter read call (R)", () => {
        const message = "R src/app.ts\n/R"
        const { blocks } = parser.processChunk(message)
        const toolUse = blocks.find(b => b.type === "tool_use") as any
        expect(toolUse).toBeDefined()
        expect(toolUse.name).toBe("read_file")
        expect(toolUse.params.path).toBe("src/app.ts")
    })

    it("should parse a single-letter read call with line ranges", () => {
        const message = "R src/app.ts 1-50\n/R"
        const { blocks } = parser.processChunk(message)
        const toolUse = blocks.find(b => b.type === "tool_use") as any
        expect(toolUse.params.path).toBe("src/app.ts")
        expect(toolUse.params.lineRange).toBe("1-50")
    })

    it("should parse a multi-line write call (W) with /write closer", () => {
        const message = "W src/test.txt\nHello World\nThis is a test.\n/write"
        const { blocks } = parser.processChunk(message)
        const toolUse = blocks.find(b => b.type === "tool_use") as any
        expect(toolUse).toBeDefined()
        expect(toolUse.name).toBe("write_to_file")
        expect(toolUse.params.path).toBe("src/test.txt")
        expect(toolUse.params.content).toBe("Hello World\nThis is a test.")
    })

    it("should parse an edit call (E) with /edit closer", () => {
        const message = "E src/app.ts\nOld (10):\nconst x = 1\nNew:\nconst x = 2\n/edit"
        const { blocks } = parser.processChunk(message)
        const toolUse = blocks.find(b => b.type === "tool_use") as any
        expect(toolUse).toBeDefined()
        expect(toolUse.name).toBe("edit")
        expect(toolUse.params.path).toBe("src/app.ts")
        expect(toolUse.nativeArgs.edits[0].oldText).toBe("const x = 1")
        expect(toolUse.nativeArgs.edits[0].newText).toBe("const x = 2")
    })

    it("should parse a grep call (G) with /G closer", () => {
        const message = 'G "AuthService" src/\n/G'
        const { blocks } = parser.processChunk(message)
        const toolUse = blocks.find(b => b.type === "tool_use") as any
        expect(toolUse.name).toBe("grep")
        expect(toolUse.params.query).toBe("AuthService")
        expect(toolUse.params.path).toBe("src/")
    })

    it("should parse a bash call (B) with /B closer", () => {
        const message = "B npm test\n/B"
        const { blocks } = parser.processChunk(message)
        const toolUse = blocks.find(b => b.type === "tool_use") as any
        expect(toolUse.name).toBe("execute_command")
        expect(toolUse.params.command).toBe("npm test")
    })

    it("should handle multiple tool calls in one message", () => {
        const message = "R file1.ts\n/R\n\nL src\n/L"
        const { blocks } = parser.processChunk(message)
        const tools = blocks.filter(b => b.type === "tool_use")
        expect(tools.length).toBe(2)
        expect(tools[0].name).toBe("read_file")
        expect(tools[1].name).toBe("list_dir")
    })
})