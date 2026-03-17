import { describe, it, expect, vi, beforeEach } from "vitest"
import { CodeIndexConfigManager } from "../config-manager"

// Mock dependencies
vi.mock("../../../core/config/ContextProxy")
vi.mock("../../../shared/embeddingModels", () => ({
    getDefaultModelId: vi.fn(),
    getModelDimension: vi.fn(),
    getModelScoreThreshold: vi.fn(),
}))

describe("CodeIndexConfigManager API Key Fallback", () => {
    let mockContextProxy: any
    let configManager: CodeIndexConfigManager

    beforeEach(() => {
        vi.clearAllMocks()
        mockContextProxy = {
            getGlobalState: vi.fn().mockReturnValue({}),
            getSecret: vi.fn(),
            refreshSecrets: vi.fn().mockResolvedValue(undefined),
        }
        configManager = new CodeIndexConfigManager(mockContextProxy)
    })

    const setupSecretMocks = (secrets: Record<string, string>) => {
        mockContextProxy.getSecret.mockImplementation((key: string) => secrets[key])
    }

    it("should fallback to openAiApiKey for OpenAI provider when codeIndexOpenAiKey is missing", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "openai",
            }
        })
        setupSecretMocks({
            "openAiApiKey": "global-openai-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.openAiOptions?.openAiNativeApiKey).toBe("global-openai-key")
    })

    it("should fallback to openAiNativeApiKey for OpenAI provider when codeIndexOpenAiKey is missing", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "openai",
            }
        })
        setupSecretMocks({
            "openAiNativeApiKey": "global-native-openai-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.openAiOptions?.openAiNativeApiKey).toBe("global-native-openai-key")
    })

    it("should prioritize codeIndexOpenAiKey over fallback key", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "openai",
            }
        })
        setupSecretMocks({
            "codeIndexOpenAiKey": "specific-key",
            "openAiApiKey": "global-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.openAiOptions?.openAiNativeApiKey).toBe("specific-key")
    })

    it("should fallback to geminiApiKey for Gemini provider", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "gemini",
            }
        })
        setupSecretMocks({
            "geminiApiKey": "global-gemini-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.geminiOptions?.apiKey).toBe("global-gemini-key")
    })

    it("should fallback to mistralApiKey for Mistral provider", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "mistral",
            }
        })
        setupSecretMocks({
            "mistralApiKey": "global-mistral-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.mistralOptions?.apiKey).toBe("global-mistral-key")
    })

    it("should fallback to openRouterApiKey for OpenRouter provider", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "openrouter",
            }
        })
        setupSecretMocks({
            "openRouterApiKey": "global-openrouter-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.openRouterOptions?.apiKey).toBe("global-openrouter-key")
    })

    it("should fallback to vercelAiGatewayApiKey for Vercel AI Gateway provider", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "vercel-ai-gateway",
            }
        })
        setupSecretMocks({
            "vercelAiGatewayApiKey": "global-vercel-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.vercelAiGatewayOptions?.apiKey).toBe("global-vercel-key")
    })

    it("should fallback to openAiApiKey for OpenAI Compatible provider", async () => {
        mockContextProxy.getGlobalState.mockReturnValue({
            codebaseIndexConfig: {
                codebaseIndexEnabled: true,
                codebaseIndexEmbedderProvider: "openai-compatible",
                codebaseIndexOpenAiCompatibleBaseUrl: "http://localhost:11434/v1"
            }
        })
        setupSecretMocks({
            "openAiApiKey": "global-openai-key"
        })

        const result = await configManager.loadConfiguration()
        expect(result.currentConfig.openAiCompatibleOptions?.apiKey).toBe("global-openai-key")
    })
})
