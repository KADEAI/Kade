import type { ExtensionContext } from "vscode"
import * as z from "zod"
import * as http from "node:http"
import {
	generateKeyPairSync,
	type KeyObject,
	privateDecrypt,
	constants as cryptoConstants,
} from "node:crypto"

import {
	ZED_CLOUD_URL,
	ZED_CREDENTIALS_KEY,
	ZED_EXPIRED_LLM_TOKEN_HEADER,
	ZED_NATIVE_SIGNIN_PATH,
	ZED_NATIVE_SIGNIN_SUCCEEDED_URL,
	ZED_OUTDATED_LLM_TOKEN_HEADER,
	ZED_SERVER_URL,
} from "./constants"

const zedCredentialsSchema = z.object({
	type: z.literal("zed"),
	userId: z.number().int(),
	accessToken: z.string(),
	githubLogin: z.string().optional(),
	name: z.string().optional(),
	avatarUrl: z.string().optional(),
})

const authenticatedUserSchema = z.object({
	user: z.object({
		id: z.number().int(),
		github_login: z.string(),
		avatar_url: z.string(),
		name: z.string().nullish(),
	}),
})

const llmTokenResponseSchema = z.object({
	token: z.string(),
})

type PendingAuth = {
	resolve: (credentials: ZedCredentials) => void
	reject: (error: Error) => void
	credentials?: ZedCredentials
	error?: Error
}

export type ZedCredentials = z.infer<typeof zedCredentialsSchema>

export class ZedOAuthManager {
	private context: ExtensionContext | null = null
	private credentials: ZedCredentials | null = null
	private llmApiToken: string | null = null
	private logFn: ((message: string) => void) | null = null
	private server: http.Server | null = null
	private pendingAuth: PendingAuth | null = null
	private llmApiTokenPromise: Promise<string> | null = null

	initialize(context: ExtensionContext, logFn?: (message: string) => void) {
		this.context = context
		this.logFn = logFn ?? null
		this.log("[zed-oauth] Manager initialized.")
	}

	async startAuthorizationFlow(): Promise<string> {
		this.log("[zed-oauth] Starting native app sign-in flow...")

		if (this.pendingAuth) {
			this.pendingAuth.reject(new Error("A new Zed authorization flow was started before the previous one completed."))
			this.pendingAuth = null
		}

		if (this.server) {
			await this.closeServer()
		}

		this.pendingAuth = {
			resolve: () => {},
			reject: () => {},
		}

		const { publicKey, privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
		})
		const publicKeyDer = publicKey.export({
			type: "pkcs1",
			format: "der",
		}) as Buffer
		const publicKeyString = publicKeyDer.toString("base64url")

		const port = await this.startLocalServer(privateKey)
		const params = new URLSearchParams({
			native_app_port: String(port),
			native_app_public_key: publicKeyString,
		})
		const authUrl = `${ZED_SERVER_URL}${ZED_NATIVE_SIGNIN_PATH}?${params.toString()}`

