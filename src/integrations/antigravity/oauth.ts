import type { ExtensionContext } from "vscode"
import * as z from "zod"
import * as crypto from "node:crypto"
import * as http from "node:http"
import { ANTIGRAVITY_CREDENTIALS_KEY, ANTIGRAVITY_OAUTH_CONFIG, OAUTH_CALLBACK_PORT } from "./constants"

// Schema for the credentials that will be stored securely.
// Includes the standard OAuth tokens plus the Antigravity-specific projectId.
const antigravityCredentialsSchema = z.object({
  type: z.literal("antigravity"),
  accessToken: z.string(),
  refreshToken: z.string(),
  expires: z.number(), // Expiration timestamp in ms
  scope: z.string(),
  email: z.string(),
  projectId: z.string(),
})

export type AntigravityCredentials = z.infer<typeof antigravityCredentialsSchema>

/**
 * Manages the OAuth flow and token lifecycle for Antigravity (Google Gemini Code Assist).
 *
 * This class handles:
 * - Initiating the authorization flow.
 * - Starting a local server to listen for the OAuth callback.
 * - Exchanging the authorization code for tokens.
 * - Performing the post-auth "onboarding" flow to get a projectId.
 * - Securely storing and retrieving credentials using ExtensionContext.secrets.
 * - Refreshing the access token when it expires.
 */
export class AntigravityOAuthManager {
  private context: ExtensionContext | null = null
  private credentials: AntigravityCredentials | null = null
  private logFn: ((message: string) => void) | null = null
  private refreshPromise: Promise<AntigravityCredentials> | null = null
  private pendingAuth: {
    resolve: (credentials: AntigravityCredentials) => void
    reject: (error: Error) => void
    state: string
  } | null = null
  private server: http.Server | null = null

  /**
   * Initializes the manager with the extension context for secret storage
   * and an optional logging function.
   */
  initialize(context: ExtensionContext, logFn?: (message: string) => void) {
    this.context = context
    this.logFn = logFn ?? null
    this.log("[antigravity-oauth] Manager initialized.")
  }

