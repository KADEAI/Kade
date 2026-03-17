import { describe, expect, it } from "vitest"

import { getMcpToolsForUnified } from "../mcp-tools"

describe("getMcpToolsForUnified", () => {
	it("renders MCP usage examples without the extra tool prefix", () => {
		const prompt = getMcpToolsForUnified({
			getServers: () => [
				{
					name: "poly-mcp",
					tools: [
						{
							name: "file_tree",
							description: "List files",
							enabledForPrompt: true,
						},
					],
				},
			],
		} as any)

		expect(prompt).toContain("```poly-mcp_file_tree")
		expect(prompt).not.toContain("```tool poly-mcp_file_tree")
	})
})