		this.log(`[zed-oauth] Authorization URL created on localhost:${port}.`)
		return authUrl
	}

	async waitForCallback(): Promise<ZedCredentials> {
		this.log("[zed-oauth] Waiting for sign-in callback...")

		if (!this.pendingAuth) {
			throw new Error("Zed authorization flow not started. Call startAuthorizationFlow() first.")
		}

		return new Promise<ZedCredentials>((resolve, reject) => {
			const pendingAuth = this.pendingAuth!
			const timeout = setTimeout(() => {
				this.pendingAuth = null
				reject(new Error("Zed authentication timed out after 5 minutes."))
				void this.closeServer()
			}, 300_000)

			pendingAuth.resolve = (credentials) => {
				this.pendingAuth = null
				clearTimeout(timeout)
				resolve(credentials)
			}
			pendingAuth.reject = (error) => {
				this.pendingAuth = null
				clearTimeout(timeout)
				reject(error)
			}

			if (pendingAuth.credentials) {
				pendingAuth.resolve(pendingAuth.credentials)
			} else if (pendingAuth.error) {
				pendingAuth.reject(pendingAuth.error)
			}
		})
	}

	async loadCredentials(): Promise<ZedCredentials | null> {
		if (this.credentials) {
			return this.credentials
		}

		if (!this.context) {
			throw new Error("Zed OAuth manager not initialized.")
		}

		const raw = await this.context.secrets.get(ZED_CREDENTIALS_KEY)
		if (!raw) {
			return null
		}

		try {
			const parsed = JSON.parse(raw)
			this.credentials = zedCredentialsSchema.parse(parsed)
			return this.credentials
		} catch (error) {
			this.logError("[zed-oauth] Failed to parse stored credentials, clearing them.", error)
			await this.clearCredentials()
			return null
		}
	}

	async getAccessToken(): Promise<string | null> {
		return (await this.loadCredentials())?.accessToken ?? null
	}

	async getCurrentUser(): Promise<{ githubLogin?: string; name?: string; avatarUrl?: string } | null> {
		const credentials = await this.loadCredentials()
		if (!credentials) {
			return null
		}

		return {
			githubLogin: credentials.githubLogin,
			name: credentials.name,
			avatarUrl: credentials.avatarUrl,
		}
	}

	async getLlmApiToken(forceRefresh: boolean = false): Promise<string> {
		if (forceRefresh) {
			this.llmApiToken = null
			this.llmApiTokenPromise = null
		}

		if (!forceRefresh && this.llmApiToken) {
			return this.llmApiToken
		}

		if (!this.llmApiTokenPromise) {
			this.llmApiTokenPromise = this.createLlmApiToken().finally(() => {
				this.llmApiTokenPromise = null
			})
		}

		return this.llmApiTokenPromise
	}

	async fetchWithLlmToken(path: string, init: RequestInit = {}, retryOnRefresh: boolean = true): Promise<Response> {
		const token = await this.getLlmApiToken()
		const headers = new Headers(init.headers)
		headers.set("Authorization", `Bearer ${token}`)

		const response = await fetch(`${ZED_CLOUD_URL}${path}`, {
			...init,
			headers,
		})

		if (
			retryOnRefresh &&
			(response.status === 401 ||
				response.headers.has(ZED_EXPIRED_LLM_TOKEN_HEADER) ||
				response.headers.has(ZED_OUTDATED_LLM_TOKEN_HEADER))
		) {
			this.log("[zed-oauth] LLM token refresh requested by server, retrying once.")
			const refreshedToken = await this.getLlmApiToken(true)
			const retryHeaders = new Headers(init.headers)
			retryHeaders.set("Authorization", `Bearer ${refreshedToken}`)

			return fetch(`${ZED_CLOUD_URL}${path}`, {
				...init,
				headers: retryHeaders,
			})
		}

		return response
	}

	async clearCredentials(): Promise<void> {
		if (!this.context) {
			return
		}

		this.credentials = null
		this.llmApiToken = null
		this.llmApiTokenPromise = null
		await this.context.secrets.delete(ZED_CREDENTIALS_KEY)
		this.log("[zed-oauth] Cleared credentials.")
	}

	private async startLocalServer(privateKey: KeyObject): Promise<number> {
		this.server = http.createServer(async (req, res) => {
			try {
				const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
				const userId = url.searchParams.get("user_id")
				const encryptedAccessToken = url.searchParams.get("access_token")

				if (!userId || !encryptedAccessToken) {
					res.writeHead(400, { "Content-Type": "text/html" })
					res.end("<h1>Authentication Failed</h1><p>Missing credentials in callback.</p>")
					if (this.pendingAuth) {
						const error = new Error("Missing user_id or access_token in Zed callback.")
						this.pendingAuth.error = error
						this.pendingAuth.reject(error)
					}
					return
				}

				const accessToken = this.decryptAccessToken(encryptedAccessToken, privateKey)
				const credentials = await this.enrichCredentials({
					type: "zed",
					userId: Number.parseInt(userId, 10),
					accessToken,
				})

				await this.saveCredentials(credentials)
				this.llmApiToken = null

				res.writeHead(302, { Location: ZED_NATIVE_SIGNIN_SUCCEEDED_URL })
				res.end()

				if (this.pendingAuth) {
					this.pendingAuth.credentials = credentials
					this.pendingAuth.resolve(credentials)
				}
				this.log(`[zed-oauth] Successfully authenticated ${credentials.githubLogin ?? credentials.userId}.`)
			} catch (error) {
				this.logError("[zed-oauth] Callback handling failed.", error)
				res.writeHead(500, { "Content-Type": "text/html" })
				res.end("<h1>Authentication Failed</h1><p>An internal error occurred.</p>")
				if (this.pendingAuth) {
					const authError = error instanceof Error ? error : new Error(String(error))
					this.pendingAuth.error = authError
					this.pendingAuth.reject(authError)
				}
			} finally {
				await this.closeServer()
			}
		})

		this.server.on("error", (error) => {
			this.logError("[zed-oauth] Local server error.", error)
			if (this.pendingAuth) {
				const authError = new Error(`Zed auth server error: ${error.message}`)
				this.pendingAuth.error = authError
				this.pendingAuth.reject(authError)
			}
			void this.closeServer()
		})

		await new Promise<void>((resolve, reject) => {
			this.server?.listen(0, "127.0.0.1", () => resolve())
			this.server?.once("error", reject)
		})

		const address = this.server.address()
		if (!address || typeof address === "string") {
			throw new Error("Failed to determine Zed auth callback port.")
		}

		return address.port
	}

	private async callAccountApi(path: string, init: RequestInit = {}): Promise<Response> {
		const credentials = await this.loadCredentials()
		if (!credentials) {
			throw new Error("Not authenticated with Zed.")
		}

		const headers = new Headers(init.headers)
		headers.set("Authorization", `${credentials.userId} ${credentials.accessToken}`)
		if (!headers.has("Content-Type") && init.body) {
			headers.set("Content-Type", "application/json")
		}

		return fetch(`${ZED_CLOUD_URL}${path}`, {
			...init,
			headers,
		})
	}

	private async createLlmApiToken(): Promise<string> {
		const response = await this.callAccountApi("/client/llm_tokens", {
			method: "POST",
			body: JSON.stringify({}),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Failed to create Zed LLM token: ${response.status} - ${errorText}`)
		}

		const data = llmTokenResponseSchema.parse(await response.json())
		this.llmApiToken = data.token
		return data.token
	}

	private async enrichCredentials(base: Pick<ZedCredentials, "type" | "userId" | "accessToken">): Promise<ZedCredentials> {
		const response = await fetch(`${ZED_CLOUD_URL}/client/users/me`, {
			headers: {
				Authorization: `${base.userId} ${base.accessToken}`,
			},
		})

		if (!response.ok) {
			return base
		}

		const data = authenticatedUserSchema.parse(await response.json())
		return {
			...base,
			githubLogin: data.user.github_login,
			name: data.user.name ?? undefined,
			avatarUrl: data.user.avatar_url,
		}
	}

	private decryptAccessToken(
		encryptedAccessToken: string,
		privateKey: KeyObject,
	): string {
		const encryptedBytes = Buffer.from(encryptedAccessToken, "base64url")

		try {
			return privateDecrypt(
				{
					key: privateKey,
					padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
					oaepHash: "sha256",
				},
				encryptedBytes,
			).toString("utf8")
		} catch {
			return privateDecrypt(
				{
					key: privateKey,
					padding: cryptoConstants.RSA_PKCS1_PADDING,
				},
				encryptedBytes,
			).toString("utf8")
		}
	}

	private async saveCredentials(credentials: ZedCredentials): Promise<void> {
		if (!this.context) {
			throw new Error("Zed OAuth manager not initialized.")
		}

		this.credentials = credentials
		await this.context.secrets.store(ZED_CREDENTIALS_KEY, JSON.stringify(credentials))
		this.log("[zed-oauth] Credentials saved securely.")
	}

	private async closeServer(): Promise<void> {
		if (!this.server) {
			return
		}

		const server = this.server
		this.server = null
		await new Promise<void>((resolve) => {
			server.close(() => resolve())
		})
	}

	private log(message: string) {
		this.logFn?.(message)
	}

	private logError(message: string, error: unknown) {
		const detail = error instanceof Error ? error.message : String(error)
		this.logFn?.(`${message} ${detail}`)
	}
}

export const zedOAuthManager = new ZedOAuthManager()
