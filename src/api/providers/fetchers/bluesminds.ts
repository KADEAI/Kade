import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"
import { deepSeekModels } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

export const BLUESMINDS_BASE_URL = "https://api.bluesminds.com/v1"

const bluesmindsModelsResponseSchema = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			owned_by: z.string().optional(),
		}),
	),
})

const FALLBACK_MODEL_INFO: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 128_000,
	supportsImages: false,
	supportsPromptCache: false,
	supportsNativeTools: false,
	defaultToolProtocol: "unified",
	inputPrice: 0,
	outputPrice: 0,
	description: "Model available via Bluesminds",
}

function inferModelInfo(id: string, ownedBy?: string, preferredIndex?: number): ModelInfo {
	const knownDeepSeekModel = deepSeekModels[id as keyof typeof deepSeekModels]
	if (knownDeepSeekModel) {
		return {
			...knownDeepSeekModel,
			supportsNativeTools: false,
			defaultToolProtocol: "unified",
			displayName: id,
			preferredIndex,
		}
	}

	const lowerId = id.toLowerCase()

	return {
		...FALLBACK_MODEL_INFO,
		supportsImages:
			lowerId.includes("4o") ||
			lowerId.includes("vision") ||
			lowerId.includes("multimodal") ||
			lowerId.includes("gemini"),
		supportsPromptCache: ownedBy === "deepseek" || lowerId.includes("deepseek"),
		displayName: id,
		preferredIndex,
		description: ownedBy ? `${id} via Bluesminds (${ownedBy})` : `${id} via Bluesminds`,
	}
}

export async function getBluesmindsModels(options?: {
	apiKey?: string
	baseUrl?: string
}): Promise<Record<string, ModelInfo>> {
	const baseUrl = (options?.baseUrl || BLUESMINDS_BASE_URL).replace(/\/$/, "")
	const headers = {
		...DEFAULT_HEADERS,
		...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
	}

	const response = await axios.get(`${baseUrl}/models`, { headers })
	const parsed = bluesmindsModelsResponseSchema.parse(response.data)

	return Object.fromEntries(
		parsed.data.map((model, index) => [model.id, inferModelInfo(model.id, model.owned_by, index)]),
	)
}
