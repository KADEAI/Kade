import { describe, expect, it, vi } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import { BaseOpenAiCompatibleProvider } from "../base-openai-compatible-provider"

type TestModelName = "cached-model" | "uncached-model"

const providerModels: Record<TestModelName, ModelInfo> = {
	"cached-model": {
		maxTokens: 1024,
		contextWindow: 8192,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
	},
	"uncached-model": {
		maxTokens: 1024,
		contextWindow: 8192,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
}

class TestOpenAiCompatibleProvider extends BaseOpenAiCompatibleProvider<TestModelName> {
	constructor(modelId: TestModelName) {
		super({
			apiKey: "test-key",
			apiModelId: modelId,
			providerName: "Test Provider",
			baseURL: "https://example.com/v1",
			defaultProviderModelId: "cached-model",
			providerModels,
		} as any)
	}

	override getModel() {
		const id = (this.options.apiModelId as TestModelName) ?? "cached-model"
		return { id, info: providerModels[id] }
	}
}

describe("BaseOpenAiCompatibleProvider prompt caching", () => {
	it("adds cache breakpoints for models that support prompt caching", async () => {
		const provider = new TestOpenAiCompatibleProvider("cached-model")
		const create = vi.fn().mockResolvedValue({})
		;(provider as any).client = { chat: { completions: { create } } }

		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "first question" },
			{ role: "assistant", content: "first answer" },
			{ role: "user", content: "latest question" },
		]

		await (provider as any).createStream("system prompt", messages)

		const params = create.mock.calls[0]?.[0]
		expect(params.messages[0]).toEqual({
			role: "system",
			content: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }],
		})
		expect(params.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" })
		expect(params.messages[3].content[0].cache_control).toEqual({ type: "ephemeral" })
	})

	it("leaves messages untouched when prompt caching is disabled", async () => {
		const provider = new TestOpenAiCompatibleProvider("uncached-model")
		const create = vi.fn().mockResolvedValue({})
		;(provider as any).client = { chat: { completions: { create } } }

		await (provider as any).createStream("system prompt", [{ role: "user", content: "hello" }])

		const params = create.mock.calls[0]?.[0]
		expect(params.messages[0]).toEqual({ role: "system", content: "system prompt" })
		expect(params.messages[1]).toEqual({ role: "user", content: "hello" })
	})
})
