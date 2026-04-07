import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { HistoryItem } from "@roo-code/types"
import { logger } from "../../utils/logging"
import { getStorageBasePath, getTaskStorageBasePath } from "../../utils/storage"

/**
 * TaskHistoryStorage - Disk-based storage for task history
 * 
 * This service moves task history from VS Code's globalState (SQLite) to disk files,
 * solving the ~5MB extension state warning and improving startup performance.
 * 
 * Storage location:
 * - customStoragePath/task_history.json when explicitly configured
 * - <workspace>/.kilocode/task_history.json by default
 * - falls back to globalStorageUri/task_history.json when no workspace is open
 */
export class TaskHistoryStorage {
	private static instances = new Map<string, TaskHistoryStorage>()
	private readonly storagePath: string
	private cache: HistoryItem[] | null = null
	private isDirty = false
	private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
	private readonly SAVE_DEBOUNCE_MS = 500

	private constructor(storagePath: string) {
		this.storagePath = storagePath
	}

	static async getInstance(context: vscode.ExtensionContext, workspacePath?: string): Promise<TaskHistoryStorage> {
		const basePath = await getTaskStorageBasePath(context.globalStorageUri.fsPath, workspacePath)
		const storagePath = path.join(basePath, "task_history.json")

		let instance = TaskHistoryStorage.instances.get(storagePath)
		if (!instance) {
			instance = new TaskHistoryStorage(storagePath)
			TaskHistoryStorage.instances.set(storagePath, instance)
			await instance.initialize(context)
		}
		return instance
	}

	/**
	 * Initialize storage - migrate from globalState if needed
	 */
	private async initialize(context: vscode.ExtensionContext): Promise<void> {
		// Ensure storage directory exists
		const storageDir = path.dirname(this.storagePath)
		try {
			await fs.mkdir(storageDir, { recursive: true })
		} catch {
			// Directory may already exist
		}

		// Migrate legacy disk history from the old global-storage location if the new
		// workspace-local file doesn't exist yet.
		const legacyBasePath = await getStorageBasePath(context.globalStorageUri.fsPath)
		const legacyStoragePath = path.join(legacyBasePath, "task_history.json")
		if (legacyStoragePath !== this.storagePath && !(await this.fileExists()) && (await this.fileExistsAt(legacyStoragePath))) {
			try {
				await fs.rename(legacyStoragePath, this.storagePath)
			} catch {
				await fs.cp(legacyStoragePath, this.storagePath)
				await fs.rm(legacyStoragePath, { force: true })
			}
			logger.info("[TaskHistoryStorage] Migrated legacy task_history.json to workspace-local storage")
		}

		// Check if we need to migrate from globalState
		const existsOnDisk = await this.fileExists()
		const globalStateHistory = context.globalState.get<HistoryItem[]>("taskHistory")

		if (!existsOnDisk && globalStateHistory && globalStateHistory.length > 0) {
			// Migrate from globalState to disk
			logger.info(`[TaskHistoryStorage] Migrating ${globalStateHistory.length} tasks from globalState to disk`)
			this.cache = globalStateHistory
			await this.saveToDisk()
			
			// Clear from globalState to free up space
			await context.globalState.update("taskHistory", undefined)
			logger.info("[TaskHistoryStorage] Migration complete, cleared globalState")
		} else if (existsOnDisk) {
			// Load from disk
			await this.loadFromDisk()

			// Cleanup: older builds could re-populate globalState.taskHistory after migration.
			// If disk storage already exists, clear the leftover Memento copy so VS Code's
			// extension state warning goes away and startup doesn't keep loading stale history.
			if (globalStateHistory && globalStateHistory.length > 0) {
				await context.globalState.update("taskHistory", undefined)
				logger.info("[TaskHistoryStorage] Cleared stale taskHistory from globalState")
			}
		} else {
			// Fresh start
			this.cache = []
		}
	}

	private async fileExists(): Promise<boolean> {
		return this.fileExistsAt(this.storagePath)
	}

	private async fileExistsAt(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	private async loadFromDisk(): Promise<void> {
		try {
			const data = await fs.readFile(this.storagePath, "utf-8")
			this.cache = JSON.parse(data)
			logger.info(`[TaskHistoryStorage] Loaded ${this.cache?.length ?? 0} tasks from disk`)
		} catch (error) {
			logger.error(`[TaskHistoryStorage] Failed to load from disk: ${error}`)
			this.cache = []
		}
	}

	private async saveToDisk(): Promise<void> {
		if (!this.cache) return

		try {
			await fs.writeFile(this.storagePath, JSON.stringify(this.cache, null, 2), "utf-8")
			this.isDirty = false
		} catch (error) {
			logger.error(`[TaskHistoryStorage] Failed to save to disk: ${error}`)
		}
	}

	private scheduleSave(): void {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer)
		}
		this.isDirty = true
		this.saveDebounceTimer = setTimeout(() => {
			this.saveToDisk()
		}, this.SAVE_DEBOUNCE_MS)
	}

	/**
	 * Get all task history items
	 */
	getAll(): HistoryItem[] {
		return this.cache ?? []
	}

	/**
	 * Get task history length without loading full array
	 */
	getLength(): number {
		return this.cache?.length ?? 0
	}

	/**
	 * Get a single task by ID
	 */
	getById(id: string): HistoryItem | undefined {
		return this.cache?.find((item) => item.id === id)
	}

	/**
	 * Update or add a task history item
	 */
	async upsert(item: HistoryItem): Promise<HistoryItem[]> {
		if (!this.cache) {
			this.cache = []
		}

		const existingIndex = this.cache.findIndex((h) => h.id === item.id)

		if (existingIndex !== -1) {
			// Preserve existing metadata unless explicitly overwritten
			this.cache[existingIndex] = {
				...this.cache[existingIndex],
				...item,
			}
		} else {
			this.cache.push(item)
		}

		this.scheduleSave()
		return this.cache
	}

	/**
	 * Delete a task by ID
	 */
	async delete(id: string): Promise<void> {
		if (!this.cache) return

		this.cache = this.cache.filter((item) => item.id !== id)
		this.scheduleSave()
	}

	/**
	 * Delete multiple tasks by IDs
	 */
	async deleteMultiple(ids: string[]): Promise<void> {
		if (!this.cache) return

		const idSet = new Set(ids)
		this.cache = this.cache.filter((item) => !idSet.has(item.id))
		this.scheduleSave()
	}

	/**
	 * Update the entire history array (for batch operations)
	 */
	async setAll(history: HistoryItem[]): Promise<void> {
		this.cache = history
		this.scheduleSave()
	}

	/**
	 * Force immediate save (for shutdown)
	 */
	async flush(): Promise<void> {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer)
			this.saveDebounceTimer = null
		}
		if (this.isDirty) {
			await this.saveToDisk()
		}
	}

	/**
	 * Reset instance (for testing)
	 */
	static resetInstance(): void {
		TaskHistoryStorage.instances.clear()
	}
}
