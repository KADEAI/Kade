import { describe, expect, it } from "vitest"
import { resolveToolProtocol } from "../resolveToolProtocol"
import { TOOL_PROTOCOL } from "@roo-code/types"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"

describe("resolveToolProtocol", () => {
	it("defaults to json when nothing is set and model support is unknown", () => {
		const settings: ProviderSettings = { apiProvider: "anthropic" }
		expect(resolveToolProtocol(settings)).toBe(TOOL_PROTOCOL.JSON)
	})

	it("defaults to unified when nothing is set and the model has no native tools", () => {
		const settings: ProviderSettings = { apiProvider: "anthropic" }
		const modelInfo: ModelInfo = {
			maxTokens: 4096,
			contextWindow: 128000,
			supportsPromptCache: false,
			supportsNativeTools: false,
		}

		expect(resolveToolProtocol(settings, modelInfo)).toBe(TOOL_PROTOCOL.UNIFIED)
	})

	it("defaults to json when nothing is set and the model supports native tools", () => {
		const settings: ProviderSettings = { apiProvider: "anthropic" }
		const modelInfo: ModelInfo = {
			maxTokens: 4096,
			contextWindow: 128000,
			supportsPromptCache: false,
			supportsNativeTools: true,
		}

		expect(resolveToolProtocol(settings, modelInfo)).toBe(TOOL_PROTOCOL.JSON)
	})

	it("keeps unified when explicitly selected even if the model supports native tools", () => {
		const settings: ProviderSettings = {
			apiProvider: "anthropic",
			toolProtocol: TOOL_PROTOCOL.UNIFIED,
		}
		const modelInfo: ModelInfo = {
			maxTokens: 4096,
			contextWindow: 128000,
			supportsPromptCache: false,
			supportsNativeTools: true,
		}

		expect(resolveToolProtocol(settings, modelInfo)).toBe(TOOL_PROTOCOL.UNIFIED)
	})

	it.each([
		["json", TOOL_PROTOCOL.JSON],
		["native", TOOL_PROTOCOL.JSON],
		["markdown", TOOL_PROTOCOL.MARKDOWN],
		["xml", TOOL_PROTOCOL.UNIFIED],
	] as const)(
		"normalizes provider setting '%s' to '%s'",
		(protocol, expected) => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
				toolProtocol: protocol as ProviderSettings["toolProtocol"],
			}

			expect(resolveToolProtocol(settings)).toBe(expected)
		},
	)

	it.each([
		["json", TOOL_PROTOCOL.JSON],
		["native", TOOL_PROTOCOL.JSON],
		["markdown", TOOL_PROTOCOL.MARKDOWN],
		["xml", TOOL_PROTOCOL.UNIFIED],
	] as const)(
		"normalizes model default '%s' to '%s'",
		(protocol, expected) => {
			const settings: ProviderSettings = { apiProvider: "anthropic" }
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				defaultToolProtocol: protocol,
			}

			expect(resolveToolProtocol(settings, modelInfo)).toBe(expected)
		},
	)

	it("keeps unified when explicitly selected for a model without native tool support", () => {
		const settings: ProviderSettings = {
			apiProvider: "anthropic",
			toolProtocol: TOOL_PROTOCOL.UNIFIED,
		}
		const modelInfo: ModelInfo = {
			maxTokens: 4096,
			contextWindow: 128000,
			supportsPromptCache: false,
			defaultToolProtocol: "markdown",
		}

		expect(resolveToolProtocol(settings, modelInfo)).toBe(TOOL_PROTOCOL.UNIFIED)
	})
})
