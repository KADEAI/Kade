import type { ExtensionContext } from "vscode"
import * as z from "zod"
import { GEMINI_OAUTH_CONFIG } from "./constants"

const GEMINI_CLI_MULTI_ACCOUNTS_KEY = "gemini-cli-oauth-multi-accounts"

const geminiMultiAccountSchema = z.object({
	type: z.literal("gemini-cli"),
	email: z.string(),
	accessToken: z.string(),
	refreshToken: z.string(),
	expires: z.number(), // unix ms
	scope: z.string().default(""),
	projectId: z.string().optional(),
	userTier: z.string().optional(),
	onboarded: z.boolean().default(false),
})

const geminiMultiAccountListSchema = z.array(geminiMultiAccountSchema)

export type GeminiMultiAccount = z.infer<typeof geminiMultiAccountSchema>

interface GeminiAccountRuntimeState {
	cooldownUntil: number
	requestTimestamps: number[]
	lastError?: string
}

export interface GeminiAcquireOptions {
	requireOnboarded?: boolean
	excludeEmails?: Set<string>
	preferEmail?: string
	rpmLimitPerAccount?: number
}

export interface GeminiAccountLease {
	account: GeminiMultiAccount
	release: {
		markRateLimited: (cooldownSeconds?: number) => void
		markForbidden: () => void
		markAvailable: () => void
	}
}

export interface GeminiMultiAccountStats {
	total: number
	available: number
	onCooldown: number
	onboarded: number
	theoreticalRpm: number
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000
const DEFAULT_RPM_LIMIT = 55
const RATE_LIMIT_COOLDOWN_SECONDS = 300 // 5 min
const FORBIDDEN_COOLDOWN_SECONDS = 1800 // 30 min

export class GeminiMultiAccountManager {
	private context: ExtensionContext | null = null
	private logFn: ((message: string) => void) | null = null

	private accounts: GeminiMultiAccount[] = []
	private runtimeByEmail = new Map<string, GeminiAccountRuntimeState>()
	private loaded = false
	private roundRobinIndex = 0

	private refreshPromises = new Map<string, Promise<GeminiMultiAccount | null>>()
	private loadPromise: Promise<void> | null = null

	public initialize(context: ExtensionContext, logFn?: (message: string) => void) {
		this.context = context
		this.logFn = logFn ?? null
		this.log("[gemini-multi] Manager initialized.")
	}

	public async listAccounts(): Promise<GeminiMultiAccount[]> {
		await this.ensureLoaded()
		return [...this.accounts]
	}

	public async getAccountByEmail(email: string): Promise<GeminiMultiAccount | null> {
		await this.ensureLoaded()
		const normalized = this.normalizeEmail(email)
		return this.accounts.find((a) => this.normalizeEmail(a.email) === normalized) ?? null
	}

	public async addOrUpdateAccount(account: GeminiMultiAccount): Promise<void> {
		await this.ensureLoaded()
		const normalized = this.normalizeEmail(account.email)

		const normalizedAccount: GeminiMultiAccount = {
			...account,
			email: normalized,
			type: "gemini-cli",
		}

		const existingIndex = this.accounts.findIndex((a) => this.normalizeEmail(a.email) === normalized)
		if (existingIndex >= 0) {
			this.accounts[existingIndex] = normalizedAccount
			this.log(`[gemini-multi] Updated account: ${normalized}`)
		} else {
			this.accounts.push(normalizedAccount)
			this.log(`[gemini-multi] Added account: ${normalized}`)
		}

		this.ensureRuntimeState(normalized)
		await this.saveAccounts()
	}

	public async removeAccount(email: string): Promise<boolean> {
		await this.ensureLoaded()
		const normalized = this.normalizeEmail(email)

		const initial = this.accounts.length
		this.accounts = this.accounts.filter((a) => this.normalizeEmail(a.email) !== normalized)
		const changed = this.accounts.length !== initial

		if (changed) {
			this.runtimeByEmail.delete(normalized)
			this.refreshPromises.delete(normalized)
			await this.saveAccounts()
			this.log(`[gemini-multi] Removed account: ${normalized}`)
		}

		return changed
	}

	public async clearAccounts(): Promise<void> {
		await this.ensureLoaded()
		this.accounts = []
		this.runtimeByEmail.clear()
		this.refreshPromises.clear()
		this.roundRobinIndex = 0
		await this.saveAccounts()
		this.log("[gemini-multi] Cleared all accounts.")
	}

