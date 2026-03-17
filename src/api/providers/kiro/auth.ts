import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import axios from "axios"
import { Mutex } from "async-mutex"
// @ts-ignore
// import * as sqlite3 from "@vscode/sqlite3"
import { getMachineFingerprint } from "./utils"

/**
 * Authentication type for Kiro API.
 */
export enum AuthType {
    KIRO_DESKTOP = "KIRO_DESKTOP",
    AWS_SSO_OIDC = "AWS_SSO_OIDC",
}

/**
 * Kiro authentication manager.
 * Handles token generation, refresh, and storage.
 * Ported from KiroaaS python-backend/kiro/auth.py
 */
export class KiroAuthManager {
    private accessToken: string | null = null
    private refreshToken: string | null = null
    private expiresAt: Date | null = null
    private profileArn: string | null = null
    private region: string
    private ssoRegion: string | null = null
    private clientId: string | null = null
    private clientSecret: string | null = null
    private credsFile: string | null = null
    private sqliteDb: string | null = null
    private sqliteTokenKey: string | null = null
    private authType: AuthType = AuthType.KIRO_DESKTOP
    private fingerprint: string
    private lock = new Mutex()

    private readonly REFRESH_THRESHOLD = 600 // 10 minutes in seconds

    constructor(options: {
        refreshToken?: string
        profileArn?: string
        region?: string
        credsFile?: string
        clientId?: string
        clientSecret?: string
        sqliteDb?: string
    }) {
        this.refreshToken = options.refreshToken || null
        this.profileArn = options.profileArn || null
        this.region = options.region || "us-east-1"
        this.credsFile = options.credsFile || null
        this.clientId = options.clientId || null
        this.clientSecret = options.clientSecret || null
        this.sqliteDb = options.sqliteDb || null
        this.fingerprint = getMachineFingerprint()

        // Initialize from sources
        this.initialize()
    }

    private async initialize() {
        if (this.sqliteDb) {
            await this.loadCredentialsFromSqlite(this.sqliteDb)
        }
        
        if (this.credsFile) {
            await this.loadCredentialsFromDirectory(path.dirname(this.expandUser(this.credsFile)))
        }
    }

    /**
     * Diagnostic check for the UI
     */
    async checkAuth() {
        await this.initialize()
        return {
            hasAccessToken: !!this.accessToken,
            hasRefreshToken: !!this.refreshToken,
            expiresAt: this.expiresAt,
            region: this.region,
            authType: this.authType
        }
    }

    private detectAuthType() {
        if (this.clientId && this.clientSecret) {
            this.authType = AuthType.AWS_SSO_OIDC
        } else {
            this.authType = AuthType.KIRO_DESKTOP
        }
    }

    /**
     * Returns a valid access token, refreshing it if necessary.
     */
    async getAccessToken(): Promise<string> {
        return await this.lock.runExclusive(async () => {
            await this.initialize()
            if (this.accessToken && !this.isTokenExpiringSoon()) {
                return this.accessToken
            }

            try {
                await this.refreshTokenRequest()
            } catch (error: any) {
                console.error("[KiroAuthManager] Token refresh failed:", error.message)

                // Fallback: If refresh failed but we have an unexpired token (unlikely if isTokenExpiringSoon was true),
                // or if we are in SQLite mode, maybe another process refreshed it.
                if (this.sqliteDb) {
                    console.log("[KiroAuthManager] Reloading from SQLite after failed refresh...")
                    await this.loadCredentialsFromSqlite(this.sqliteDb)
                    if (this.accessToken && !this.isTokenExpiringSoon()) {
                        return this.accessToken
                    }
                }

                if (this.accessToken && !this.isTokenExpired()) {
                    console.warn("[KiroAuthManager] Using unexpired but nearing expiration token.")
                    return this.accessToken
                }

                throw new Error(`Failed to obtain access token: ${error.message}`)
            }

            if (!this.accessToken) {
                throw new Error("Unable to obtain access token")
            }

            return this.accessToken
        })
    }

    /**
     * Forced token refresh.
     */
    async forceRefresh(): Promise<string> {
        return await this.lock.runExclusive(async () => {
            await this.refreshTokenRequest()
            if (!this.accessToken) throw new Error("Failed to obtain access token after force refresh")
            return this.accessToken
        })
    }

    private isTokenExpiringSoon(): boolean {
        if (!this.expiresAt) return true
        const now = Math.floor(Date.now() / 1000)
        return this.expiresAt.getTime() / 1000 <= now + this.REFRESH_THRESHOLD
    }

    private isTokenExpired(): boolean {
        if (!this.expiresAt) return true
        return this.expiresAt.getTime() <= Date.now()
    }

    private async refreshTokenRequest(): Promise<void> {
        if (this.authType === AuthType.KIRO_DESKTOP) {
            await this.refreshTokenKiroDesktop()
        } else {
            await this.refreshTokenAwsSsoOidc()
        }
    }

