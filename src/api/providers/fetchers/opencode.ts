import axios from "axios"

import {
	type ModelInfo,
	anthropicModels,
	claudeCodeModels,
	geminiModels,
	internationalZAiModels,
	minimaxModels,
	moonshotModels,
	openAiCodexModels,
	openAiNativeModels,
} from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

const OPENCODE_MODELS_ENDPOINT = "https://opencode.ai/zen/v1/models"

const DEFAULT_OPENCODE_MODEL_INFO: ModelInfo = {
	maxTokens: 16_384,
	contextWindow: 128_000,
	supportsImages: false,
	supportsPromptCache: false,
	supportsNativeTools: false,
	defaultToolProtocol: "unified",
}

const OPENCODE_DOC_MODEL_OVERRIDES: Record<string, Partial<ModelInfo>> = {
	"claude-opus-4-6": {
		displayName: "Claude Opus 4.6",
		inputPrice: 5,
		outputPrice: 25,
		cacheReadsPrice: 0.5,
		cacheWritesPrice: 6.25,
	},
	"claude-opus-4-5": {
		displayName: "Claude Opus 4.5",
		inputPrice: 5,
		outputPrice: 25,
		cacheReadsPrice: 0.5,
		cacheWritesPrice: 6.25,
	},
	"claude-opus-4-1": {
		displayName: "Claude Opus 4.1",
		inputPrice: 15,
		outputPrice: 75,
		cacheReadsPrice: 1.5,
		cacheWritesPrice: 18.75,
	},
	"claude-sonnet-4-6": {
		displayName: "Claude Sonnet 4.6",
		inputPrice: 3,
		outputPrice: 15,
		cacheReadsPrice: 0.3,
		cacheWritesPrice: 3.75,
	},
	"claude-sonnet-4-5": {
		displayName: "Claude Sonnet 4.5",
		inputPrice: 3,
		outputPrice: 15,
		cacheReadsPrice: 0.3,
		cacheWritesPrice: 3.75,
	},
	"claude-sonnet-4": {
		displayName: "Claude Sonnet 4",
		inputPrice: 3,
		outputPrice: 15,
		cacheReadsPrice: 0.3,
		cacheWritesPrice: 3.75,
	},
	"claude-3-5-haiku": {
		displayName: "Claude 3.5 Haiku",
		inputPrice: 0.8,
		outputPrice: 4,
		cacheReadsPrice: 0.08,
		cacheWritesPrice: 1,
	},
	"claude-haiku-4-5": {
		displayName: "Claude Haiku 4.5",
		inputPrice: 1,
		outputPrice: 5,
		cacheReadsPrice: 0.1,
		cacheWritesPrice: 1.25,
	},
	"gemini-3.1-pro": {
		displayName: "Gemini 3.1 Pro",
		inputPrice: 2,
		outputPrice: 12,
		cacheReadsPrice: 0.2,
		tiers: [{ contextWindow: 1_048_576, inputPrice: 4, outputPrice: 18, cacheReadsPrice: 0.4 }],
	},
	"gemini-3-pro": {
		displayName: "Gemini 3 Pro",
		deprecated: true,
		inputPrice: 2,
		outputPrice: 12,
		cacheReadsPrice: 0.2,
		tiers: [{ contextWindow: 1_048_576, inputPrice: 4, outputPrice: 18, cacheReadsPrice: 0.4 }],
	},
	"gemini-3-flash": {
		displayName: "Gemini 3 Flash",
		inputPrice: 0.5,
		outputPrice: 3,
		cacheReadsPrice: 0.05,
	},
	"gpt-5.4": {
		displayName: "GPT 5.4",
		inputPrice: 2.5,
		outputPrice: 15,
		cacheReadsPrice: 0.25,
	},
	"gpt-5.4-pro": {
		displayName: "GPT 5.4 Pro",
		inputPrice: 30,
		outputPrice: 180,
		cacheReadsPrice: 30,
	},
	"gpt-5.4-mini": {
		displayName: "GPT 5.4 Mini",
		inputPrice: 0.75,
		outputPrice: 4.5,
		cacheReadsPrice: 0.075,
	},
	"gpt-5.4-nano": {
		displayName: "GPT 5.4 Nano",
		inputPrice: 0.2,
		outputPrice: 1.25,
		cacheReadsPrice: 0.02,
	},
	"gpt-5.3-codex-spark": {
		displayName: "GPT 5.3 Codex Spark",
		inputPrice: 1.75,
		outputPrice: 14,
		cacheReadsPrice: 0.175,
	},
	"gpt-5.3-codex": {
		displayName: "GPT 5.3 Codex",
		inputPrice: 1.75,
		outputPrice: 14,
		cacheReadsPrice: 0.175,
	},
	"gpt-5.2": {
		displayName: "GPT 5.2",
		inputPrice: 1.75,
		outputPrice: 14,
		cacheReadsPrice: 0.175,
	},
	"gpt-5.2-codex": {
		displayName: "GPT 5.2 Codex",
		inputPrice: 1.75,
		outputPrice: 14,
		cacheReadsPrice: 0.175,
	},
	"gpt-5.1": {
		displayName: "GPT 5.1",
		inputPrice: 1.07,
		outputPrice: 8.5,
		cacheReadsPrice: 0.107,
	},
	"gpt-5.1-codex-max": {
		displayName: "GPT 5.1 Codex Max",
		inputPrice: 1.25,
		outputPrice: 10,
		cacheReadsPrice: 0.125,
	},
	"gpt-5.1-codex": {
		displayName: "GPT 5.1 Codex",
		inputPrice: 1.07,
		outputPrice: 8.5,
		cacheReadsPrice: 0.107,
	},
	"gpt-5.1-codex-mini": {
		displayName: "GPT 5.1 Codex Mini",
		inputPrice: 0.25,
		outputPrice: 2,
		cacheReadsPrice: 0.025,
	},
	"gpt-5": {
		displayName: "GPT 5",
		inputPrice: 1.07,
		outputPrice: 8.5,
		cacheReadsPrice: 0.107,
	},
	"gpt-5-codex": {
		displayName: "GPT 5 Codex",
		inputPrice: 1.07,
		outputPrice: 8.5,
		cacheReadsPrice: 0.107,
	},
	"gpt-5-nano": {
		displayName: "GPT 5 Nano",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
	},
	"glm-5": {
		displayName: "GLM 5",
		inputPrice: 1,
		outputPrice: 3.2,
		cacheReadsPrice: 0.2,
	},
	"glm-4.7": {
		displayName: "GLM 4.7",
		deprecated: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheReadsPrice: 0.11,
	},
	"glm-4.6": {
		displayName: "GLM 4.6",
		deprecated: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheReadsPrice: 0.11,
	},
	"minimax-m2.5": {
		displayName: "MiniMax M2.5",
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheReadsPrice: 0.06,
		cacheWritesPrice: 0.375,
	},
	"minimax-m2.5-free": {
		displayName: "MiniMax M2.5 Free",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		isFree: true,
	},
	"minimax-m2.1": {
		displayName: "MiniMax M2.1",
		deprecated: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheReadsPrice: 0.06,
		cacheWritesPrice: 0.375,
	},
	"mimo-v2-pro-free": {
		displayName: "MiMo V2 Pro Free",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		isFree: true,
	},
	"mimo-v2-omni-free": {
		displayName: "MiMo V2 Omni Free",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		isFree: true,
		supportsImages: true,
	},
	"mimo-v2-flash-free": {
		displayName: "MiMo V2 Flash Free",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		isFree: true,
	},
	"kimi-k2.5": {
		displayName: "Kimi K2.5",
		inputPrice: 0.6,
		outputPrice: 3,
		cacheReadsPrice: 0.1,
	},
	"kimi-k2": {
		displayName: "Kimi K2",
		deprecated: true,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheReadsPrice: 0.15,
	},
	"kimi-k2-thinking": {
		displayName: "Kimi K2 Thinking",
		deprecated: true,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheReadsPrice: 0.15,
	},
	"trinity-large-preview-free": {
		displayName: "Trinity Large Preview Free",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		isFree: true,
	},
	"big-pickle": {
		displayName: "Big Pickle",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		isStealthModel: true,
		description: "Big Pickle is a stealth model that's free on OpenCode for a limited time.",
	},
	"nemotron-3-super-free": {
		displayName: "Nemotron 3 Super Free",
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		isFree: true,
	},
}

