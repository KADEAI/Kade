import { claudeCodeOAuthManager } from "./oauth"
import { fetchRateLimitInfo } from "./streaming-client"
import { type ClaudeCodeRateLimitInfo } from "@roo-code/types"

/**
 * Fetches rate limit information for the currently authenticated Claude Code user.
 */
export async function fetchClaudeCodeRateLimitInfo(): Promise<ClaudeCodeRateLimitInfo> {
    const accessToken = await claudeCodeOAuthManager.getAccessToken()
    if (!accessToken) {
        throw new Error("Not authenticated with Claude Code")
    }

    return fetchRateLimitInfo(accessToken)
}
