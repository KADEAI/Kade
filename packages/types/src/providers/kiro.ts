import { ModelInfo } from "../model.js"

export const kiroDefaultModelId = "claude-sonnet-4-5"

export const kiroModels: Record<string, ModelInfo> = {
    "claude-sonnet-4-5": {
        maxTokens: 8192,
        contextWindow: 173_000,
        supportsImages: true,
        supportsPromptCache: true,
        supportsNativeTools: false,
        defaultToolProtocol: "unified",
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude 4.5 Sonnet (Infinite)",
    },
    "claude-haiku-4-5": {
        maxTokens: 8192,
        contextWindow: 200_000,
        supportsImages: true,
        supportsPromptCache: true,
        supportsNativeTools: false,
        defaultToolProtocol: "unified",
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude 4.5 Haiku",
    },
    "claude-3-7-sonnet": {
        maxTokens: 8192,
        contextWindow: 200_000,
        supportsImages: true,
        supportsPromptCache: true,
        supportsNativeTools: false,
        defaultToolProtocol: "unified",
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude 3.7 Sonnet",
    },
    "claude-3-5-sonnet-20240620": {
        maxTokens: 8192,
        contextWindow: 200_000,
        supportsImages: true,
        supportsPromptCache: true,
        supportsNativeTools: false,
        defaultToolProtocol: "unified",
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude 3.5 Sonnet",
    },
}

export type KiroModelId = keyof typeof kiroModels

export const kiroModelNames = Object.keys(kiroModels) as KiroModelId[]