const OPENCODE_BASE_MODEL_INFO: Record<string, Partial<ModelInfo>> = {
	"claude-opus-4-6": anthropicModels["claude-opus-4-6"],
	"claude-opus-4-5": anthropicModels["claude-opus-4-5-20251101"] ?? claudeCodeModels["claude-opus-4-5"],
	"claude-opus-4-1": anthropicModels["claude-opus-4-1-20250805"],
	"claude-sonnet-4-6": anthropicModels["claude-sonnet-4-6"],
	"claude-sonnet-4-5": anthropicModels["claude-sonnet-4-5"],
	"claude-sonnet-4": anthropicModels["claude-sonnet-4-20250514"] ?? claudeCodeModels["claude-sonnet-4-5"],
	"claude-3-5-haiku": anthropicModels["claude-3-5-haiku-20241022"],
	"claude-haiku-4-5": anthropicModels["claude-haiku-4-5-20251001"] ?? claudeCodeModels["claude-haiku-4-5"],
	"gemini-3.1-pro": geminiModels["gemini-3-pro-preview"],
	"gemini-3-pro": geminiModels["gemini-3-pro-preview"],
	"gemini-3-flash": geminiModels["gemini-3-flash-preview"],
	"gpt-5.4": openAiCodexModels["gpt-5.4"],
	"gpt-5.4-pro": openAiCodexModels["gpt-5.4"],
	"gpt-5.4-mini": openAiCodexModels["gpt-5.4"],
	"gpt-5.4-nano": openAiCodexModels["gpt-5.4"],
	"gpt-5.3-codex-spark": openAiCodexModels["gpt-5.3-codex"],
	"gpt-5.3-codex": openAiCodexModels["gpt-5.3-codex"],
	"gpt-5.2": openAiNativeModels["gpt-5.2"],
	"gpt-5.2-codex": openAiNativeModels["gpt-5.2-codex"],
	"gpt-5.1": openAiNativeModels["gpt-5.1"],
	"gpt-5.1-codex-max": openAiNativeModels["gpt-5.1-codex-max"],
	"gpt-5.1-codex": openAiNativeModels["gpt-5.1-codex"],
	"gpt-5.1-codex-mini": openAiNativeModels["gpt-5.1-codex-mini"],
	"gpt-5": openAiNativeModels["gpt-5"],
	"gpt-5-codex": openAiNativeModels["gpt-5-codex"],
	"gpt-5-nano": openAiNativeModels["gpt-5-nano"],
	"glm-5": internationalZAiModels["glm-5"],
	"glm-4.7": internationalZAiModels["glm-4.7"],
	"glm-4.6": internationalZAiModels["glm-4.6"],
	"minimax-m2.5": minimaxModels["MiniMax-M2.5"],
	"minimax-m2.5-free": minimaxModels["MiniMax-M2.5"],
	"minimax-m2.1": minimaxModels["MiniMax-M2.1"],
	"kimi-k2.5": moonshotModels["kimi-k2.5"],
	"kimi-k2": moonshotModels["kimi-k2-0905-preview"] ?? moonshotModels["kimi-k2-0711-preview"],
	"kimi-k2-thinking": moonshotModels["kimi-k2-thinking"],
}