  /**
   * Starts the full OAuth 2.0 authorization code flow.
   * 1. Generates a CSRF token (`state`).
   * 2. Starts a local HTTP server to listen for the callback.
   * 3. Creates a promise to be resolved/rejected by the callback handler.
   * 4. Builds and returns the authorization URL for the user to open.
   */
  public startAuthorizationFlow(): string {
    this.log("[antigravity-oauth] Starting authorization flow...")

    const state = crypto.randomBytes(32).toString("base64url")
    const redirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`

    this.startLocalServer(state)

    this.pendingAuth = {
      resolve: () => { }, // Will be replaced by the Promise constructor
      reject: () => { }, // Will be replaced by the Promise constructor
      state,
    }

    const authUrl = this.buildAuthUrl(redirectUri, state)
    this.log(`[antigravity-oauth] Authorization URL created. Ready for user to open.`)
    return authUrl
  }

  /**
   * Builds the full authorization URL for the Google OAuth flow.
   */
  private buildAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_OAUTH_CONFIG.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: ANTIGRAVITY_OAUTH_CONFIG.scopes.join(" "),
      state: state,
      access_type: "offline", // Required to get a refresh_token
      prompt: "consent", // Ensures the user is prompted for consent
    })

    return `${ANTIGRAVITY_OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`
  }

  private startLocalServer(state: string) {
    if (this.server) {
      this.log("[antigravity-oauth] Server is already running. Closing existing server before starting new one.")
      this.server.close()
    }

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`)
      const params = url.searchParams

      const code = params.get("code")
      const receivedState = params.get("state")
      const error = params.get("error")

      if (error) {
        const errorDescription = params.get("error_description") || error
        this.logError(`[antigravity-oauth] OAuth callback error: ${errorDescription}`)
        this.pendingAuth?.reject(new Error(errorDescription))
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<h1>Authentication Failed</h1><p>An error occurred. You can close this window.</p>")
        this.server?.close()
        return
      }

      if (receivedState !== state) {
        this.logError("[antigravity-oauth] Invalid state parameter. Potential CSRF attack.")
        this.pendingAuth?.reject(new Error("Invalid state parameter."))
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<h1>Authentication Failed</h1><p>Invalid state. You can close this window.</p>")
        this.server?.close()
        return
      }

      if (!code) {
        this.logError("[antigravity-oauth] No authorization code received.")
        this.pendingAuth?.reject(new Error("No authorization code received."))
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<h1>Authentication Failed</h1><p>No code received. You can close this window.</p>")
        this.server?.close()
        return
      }

      try {
        this.log("[antigravity-oauth] Authorization code received. Exchanging for tokens...")
        const tokens = await this.exchangeCodeForTokens(code)

        this.log("[antigravity-oauth] Tokens received. Fetching user info...")
        const userInfo = await this.getUserInfo(tokens.access_token)

        this.log("[antigravity-oauth] Starting Gemini Code Assist onboarding flow...")
        const { projectId } = await this.completeOnboarding(tokens.access_token)
        this.log(`[antigravity-oauth] Onboarding complete. Project ID: ${projectId}`)

        const credentials: AntigravityCredentials = {
          type: "antigravity",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expires: Date.now() + tokens.expires_in * 1000,
          scope: tokens.scope,
          email: userInfo.email,
          projectId,
        }

        await this.saveCredentials(credentials)
        this.log(`[antigravity-oauth] Successfully authenticated user: ${userInfo.email}`)
        this.pendingAuth?.resolve(credentials)

        res.writeHead(200, { "Content-Type": "text/html" })
        res.end("<h1>Authentication Successful</h1><p>You can now close this window and return to VS Code.</p>")
      } catch (err) {
        this.logError("[antigravity-oauth] Failed during token exchange or onboarding:", err)
        this.pendingAuth?.reject(err as Error)
        res.writeHead(500, { "Content-Type": "text/html" })
        res.end("<h1>Authentication Failed</h1><p>An internal error occurred. You can close this window.</p>")
      } finally {
        this.server?.close()
        this.server = null
      }
    })

    this.server.on("error", (err) => {
      this.logError("[antigravity-oauth] Local server error:", err)
      this.pendingAuth?.reject(new Error(`Server error: ${err.message}`))
      this.server?.close()
      this.server = null
    })

    this.server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      this.log(`[antigravity-oauth] Local server listening on http://localhost:${OAUTH_CALLBACK_PORT}`)
    })
  }

  /**
   * Exchanges an authorization code for access and refresh tokens.
   */
  private async exchangeCodeForTokens(code: string): Promise<{
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
  }> {
    const redirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ANTIGRAVITY_OAUTH_CONFIG.clientId,
      client_secret: ANTIGRAVITY_OAUTH_CONFIG.clientSecret,
      code: code,
      redirect_uri: redirectUri,
    })

    const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`)
    }

    return response.json()
  }

  /**
   * Fetches user profile information (like email) from the Google API.
   */
  private async getUserInfo(accessToken: string): Promise<{ email: string }> {
    const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get user info: ${response.status} - ${errorText}`)
    }

    return response.json()
  }

  /**
   * Returns a promise that resolves when the OAuth callback is received and processed,
   * or rejects on timeout or error.
   */
  public async waitForCallback(): Promise<AntigravityCredentials> {
    this.log("[antigravity-oauth] Waiting for authorization callback...")
    if (!this.pendingAuth) {
      throw new Error("Authorization flow not started. Call startAuthorizationFlow() first.")
    }

    return new Promise<AntigravityCredentials>((resolve, reject) => {
      this.pendingAuth!.resolve = resolve
      this.pendingAuth!.reject = reject

      // Set a 5-minute timeout for the auth flow
      const timeout = setTimeout(() => {
        reject(new Error("Antigravity authentication timed out after 5 minutes."))
        this.server?.close()
      }, 300000)

      // When the promise is settled, clear the timeout
      const originalResolve = this.pendingAuth!.resolve
      this.pendingAuth!.resolve = (creds) => {
        clearTimeout(timeout)
        originalResolve(creds)
      }
      const originalReject = this.pendingAuth!.reject
      this.pendingAuth!.reject = (err) => {
        clearTimeout(timeout)
        originalReject(err)
      }
    })
  }

  /**
   * Retrieves a valid access token, refreshing it if it's expired.
   */
  public async getAccessToken(): Promise<string | null> {
    await this.loadCredentials()
    if (!this.credentials) {
      this.log("[antigravity-oauth] No credentials found.")
      return null
    }

    // If a refresh is already in progress, wait for it to complete.
    if (this.refreshPromise) {
      this.log("[antigravity-oauth] Token refresh in progress, waiting...")
      await this.refreshPromise
    }

    if (this.isTokenExpired()) {
      this.log("[antigravity-oauth] Access token expired. Refreshing...")
      try {
        this.refreshPromise = this.refreshAccessToken()
        await this.refreshPromise
      } catch (error) {
        this.logError("[antigravity-oauth] Failed to refresh access token.", error)
        await this.clearCredentials() // Clear credentials on refresh failure
        return null
      } finally {
        this.refreshPromise = null
      }
    }

    return this.credentials?.accessToken ?? null
  }

  /**
   * Retrieves the stored Gemini Code Assist project ID.
   */
  public async getProjectId(): Promise<string | null> {
  await this.loadCredentials()
  return this.credentials?.projectId || ANTIGRAVITY_OAUTH_CONFIG.defaultProjectId
}

  /**
   * Securely saves credentials to the extension's secret storage.
   */
  private async saveCredentials(credentials: AntigravityCredentials): Promise<void> {
    if (!this.context) {
      throw new Error("AntigravityOAuthManager not initialized with ExtensionContext.")
    }
    this.credentials = credentials
    await this.context.secrets.store(ANTIGRAVITY_CREDENTIALS_KEY, JSON.stringify(credentials))
    this.log("[antigravity-oauth] Credentials saved securely.")
  }

  /**
   * Loads credentials from the extension's secret storage.
   */
  public async loadCredentials(): Promise<AntigravityCredentials | null> {
    if (!this.context) {
      return null
    }
    if (this.credentials) {
      return this.credentials
    }

    const credentialsJson = await this.context.secrets.get(ANTIGRAVITY_CREDENTIALS_KEY)
    if (credentialsJson) {
      try {
        const parsed = JSON.parse(credentialsJson)
        this.credentials = antigravityCredentialsSchema.parse(parsed)
        return this.credentials
      } catch (error) {
        this.logError("[antigravity-oauth] Failed to parse stored credentials, clearing them.", error)
        await this.clearCredentials()
        return null
      }
    }
    return null
  }

  /**
   * Clears all stored credentials for Antigravity.
   */
  public async clearCredentials(): Promise<void> {
    this.credentials = null
    this.refreshPromise = null
    if (this.context) {
      await this.context.secrets.delete(ANTIGRAVITY_CREDENTIALS_KEY)
    }
    this.log("[antigravity-oauth] Cleared credentials.")
  }

  // --- Onboarding and Token Refresh ---

  /**
   * Uses the refresh token to get a new access token.
   */
  private async refreshAccessToken(): Promise<AntigravityCredentials> {
    if (!this.credentials?.refreshToken) {
      throw new Error("No refresh token available.")
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ANTIGRAVITY_OAUTH_CONFIG.clientId,
      client_secret: ANTIGRAVITY_OAUTH_CONFIG.clientSecret,
      refresh_token: this.credentials.refreshToken,
    })

    const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`)
    }

    const newTokens = await response.json()
    const newCredentials: AntigravityCredentials = {
      ...this.credentials,
      accessToken: newTokens.access_token,
      expires: Date.now() + newTokens.expires_in * 1000,
    }

    await this.saveCredentials(newCredentials)
    this.log("[antigravity-oauth] Token refreshed and saved successfully.")
    return newCredentials
  }

  private isTokenExpired(): boolean {
    if (!this.credentials) return true
    // Use a 5-minute buffer to be safe
    const bufferMs = 5 * 60 * 1000
    return Date.now() > this.credentials.expires - bufferMs
  }

  /**
   * Completes the multi-step onboarding process to enable Gemini Code Assist.
   */
  private async completeOnboarding(accessToken: string): Promise<{ projectId: string }> {
    const { projectId, tierId } = await this.loadCodeAssist(accessToken)
    if (!projectId) {
      throw new Error(
        "No Google Cloud Project found. Please ensure you have a GCP project with Gemini Code Assist enabled.",
      )
    }

    this.log(`[antigravity-oauth] Initial project ID: ${projectId}, Tier: ${tierId}. Starting onboarding poll...`)

    for (let i = 0; i < 10; i++) {
      const result = await this.onboardUser(accessToken, projectId, tierId)
      if (result.done === true) {
        let finalProjectId = projectId
        if (result.response?.cloudaicompanionProject) {
          const respProject = result.response.cloudaicompanionProject
          finalProjectId = (typeof respProject === "string" ? respProject : respProject.id)?.trim() ?? projectId
        }
        return { projectId: finalProjectId }
      }
      this.log(`[antigravity-oauth] Onboarding not complete, waiting 5s (attempt ${i + 1}/10)...`)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    throw new Error("Onboarding timed out after 50 seconds. Please try again.")
  }

  /**
   * Step 1 of onboarding: Fetches the initial project and tier configuration.
   */
  private async loadCodeAssist(accessToken: string): Promise<{ projectId: string; tierId: string }> {
    const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.loadCodeAssistEndpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ metadata: this.getMetadata() }),
    })

    if (!response.ok) {
      throw new Error(`Failed to load code assist: ${await response.text()}`)
    }
    const data = await response.json()

    const projectId = data.cloudaicompanionProject?.id ?? data.cloudaicompanionProject
    let tierId = "legacy-tier"
    if (Array.isArray(data.allowedTiers)) {
      tierId = data.allowedTiers.find((t: any) => t.isDefault)?.id?.trim() || tierId
    }

    return { projectId, tierId }
  }

  /**
   * Step 2 of onboarding: Polls the onboarding endpoint.
   */
  private async onboardUser(accessToken: string, projectId: string, tierId: string): Promise<any> {
    const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.onboardUserEndpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({
        tierId,
        metadata: this.getMetadata(),
        cloudaicompanionProject: projectId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to onboard user: ${await response.text()}`)
    }
    return response.json()
  }

  private getApiHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    }
  }

  private getMetadata() {
    return {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }
  }

  // --- Internal logging ---


  private log(message: string, ...args: unknown[]) {
    this.logFn?.(message)
    if (args.length > 0) {
      console.log(message, ...args)
    }
  }

  private logError(message: string, ...args: unknown[]) {
    this.logFn?.(`[ERROR] ${message}`)
    console.error(message, ...args)
  }
}



// Export a singleton instance to be used across the extension.
export const antigravityOAuthManager = new AntigravityOAuthManager()
