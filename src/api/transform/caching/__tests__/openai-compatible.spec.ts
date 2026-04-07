import { describe, expect, it } from "vitest"
import OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import {
	applyOpenAiCompatiblePromptCaching,
	planOpenAiCompatiblePromptCaching,
} from "../openai-compatible"

const modelInfo: ModelInfo = {
	maxTokens: 4096,
	contextWindow: 200000,
	supportsPromptCache: true,
	maxCachePoints: 3,
	minTokensPerCachePoint: 50,
	cachableFields: ["system", "messages"],
	inputPrice: 0,
	outputPrice: 0,
}

function createMessages(userCount: number): OpenAI.Chat.ChatCompletionMessageParam[] {
	const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: "system prompt" }]

	for (let i = 0; i < userCount; i++) {
		messages.push({
			role: "user",
			content: `user-${i} ` + "long context ".repeat(30),
		})
		messages.push({
			role: "assistant",
			content: `assistant-${i} ` + "reply context ".repeat(20),
		})
	}

	return messages
}

describe("openai-compatible prompt caching", () => {
	it("falls back to caching the last two user messages when the planner has no placements", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: "system prompt" },
			{ role: "user", content: "short" },
			{ role: "assistant", content: "reply" },
			{ role: "user", content: "latest" },
		]

		const result = applyOpenAiCompatiblePromptCaching({
			systemPrompt: "system prompt",
			messages,
			modelInfo,
		})

		expect(result.appliedMessageIndices).toEqual([1, 3])
		expect((messages[3].content as any[])[0].cache_control).toEqual({ type: "ephemeral" })
	})

	it("reuses previous placements and adds a new cache point as the conversation grows", () => {
		const firstMessages = createMessages(2)
		const firstPlan = planOpenAiCompatiblePromptCaching({
			systemPrompt: "system prompt",
			messages: firstMessages,
			modelInfo,
		})

		expect(firstPlan.appliedMessageIndices.length).toBe(1)

		const secondMessages = createMessages(4)
		const secondPlan = planOpenAiCompatiblePromptCaching({
			systemPrompt: "system prompt",
			messages: secondMessages,
			modelInfo,
			previousCachePointPlacements: firstPlan.messageCachePointPlacements,
		})

		expect(secondPlan.appliedMessageIndices.length).toBeGreaterThan(1)
		expect(secondPlan.messageCachePointPlacements?.length).toBeGreaterThan(1)
		expect(secondPlan.appliedMessageIndices[0]).toBeLessThan(secondPlan.appliedMessageIndices[1])
	})
})
