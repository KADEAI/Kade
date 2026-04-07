import { describe, expect, it } from "vitest"

import { getEffectiveStreamingToolUse } from "../groupedNativeStreaming"

describe("grouped native streaming", () => {
	it("unwraps partial content router writes into a write tool block", () => {
		const effective = getEffectiveStreamingToolUse({
			type: "tool_use",
			id: "content_partial_1",
			name: "batch",
			originalName: "content",
			partial: true,
			params: {},
			nativeArgs: {
				calls: [
					{
						name: "write",
						arguments: {
							path: "notes.txt",
							content: "hello",
						},
					},
				],
			},
		} as any) as any

		expect(effective.name).toBe("write")
		expect(effective.partial).toBe(true)
		expect(effective.id).toBe("content_partial_1::write:0")
		expect(effective.params).toMatchObject({
			path: "notes.txt",
			content: "hello",
		})
	})

	it("unwraps partial content router edits into an edit tool block", () => {
		const effective = getEffectiveStreamingToolUse({
			type: "tool_use",
			id: "content_partial_2",
			name: "batch",
			originalName: "content",
			partial: true,
			params: {},
			nativeArgs: {
				calls: [
					{
						name: "edit",
						arguments: {
							path: "src/app.ts",
							lineRange: "10-12",
							oldText: "a",
							newText: "b",
						},
					},
				],
			},
		} as any) as any

		expect(effective.name).toBe("edit")
		expect(effective.partial).toBe(true)
		expect(effective.id).toBe("content_partial_2::edit:0")
		expect(effective.nativeArgs).toMatchObject({
			path: "src/app.ts",
			edit: [{ lineRange: "10-12", oldText: "a", newText: "b" }],
		})
	})

	it("unwraps partial tools router reads into a read tool block", () => {
		const effective = getEffectiveStreamingToolUse({
			type: "tool_use",
			id: "tools_partial_1",
			name: "batch",
			originalName: "tools",
			partial: true,
			params: {},
			nativeArgs: {
				calls: [{ name: "read", arguments: { files: ["src/app.ts:H20"] } }],
			},
		} as any) as any

		expect(effective.name).toBe("read")
		expect(effective.partial).toBe(true)
		expect(effective.id).toBe("tools_partial_1::read:0")
		expect(effective.nativeArgs).toMatchObject({
			files: [{ path: "src/app.ts", head: 20 }],
		})
	})

	it("leaves standalone non-batch tool blocks unchanged", () => {
		const original = {
			type: "tool_use",
			id: "write_partial_direct",
			name: "write",
			partial: true,
			params: {
				path: "notes.txt",
				content: "hello",
			},
		} as any

		expect(getEffectiveStreamingToolUse(original)).toBe(original)
	})
})
