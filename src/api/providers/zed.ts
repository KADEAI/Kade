import type { Anthropic } from "@anthropic-ai/sdk"

import { type ModelInfo, zedDefaultModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { convertToSimpleMessages } from "../transform/simple-format"
import type { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import {
	getZedModels,
	getZedModelsRaw,
	type ZedLanguageModel,
	type ZedUpstreamProvider,
} from "./fetchers/zed"
import {
	ZED_CLIENT_SUPPORTS_STATUS_MESSAGES_HEADER,
	ZED_CLIENT_SUPPORTS_STREAM_ENDED_HEADER,
	ZED_CLIENT_SUPPORTS_XAI_HEADER,
} from "../../integrations/zed/constants"
import { zedOAuthManager } from "../../integrations/zed/oauth"

const EXTENSION_VERSION: string = require("../../package.json").version ?? "unknown"

const DEFAULT_ZED_MODEL_INFO: ModelInfo = {
	maxTokens: 8_192,
	contextWindow: 200_000,
	supportsImages: false,
	supportsPromptCache: false,
	supportsNativeTools: false,
	inputPrice: 0,
	outputPrice: 0,
	description: "Zed hosted model",
}

type ZedCompletionEnvelope = {
	status?: {
		queued?: { position?: number }
		started?: Record<string, never>
		failed?: { code?: string; message?: string }
		stream_ended?: Record<string, never>
	}
	event?: any
}

export class ZedHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private models: Record<string, ModelInfo> = {}
	private rawModelsById = new Map<string, ZedLanguageModel>()
	private defaultModelId?: string

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
	}

	private async ensureModelsLoaded(forceRefresh: boolean = false) {
		const [models, rawResponse] = await Promise.all([
			getZedModels(forceRefresh),
			getZedModelsRaw(forceRefresh),
		])

		this.models = models
		this.rawModelsById = new Map(rawResponse.models.map((model) => [model.id, model]))
		this.defaultModelId =
			rawResponse.default_model ?? rawResponse.recommended_models?.[0] ?? rawResponse.models[0]?.id
	}

	private getUpstreamProvider(info: ModelInfo): ZedUpstreamProvider {
		return ((info as ModelInfo & { zedProvider?: ZedUpstreamProvider }).zedProvider ?? "openai") as ZedUpstreamProvider
	}

	private getFormat(provider: ZedUpstreamProvider): "anthropic" | "openai" | "gemini" {
		if (provider === "anthropic") {
			return "anthropic"
		}

		if (provider === "google") {
			return "gemini"
		}

		return "openai"
	}

	private buildProviderRequest(
		provider: ZedUpstreamProvider,
		modelId: string,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		model: ReturnType<ZedHandler["getModel"]>,
	): Record<string, unknown> {
		const simpleMessages = convertToSimpleMessages(
			messages.filter((message) => (message as { type?: string }).type !== "reasoning"),
		)
		const temperature = this.options.modelTemperature ?? (model.info.defaultTemperature as number | undefined) ?? 0.7
		const maxOutputTokens = this.options.modelMaxTokens ?? model.maxTokens ?? model.info.maxTokens ?? 8192

		switch (provider) {
			case "anthropic":
				return {
					model: modelId,
					system: systemPrompt || undefined,
					messages: this.mergeConsecutiveMessages(simpleMessages).map((message) => ({
						role: message.role,
						content: [{ type: "text", text: message.content }],
					})),
					max_tokens: maxOutputTokens,
					temperature,
					stream: true,
				}
			case "google":
				return {
					model: `models/${modelId}`,
					system_instruction: systemPrompt
						? {
								parts: [{ text: systemPrompt }],
							}
						: undefined,
					contents: this.mergeConsecutiveMessages(simpleMessages).map((message) => ({
						role: message.role === "assistant" ? "model" : "user",
						parts: [{ text: message.content }],
					})),
					generation_config: {
						candidateCount: 1,
						maxOutputTokens: maxOutputTokens,
						temperature,
					},
				}
			case "x_ai":
				return {
					model: modelId,
					messages: [
						...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
						...simpleMessages,
					],
					stream: true,
					stream_options: { include_usage: true },
					temperature,
					max_tokens: maxOutputTokens,
				}
			case "openai":
			default:
				return {
					model: modelId,
					input: [
						...(systemPrompt
							? [
									{
										type: "message",
										role: "system",
										content: [{ type: "input_text", text: systemPrompt }],
									},
								]
							: []),
						...simpleMessages.map((message) => ({
							type: "message",
							role: message.role,
							content: [
								message.role === "assistant"
									? {
											type: "output_text",
											text: message.content,
											annotations: [],
										}
									: {
											type: "input_text",
											text: message.content,
										},
							],
						})),
					],
					stream: true,
					max_output_tokens: maxOutputTokens,
					temperature,
				}
		}
	}

	private mergeConsecutiveMessages(messages: Array<{ role: "user" | "assistant"; content: string }>) {
		const merged: Array<{ role: "user" | "assistant"; content: string }> = []

		for (const message of messages) {
			if (!message.content) {
				continue
			}

			const last = merged.at(-1)
			if (last && last.role === message.role) {
				last.content += `\n\n${message.content}`
			} else {
				merged.push({ ...message })
			}
		}

		return merged
	}

	private async *parseJsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<ZedCompletionEnvelope> {
		const reader = stream.getReader()
		const decoder = new TextDecoder("utf-8")
		let buffer = ""

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}

				buffer += decoder.decode(value, { stream: true })
				let newlineIndex = buffer.indexOf("\n")

				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex).trim()
					buffer = buffer.slice(newlineIndex + 1)

					if (line) {
						yield JSON.parse(line) as ZedCompletionEnvelope
					}

					newlineIndex = buffer.indexOf("\n")
				}
			}
		} finally {
			reader.releaseLock()
		}

		const finalLine = buffer.trim()
		if (finalLine) {
			yield JSON.parse(finalLine) as ZedCompletionEnvelope
		}
	}

	private normalizeUsage(provider: ZedUpstreamProvider, event: any): ApiStreamUsageChunk | undefined {
		switch (provider) {
			case "anthropic": {
				const usage = event?.usage ?? event?.message?.usage
				if (!usage) {
					return undefined
				}

				return {
					type: "usage",
					inputTokens: usage.input_tokens ?? 0,
					outputTokens: usage.output_tokens ?? 0,
					cacheReadTokens: usage.cache_read_input_tokens,
					cacheWriteTokens: usage.cache_creation_input_tokens,
					totalCost: 0,
				}
			}
			case "google": {
				const usage = event?.usageMetadata
				if (!usage) {
					return undefined
				}

				return {
					type: "usage",
					inputTokens: usage.promptTokenCount ?? 0,
					outputTokens: usage.candidatesTokenCount ?? 0,
					cacheReadTokens: usage.cachedContentTokenCount,
					reasoningTokens: usage.thoughtsTokenCount,
					totalCost: 0,
				}
			}
			case "x_ai": {
				const usage = event?.usage
				if (!usage) {
					return undefined
				}

				return {
					type: "usage",
					inputTokens: usage.prompt_tokens ?? 0,
					outputTokens: usage.completion_tokens ?? 0,
					totalCost: 0,
				}
			}
			case "openai":
			default: {
				const usage = event?.response?.usage ?? event?.usage
				if (!usage) {
					return undefined
				}

				return {
					type: "usage",
					inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
					outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
					cacheReadTokens:
						usage.input_tokens_details?.cached_tokens ?? usage.cached_tokens ?? undefined,
					reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
					totalCost: 0,
				}
			}
		}
	}

	private async handleErrorResponse(response: Response): Promise<never> {
		const body = await response.text()
		let message = `Zed API error (${response.status})`

		try {
			const parsed = JSON.parse(body) as { message?: string; code?: string }
			if (parsed.message) {
				message = parsed.message
			} else if (parsed.code) {
				message = `${message}: ${parsed.code}`
			}
		} catch {
			if (body) {
				message = `${message}: ${body}`
			}
		}

		throw new Error(message)
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.ensureModelsLoaded()

		const model = this.getModel()
		const provider = this.getUpstreamProvider(model.info)
		const providerRequest = this.buildProviderRequest(provider, model.id, systemPrompt, messages, model)

		const response = await zedOAuthManager.fetchWithLlmToken("/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				[ZED_CLIENT_SUPPORTS_STATUS_MESSAGES_HEADER]: "true",
				[ZED_CLIENT_SUPPORTS_STREAM_ENDED_HEADER]: "true",
				[ZED_CLIENT_SUPPORTS_XAI_HEADER]: "true",
				"x-zed-version": EXTENSION_VERSION,
			},
			body: JSON.stringify({
				thread_id: metadata?.taskId,
				provider,
				model: model.id,
				provider_request: providerRequest,
			}),
		})

		if (!response.ok) {
			await this.handleErrorResponse(response)
		}

		if (!response.body) {
			throw new Error("Zed returned an empty response stream.")
		}

		let lastUsage: ApiStreamUsageChunk | undefined

		for await (const line of this.parseJsonLines(response.body)) {
			const status = line.status
			if (status?.failed) {
				throw new Error(status.failed.message || status.failed.code || "Zed completion failed.")
			}

			const event = line.event
			if (!event) {
				continue
			}

			const usage = this.normalizeUsage(provider, event)
			if (usage) {
				lastUsage = usage
			}

			switch (provider) {
				case "anthropic": {
					if (event.type === "content_block_delta") {
						if (event.delta?.type === "text_delta" && event.delta.text) {
							yield { type: "text", text: event.delta.text }
						} else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
							yield { type: "reasoning", text: event.delta.thinking }
						}
					}
					break
				}
				case "google": {
					const candidate = event.candidates?.[0]
					for (const part of candidate?.content?.parts ?? []) {
						if (part.text) {
							if (part.thought === true) {
								yield { type: "reasoning", text: part.text }
							} else {
								yield { type: "text", text: part.text }
							}
						}
					}
					break
				}
				case "x_ai": {
					const delta = event.choices?.[0]?.delta
					if (delta?.content) {
						yield { type: "text", text: delta.content }
					}
					if (delta?.reasoning_content) {
						yield { type: "reasoning", text: delta.reasoning_content }
					}
					break
				}
				case "openai":
				default: {
					if (event.type === "response.output_text.delta" && event.delta) {
						yield { type: "text", text: event.delta }
					} else if (event.type === "response.text.delta" && event.delta) {
						yield { type: "text", text: event.delta }
					} else if (
						(event.type === "response.reasoning.delta" ||
							event.type === "response.reasoning_summary.delta" ||
							event.type === "response.reasoning_summary_text.delta") &&
						event.delta
					) {
						yield { type: "reasoning", text: event.delta }
					}
					break
				}
			}
		}

		if (lastUsage) {
			yield lastUsage
		}
	}

	override getModel() {
		const explicitId = this.options.apiModelId
		const resolvedId =
			(explicitId && this.models[explicitId] ? explicitId : undefined) ??
			(this.defaultModelId && this.models[this.defaultModelId] ? this.defaultModelId : undefined) ??
			Object.keys(this.models)[0] ??
			explicitId ??
			(zedDefaultModelId || "zed")

		const info = this.models[resolvedId] ?? DEFAULT_ZED_MODEL_INFO
		const provider = this.getUpstreamProvider(info)
		const format = this.getFormat(provider)
		const params =
			format === "anthropic"
				? getModelParams({
						format: "anthropic",
						modelId: resolvedId,
						model: info,
						settings: this.options,
					})
				: format === "gemini"
					? getModelParams({
							format: "gemini",
							modelId: resolvedId,
							model: info,
							settings: this.options,
						})
					: getModelParams({
							format: "openai",
							modelId: resolvedId,
							model: info,
							settings: this.options,
						})

		return {
			id: resolvedId,
			info,
			...params,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		let output = ""

		for await (const chunk of this.createMessage("", [{ role: "user", content: prompt }])) {
			if (chunk.type === "text") {
				output += chunk.text
			}
		}

		return output
	}
}
