import { describe, expect, it, vi } from "vitest"

import { RooHandler } from "../roo"

describe("RooHandler prompt caching", () => {
	it("adds cache breakpoints when the selected model supports prompt caching", async () => {
		vi.spyOn(RooHandler.prototype as any, "loadDynamicModels").mockResolvedValue(undefined)

		const handler = new RooHandler({} as any)
		const create = vi.fn().mockResolvedValue({})
		;(handler as any).client = { chat: { completions: { create } }, apiKey: "test-token" }
		;(handler as any).getModel = vi.fn().mockReturnValue({
			id: "roo/sonnet",
			info: {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsPromptCache: true,
				inputPrice: 0,
				outputPrice: 0,
			},
		})

		await (handler as any).createStream("system prompt", [
			{ role: "user", content: "first question" },
			{ role: "assistant", content: "first answer" },
			{ role: "user", content: "latest question" },
		])

		const params = create.mock.calls[0]?.[0]
		expect(params.messages[0]).toEqual({
			role: "system",
			content: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }],
		})
		expect(params.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" })
		expect(params.messages[3].content[0].cache_control).toEqual({ type: "ephemeral" })
	})
})