function humanizeOpenCodeModelId(modelId: string): string {
	return modelId
		.split("-")
		.map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
		.join(" ")
}

function resolveOpenCodePrice(rawPrice: unknown, docPrice?: number): number | undefined {
	const parsedRawPrice = parseApiPrice(rawPrice)
	return parsedRawPrice ?? docPrice
}

function resolveOpenCodeModelInfo(modelId: string, rawModel: any, preferredIndex: number): ModelInfo {
	const base = OPENCODE_BASE_MODEL_INFO[modelId] ?? {}
	const doc = OPENCODE_DOC_MODEL_OVERRIDES[modelId] ?? {}
	const rawPricing = rawModel?.pricing ?? {}

	const inputPrice = resolveOpenCodePrice(rawPricing.input, doc.inputPrice ?? base.inputPrice)
	const outputPrice = resolveOpenCodePrice(rawPricing.output, doc.outputPrice ?? base.outputPrice)
	const cacheWritesPrice = resolveOpenCodePrice(rawPricing.cache_write, doc.cacheWritesPrice ?? base.cacheWritesPrice)
	const cacheReadsPrice = resolveOpenCodePrice(rawPricing.cache_read, doc.cacheReadsPrice ?? base.cacheReadsPrice)

	const maxTokens = Number(rawModel?.max_tokens ?? rawModel?.top_provider?.max_completion_tokens ?? doc.maxTokens ?? base.maxTokens)
	const contextWindow = Number(rawModel?.context_window ?? rawModel?.top_provider?.context_length ?? doc.contextWindow ?? base.contextWindow)
	const supportsImages =
		typeof doc.supportsImages === "boolean"
			? doc.supportsImages
			: typeof base.supportsImages === "boolean"
				? base.supportsImages
				: false
	const supportsPromptCache =
		typeof base.supportsPromptCache === "boolean"
			? base.supportsPromptCache
			: cacheReadsPrice !== undefined || cacheWritesPrice !== undefined

	return {
		...DEFAULT_OPENCODE_MODEL_INFO,
		...base,
		...doc,
		maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_OPENCODE_MODEL_INFO.maxTokens,
		contextWindow:
			Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : DEFAULT_OPENCODE_MODEL_INFO.contextWindow,
		supportsImages,
		supportsPromptCache,
		supportsNativeTools: false,
		inputPrice,
		outputPrice,
		cacheWritesPrice,
		cacheReadsPrice,
		displayName: rawModel?.name || rawModel?.display_name || doc.displayName || base.displayName || humanizeOpenCodeModelId(modelId),
		description: rawModel?.description || doc.description || base.description,
		isFree:
			rawModel?.is_free ??
			doc.isFree ??
			((inputPrice ?? 0) === 0 && (outputPrice ?? 0) === 0 && (cacheReadsPrice ?? 0) === 0 && (cacheWritesPrice ?? 0) === 0),
		preferredIndex,
	}
}

export async function getOpenCodeModels(): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get(OPENCODE_MODELS_ENDPOINT)
		const responseData = response.data
		const rawModels = Array.isArray(responseData?.data) ? responseData.data : Array.isArray(responseData) ? responseData : []

		for (const [preferredIndex, rawModel] of rawModels.entries()) {
			if (!rawModel?.id || typeof rawModel.id !== "string") {
				continue
			}

			models[rawModel.id] = resolveOpenCodeModelInfo(rawModel.id, rawModel, preferredIndex)
		}
	} catch (error) {
		console.error(`Error fetching OpenCode models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	if (Object.keys(models).length === 0) {
		for (const [preferredIndex, modelId] of ["claude-sonnet-4-5", "gpt-5.3-codex", "gpt-5.4"].entries()) {
			models[modelId] = resolveOpenCodeModelInfo(modelId, { id: modelId }, preferredIndex)
		}
	}

	return models
}
