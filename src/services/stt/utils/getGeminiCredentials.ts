// kade_change - new file: Shared utility for Gemini credential retrieval
import type { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"

/**
 * Get Gemini API key from provider settings
 * Searches for any provider with type "gemini"
 */
export async function getGeminiApiKey(providerSettingsManager: ProviderSettingsManager): Promise<string | null> {
    try {
        const allProfiles = await providerSettingsManager.listConfig()

        for (const profile of allProfiles) {
            if (profile.apiProvider === "gemini") {
                const fullProfile = await providerSettingsManager.getProfile({ id: profile.id })
                if (fullProfile.geminiApiKey) {
                    return fullProfile.geminiApiKey
                }
            }
        }

        return null
    } catch (error) {
        console.error("[getGeminiCredentials] Error getting API key:", error)
        return null
    }
}
