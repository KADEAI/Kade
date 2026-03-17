/**
 * Antigravity (Google) OAuth Configuration
 *
 * This configuration is ported from the 9router project. It defines the
 * endpoints, client credentials, and scopes required for the Google OAuth2 flow
 * used by Gemini Code Assist (internally referred to as Antigravity).
 */
export const ANTIGRAVITY_OAUTH_CONFIG = {
    // From 9router: ANTIGRAVITY_CONFIG.clientId
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",

    // From 9router: ANTIGRAVITY_CONFIG.clientSecret
    clientSecret: "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",

    // From 9router: ANTIGRAVITY_CONFIG.authorizeUrl
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",

    // From 9router: ANTIGRAVITY_CONFIG.tokenUrl
    tokenEndpoint: "https://oauth2.googleapis.com/token",

    // From 9router: ANTIGRAVITY_CONFIG.userInfoUrl
    userInfoEndpoint: "https://www.googleapis.com/oauth2/v1/userinfo",

    // From 9router: ANTIGRAVITY_CONFIG.scopes
    scopes: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/cclog",
        "https://www.googleapis.com/auth/experimentsandconfigs",
    ],

    // --- Antigravity Specific Endpoints ---
    // From 9router: ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",

    // From 9router: ANTIGRAVITY_CONFIG.onboardUserEndpoint
    onboardUserEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",

    /**
     * Hardcoded project id used when Antigravity does not return one.
     */
    defaultProjectId: "rising-fact-p41fc",
}

/**
 * Antigravity version string - SINGLE SOURCE OF TRUTH.
 */
export const ANTIGRAVITY_VERSION = "1.18.4"

/**
 * The fixed port for the OAuth callback listener.
 * Using a fixed port is more reliable for VS Code extensions.
 */
export const OAUTH_CALLBACK_PORT = 1456 // Using a different port than Codex

/**
 * The key used to store the Antigravity credentials in VS Code's secret storage.
 */
export const ANTIGRAVITY_CREDENTIALS_KEY = "antigravity-oauth-credentials"