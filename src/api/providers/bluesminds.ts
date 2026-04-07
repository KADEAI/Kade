import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { bluesmindsDefaultModelId, bluesmindsDefaultModelInfo } from "@roo-code/types"

import { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { RouterProvider } from "./router-provider"
import { BLUESMINDS_BASE_URL } from "./fetchers/bluesminds"

export class BluesmindsHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "bluesminds",
			baseURL: options.bluesmindsBaseUrl || BLUESMINDS_BASE_URL,
			apiKey: options.bluesmindsApiKey,
			modelId: options.apiModelId,
			defaultModelId: bluesmindsDefaultModelId,
			defaultModelInfo: bluesmindsDefaultModelInfo,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info } = await this.fetchModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
		}

		if (info.maxTokens) {
			requestOptions.max_tokens = info.maxTokens
		}

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}

		const { data: completion } = await this.client.chat.completions.create(requestOptions).withResponse()

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta as any

			if (delta?.reasoning_content) {
				yield { type: "reasoning", text: delta.reasoning_content }
			}

			if (delta?.reasoning) {
				yield { type: "reasoning", text: delta.reasoning }
			}

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens,
					outputTokens: chunk.usage.completion_tokens,
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId } = await this.fetchModel()

		const response = await this.client.chat.completions.create({
			model: modelId,
			messages: [{ role: "user", content: prompt }],
		})

		return response.choices[0]?.message.content || ""
	}
}
