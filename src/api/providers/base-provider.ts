import { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { ApiStream } from "../transform/stream"
import { countTokens } from "../../utils/countTokens"
import type { CachePointPlacement } from "../transform/cache-strategy/types"
import { applyOpenAiCompatiblePromptCaching } from "../transform/caching/openai-compatible"

import { normalizeObjectAdditionalPropertiesFalse } from "./kilocode/openai-strict-schema" // kade_change
import { toOpenAIFunctionTool } from "../../core/prompts/tools/native-tools/converters"

/**
 * Base class for API providers that implements common functionality.
 */
export abstract class BaseProvider implements ApiHandler {
	private readonly promptCachePlacementsByConversation = new Map<string, CachePointPlacement[]>()

	abstract createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream

	abstract getModel(): { id: string; info: ModelInfo }

	/**
	 * Converts an array of tools (potentially including simplified Tool objects)
	 * to be compatible with OpenAI's expected native function calling format.
	 */
	protected convertToolsForOpenAI(tools: any[] | undefined): OpenAI.Chat.ChatCompletionTool[] | undefined {
		if (!tools) {
			return undefined
		}

		return tools.map((tool) => {
			const convertedTool = toOpenAIFunctionTool(tool) as OpenAI.Chat.ChatCompletionFunctionTool
			const strict = convertedTool.function.strict ?? true

			return {
				type: "function",
				function: {
					...convertedTool.function,
					...(strict ? { strict: true } : {}),
					parameters: strict
						? this.convertToolSchemaForOpenAI(convertedTool.function.parameters)
						: normalizeObjectAdditionalPropertiesFalse(convertedTool.function.parameters),
				},
			}
		}) as OpenAI.Chat.ChatCompletionTool[]
	}

	/**
	 * Converts tool schemas to be compatible with OpenAI's strict mode by:
	 * - Ensuring all properties are in the required array (strict mode requirement)
	 * - Converting nullable types (["type", "null"]) to non-nullable ("type")
	 * - Recursively processing nested objects and arrays
	 *
	 * This matches the behavior of ensureAllRequired in openai-native.ts
	 */
	protected convertToolSchemaForOpenAI(schema: any): any {
		if (!schema || typeof schema !== "object" || schema.type !== "object") {
			return schema
		}

		const result = { ...schema }

		if (result.properties) {
			const allKeys = Object.keys(result.properties)
			// OpenAI strict mode requires ALL properties to be in required array
			result.required = allKeys

			// Recursively process nested objects and convert nullable types
			const newProps = { ...result.properties }
			for (const key of allKeys) {
				const prop = newProps[key]

				// Handle nullable types by removing null
				if (prop && Array.isArray(prop.type) && prop.type.includes("null")) {
					const nonNullTypes = prop.type.filter((t: string) => t !== "null")
					prop.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes
				}

				// Recursively process nested objects
				if (prop && prop.type === "object") {
					newProps[key] = this.convertToolSchemaForOpenAI(prop)
				} else if (prop && prop.type === "array" && prop.items?.type === "object") {
					newProps[key] = {
						...prop,
						items: this.convertToolSchemaForOpenAI(prop.items),
					}
				}
			}
			result.properties = newProps
		}

		return normalizeObjectAdditionalPropertiesFalse(result) // kade_change: normalize invalid schemes for strict mode
	}

	/**
	 * Default token counting implementation using tiktoken.
	 * Providers can override this to use their native token counting endpoints.
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	async countTokens(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
		if (content.length === 0) {
			return 0
		}

		return countTokens(content, { useWorker: true })
	}

	protected applyOpenAiPromptCaching(
		systemPrompt: string,
		messages: OpenAI.Chat.ChatCompletionMessageParam[],
		modelInfo: ModelInfo,
		conversationId?: string,
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		if (!modelInfo.supportsPromptCache) {
			return messages
		}

		const previousCachePointPlacements = conversationId
			? this.promptCachePlacementsByConversation.get(conversationId)
			: undefined

		const result = applyOpenAiCompatiblePromptCaching({
			systemPrompt,
			messages,
			modelInfo,
			previousCachePointPlacements,
		})

		if (conversationId) {
			if (result.messageCachePointPlacements && result.messageCachePointPlacements.length > 0) {
				this.promptCachePlacementsByConversation.set(conversationId, result.messageCachePointPlacements)
			} else {
				this.promptCachePlacementsByConversation.delete(conversationId)
			}
		}

		return messages
	}
}
