
/**
 * Gemini CLI OAuth Configuration
 *
 * This configuration is ported from the 9router project. It defines the
 * endpoints, client credentials, and scopes required for the Google OAuth2 flow
 * used by Gemini CLI.
 */
export const GEMINI_OAUTH_CONFIG = {
    // From 9router: GEMINI_CONFIG.clientId
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",

    // From 9router: GEMINI_CONFIG.clientSecret
    clientSecret: "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",

    // From 9router: GEMINI_CONFIG.authorizeUrl
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",

    // From 9router: GEMINI_CONFIG.tokenUrl
    tokenEndpoint: "https://oauth2.googleapis.com/token",

    // From 9router: GEMINI_CONFIG.userInfoUrl
    userInfoEndpoint: "https://www.googleapis.com/oauth2/v1/userinfo",

    // From 9router: GEMINI_CONFIG.scopes
    scopes: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ],

    // --- Gemini Specific Endpoints ---
    // Used for project discovery as seen in 9router's postExchange
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
}

/**
 * The fixed port for the OAuth callback listener.
 * Using a free port different from Antigravity/Codex.
 */
export const OAUTH_CALLBACK_PORT = 1457

/**
 * The key used to store the Gemini CLI credentials in VS Code's secret storage.
 */
export const GEMINI_CLI_CREDENTIALS_KEY = "gemini-cli-oauth-credentials"
