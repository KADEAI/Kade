import * as path from "path"
import fs from "fs/promises"
import * as fsSync from "fs"

import NodeCache from "node-cache"
import { z } from "zod"

import type { ProviderName } from "@roo-code/types"
import { modelInfoSchema, TelemetryEventName, kiroModels, anthropicModels } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import type { RouterName, ModelRecord } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModels } from "./openrouter"
import { getVercelAiGatewayModels } from "./vercel-ai-gateway"
import { getRequestyModels } from "./requesty"
import { getGlamaModels } from "./glama" // kade_change
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"
import { GetModelsOptions } from "../../../shared/api"
import { getKiloUrlFromToken } from "@roo-code/types"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"
import { getIOIntelligenceModels } from "./io-intelligence"
// kade_change start
import { getOvhCloudAiEndpointsModels } from "./ovhcloud"
import { getGeminiModels } from "./gemini"
import { getInceptionModels } from "./inception"
import { getSyntheticModels } from "./synthetic"
import { getSapAiCoreModels } from "./sap-ai-core"
// kade_change end

import { getDeepInfraModels } from "./deepinfra"
import { getHuggingFaceModels } from "./huggingface"
import { getRooModels } from "./roo"
import { getChutesModels } from "./chutes"
import { getNanoGptModels } from "./nano-gpt" //kade_change
import { getOpenCodeModels } from "./opencode" // kade_change

import { getApertisModels } from "./apertis"
import { getPoeModels } from "./poe"
import { getZenmuxModels } from "./zenmux"

// Models ported from 9router
const ANTIGRAVITY_MODELS: ModelRecord = {
	"gemini-3-pro-low": {
		maxTokens: 8192,
		contextWindow: 2097152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Gemini 3 Pro Low (Antigravity)",
	},
	"gemini-3-pro-high": {
		maxTokens: 8192,
		contextWindow: 2097152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Gemini 3 Pro High (Antigravity)",
	},
	"gemini-3-flash": {
		maxTokens: 8192,
		contextWindow: 1048576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Gemini 3 Flash (Antigravity)",
	},
	"gemini-2.5-flash": {
		maxTokens: 8192,
		contextWindow: 1048576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Gemini 2.5 Flash (Antigravity)",
	},
	"claude-sonnet-4-5": {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Claude Sonnet 4.5 (Antigravity)",
	},
	"claude-sonnet-4-5-thinking": {
		maxTokens: 32768,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Claude Sonnet 4.5 Thinking (Antigravity)",
	},
	"claude-opus-4-5-thinking": {
		maxTokens: 32768,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Claude Opus 4.5 Thinking (Antigravity)",
	},
}

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

// Zod schema for validating ModelRecord structure from disk cache
const modelRecordSchema = z.record(z.string(), modelInfoSchema)

// Track in-flight refresh requests to prevent concurrent API calls for the same provider
// This prevents race conditions where multiple calls might overwrite each other's results
const inFlightRefresh = new Map<RouterName, Promise<ModelRecord>>()

