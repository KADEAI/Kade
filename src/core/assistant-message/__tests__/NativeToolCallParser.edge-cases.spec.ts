import { describe, expect, it } from "vitest"
import { NativeToolCallParser } from "../NativeToolCallParser"

describe("NativeToolCallParser JSON Edge Cases (Registry Tools Only)", () => {
	describe("Streaming JSON with Escaped Characters", () => {
		it("handles escaped quotes in write content", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_write_1", "write")
			
			const chunk1 = '{"path": "test.js", "content": "console.log(\\"hello\\"'
			const res1 = NativeToolCallParser.processStreamingChunk("call_write_1", chunk1) as any
			
			expect(res1?.nativeArgs).toMatchObject({
				path: "test.js",
				content: 'console.log("hello"'
			})

			const chunk2 = ');"}'
			const res2 = NativeToolCallParser.processStreamingChunk("call_write_1", chunk2) as any
			expect(res2?.nativeArgs).toMatchObject({
				content: 'console.log("hello");'
			})
		})

		it("handles escaped newlines in bash command", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_bash_1", "bash")
			
			const chunk = '{"command": "echo \\"line 1\\nline 2\\""}'
			const res = NativeToolCallParser.processStreamingChunk("call_bash_1", chunk) as any
			
			expect(res?.nativeArgs).toMatchObject({
				command: 'echo "line 1\nline 2"'
			})
		})
	})

	describe("Streaming JSON with Nested Structures (Batch)", () => {
		it("handles partial batch calls", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_batch_1", "batch")
			
			const chunk1 = '{"calls": [{"name": "list", "arguments": {"path": "src"}}'
			const res1 = NativeToolCallParser.processStreamingChunk("call_batch_1", chunk1) as any
			
			expect(res1?.nativeArgs).toMatchObject({
				calls: [{ name: "list", arguments: { path: "src" } }]
			})

			const chunk2 = ', {"name": "read", "arguments": {"files": ["app.ts"]}}]}'
			const res2 = NativeToolCallParser.processStreamingChunk("call_batch_1", chunk2) as any
			
			expect(res2?.nativeArgs?.calls).toHaveLength(2)
			expect(res2?.nativeArgs?.calls[1]).toMatchObject({
				name: "read",
				arguments: { files: ["app.ts"] }
			})
		})
    })

    it("handles partial tools router calls", () => {
        NativeToolCallParser.clearAllStreamingToolCalls()
        NativeToolCallParser.startStreamingToolCall("call_tools_grouped_1", "tools" as any)

        const chunk = '{"tools":[{"read":["app.ts:H20"]},{"grep":"AuthService","path":"src"}]}'
        const res = NativeToolCallParser.processStreamingChunk("call_tools_grouped_1", chunk) as any

        expect(res?.name).toBe("batch")
        expect(res?.originalName).toBe("tools")
        expect(res?.nativeArgs).toMatchObject({
            calls: [
                { name: "read", arguments: { files: ["app.ts:H20"] } },
                { name: "grep", arguments: { query: "AuthService", path: "src" } },
            ],
        })
    })

	it("falls back to flat edit fields when content router includes an empty compatibility edit array", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_content_grouped_empty_edit",
			name: "content" as any,
			arguments: JSON.stringify({
				content: [
					{
						path: "fifty-lines.txt",
						edit: [],
						lineRange: "1-3",
						oldText: "a",
						newText: "b",
					},
				],
			}),
		}) as any

		expect(toolUse?.name).toBe("batch")
		expect(toolUse?.nativeArgs).toMatchObject({
			calls: [
				{
					name: "edit",
					arguments: {
						path: "fifty-lines.txt",
						lineRange: "1-3",
						oldText: "a",
						newText: "b",
					},
				},
			],
		})
	})

    describe("Complex Edit Tool Edge Cases", () => {
		it("handles multi-block edit streaming", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_edit_1", "edit")
			
			const chunk1 = '{"path": "app.ts", "edit": [{"lineRange": "1-5", "oldText": "A", "newText": "B"}'
			const res1 = NativeToolCallParser.processStreamingChunk("call_edit_1", chunk1) as any
			
			expect(res1?.nativeArgs?.edit).toHaveLength(1)
			
			const chunk2 = ', {"lineRange": "10-15", "oldText": "C", "newText": "D"}]}'
			const res2 = NativeToolCallParser.processStreamingChunk("call_edit_1", chunk2) as any
			
			expect(res2?.nativeArgs?.edit).toHaveLength(2)
			expect(res2?.nativeArgs?.edit[1]).toMatchObject({
				lineRange: "10-15",
				oldText: "C",
				newText: "D"
			})
		})

		it("handles flat edit arguments (model shortcut)", () => {
			const toolUse = NativeToolCallParser.parseToolCall({
				id: "call_edit_flat",
				name: "edit",
				arguments: JSON.stringify({
					path: "flat.ts",
					lineRange: "1-10",
					oldText: "old",
					newText: "new"
				})
			}) as any

			expect(toolUse?.nativeArgs).toMatchObject({
				path: "flat.ts",
				edit: [{ lineRange: "1-10", oldText: "old", newText: "new" }]
			})
		})
	})

	describe("Recovery Path for Registry Tools", () => {
		it("recovers from Unified Protocol 'edit' format", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_recover_edit", "edit")
			
			const chunk = "edit;index.html\nOld: foo\nNew: bar"
			const res = NativeToolCallParser.processStreamingChunk("call_recover_edit", chunk) as any
			
			expect(res?.name).toBe("edit")
			expect(res?.nativeArgs).toMatchObject({
				path: "index.html",
				edit: [{ oldText: "foo", newText: "bar" }]
			})
		})

		it("recovers from XML format for 'read'", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_recover_read", "read")
			
			const chunk = "<tool_call><function=read><parameter=path>test.ts</parameter></function></tool_call>"
			const res = NativeToolCallParser.processStreamingChunk("call_recover_read", chunk) as any
			
			expect(res?.name).toBe("read")
			expect(res?.nativeArgs?.files).toMatchObject([{ path: "test.ts" }])
		})

		it("does not emit a partial tool call when a <think> block obscures unified recovery", () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall("call_think_recover", "edit")
			
			const chunk = "<think>Refactoring...</think>\n\nedit;app.ts\nOld: 1\nNew: 2"
			const res = NativeToolCallParser.processStreamingChunk("call_think_recover", chunk) as any
			
			expect(res).toBeNull()
		})
	})

	describe("Alias Resolution for Registry Tools", () => {
		it("resolves write_file to write", () => {
			const toolUse = NativeToolCallParser.parseToolCall({
				id: "call_alias_write",
				name: "write_file" as any,
				arguments: JSON.stringify({ path: "alias.ts", content: "data" })
			}) as any

			expect(toolUse?.name).toBe("write")
			expect(toolUse?.originalName).toBe("write_file")
		})

		it("resolves list_files to list", () => {
			const toolUse = NativeToolCallParser.parseToolCall({
				id: "call_alias_list",
				name: "list_files" as any,
				arguments: JSON.stringify({ path: "src" })
			}) as any

			expect(toolUse?.name).toBe("list")
		})
	})
})
