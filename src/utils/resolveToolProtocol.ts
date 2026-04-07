import { ToolProtocol, TOOL_PROTOCOL, providerForcesCodeBlockToolProtocol } from "@roo-code/types"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"

/**
 * Resolve the effective tool protocol based on the precedence hierarchy:
 *
 * 1. User Preference - Per-Profile (explicit profile setting)
 * 2. Model Default (defaultToolProtocol in ModelInfo)
 * 3. JSON/Native Fallback (final fallback when native tools are supported)
 * 4. UNIFIED Fallback (final fallback when native tools are not supported)
 *
 * Legacy protocol names are normalized for compatibility:
 * - "native" -> "json"
 * - "json" -> "json"
 * - "xml" -> "unified"
 * - "markdown" -> "markdown"
 *
 * @param providerSettings - The provider settings for the current profile
 * @param modelInfo - Optional model information containing capabilities
 * @returns The resolved tool protocol
 */
export function resolveToolProtocol(providerSettings: ProviderSettings, modelInfo?: ModelInfo): ToolProtocol {
	if (providerForcesCodeBlockToolProtocol(providerSettings.apiProvider) || modelInfo?.supportsNativeTools === false) {
		return TOOL_PROTOCOL.UNIFIED
	}

	const rawProtocol = providerSettings.toolProtocol || modelInfo?.defaultToolProtocol

	if (rawProtocol === TOOL_PROTOCOL.JSON || rawProtocol === "native") {
		return TOOL_PROTOCOL.JSON
	}

	if (rawProtocol === TOOL_PROTOCOL.MARKDOWN) {
		return TOOL_PROTOCOL.MARKDOWN
	}

	if (rawProtocol === TOOL_PROTOCOL.UNIFIED || rawProtocol === "xml") {
		return TOOL_PROTOCOL.UNIFIED
	}

	return TOOL_PROTOCOL.JSON
}