export /*kade_change*/ async function writeModels(router: RouterName, data: ModelRecord) {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

export /*kade_change*/ async function readModels(router: RouterName): Promise<ModelRecord | undefined> {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	if (!exists) {
		return undefined
	}

	try {
		const data = await fs.readFile(filePath, "utf8")
		return JSON.parse(data)
	} catch (error) {
		console.error(`[MODEL_CACHE] Error parsing ${router} models from disk, deleting:`, error)
		try {
			await fs.unlink(filePath)
		} catch (unlinkError) {
			// Ignore
		}
		return undefined
	}
}

/**
 * Fetch models from the provider API.
 * Extracted to avoid duplication between getModels() and refreshModels().
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from the provider API
 */
async function fetchModelsFromProvider(options: GetModelsOptions): Promise<ModelRecord> {
	const { provider } = options

	let models: ModelRecord

	switch (provider) {
		case "openrouter":
			// kade_change start: base url and bearer token
			models = await getOpenRouterModels({
				openRouterBaseUrl: options.baseUrl,
				headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
			})
			// kade_change end
			break
		case "requesty":
			// Requesty models endpoint requires an API key for per-user custom policies.
			models = await getRequestyModels(options.baseUrl, options.apiKey)
			break
		// kade_change start
		case "glama":
			models = await getGlamaModels()
			break
		case "opencode":
			models = await getOpenCodeModels()
			break
		// kade_change end
		case "unbound":
			// Unbound models endpoint requires an API key to fetch application specific models.
			models = await getUnboundModels(options.apiKey)
			break
		case "litellm":
			// Type safety ensures apiKey and baseUrl are always provided for LiteLLM.
			models = await getLiteLLMModels(options.apiKey, options.baseUrl)
			break
		// kade_change start
		case "kilocode": {
			const backendUrl = options.kilocodeOrganizationId
				? `https://api.kilo.ai/api/organizations/${options.kilocodeOrganizationId}`
				: "https://api.kilo.ai/api/openrouter"
			const openRouterBaseUrl = getKiloUrlFromToken(backendUrl, options.kilocodeToken ?? "")
			models = await getOpenRouterModels({
				openRouterBaseUrl,
				headers: options.kilocodeToken ? { Authorization: `Bearer ${options.kilocodeToken}` } : undefined,
			})
			break
		}
		case "synthetic":
			models = await getSyntheticModels(options.apiKey)
			break
		case "gemini":
			models = await getGeminiModels({
				apiKey: options.apiKey,
				baseUrl: options.baseUrl,
			})
			break
		// kade_change end
		case "ollama":
			models = await getOllamaModels(options.baseUrl, options.apiKey, options.numCtx /*kade_change*/)
			break
		case "lmstudio":
			models = await getLMStudioModels(options.baseUrl)
			break
		case "deepinfra":
			models = await getDeepInfraModels(options.apiKey, options.baseUrl)
			break
		case "io-intelligence":
			models = await getIOIntelligenceModels(options.apiKey)
			break
		case "vercel-ai-gateway":
			models = await getVercelAiGatewayModels()
			break
		case "huggingface":
			models = await getHuggingFaceModels()
			break
		// kade_change start
		case "sap-ai-core":
			models = await getSapAiCoreModels(
				options.sapAiCoreServiceKey,
				options.sapAiCoreResourceGroup,
				options.sapAiCoreUseOrchestration,
			)
			break
		case "inception":
			models = await getInceptionModels()
			break
		case "ovhcloud":
			models = await getOvhCloudAiEndpointsModels()
			break
		// kade_change end
		case "roo": {
			// Roo Code Cloud provider requires baseUrl and optional apiKey
			const rooBaseUrl = options.baseUrl ?? process.env.ROO_CODE_PROVIDER_URL ?? "https://api.roocode.com/proxy"
			models = await getRooModels(rooBaseUrl, options.apiKey)
			break
		}
		case "chutes":
			models = await getChutesModels(options.apiKey)
			break
		//kade_change start
		case "nano-gpt":
			models = await getNanoGptModels({
				nanoGptModelList: options.nanoGptModelList,
				apiKey: options.apiKey,
			})
			break
		//kade_change end
		case "cli-proxy":
			// cli-proxy models are fetched via webview message to the proxy process
			// We return empty here as actual population happens in the UI
			// We return empty here as actual population happens in the UI
			models = {}
			break
		case "antigravity":
			models = ANTIGRAVITY_MODELS
			break
		case "kiro":
			models = kiroModels
			break
		case "apertis":
			models = await getApertisModels(options)
			break
		case "aihubmix":
			models = await getOpenRouterModels({
				openRouterBaseUrl: options.baseUrl || "https://aihubmix.com/api/v1",
				headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
			})
			break
		case "corethink":
			models = anthropicModels
			break
		case "poe":
			models = await getPoeModels(options.apiKey)
			break
		case "zenmux":
			models = await getZenmuxModels(options)
			break
		default: {
			// Ensures router is exhaustively checked if RouterName is a strict union.
			const exhaustiveCheck: never = provider
			throw new Error(`Unknown provider: ${exhaustiveCheck}`)
		}
	}

	return models
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	let models = getModelsFromCache(provider)

	if (models) {
		return models
	}

	try {
		models = await fetchModelsFromProvider(options)
		const modelCount = Object.keys(models).length

		// Only cache non-empty results to prevent persisting failed API responses
		// Empty results could indicate API failure rather than "no models exist"
		if (modelCount > 0) {
			memoryCache.set(provider, models)

			// kade_change start: prevent eternal caching of kilocode models
			if (provider !== "kilocode") {
				await writeModels(provider, models).catch((err) =>
					console.error(`[MODEL_CACHE] Error writing ${provider} models to file cache:`, err),
				)
			}
			// kade_change end
		} else {
			TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
				provider,
				context: "getModels",
				hasExistingCache: false,
			})
		}

		return models
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		console.error(`[getModels] Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Force-refresh models from API, bypassing cache.
 * Uses atomic writes so cache remains available during refresh.
 * This function also prevents concurrent API calls for the same provider using
 * in-flight request tracking to avoid race conditions.
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from API, or existing cache if refresh yields worse data
 */
export const refreshModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	// Check if there's already an in-flight refresh for this provider
	// This prevents race conditions where multiple concurrent refreshes might
	// overwrite each other's results
	const existingRequest = inFlightRefresh.get(provider)
	if (existingRequest) {
		return existingRequest
	}

	// Create the refresh promise and track it
	const refreshPromise = (async (): Promise<ModelRecord> => {
		try {
			// Force fresh API fetch - skip getModelsFromCache() check
			const models = await fetchModelsFromProvider(options)
			const modelCount = Object.keys(models).length

			// Get existing cached data for comparison
			const existingCache = getModelsFromCache(provider)
			const existingCount = existingCache ? Object.keys(existingCache).length : 0

			if (modelCount === 0) {
				TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
					provider,
					context: "refreshModels",
					hasExistingCache: existingCount > 0,
					existingCacheSize: existingCount,
				})
				if (existingCount > 0) {
					return existingCache!
				} else {
					return {}
				}
			}

			// Update memory cache first
			memoryCache.set(provider, models)

			// Atomically write to disk (safeWriteJson handles atomic writes)
			await writeModels(provider, models).catch((err) =>
				console.error(`[refreshModels] Error writing ${provider} models to disk:`, err),
			)

			return models
		} catch (error) {
			// Log the error for debugging, then return existing cache if available (graceful degradation)
			console.error(`[refreshModels] Failed to refresh ${provider} models:`, error)
			return getModelsFromCache(provider) || {}
		} finally {
			// Always clean up the in-flight tracking
			inFlightRefresh.delete(provider)
		}
	})()

	// Track the in-flight request
	inFlightRefresh.set(provider, refreshPromise)

	return refreshPromise
}

/**
 * Initialize background model cache refresh.
 * Refreshes public provider caches without blocking or requiring auth.
 * Should be called once during extension activation.
 */
export async function initializeModelCacheRefresh(): Promise<void> {
	// Wait for extension to fully activate before refreshing
	setTimeout(async () => {
		// Providers that work without API keys
		const publicProviders: Array<{ provider: RouterName; options: GetModelsOptions }> = [
			{ provider: "openrouter", options: { provider: "openrouter" } },
			{ provider: "glama", options: { provider: "glama" } }, // kade_change
			{ provider: "opencode", options: { provider: "opencode" } }, // kade_change
			{ provider: "vercel-ai-gateway", options: { provider: "vercel-ai-gateway" } },
			{ provider: "chutes", options: { provider: "chutes" } },
		]

		// Refresh each provider in background (fire and forget)
		for (const { options } of publicProviders) {
			refreshModels(options).catch(() => {
				// Silent fail - old cache remains available
			})

			// Small delay between refreshes to avoid API rate limits
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
	}, 2000)
}

/**
 * Flush models memory cache for a specific router.
 *
 * @param router - The router to flush models for.
 * @param refresh - If true, immediately fetch fresh data from API
 */
export const flushModels = async (router: RouterName, refresh: boolean = false): Promise<void> => {
	if (refresh) {
		// Don't delete memory cache - let refreshModels atomically replace it
		// This prevents a race condition where getModels() might be called
		// before refresh completes, avoiding a gap in cache availability
		refreshModels({ provider: router } as GetModelsOptions).catch((error) => {
			console.error(`[flushModels] Refresh failed for ${router}:`, error)
		})
	} else {
		// Only delete memory cache when not refreshing
		memoryCache.del(router)
	}
}

/**
 * Get models from cache, checking memory first, then disk.
 * This ensures providers always have access to last known good data,
 * preventing fallback to hardcoded defaults on startup.
 *
 * @param provider - The provider to get models for.
 * @returns Models from memory cache, disk cache, or undefined if not cached.
 */
export function getModelsFromCache(provider: ProviderName): ModelRecord | undefined {
	// Check memory cache first (fast)
	const memoryModels = memoryCache.get<ModelRecord>(provider)
	if (memoryModels) {
		return memoryModels
	}

	// kade_change start: prevent eternal caching of kilocode models
	if (provider === "kilocode") {
		return undefined
	}
	// kade_change end

	// Memory cache miss - try to load from disk synchronously
	// This is acceptable because it only happens on cold start or after cache expiry
	try {
		const filename = `${provider}_models.json`
		const cacheDir = getCacheDirectoryPathSync()
		if (!cacheDir) {
			return undefined
		}

		const filePath = path.join(cacheDir, filename)

		// Use synchronous fs to avoid async complexity in getModel() callers
		if (fsSync.existsSync(filePath)) {
			const data = fsSync.readFileSync(filePath, "utf8")
			let models: any
			try {
				models = JSON.parse(data)
			} catch (parseError) {
				console.debug(`[MODEL_CACHE] Corrupt JSON in cache for ${provider}, deleting file:`, parseError)
				try {
					fsSync.unlinkSync(filePath)
				} catch (unlinkError) {
					// Ignore unlink errors
				}
				return undefined
			}

			// Validate the disk cache data structure using Zod schema
			// This ensures the data conforms to ModelRecord = Record<string, ModelInfo>
			const validation = modelRecordSchema.safeParse(models)
			if (!validation.success) {
				console.debug(
					`[MODEL_CACHE] Invalid disk cache data structure for ${provider}, deleting file:`,
					validation.error.format(),
				)
				try {
					fsSync.unlinkSync(filePath)
				} catch (unlinkError) {
					// Ignore
				}
				return undefined
			}

			// Populate memory cache for future fast access
			memoryCache.set(provider, validation.data)

			return validation.data
		}
	} catch (error) {
		console.error(`[MODEL_CACHE] Error loading ${provider} models from disk:`, error)
	}

	return undefined
}

/**
 * Synchronous version of getCacheDirectoryPath for use in getModelsFromCache.
 * Returns the cache directory path without async operations.
 */
function getCacheDirectoryPathSync(): string | undefined {
	try {
		const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			return undefined
		}
		const cachePath = path.join(globalStoragePath, "cache")
		return cachePath
	} catch (error) {
		console.error(`[MODEL_CACHE] Error getting cache directory path:`, error)
		return undefined
	}
}
