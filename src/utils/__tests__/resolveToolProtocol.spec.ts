import { describe, it, expect } from "vitest"
import { resolveToolProtocol } from "../resolveToolProtocol"
import { TOOL_PROTOCOL } from "@roo-code/types"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"

describe("resolveToolProtocol", () => {
	describe("Precedence Level 1: User Profile Setting", () => {
		it("should use profile toolProtocol when explicitly set to xml", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN,
				apiProvider: "anthropic",
			}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN)
		})

		it("should use profile toolProtocol when explicitly set to native", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN,
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true, // Model supports native tools
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN)
		})

		it("should override model default when profile setting is present", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN,
				apiProvider: "openai-native",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				defaultToolProtocol: "markdown",
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Profile setting wins
		})

		it("should override model capability when profile setting is present", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN,
				apiProvider: "openai-native",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Profile setting wins
		})
	})

	describe("Precedence Level 2: Model Default", () => {
		it("should use model defaultToolProtocol when no profile setting", () => {
			const settings: ProviderSettings = {
				apiProvider: "roo",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				defaultToolProtocol: "markdown",
				supportsNativeTools: true, // Model must support native tools
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Model default wins when experiment is disabled
		})

		it("should override model capability when model default is present", () => {
			const settings: ProviderSettings = {
				apiProvider: "roo",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				defaultToolProtocol: TOOL_PROTOCOL.MARKDOWN,
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Model default wins over capability
		})
	})

	describe("Support Validation", () => {
		it("should fall back to XML when model doesn't support native", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: false,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN)
		})

		it("should fall back to XML when user prefers native but model doesn't support it", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN, // User wants native
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: false, // But model doesn't support it
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Falls back to XML due to lack of support
		})

		it("should fall back to XML when user prefers native but model support is undefined", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN, // User wants native
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				// supportsNativeTools is undefined (not specified)
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Falls back to XML - undefined treated as unsupported
		})
	})

	describe("Precedence Level 3: UNIFIED Fallback", () => {
		it("should use UNIFIED fallback when no model default is specified", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}
			const result = resolveToolProtocol(settings, undefined)
			expect(result).toBe(TOOL_PROTOCOL.UNIFIED) // UNIFIED fallback
		})
	})

	describe("Complete Precedence Chain", () => {
		it("should respect full precedence: Profile > Model Default > UNIFIED Fallback", () => {
			// Set up a scenario with all levels defined
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN, // Level 1: User profile setting
				apiProvider: "roo",
			}

			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				defaultToolProtocol: TOOL_PROTOCOL.MARKDOWN, // Level 2: Model default
				supportsNativeTools: true, // Support check
			}

			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Profile setting wins
		})

		it("should skip to model default when profile setting is undefined", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai-native",
			}

			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				defaultToolProtocol: TOOL_PROTOCOL.MARKDOWN, // Level 2
				supportsNativeTools: true, // Support check
			}

			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Model default wins
		})

		it("should skip to UNIFIED fallback when profile and model default are undefined", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai-native",
			}

			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true,
			}

			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.UNIFIED) // UNIFIED fallback
		})

		it("should skip to UNIFIED fallback when model info is unavailable", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}

			const result = resolveToolProtocol(settings, undefined)
			expect(result).toBe(TOOL_PROTOCOL.UNIFIED) // UNIFIED fallback
		})
	})

	describe("Edge Cases", () => {
		it("should handle missing provider name gracefully", () => {
			const settings: ProviderSettings = {}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.UNIFIED) // Falls back to global
		})

		it("should handle undefined model info gracefully", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai-native",
			}
			const result = resolveToolProtocol(settings, undefined)
			expect(result).toBe(TOOL_PROTOCOL.UNIFIED) // UNIFIED fallback
		})

		it("should fall back to XML when model doesn't support native", () => {
			const settings: ProviderSettings = {
				apiProvider: "roo",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: false, // Model doesn't support native
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Falls back to XML due to lack of support
		})
	})

	describe("Real-world Scenarios", () => {
		it("should use UNIFIED fallback for models without defaultToolProtocol", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai-native",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.UNIFIED) // UNIFIED fallback
		})

		it("should use XML for Claude models with Anthropic provider", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsPromptCache: true,
				supportsNativeTools: false,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN)
		})

		it("should allow user to force XML on native-supporting model", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN, // User explicitly wants XML
				apiProvider: "openai-native",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true, // Model supports native but user wants XML
				defaultToolProtocol: "markdown",
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // User preference wins
		})

		it("should not allow user to force native when model doesn't support it", () => {
			const settings: ProviderSettings = {
				toolProtocol: TOOL_PROTOCOL.MARKDOWN, // User wants native
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: false, // Model doesn't support native
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Falls back to XML due to lack of support
		})

		it("should use model default when available", () => {
			const settings: ProviderSettings = {
				apiProvider: "roo",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsPromptCache: true,
				defaultToolProtocol: TOOL_PROTOCOL.MARKDOWN,
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.MARKDOWN) // Model default wins
		})
	})
})
