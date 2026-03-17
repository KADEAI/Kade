import type OpenAI from "openai"
import type Anthropic from "@anthropic-ai/sdk"

/**
 * Ultra-simple tool parameter definition
 */
export type ToolParam = {
	type?: string | string[]
	description: string
	enum?: string[]
	items?: any
	properties?: Record<string, ToolParam> // Support nested objects
}

/**
 * Standardized Tool format (Simplified)
 */
export interface Tool {
	name: string
	description: string
	params?: Record<string, string | ToolParam> // Can be just a description string or a full object
	required?: string[]
	strict?: boolean
	// Fallback for complex schemas
	input_schema?: Anthropic.Tool.InputSchema
}

/**
 * Converts our ultra-simple Tool format to OpenAI's ChatCompletionTool format.
 */
export function convertToOpenAI(tool: Tool): OpenAI.Chat.ChatCompletionTool {
	const properties: Record<string, any> = {}
	const required: string[] = tool.required || []

	function convertParam(value: ToolParam): any {
		const param: any = {
			type: value.type || "string",
			description: value.description,
			...(value.enum ? { enum: value.enum } : {}),
			...(value.items ? { items: value.items } : {}),
		}

		if (value.properties) {
			const nestedProps: Record<string, any> = {}
			for (const [k, v] of Object.entries(value.properties)) {
				nestedProps[k] = convertParam(v)
			}
			param.properties = nestedProps
			// Make all properties required by default for nested objects in strict mode? 
			// For now, let's just include all keys as required if not specified otherwise
			param.required = Object.keys(nestedProps)
			param.additionalProperties = false
		}

		return param
	}

	if (tool.params) {
		for (const [key, value] of Object.entries(tool.params)) {
			if (typeof value === "string") {
				properties[key] = { type: "string", description: value }
			} else {
				properties[key] = convertParam(value)
			}
			// If not explicitly provided in required array, we assume it's optional
		}
	}

	const parameters = tool.input_schema || {
		type: "object",
		properties,
		required: tool.required ? required : Object.keys(properties),
		additionalProperties: false,
	}

	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: parameters as any,
			strict: tool.strict ?? true,
		},
	}
}

/**
 * Converts an OpenAI ChatCompletionTool to Anthropic's Tool format.
 */
export function convertOpenAIToolToAnthropic(tool: OpenAI.Chat.ChatCompletionTool): Anthropic.Tool {
	if (tool.type !== "function") {
		throw new Error(`Unsupported tool type: ${tool.type}`)
	}

	return {
		name: tool.function.name,
		description: tool.function.description || "",
		input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
	}
}

export function convertOpenAIToolsToAnthropic(tools: OpenAI.Chat.ChatCompletionTool[]): Anthropic.Tool[] {
	return tools.map(convertOpenAIToolToAnthropic)
}
