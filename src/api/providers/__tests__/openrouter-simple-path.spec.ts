import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OpenRouterHandler } from "../openrouter"

const baseModel = {
	id: "openai/gpt-4o-mini",
	info: {
		maxTokens: 8192,
		contextWindow: 128000,
		supportsPromptCache: false,
		supportsNativeTools: true,
		inputPrice: 0,
		outputPrice: 0,
	},
	maxTokens: 2048,
	temperature: 0,
	topP: undefined,
	reasoning: undefined,
	verbosity: undefined,
}

describe("OpenRouter simple path", () => {
	beforeEach(() => {
		vi.spyOn(OpenRouterHandler.prototype as any, "loadDynamicModels").mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("uses the simple path only for plain OpenRouter models", () => {
		const handler = new OpenRouterHandler({ openRouterApiKey: "test-key", openRouterModelId: baseModel.id } as any)
		expect((handler as any).shouldUseSimpleStreamPath(baseModel)).toBe(true)

		const withReasoning = { ...baseModel, reasoning: { effort: "low" } }
		expect((handler as any).shouldUseSimpleStreamPath(withReasoning)).toBe(false)

		const geminiModel = { ...baseModel, id: "google/gemini-2.5-flash" }
		expect((handler as any).shouldUseSimpleStreamPath(geminiModel)).toBe(false)

		const deepseekModel = { ...baseModel, id: "deepseek/deepseek-r1" }
		expect((handler as any).shouldUseSimpleStreamPath(deepseekModel)).toBe(false)

		const routedHandler = new OpenRouterHandler({
			openRouterApiKey: "test-key",
			openRouterModelId: baseModel.id,
			openRouterSpecificProvider: "baseten",
		} as any)
		expect((routedHandler as any).shouldUseSimpleStreamPath(baseModel)).toBe(false)

		const transformedHandler = new OpenRouterHandler({
			openRouterApiKey: "test-key",
			openRouterModelId: baseModel.id,
			openRouterUseMiddleOutTransform: true,
		} as any)
		expect((transformedHandler as any).shouldUseSimpleStreamPath(baseModel)).toBe(false)
	})

	it("streams text and tool chunks through the simple path without router transforms", async () => {
		const handler = new OpenRouterHandler({ openRouterApiKey: "test-key", openRouterModelId: baseModel.id } as any)

		vi.spyOn(handler as any, "fetchModel").mockResolvedValue(baseModel)

		async function* stream() {
			yield {
				choices: [{ delta: { content: "hello" }, finish_reason: null }],
			} as any
			yield {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_123",
									function: {
										name: "write",
										arguments: "{\"path\":\"demo.txt\"}",
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
				usage: { prompt_tokens: 12, completion_tokens: 4 },
			} as any
		}

		const create = vi.fn().mockResolvedValue(stream())
		;(handler as any).client = { chat: { completions: { create } } }

		const chunks = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }] as any)) {
			chunks.push(chunk)
		}

		expect(create).toHaveBeenCalledTimes(1)
		expect(create.mock.calls[0]?.[0]).not.toHaveProperty("transforms")
		expect(create.mock.calls[0]?.[0]).not.toHaveProperty("provider")
		expect(chunks).toEqual([
			{ type: "text", text: "hello" },
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_123",
				name: "write",
				arguments: "{\"path\":\"demo.txt\"}",
			},
			{
				type: "usage",
				inputTokens: 12,
				outputTokens: 4,
				cacheReadTokens: undefined,
				reasoningTokens: undefined,
				totalCost: 0,
			},
		])
	})
})