    private async refreshTokenKiroDesktop(): Promise<void> {
        if (!this.refreshToken) throw new Error("Refresh token is not set")

        const url = `https://prod.${this.region}.auth.desktop.kiro.dev/refreshToken`
        const payload = { refreshToken: this.refreshToken }
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": `KiroIDE-0.8.140-managed`,
        }

        console.log("[KiroAuthManager] Refreshing token via Kiro Desktop Auth...")
        const response = await axios.post(url, payload, { headers, timeout: 30000 })
        const data = response.data

        this.accessToken = data.accessToken
        this.refreshToken = data.refreshToken || this.refreshToken
        if (data.expiresAt) {
            this.expiresAt = new Date(data.expiresAt)
        } else if (data.expiresIn) {
            this.expiresAt = new Date(Date.now() + data.expiresIn * 1000)
        }

        await this.saveCredentials()
    }

    private async refreshTokenAwsSsoOidc(): Promise<void> {
        try {
            await this.doAwsSsoOidcRefresh()
        } catch (error: any) {
            if (error.response?.status === 400 && this.sqliteDb) {
                console.warn("[KiroAuthManager] Token refresh failed with 400, reloading from SQLite...")
                await this.loadCredentialsFromSqlite(this.sqliteDb)
                await this.doAwsSsoOidcRefresh()
            } else {
                throw error
            }
        }
    }

    private async doAwsSsoOidcRefresh(): Promise<void> {
        if (!this.refreshToken) throw new Error("Refresh token is not set")
        if (!this.clientId) throw new Error("Client ID is not set")
        if (!this.clientSecret) throw new Error("Client secret is not set")

        const ssoRegion = this.ssoRegion || this.region
        const url = `https://oidc.${ssoRegion}.amazonaws.com/token`
        const payload = {
            grantType: "refresh_token",
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            refreshToken: this.refreshToken,
        }

        console.log("[KiroAuthManager] Refreshing token via AWS SSO OIDC...")
        const response = await axios.post(url, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
        })
        const result = response.data

        this.accessToken = result.accessToken
        this.refreshToken = result.refreshToken || this.refreshToken
        if (result.expiresIn) {
            this.expiresAt = new Date(Date.now() + result.expiresIn * 1000)
        }

        await this.saveCredentials()
    }

    private async saveCredentials(): Promise<void> {
        if (this.credsFile) {
            await this.saveCredentialsToFile()
        }
        if (this.sqliteDb) {
            await this.saveCredentialsToSqlite()
        }
    }

    private async loadCredentialsFromDirectory(dirPath: string): Promise<void> {
        try {
            const files = await fs.readdir(dirPath)
            const mergedData: any = {}

            const sortedFiles = files.sort((a, b) => {
                if (a === "kiro-auth-token.json") return -1
                if (b === "kiro-auth-token.json") return 1
                return 0
            })

            for (const file of sortedFiles) {
                if (!file.endsWith(".json")) continue
                try {
                    const filePath = path.join(dirPath, file)
                    const content = await fs.readFile(filePath, "utf-8")
                    const cleanContent = content.trim().split("}{")[0] + (content.includes("}{") ? "}" : "")
                    const data = JSON.parse(cleanContent)
                    console.log(`[KiroAuthManager] Reading ${file}, found refreshToken: ${!!(data.refreshToken || data.refresh_token)}`)
                    Object.assign(mergedData, data)
                } catch (e) {
                    console.error(`[KiroAuthManager] Error parsing ${file}:`, e.message)
                }
            }

            console.log(`[KiroAuthManager] Merged data keys: ${Object.keys(mergedData).join(", ")}`)
            this.accessToken = mergedData.accessToken || mergedData.access_token || this.accessToken
            this.refreshToken = mergedData.refreshToken || mergedData.refresh_token || this.refreshToken
            this.clientId = mergedData.clientId || mergedData.client_id || this.clientId
            this.clientSecret = mergedData.clientSecret || mergedData.client_secret || this.clientSecret
            
            if (mergedData.expiresAt) this.expiresAt = new Date(mergedData.expiresAt)
            else if (mergedData.expires_at) this.expiresAt = new Date(mergedData.expires_at)
            else if (mergedData.expiresIn) this.expiresAt = new Date(Date.now() + mergedData.expiresIn * 1000)
            
            if (mergedData.region) {
                this.region = mergedData.region
                this.ssoRegion = mergedData.region
            }
            if (mergedData.profileArn) this.profileArn = mergedData.profileArn
            
            this.detectAuthType()
            console.log(`[KiroAuthManager] Final State - AccessToken: ${!!this.accessToken}, RefreshToken: ${!!this.refreshToken}, ProfileArn: ${this.profileArn}`)
        } catch (error) {
            console.warn(`[KiroAuthManager] Failed to scan directory ${dirPath}:`, error)
        }
    }

    private async saveCredentialsToFile(): Promise<void> {
        if (!this.credsFile) return
        try {
            const expandedPath = this.expandUser(this.credsFile)
            let existingData: any = {}
            try {
                const content = await fs.readFile(expandedPath, "utf-8")
                existingData = JSON.parse(content)
            } catch (e) { }

            existingData.accessToken = this.accessToken
            existingData.refreshToken = this.refreshToken
            if (this.expiresAt) {
                existingData.expiresAt = this.expiresAt.toISOString()
            }
            if (this.profileArn) {
                existingData.profileArn = this.profileArn
            }

            await fs.writeFile(expandedPath, JSON.stringify(existingData, null, 2))
        } catch (error) {
            console.error("[KiroAuthManager] Failed to save credentials to file:", error)
        }
    }

    private async loadCredentialsFromSqlite(dbPath: string): Promise<void> {
        // Skip SQLite if the module is known to be missing to avoid console noise
        return Promise.resolve()
    }

    private async _unused_loadCredentialsFromSqlite(dbPath: string): Promise<void> {
        const expandedPath = this.expandUser(dbPath)

        return new Promise((resolve) => {
            // @ts-ignore
            const db = new (global as any).sqlite3.Database(expandedPath, 0, (err: Error | null) => {
                if (err) {
                    console.warn(`[KiroAuthManager] Failed to open SQLite DB ${expandedPath}:`, err)
                    return resolve()
                }

                // The keys we check for AWS SSO OIDC tokens
                const supportedKeys = [
                    "cw:token", // kiro-cli
                    "aws-q-cli:token", // amzn-q-cli
                    "sso:token",
                ]

                db.all(
                    "SELECT key, value FROM auth_kv WHERE key IN (?, ?, ?)",
                    supportedKeys,
                    (err: Error | null, rows: any[]) => {
                        if (err || !rows) {
                            db.close()
                            return resolve()
                        }

                        // Prioritize cw:token
                        const keyOrder = ["cw:token", "aws-q-cli:token", "sso:token"]
                        rows.sort((a, b) => keyOrder.indexOf(a.key) - keyOrder.indexOf(b.key))

                        if (rows.length > 0) {
                            const row = rows[0]
                            this.sqliteTokenKey = row.key
                            try {
                                const data = JSON.parse(row.value)
                                this.accessToken = data.access_token || null
                                this.refreshToken = data.refresh_token || null
                                if (data.expires_at) this.expiresAt = new Date(data.expires_at)
                                this.ssoRegion = data.region || null

                                // Client creds for OIDC
                                db.get(
                                    "SELECT value FROM auth_kv WHERE key = ?",
                                    ["sso:client_creds"],
                                    (err: Error | null, clientRow: any) => {
                                        if (!err && clientRow) {
                                            try {
                                                const clientData = JSON.parse(clientRow.value)
                                                this.clientId = clientData.clientId || null
                                                this.clientSecret = clientData.clientSecret || null
                                            } catch (e) { }
                                        }
                                        db.close()
                                        resolve()
                                    },
                                )
                                return
                            } catch (e) {
                                console.error("[KiroAuthManager] Failed to parse SQLite token JSON:", e)
                            }
                        }
                        db.close()
                        resolve()
                    },
                )
            })
        })
    }

    private async saveCredentialsToSqlite(): Promise<void> {
        if (!this.sqliteDb) return
        const expandedPath = this.expandUser(this.sqliteDb)

        // Use dynamic import for sqlite3
        let sqlite3: any
        try {
            // @ts-ignore
            sqlite3 = await import("@vscode/sqlite3")
        } catch (error) {
            console.error("[KiroAuthManager] Cannot save to SQLite: @vscode/sqlite3 not available.")
            return
        }

        return new Promise((resolve) => {
            const db = new sqlite3.Database(expandedPath, sqlite3.OPEN_READWRITE, (err: Error | null) => {
                if (err) {
                    console.error(`[KiroAuthManager] Failed to open SQLite DB for writing:`, err)
                    return resolve()
                }

                const tokenData = {
                    access_token: this.accessToken,
                    refresh_token: this.refreshToken,
                    expires_at: this.expiresAt ? this.expiresAt.toISOString() : null,
                    region: this.ssoRegion || this.region,
                }
                const tokenJson = JSON.stringify(tokenData)

                const updateToken = (key: string) => {
                    db.run("UPDATE auth_kv SET value = ? WHERE key = ?", [tokenJson, key], function (this: any, err: Error | null) {
                        if (!err && this.changes > 0) {
                            db.close()
                            resolve()
                        } else {
                            // Try other keys if this one failed
                            const nextIndex = supportedKeys.indexOf(key) + 1
                            if (nextIndex < supportedKeys.length) {
                                updateToken(supportedKeys[nextIndex])
                            } else {
                                db.close()
                                resolve()
                            }
                        }
                    })
                }

                const supportedKeys = ["cw:token", "aws-q-cli:token", "sso:token"]
                updateToken(this.sqliteTokenKey || supportedKeys[0])
            })
        })
    }

    private expandUser(filePath: string): string {
        if (filePath.startsWith("~")) {
            return path.join(os.homedir(), filePath.slice(1))
        }
        return path.resolve(filePath)
    }

    // Getters
    public getRegion(): string {
        return this.region
    }
    public getAuthType(): AuthType {
        return this.authType
    }
    public getFingerprint(): string {
        return this.fingerprint
    }
    public getProfileArn(): string | null {
        return this.profileArn
    }
}
