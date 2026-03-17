
import { ModelInfo } from "../model.js"

export const cliProxyDefaultModelId = "claude-sonnet-latest"

export const cliProxyModels: Record<string, ModelInfo> = {
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
        supportsPromptCache: false,
        supportsReasoningBinary: true,
        inputPrice: 5.0,
        outputPrice: 20.0,
    },
}
