import type { ModelInfo } from "@roo-code/types"

import type { ModelRecord } from "../../../shared/api"
import {
	ZED_CLIENT_SUPPORTS_XAI_HEADER,
} from "../../../integrations/zed/constants"
import { zedOAuthManager } from "../../../integrations/zed/oauth"

export type ZedUpstreamProvider = "anthropic" | "openai" | "google" | "x_ai"

export interface ZedEffortLevel {
	name: string
	value: string
	is_default?: boolean
}

export interface ZedLanguageModel {
	provider: ZedUpstreamProvider
	id: string
	display_name: string
	is_latest?: boolean
	max_token_count: number
	max_token_count_in_max_mode?: number | null
	max_output_tokens: number
	supports_tools: boolean
	supports_images: boolean
	supports_thinking: boolean
	supports_fast_mode?: boolean
	supported_effort_levels: ZedEffortLevel[]
	supports_streaming_tools?: boolean
	supports_parallel_tool_calls?: boolean
}

export interface ZedListModelsResponse {
	models: ZedLanguageModel[]
	default_model?: string
	default_fast_model?: string
	recommended_models: string[]
}

let lastResponse: ZedListModelsResponse | null = null

export async function getZedModelsRaw(forceRefresh: boolean = false): Promise<ZedListModelsResponse> {
	if (!forceRefresh && lastResponse) {
		return lastResponse
	}

	const response = await zedOAuthManager.fetchWithLlmToken("/models", {
		method: "GET",
		headers: {
			[ZED_CLIENT_SUPPORTS_XAI_HEADER]: "true",
		},
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Failed to fetch Zed models: ${response.status} - ${errorText}`)
	}

	lastResponse = (await response.json()) as ZedListModelsResponse
	return lastResponse
}

export async function getZedModels(forceRefresh: boolean = false): Promise<ModelRecord> {
	const response = await getZedModelsRaw(forceRefresh)
	const recommendedIds = new Set(response.recommended_models ?? [])

	return Object.fromEntries(
		response.models.map((model, index) => {
			const effortValues = model.supported_effort_levels
				?.map((level) => level.value)
				.filter(Boolean) as Array<"none" | "minimal" | "low" | "medium" | "high"> | undefined

			const defaultEffort = model.supported_effort_levels?.find((level) => level.is_default)?.value

			const info: ModelInfo = {
				maxTokens: model.max_output_tokens,
				contextWindow: model.max_token_count,
				supportsImages: model.supports_images,
				supportsPromptCache: model.provider === "anthropic",
				supportsNativeTools: false,
				inputPrice: 0,
				outputPrice: 0,
				description: model.display_name,
				...(effortValues && effortValues.length > 0 ? { supportsReasoningEffort: effortValues } : {}),
				...(defaultEffort ? { reasoningEffort: defaultEffort as ModelInfo["reasoningEffort"] } : {}),
				...(recommendedIds.has(model.id) ? { preferredIndex: index } : {}),
			}

			Object.assign(info as object, {
				zedProvider: model.provider,
				zedDisplayName: model.display_name,
				zedSupportsTools: model.supports_tools,
				zedSupportsThinking: model.supports_thinking,
				zedSupportsStreamingTools: model.supports_streaming_tools ?? false,
				zedSupportsParallelToolCalls: model.supports_parallel_tool_calls ?? false,
				zedIsLatest: model.is_latest ?? false,
			})

			return [model.id, info]
		}),
	)
}

export function getLastZedModelsResponse(): ZedListModelsResponse | null {
	return lastResponse
}
