import { describe, expect, it, vi } from "vitest"
import type { ModeConfig } from "@roo-code/types"

vi.mock("vscode")

import { validateToolUse } from "../validateToolUse"

describe("validateToolUse", () => {
	const customModes: ModeConfig[] = [
		{
			slug: "mcp-mode",
			name: "MCP Mode",
			roleDefinition: "You can use MCP tools",
			groups: ["mcp"],
		},
	]

	it("allows valid MCP tool names that use the supported function-name format", () => {
		expect(() =>
			validateToolUse("mcp--weather--get_forecast" as any, "mcp-mode", customModes),
		).not.toThrow()
	})

	it("rejects malformed MCP tool names instead of treating them as dynamic tools", () => {
		expect(() =>
			validateToolUse("mcp_server_tool" as any, "mcp-mode", customModes),
		).toThrow('Unknown tool "mcp_server_tool"')
	})
})
