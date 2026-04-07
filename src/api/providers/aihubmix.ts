import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { aihubmixDefaultModelId, aihubmixDefaultModelInfo } from "@roo-code/types"

import { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { RouterProvider } from "./router-provider"
import { getAihubmixInferenceBaseUrl } from "./utils/aihubmix-url"

export class AIHubMixHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "aihubmix",
			baseURL: getAihubmixInferenceBaseUrl(options.aihubmixBaseUrl),
			apiKey: options.aihubmixApiKey,
			modelId: options.apiModelId,
			defaultModelId: aihubmixDefaultModelId,
			defaultModelInfo: aihubmixDefaultModelInfo,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
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
