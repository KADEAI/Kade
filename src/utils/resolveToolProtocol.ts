import { ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"

/**
 * Resolve the effective tool protocol based on the precedence hierarchy:
 *
 * 1. User Preference - Per-Profile (explicit profile setting)
 * 2. Model Default (defaultToolProtocol in ModelInfo)
 * 3. NATIVE Fallback (final fallback)
 *
 * Then check support: if protocol is "native" but model doesn't support it, use MARKDOWN.
 *
 * @param providerSettings - The provider settings for the current profile
 * @param modelInfo - Optional model information containing capabilities
 * @returns The resolved tool protocol (either "unified" or "markdown")
 */
export function resolveToolProtocol(providerSettings: ProviderSettings, modelInfo?: ModelInfo): ToolProtocol {
	// Determine the preferred protocol
	const rawProtocol = providerSettings.toolProtocol || modelInfo?.defaultToolProtocol || TOOL_PROTOCOL.MARKDOWN
	const preferredProtocol = (rawProtocol as any) === "xml" || (rawProtocol as any) === "native" ? TOOL_PROTOCOL.MARKDOWN : (rawProtocol as ToolProtocol)


	return preferredProtocol
}
