import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk" // Keep for type usage only

import { litellmDefaultModelId, litellmDefaultModelInfo, TOOL_PROTOCOL } from "@roo-code/types"

import { calculateApiCostOpenAI } from "../../shared/cost"

import { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"

/**
 * LiteLLM provider handler
 *
 * This handler uses the LiteLLM API to proxy requests to various LLM providers.
 * It follows the OpenAI API format for compatibility.
 */
export class LiteLLMHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "litellm",
			baseURL: `${options.litellmBaseUrl || "http://localhost:4000"}`,
			apiKey: options.litellmApiKey || "dummy-key",
			modelId: options.litellmModelId,
			defaultModelId: litellmDefaultModelId,
			defaultModelInfo: litellmDefaultModelInfo,
		})
	}

	private isGpt5(modelId: string): boolean {
		// Match gpt-5, gpt5, and variants like gpt-5o, gpt-5-turbo, gpt5-preview, gpt-5.1
		// Avoid matching gpt-50, gpt-500, etc.
		return /\bgpt-?5(?!\d)/i.test(modelId)
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info } = await this.fetchModel()
		const requestMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (this.options.litellmUsePromptCache && info.supportsPromptCache) {
			this.applyOpenAiPromptCaching(systemPrompt, requestMessages, info, metadata?.taskId)
		}

		// Required by some providers; others default to max tokens allowed
		let maxTokens: number | undefined = info.maxTokens ?? undefined

		// Check if this is a GPT-5 model that requires max_completion_tokens instead of max_tokens
		const isGPT5Model = this.isGpt5(modelId)

		// Check if model supports native tools and tools are provided with native protocol
		const supportsNativeTools = info.supportsNativeTools ?? false
		const useNativeTools =
			supportsNativeTools &&
			metadata?.tools &&
			metadata.tools.length > 0 &&
			metadata?.toolProtocol === TOOL_PROTOCOL.JSON

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: requestMessages,
			stream: true,
			stream_options: {
				include_usage: true,
			},
			...(useNativeTools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(useNativeTools && metadata.tool_choice && { tool_choice: metadata.tool_choice }),
			...(useNativeTools && { parallel_tool_calls: metadata?.parallelToolCalls ?? false }),
		}

		// GPT-5 models require max_completion_tokens instead of the deprecated max_tokens parameter
		if (isGPT5Model && maxTokens) {
			requestOptions.max_completion_tokens = maxTokens
		} else if (maxTokens) {
			requestOptions.max_tokens = maxTokens
		}

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}

		try {
			const { data: completion } = await this.client.chat.completions.create(requestOptions).withResponse()

			let lastUsage

			for await (const chunk of completion) {
				const delta = chunk.choices[0]?.delta
				const usage = chunk.usage as LiteLLMUsage

				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}

				// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
				if (delta?.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCall.id,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}

				if (usage) {
					lastUsage = usage
				}
			}

			if (lastUsage) {
				// Extract cache-related information if available
				// LiteLLM may use different field names for cache tokens
				const cacheWriteTokens =
					lastUsage.cache_creation_input_tokens || (lastUsage as any).prompt_cache_miss_tokens || 0
				const cacheReadTokens =
					lastUsage.prompt_tokens_details?.cached_tokens ||
					(lastUsage as any).cache_read_input_tokens ||
					(lastUsage as any).prompt_cache_hit_tokens ||
					0

				const { totalCost } = calculateApiCostOpenAI(
					info,
					lastUsage.prompt_tokens || 0,
					lastUsage.completion_tokens || 0,
					cacheWriteTokens,
					cacheReadTokens,
				)

				const usageData: ApiStreamUsageChunk = {
					type: "usage",
					inputTokens: lastUsage.prompt_tokens || 0,
					outputTokens: lastUsage.completion_tokens || 0,
					cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
					cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
					totalCost,
				}

				yield usageData
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`LiteLLM streaming error: ${error.message}`)
			}
			throw error
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info } = await this.fetchModel()

		// Check if this is a GPT-5 model that requires max_completion_tokens instead of max_tokens
		const isGPT5Model = this.isGpt5(modelId)

		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? 0
			}

			// GPT-5 models require max_completion_tokens instead of the deprecated max_tokens parameter
			if (isGPT5Model && info.maxTokens) {
				requestOptions.max_completion_tokens = info.maxTokens
			} else if (info.maxTokens) {
				requestOptions.max_tokens = info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`LiteLLM completion error: ${error.message}`)
			}
			throw error
		}
	}
}

// LiteLLM usage may include an extra field for Anthropic use cases.
interface LiteLLMUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
}
