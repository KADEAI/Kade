import { describe, expect, it, vi } from "vitest"
import type { ModeConfig } from "@roo-code/types"

import { filterNativeToolsForMode } from "../filter-tools-for-mode"
import { getNativeTools } from "../native-tools"

vi.mock("../../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: () => ({
			isEnabled: () => false,
		}),
	},
}))

describe("filterNativeToolsForMode native router specialization", () => {
	it("exposes the tool router with the structured calls array schema", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const filtered = filterNativeToolsForMode(
			getNativeTools(),
			"code",
			[codeMode],
			{ imageGeneration: false },
			undefined,
			{
				browserToolEnabled: false,
				todoListEnabled: false,
				subAgentToolEnabled: false,
			},
			undefined,
		)

		const toolRouter = filtered.find((tool) => "name" in tool && tool.name === "tool") as any
		expect(toolRouter).toBeTruthy()
		expect(toolRouter.params.calls.type).toBe("array")
		expect(toolRouter.params.calls.items.type).toBe("object")
		expect(toolRouter.params.content).toBeUndefined()
		expect(toolRouter.description).toContain('"tool": "agent"')
	})

	it("still exposes tool when only edit-group tools are allowed", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["edit"] as const,
		}

		const filtered = filterNativeToolsForMode(
			getNativeTools(),
			"code",
			[codeMode],
			{},
			undefined,
			{},
			undefined,
		)

		const toolRouter = filtered.find((tool) => "name" in tool && tool.name === "tool") as any
		expect(toolRouter).toBeTruthy()
		expect(toolRouter.params.calls.type).toBe("array")
		expect(toolRouter.description).toContain('"tool": "edit"')
		expect(toolRouter.description).toContain('"tool": "write"')
	})
})
