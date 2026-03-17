
import type { ExtensionContext } from "vscode"
import * as z from "zod"
import * as crypto from "node:crypto"
import * as http from "node:http"
import { GEMINI_CLI_CREDENTIALS_KEY, GEMINI_OAUTH_CONFIG, OAUTH_CALLBACK_PORT } from "./constants"

// Schema for the credentials that will be stored securely.
const geminiCredentialsSchema = z.object({
    type: z.literal("gemini-cli"),
    accessToken: z.string(),
    refreshToken: z.string(),
    expires: z.number(), // Expiration timestamp in ms
    scope: z.string(),
    email: z.string(),
    projectId: z.string().optional(), // Project ID might not be available immediately or needed if passed in request
})

export type GeminiCredentials = z.infer<typeof geminiCredentialsSchema>

/**
 * Manages the OAuth flow and token lifecycle for Gemini CLI.
 */
export class GeminiOAuthManager {
    private context: ExtensionContext | null = null
    private credentials: GeminiCredentials | null = null
    private logFn: ((message: string) => void) | null = null
    private refreshPromise: Promise<GeminiCredentials> | null = null
    private pendingAuth: {
        resolve: (credentials: GeminiCredentials) => void
        reject: (error: Error) => void
        state: string
    } | null = null
    private server: http.Server | null = null

    initialize(context: ExtensionContext, logFn?: (message: string) => void) {
        this.context = context
        this.logFn = logFn ?? null
        this.log("[gemini-oauth] Manager initialized.")
    }

