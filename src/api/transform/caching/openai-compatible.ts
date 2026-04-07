import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import { MultiPointStrategy } from "../cache-strategy/multi-point-strategy"
import type {
	CachePointPlacement,
	ModelInfo as CacheStrategyModelInfo,
} from "../cache-strategy/types"

type PromptCachePlanInput = {
	systemPrompt: string
	messages: OpenAI.Chat.ChatCompletionMessageParam[]
	modelInfo: ModelInfo
	previousCachePointPlacements?: CachePointPlacement[]
}

type PromptCachePlanResult = {
	appliedMessageIndices: number[]
	messageCachePointPlacements?: CachePointPlacement[]
}

function getCacheModelInfo(modelInfo: ModelInfo): CacheStrategyModelInfo {
	return {
		maxTokens: modelInfo.maxTokens ?? 8192,
		contextWindow: modelInfo.contextWindow,
		supportsPromptCache: modelInfo.supportsPromptCache,
		maxCachePoints: modelInfo.maxCachePoints ?? 3,
		minTokensPerCachePoint: modelInfo.minTokensPerCachePoint ?? 50,
		cachableFields: (modelInfo.cachableFields as Array<"system" | "messages" | "tools"> | undefined) ?? [
			"system",
			"messages",
		],
	}
}

function createImageBlock(): Anthropic.ImageBlockParam {
	return {
		type: "image",
		source: {
			type: "base64",
			media_type: "image/png",
			data: "",
		},
	}
}

function convertMessageContentToAnthropicBlocks(
	message: OpenAI.Chat.ChatCompletionMessageParam,
): Anthropic.ContentBlockParam[] | string {
	if (typeof message.content === "string") {
		return message.content
	}

	const contentBlocks: Anthropic.ContentBlockParam[] = []

	if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (part.type === "text") {
				contentBlocks.push({ type: "text", text: part.text })
			} else if (part.type === "image_url") {
				contentBlocks.push(createImageBlock())
			}
		}
	}

	if (message.role === "assistant" && "tool_calls" in message && Array.isArray(message.tool_calls)) {
		for (const toolCall of message.tool_calls) {
			if (toolCall.type !== "function") {
				continue
			}

			contentBlocks.push({
				type: "tool_use",
				id: toolCall.id,
				name: toolCall.function.name,
				input: JSON.parse(toolCall.function.arguments || "{}"),
			})
		}
	}

	return contentBlocks.length > 0 ? contentBlocks : ""
}

function convertOpenAiMessagesToAnthropicLike(
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
): {
	messages: Anthropic.Messages.MessageParam[]
	sourceIndices: number[]
} {
	const anthropicMessages: Anthropic.Messages.MessageParam[] = []
	const sourceIndices: number[] = []

	for (const [index, message] of messages.entries()) {
		if (message.role === "system" || message.role === "developer") {
			continue
		}

		anthropicMessages.push({
			role: message.role === "assistant" ? "assistant" : "user",
			content: convertMessageContentToAnthropicBlocks(message),
		})
		sourceIndices.push(index)
	}

	return { messages: anthropicMessages, sourceIndices }
}

function getLastUserMessageIndices(
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
	limit: number,
): number[] {
	return messages
		.map((message, index) => ({ message, index }))
		.filter(({ message }) => message.role === "user")
		.slice(-limit)
		.map(({ index }) => index)
}

function applyCacheControlToMessage(message: OpenAI.Chat.ChatCompletionMessageParam) {
	if (typeof message.content === "string") {
		message.content = [{ type: "text", text: message.content }]
	}

	if (!Array.isArray(message.content)) {
		return
	}

	let lastTextPart = message.content.filter((part) => part.type === "text").pop()

	if (!lastTextPart) {
		lastTextPart = { type: "text", text: "..." }
		message.content.push(lastTextPart)
	}

	;(lastTextPart as any).cache_control = { type: "ephemeral" }
}

function applySystemCacheControl(systemPrompt: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
	const systemIndex = messages.findIndex((message) => message.role === "system")
	if (systemIndex === -1) {
		return
	}

	messages[systemIndex] = {
		role: "system",
		content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
	}
}

export function planOpenAiCompatiblePromptCaching(input: PromptCachePlanInput): PromptCachePlanResult {
	const { messages, sourceIndices } = convertOpenAiMessagesToAnthropicLike(input.messages)
	const strategy = new MultiPointStrategy({
		modelInfo: getCacheModelInfo(input.modelInfo),
		systemPrompt: input.systemPrompt,
		messages,
		usePromptCache: input.modelInfo.supportsPromptCache,
		previousCachePointPlacements: input.previousCachePointPlacements,
	})
	const result = strategy.determineOptimalCachePoints()
	const placements = result.messageCachePointPlacements ?? []
	const appliedMessageIndices = placements
		.map((placement) => sourceIndices[placement.index])
		.filter((index): index is number => typeof index === "number" && input.messages[index]?.role === "user")

	return {
		appliedMessageIndices,
		messageCachePointPlacements: placements,
	}
}

export function applyOpenAiCompatiblePromptCaching(input: PromptCachePlanInput): PromptCachePlanResult {
	applySystemCacheControl(input.systemPrompt, input.messages)

	const plan = planOpenAiCompatiblePromptCaching(input)
	const targetIndices =
		plan.appliedMessageIndices.length > 0 ? plan.appliedMessageIndices : getLastUserMessageIndices(input.messages, 2)

	for (const index of targetIndices) {
		const message = input.messages[index]
		if (message?.role === "user") {
			applyCacheControlToMessage(message)
		}
	}

	return {
		appliedMessageIndices: targetIndices,
		messageCachePointPlacements: plan.messageCachePointPlacements,
	}
}
