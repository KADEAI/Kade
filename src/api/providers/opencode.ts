
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { opencodeDefaultModelId, opencodeDefaultModelInfo } from "@roo-code/types"

import { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { RouterProvider } from "./router-provider"

export class OpenCodeHandler extends RouterProvider implements SingleCompletionHandler {
    constructor(options: ApiHandlerOptions) {
        super({
            options,
            name: "opencode",
            baseURL: "https://opencode.ai/zen/v1",
            apiKey: options.opencodeApiKey,
            modelId: options.opencodeModelId,
            defaultModelId: opencodeDefaultModelId,
            defaultModelInfo: opencodeDefaultModelInfo,
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

        // Some providers/models might support temperature
        if (this.supportsTemperature(modelId)) {
            // Using a default of 0 if not set, similar to other providers
            requestOptions.temperature = this.options.modelTemperature ?? 0
        }

        const { data: completion, response } = await this.client.chat.completions
            .create(requestOptions)
            .withResponse()

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

            // Handle usage if provided in the stream (some OpenAI compatible providers do this)
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

        try {
            const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
                model: modelId,
                messages: [{ role: "user", content: prompt }],
            }

            const response = await this.client.chat.completions.create(requestOptions)
            return response.choices[0]?.message.content || ""
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`OpenCode completion error: ${error.message}`)
            }

            throw error
        }
    }
}