	public async acquire(options: GeminiAcquireOptions = {}): Promise<GeminiAccountLease | null> {
		await this.ensureLoaded()

		if (this.accounts.length === 0) {
			return null
		}

		const requireOnboarded = options.requireOnboarded ?? false
		const exclude = options.excludeEmails ?? new Set<string>()
		const rpmLimit = options.rpmLimitPerAccount ?? DEFAULT_RPM_LIMIT

		// Prefer one specific account first if requested
		if (options.preferEmail) {
			const preferred = await this.tryAcquireSpecificAccount(options.preferEmail, {
				requireOnboarded,
				excludeEmails: exclude,
				rpmLimitPerAccount: rpmLimit,
			})
			if (preferred) {
				return preferred
			}
		}

		// Round-robin across all accounts
		const total = this.accounts.length
		for (let i = 0; i < total; i++) {
			const index = (this.roundRobinIndex + i) % total
			const account = this.accounts[index]
			const normalized = this.normalizeEmail(account.email)

			if (exclude.has(normalized)) {
				continue
			}

			const acquired = await this.tryAcquireAccount(account, {
				requireOnboarded,
				rpmLimitPerAccount: rpmLimit,
			})

			if (acquired) {
				this.roundRobinIndex = (index + 1) % Math.max(total, 1)
				return acquired
			}
		}

		return null
	}

	public markRateLimited(email: string, cooldownSeconds: number = RATE_LIMIT_COOLDOWN_SECONDS): void {
		const state = this.ensureRuntimeState(email)
		state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + cooldownSeconds * 1000)
		state.lastError = "rate_limited"
		this.log(`[gemini-multi] Rate limited: ${this.normalizeEmail(email)} (${cooldownSeconds}s)`)
	}

