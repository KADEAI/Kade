import { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { ApiStream } from "../transform/stream"
import { countTokens } from "../../utils/countTokens"

import { normalizeObjectAdditionalPropertiesFalse } from "./kilocode/openai-strict-schema" // kilocode_change

/**
 * Base class for API providers that implements common functionality.
 */
export abstract class BaseProvider implements ApiHandler {
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

		// If the model specifically requests the flat format, deliver it directly
		if (this.getModel().info.supportsFlatTools) {
			return tools as OpenAI.Chat.ChatCompletionTool[]
		}

		return tools.map((tool) => {
			// If it's already in OpenAI format, just ensure strict mode
			if (tool.type === "function") {
				return {
					...tool,
					function: {
						...tool.function,
						strict: true,
						parameters: this.convertToolSchemaForOpenAI(tool.function.parameters),
					},
				}
			}

			// If it's our simplified format, convert it!
			const properties: Record<string, any> = {}
			const required: string[] = tool.required || []

			if (tool.params) {
				for (const [key, value] of Object.entries(tool.params as Record<string, any>)) {
					if (typeof value === "string") {
						properties[key] = { type: "string", description: value }
					} else {
						// value is ToolParam
						properties[key] = {
							type: value.type || "string",
							description: value.description,
							...(value.enum ? { enum: value.enum } : {}),
							...(value.items ? { items: value.items } : {}),
						}
					}
				}
			}

			// If input_schema is provided (legacy/compat), use it, otherwise build from properties
			const parameters = tool.input_schema || {
				type: "object",
				properties,
				required: required.length > 0 ? required : Object.keys(properties),
				additionalProperties: false,
			}

			return {
				type: "function",
				function: {
					name: tool.name,
					description: tool.description,
					strict: tool.strict ?? true,
					parameters,
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

		return normalizeObjectAdditionalPropertiesFalse(result) // kilocode_change: normalize invalid schemes for strict mode
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
}
