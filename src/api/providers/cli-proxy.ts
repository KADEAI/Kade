import { ApiHandlerOptions } from "../../shared/api"
import { ModelInfo, cliProxyDefaultModelId } from "@roo-code/types"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

const cliProxyModels: Record<string, ModelInfo> = {
    "claude-sonnet-latest": {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsImages: true,
        supportsPromptCache: true,
        inputPrice: 3.0,
        outputPrice: 15.0,
        cacheWritesPrice: 3.75,
        cacheReadsPrice: 0.3,
    },
    "gpt-5": {
        maxTokens: 16384,
        contextWindow: 200000,
        supportsImages: true,
        supportsPromptCache: false, // kilocode_change: Add missing property
        supportsReasoningBinary: true,
        inputPrice: 5.0,
        outputPrice: 20.0,
    },
}

export class CliProxyHandler extends BaseOpenAiCompatibleProvider<string> {
    constructor(options: ApiHandlerOptions) {
        super({
            ...options,
            providerName: "cli-proxy",
            baseURL: `http://localhost:${options.cliProxyPort || 8317}/v1`,
            defaultProviderModelId: cliProxyDefaultModelId,
            providerModels: cliProxyModels,
        })
    }

    override getModel(): { id: string; info: ModelInfo } {
        const modelId = this.options.apiModelId || this.defaultProviderModelId
        const modelInfo = this.providerModels[modelId] || {
            maxTokens: 8192,
            contextWindow: 200000,
            supportsImages: true,
        }
        // If explicit info is missing, use the constructed object
        const info = (modelInfo as ModelInfo)
        return { id: modelId, info }
    }
}