	public markForbidden(email: string): void {
		const state = this.ensureRuntimeState(email)
		state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + FORBIDDEN_COOLDOWN_SECONDS * 1000)
		state.lastError = "forbidden"
		this.log(`[gemini-multi] Forbidden: ${this.normalizeEmail(email)} (${FORBIDDEN_COOLDOWN_SECONDS}s)`)
	}

	public markAvailable(email: string): void {
		const state = this.ensureRuntimeState(email)
		state.cooldownUntil = 0
		state.lastError = undefined
	}

	public async getStats(rpmLimitPerAccount: number = DEFAULT_RPM_LIMIT): Promise<GeminiMultiAccountStats> {
		await this.ensureLoaded()
		const now = Date.now()

		let available = 0
		let onCooldown = 0
		let onboarded = 0

		for (const account of this.accounts) {
			const state = this.ensureRuntimeState(account.email)
			const normalized = this.normalizeEmail(account.email)

			this.cleanupRequestWindow(normalized)

			if (account.onboarded) {
				onboarded++
			}

			const isCooldown = state.cooldownUntil > now
			if (isCooldown) {
				onCooldown++
				continue
			}

			if (state.requestTimestamps.length < rpmLimitPerAccount) {
				available++
			}
		}

		return {
			total: this.accounts.length,
			available,
			onCooldown,
			onboarded,
			theoreticalRpm: available * 60,
		}
	}

	private async tryAcquireSpecificAccount(
		email: string,
		options: Required<Omit<GeminiAcquireOptions, "preferEmail">>,
	): Promise<GeminiAccountLease | null> {
		const normalized = this.normalizeEmail(email)
		if (options.excludeEmails.has(normalized)) {
			return null
		}

		const account = this.accounts.find((a) => this.normalizeEmail(a.email) === normalized)
		if (!account) {
			return null
		}

		return this.tryAcquireAccount(account, options)
	}

	private async tryAcquireAccount(
		account: GeminiMultiAccount,
		options: Required<Omit<GeminiAcquireOptions, "preferEmail" | "excludeEmails">> & {
			excludeEmails?: Set<string>
		},
	): Promise<GeminiAccountLease | null> {
		const normalized = this.normalizeEmail(account.email)
		const state = this.ensureRuntimeState(normalized)

		if (options.requireOnboarded && !account.onboarded) {
			return null
		}

		// Cooldown check
		if (state.cooldownUntil > Date.now()) {
			return null
		}

		// Expiry check + refresh
		const maybeFresh = await this.ensureFreshAccessToken(account)
		if (!maybeFresh) {
			state.lastError = "refresh_failed"
			return null
		}

		// RPM window check
		this.cleanupRequestWindow(normalized)
		if (state.requestTimestamps.length >= options.rpmLimitPerAccount) {
			return null
		}

		// Reserve one request slot immediately
		state.requestTimestamps.push(Date.now())
		state.lastError = undefined

		const leasedAccount: GeminiMultiAccount = { ...maybeFresh }

		return {
			account: leasedAccount,
			release: {
				markRateLimited: (cooldownSeconds?: number) => this.markRateLimited(normalized, cooldownSeconds),
				markForbidden: () => this.markForbidden(normalized),
				markAvailable: () => this.markAvailable(normalized),
			},
		}
	}

	private async ensureFreshAccessToken(account: GeminiMultiAccount): Promise<GeminiMultiAccount | null> {
		if (!this.isTokenExpired(account)) {
			return account
		}

		const email = this.normalizeEmail(account.email)
		let promise = this.refreshPromises.get(email)

		if (!promise) {
			promise = this.refreshAccessToken(account).finally(() => {
				this.refreshPromises.delete(email)
			})
			this.refreshPromises.set(email, promise)
		}

		return promise
	}

	private async refreshAccessToken(account: GeminiMultiAccount): Promise<GeminiMultiAccount | null> {
		try {
			const body = new URLSearchParams({
				grant_type: "refresh_token",
				client_id: GEMINI_OAUTH_CONFIG.clientId,
				client_secret: GEMINI_OAUTH_CONFIG.clientSecret,
				refresh_token: account.refreshToken,
			})

			const response = await fetch(GEMINI_OAUTH_CONFIG.tokenEndpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body,
			})

			if (!response.ok) {
				const errorText = await response.text()
				this.logError(`[gemini-multi] Refresh failed for ${account.email}: ${response.status} ${errorText}`)
				return null
			}

			const data = (await response.json()) as {
				access_token: string
				expires_in: number
				token_type?: string
			}

			const updated: GeminiMultiAccount = {
				...account,
				accessToken: data.access_token,
				expires: Date.now() + (data.expires_in ?? 3600) * 1000,
			}

			await this.addOrReplaceInMemory(updated)
			await this.saveAccounts()

			this.log(`[gemini-multi] Refreshed token for ${this.normalizeEmail(account.email)}`)
			return updated
		} catch (error) {
			this.logError(`[gemini-multi] Refresh error for ${account.email}`, error)
			return null
		}
	}

	private async addOrReplaceInMemory(updated: GeminiMultiAccount): Promise<void> {
		const normalized = this.normalizeEmail(updated.email)
		const index = this.accounts.findIndex((a) => this.normalizeEmail(a.email) === normalized)
		if (index >= 0) {
			this.accounts[index] = updated
		} else {
			this.accounts.push(updated)
		}
		this.ensureRuntimeState(normalized)
	}

	private isTokenExpired(account: GeminiMultiAccount): boolean {
		return Date.now() > account.expires - TOKEN_EXPIRY_BUFFER_MS
	}

	private cleanupRequestWindow(email: string): void {
		const state = this.ensureRuntimeState(email)
		const cutoff = Date.now() - 60_000
		state.requestTimestamps = state.requestTimestamps.filter((ts) => ts >= cutoff)
	}

	private ensureRuntimeState(email: string): GeminiAccountRuntimeState {
		const normalized = this.normalizeEmail(email)
		const existing = this.runtimeByEmail.get(normalized)
		if (existing) {
			return existing
		}

		const created: GeminiAccountRuntimeState = {
			cooldownUntil: 0,
			requestTimestamps: [],
		}
		this.runtimeByEmail.set(normalized, created)
		return created
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return
		}
		if (this.loadPromise) {
			await this.loadPromise
			return
		}
		this.loadPromise = this.loadInternal()
		await this.loadPromise
		this.loadPromise = null
	}

	private async loadInternal(): Promise<void> {
		if (!this.context) {
			throw new Error("GeminiMultiAccountManager not initialized with ExtensionContext.")
		}

		const raw = await this.context.secrets.get(GEMINI_CLI_MULTI_ACCOUNTS_KEY)
		if (!raw) {
			this.accounts = []
			this.loaded = true
			return
		}

		try {
			const parsed = JSON.parse(raw)
			const validated = geminiMultiAccountListSchema.parse(parsed)

			// Normalize emails and keep deterministic order
			this.accounts = validated
				.map((a) => ({ ...a, email: this.normalizeEmail(a.email) }))
				.sort((a, b) => a.email.localeCompare(b.email))

			for (const account of this.accounts) {
				this.ensureRuntimeState(account.email)
			}

			this.loaded = true
		} catch (error) {
			this.logError("[gemini-multi] Failed to parse stored accounts. Clearing invalid payload.", error)
			this.accounts = []
			this.runtimeByEmail.clear()
			this.loaded = true
			await this.context.secrets.delete(GEMINI_CLI_MULTI_ACCOUNTS_KEY)
		}
	}

	private async saveAccounts(): Promise<void> {
		if (!this.context) {
			throw new Error("GeminiMultiAccountManager not initialized with ExtensionContext.")
		}

		const payload = JSON.stringify(
			[...this.accounts].sort((a, b) => a.email.localeCompare(b.email)),
		)

		await this.context.secrets.store(GEMINI_CLI_MULTI_ACCOUNTS_KEY, payload)
	}

	private normalizeEmail(email: string): string {
		return email.trim().toLowerCase()
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

export const geminiMultiAccountManager = new GeminiMultiAccountManager()