    public startAuthorizationFlow(): string {
        this.log("[gemini-oauth] Starting authorization flow...")

        const state = crypto.randomBytes(32).toString("base64url")
        const redirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`

        this.startLocalServer(state)

        this.pendingAuth = {
            resolve: () => { },
            reject: () => { },
            state,
        }

        const authUrl = this.buildAuthUrl(redirectUri, state)
        this.log(`[gemini-oauth] Authorization URL created. Ready for user to open.`)
        return authUrl
    }

    private buildAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: GEMINI_OAUTH_CONFIG.clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: GEMINI_OAUTH_CONFIG.scopes.join(" "),
            state: state,
            access_type: "offline",
            prompt: "consent",
        })

        return `${GEMINI_OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`
    }

    private startLocalServer(state: string) {
        if (this.server) {
            this.log("[gemini-oauth] Server is already running. Closing existing server before starting new one.")
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
                this.logError(`[gemini-oauth] OAuth callback error: ${errorDescription}`)
                this.pendingAuth?.reject(new Error(errorDescription))
                res.writeHead(400, { "Content-Type": "text/html" })
                res.end("<h1>Authentication Failed</h1><p>An error occurred. You can close this window.</p>")
                this.server?.close()
                return
            }

            if (receivedState !== state) {
                this.logError("[gemini-oauth] Invalid state parameter. Potential CSRF attack.")
                this.pendingAuth?.reject(new Error("Invalid state parameter."))
                res.writeHead(400, { "Content-Type": "text/html" })
                res.end("<h1>Authentication Failed</h1><p>Invalid state. You can close this window.</p>")
                this.server?.close()
                return
            }

            if (!code) {
                this.logError("[gemini-oauth] No authorization code received.")
                this.pendingAuth?.reject(new Error("No authorization code received."))
                res.writeHead(400, { "Content-Type": "text/html" })
                res.end("<h1>Authentication Failed</h1><p>No code received. You can close this window.</p>")
                this.server?.close()
                return
            }

            try {
                this.log("[gemini-oauth] Authorization code received. Exchanging for tokens...")
                const tokens = await this.exchangeCodeForTokens(code)

                this.log("[gemini-oauth] Tokens received. Fetching user info...")
                const userInfo = await this.getUserInfo(tokens.access_token)

                this.log("[gemini-oauth] Fetching Project ID...")
                const projectId = await this.fetchProjectId(tokens.access_token)
                this.log(`[gemini-oauth] Project ID: ${projectId}`)

                const credentials: GeminiCredentials = {
                    type: "gemini-cli",
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expires: Date.now() + tokens.expires_in * 1000,
                    scope: tokens.scope,
                    email: userInfo.email,
                    projectId: projectId || undefined,
                }

                await this.saveCredentials(credentials)
                this.log(`[gemini-oauth] Successfully authenticated user: ${userInfo.email}`)
                this.pendingAuth?.resolve(credentials)

                res.writeHead(200, { "Content-Type": "text/html" })
                res.end("<h1>Authentication Successful</h1><p>You can now close this window and return to VS Code.</p>")
            } catch (err) {
                this.logError("[gemini-oauth] Failed during token exchange:", err)
                this.pendingAuth?.reject(err as Error)
                res.writeHead(500, { "Content-Type": "text/html" })
                res.end("<h1>Authentication Failed</h1><p>An internal error occurred. You can close this window.</p>")
            } finally {
                this.server?.close()
                this.server = null
            }
        })

        this.server.on("error", (err) => {
            this.logError("[gemini-oauth] Local server error:", err)
            this.pendingAuth?.reject(new Error(`Server error: ${err.message}`))
            this.server?.close()
            this.server = null
        })

        this.server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
            this.log(`[gemini-oauth] Local server listening on http://localhost:${OAUTH_CALLBACK_PORT}`)
        })
    }

    private async exchangeCodeForTokens(code: string): Promise<{
        access_token: string
        refresh_token: string
        expires_in: number
        scope: string
    }> {
        const redirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: GEMINI_OAUTH_CONFIG.clientId,
            client_secret: GEMINI_OAUTH_CONFIG.clientSecret,
            code: code,
            redirect_uri: redirectUri,
        })

        const response = await fetch(GEMINI_OAUTH_CONFIG.tokenEndpoint, {
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

    private async getUserInfo(accessToken: string): Promise<{ email: string }> {
        const response = await fetch(GEMINI_OAUTH_CONFIG.userInfoEndpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (!response.ok) {
            // Fallback to empty email if fails, or throw? 
            // 9router treats it as empty object if fail.
            // But for our schema we need string.
            try {
                const errorText = await response.text()
                console.error(`Failed to get user info: ${response.status} - ${errorText}`)
            } catch { }
            return { email: "unknown" }
        }

        return response.json()
    }

    private async fetchProjectId(accessToken: string): Promise<string | null> {
        try {
            const response = await fetch(GEMINI_OAUTH_CONFIG.loadCodeAssistEndpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    metadata: { 
                        ideType: "VSCODE", 
                        platform: "PLATFORM_UNSPECIFIED", 
                        pluginType: "GEMINI"  
                    },
                }),
            })

            if (!response.ok) {
                const txt = await response.text()
                console.error("Failed to load code assist:", txt)
                return null
            }

            const data = await response.json()
            const projectId = data.cloudaicompanionProject?.id ?? data.cloudaicompanionProject
            return projectId || null
        } catch (e) {
            console.error("Error fetching project ID:", e)
            return null
        }
    }

    public async waitForCallback(): Promise<GeminiCredentials> {
        this.log("[gemini-oauth] Waiting for authorization callback...")
        if (!this.pendingAuth) {
            throw new Error("Authorization flow not started. Call startAuthorizationFlow() first.")
        }

        return new Promise<GeminiCredentials>((resolve, reject) => {
            this.pendingAuth!.resolve = resolve
            this.pendingAuth!.reject = reject

            const timeout = setTimeout(() => {
                reject(new Error("Gemini authentication timed out after 5 minutes."))
                this.server?.close()
            }, 300000)

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

    public async getAccessToken(): Promise<string | null> {
        await this.loadCredentials()
        if (!this.credentials) {
            this.log("[gemini-oauth] No credentials found.")
            return null
        }

        if (this.refreshPromise) {
            await this.refreshPromise
        }

        if (this.isTokenExpired()) {
            this.log("[gemini-oauth] Access token expired. Refreshing...")
            try {
                this.refreshPromise = this.refreshAccessToken()
                await this.refreshPromise
            } catch (error) {
                this.logError("[gemini-oauth] Failed to refresh access token.", error)
                await this.clearCredentials()
                return null
            } finally {
                this.refreshPromise = null
            }
        }

        return this.credentials?.accessToken ?? null
    }

    public async getProjectId(): Promise<string | null> {
        await this.loadCredentials()

        if (!this.credentials) {
            return null
        }

        if (this.credentials.projectId) {
            return this.credentials.projectId
        }

        const accessToken = await this.getAccessToken()
        if (!accessToken) {
            return null
        }

        const projectId = await this.fetchProjectId(accessToken)
        if (!projectId) {
            return null
        }

        const updatedCredentials: GeminiCredentials = {
            ...this.credentials,
            projectId,
        }
        await this.saveCredentials(updatedCredentials)

        return projectId
    }

    private async saveCredentials(credentials: GeminiCredentials): Promise<void> {
        if (!this.context) {
            throw new Error("GeminiOAuthManager not initialized with ExtensionContext.")
        }
        this.credentials = credentials
        await this.context.secrets.store(GEMINI_CLI_CREDENTIALS_KEY, JSON.stringify(credentials))
        this.log("[gemini-oauth] Credentials saved securely.")
    }

    public async loadCredentials(): Promise<GeminiCredentials | null> {
        if (!this.context) {
            return null
        }
        if (this.credentials) {
            return this.credentials
        }

        const credentialsJson = await this.context.secrets.get(GEMINI_CLI_CREDENTIALS_KEY)
        if (credentialsJson) {
            try {
                const parsed = JSON.parse(credentialsJson)
                this.credentials = geminiCredentialsSchema.parse(parsed)
                return this.credentials
            } catch (error) {
                this.logError("[gemini-oauth] Failed to parse stored credentials, clearing them.", error)
                await this.clearCredentials()
                return null
            }
        }
        return null
    }

    public async clearCredentials(): Promise<void> {
        this.credentials = null
        this.refreshPromise = null
        if (this.context) {
            await this.context.secrets.delete(GEMINI_CLI_CREDENTIALS_KEY)
        }
        this.log("[gemini-oauth] Cleared credentials.")
    }

    private async refreshAccessToken(): Promise<GeminiCredentials> {
        if (!this.credentials?.refreshToken) {
            throw new Error("No refresh token available.")
        }

        const body = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: GEMINI_OAUTH_CONFIG.clientId,
            client_secret: GEMINI_OAUTH_CONFIG.clientSecret,
            refresh_token: this.credentials.refreshToken,
        })

        const response = await fetch(GEMINI_OAUTH_CONFIG.tokenEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Token refresh failed: ${response.status} - ${errorText}`)
        }

        const newTokens = await response.json()
        const newCredentials: GeminiCredentials = {
            ...this.credentials,
            accessToken: newTokens.access_token,
            expires: Date.now() + newTokens.expires_in * 1000,
        }

        await this.saveCredentials(newCredentials)
        this.log("[gemini-oauth] Token refreshed and saved successfully.")
        return newCredentials
    }

    private isTokenExpired(): boolean {
        if (!this.credentials) return true
        const bufferMs = 5 * 60 * 1000
        return Date.now() > this.credentials.expires - bufferMs
    }

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

export const geminiOAuthManager = new GeminiOAuthManager()
