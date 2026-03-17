import axios from "axios"
import https from "https"
import type { ModelInfo } from "@roo-code/types"
import { parseApiPrice } from "../../../shared/cost"

export async function getOpenCodeModels(): Promise<Record<string, ModelInfo>> {
    const models: Record<string, ModelInfo> = {}

    try {
        // OpenCode Zen models endpoint is public and doesn't require authentication
        const response = await axios.get("https://opencode.ai/zen/v1/models", {
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        })
        const responseData = response.data

        // The API returns { object: "list", data: [...] } format (OpenAI-compatible)
        const rawModels = responseData.data || responseData

        if (Array.isArray(rawModels)) {
            for (const rawModel of rawModels) {
                if (!rawModel?.id) continue

                const modelInfo: ModelInfo = {
                    maxTokens: rawModel.max_tokens || rawModel.top_provider?.max_completion_tokens || 4096,
                    contextWindow: rawModel.context_window || rawModel.top_provider?.context_length || 128000,
                    supportsImages: !!(rawModel.architecture?.modality?.includes("text->image") || rawModel.modalities?.includes("image")),
                    supportsPromptCache: false,
                    inputPrice: parseApiPrice(rawModel.pricing?.input),
                    outputPrice: parseApiPrice(rawModel.pricing?.output),
                    description: rawModel.description,
                    cacheWritesPrice: parseApiPrice(rawModel.pricing?.cache_write),
                    cacheReadsPrice: parseApiPrice(rawModel.pricing?.cache_read),
                    displayName: rawModel.name || rawModel.display_name,
                    isFree: rawModel.is_free ?? true,
                }

                models[rawModel.id] = modelInfo
            }
        }
    } catch (error) {
        console.error(`Error fetching OpenCode models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
    }

    // Fallback models if API is unreachable or returns nothing
    if (Object.keys(models).length === 0) {
        models["grok-code"] = {
            maxTokens: 4096,
            contextWindow: 128000,
            supportsImages: false,
            supportsPromptCache: false,
            inputPrice: 0,
            outputPrice: 0,
            description: "Grok Code Fast 1 - Free on OpenCode",
            displayName: "Grok Code Fast 1",
            isFree: true,
        }
        models["gpt-5.2"] = {
            maxTokens: 16384,
            contextWindow: 1024000,
            supportsImages: true,
            supportsPromptCache: true,
            inputPrice: 0,
            outputPrice: 0,
            description: "GPT-5.2 - State of the art coding model",
            displayName: "GPT 5.2",
            isFree: true,
        }
        models["gpt-5-nano"] = {
            maxTokens: 8192,
            contextWindow: 128000,
            supportsImages: false,
            supportsPromptCache: false,
            inputPrice: 0,
            outputPrice: 0,
            description: "GPT 5 Nano - Ultra fast coding model",
            displayName: "GPT 5 Nano",
            isFree: true,
        }
    }

    return models
}
