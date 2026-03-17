import { ModelInfo } from "../model.js"

export const opencodeDefaultModelId = "grok-code"

export const opencodeDefaultModelInfo: ModelInfo = {
    maxTokens: 4096,
    contextWindow: 128_000,
    supportsImages: false,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Grok Code Fast 1 - Free on OpenCode for a limited time",
}
