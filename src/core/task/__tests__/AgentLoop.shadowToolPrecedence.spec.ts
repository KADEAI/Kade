import { describe, expect, it } from "vitest"

import {
	isTextProtocolShadowToolBlock,
	stripTextProtocolShadowToolBlocks,
} from "../textProtocolShadowTools"

describe("AgentLoop shadow text-tool precedence", () => {
	it("identifies unified and xml tool blocks as shadow text-protocol tool uses", () => {
		expect(
			isTextProtocolShadowToolBlock({
				type: "tool_use",
				id: "unified_turn_list_1",
			}),
		).toBe(true)
		expect(
			isTextProtocolShadowToolBlock({
				type: "tool_use",
				id: "xml_turn_edit_1",
			}),
		).toBe(true)
		expect(
			isTextProtocolShadowToolBlock({
				type: "tool_use",
				id: "call_abc123",
			}),
		).toBe(false)
	})

	it("drops rewritten text-protocol tool blocks when native tool events arrive", () => {
		const blocks = stripTextProtocolShadowToolBlocks([
			{ type: "text", content: "I'll inspect the project." },
			{ type: "tool_use", id: "unified_turn_list_1", name: "list" },
			{ type: "tool_use", id: "call_abc123", name: "list" },
		] as any[])

		expect(blocks).toEqual([
			{ type: "text", content: "I'll inspect the project." },
			{ type: "tool_use", id: "call_abc123", name: "list" },
		])
	})
})
