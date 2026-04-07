import { ModelInfo } from "../model.js"

export const opencodeDefaultModelId = "claude-sonnet-4-5"

export const opencodeDefaultModelInfo: ModelInfo = {
    maxTokens: 64_000,
    contextWindow: 200_000,
    supportsImages: true,
    supportsPromptCache: true,
    supportsNativeTools: false,
    defaultToolProtocol: "unified",
    inputPrice: 3,
    outputPrice: 15,
    cacheWritesPrice: 3.75,
    cacheReadsPrice: 0.3,
    description: "Claude Sonnet 4.5 via OpenCode Zen",
}
