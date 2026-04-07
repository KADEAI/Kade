import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { TaskHistoryStorage } from "../TaskHistoryStorage"

vi.mock("../../../utils/logging", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}))

describe("TaskHistoryStorage", () => {
	let tempDir: string
	let context: {
		globalStorageUri: { fsPath: string }
		globalState: {
			get: ReturnType<typeof vi.fn>
			update: ReturnType<typeof vi.fn>
		}
	}

	beforeEach(async () => {
		TaskHistoryStorage.resetInstance()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-storage-"))
		context = {
			globalStorageUri: { fsPath: tempDir },
			globalState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
		}
	})

	afterEach(async () => {
		TaskHistoryStorage.resetInstance()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("clears stale globalState task history when disk history already exists", async () => {
		const existingHistory = [{ id: "task-1" }]
		const workspaceStorageDir = path.join(tempDir, ".kilocode")
		await fs.mkdir(workspaceStorageDir, { recursive: true })
		await fs.writeFile(path.join(workspaceStorageDir, "task_history.json"), JSON.stringify(existingHistory), "utf8")
		context.globalState.get.mockReturnValue([{ id: "stale-task" }])

		const storage = await TaskHistoryStorage.getInstance(context as any, tempDir)

		expect(storage.getAll()).toEqual(existingHistory)
		expect(context.globalState.update).toHaveBeenCalledWith("taskHistory", undefined)
	})

	it("migrates legacy task_history.json into workspace-local storage", async () => {
		const legacyHistory = [{ id: "legacy-task" }]
		await fs.writeFile(path.join(tempDir, "task_history.json"), JSON.stringify(legacyHistory), "utf8")
		context.globalState.get.mockReturnValue(undefined)

		const storage = await TaskHistoryStorage.getInstance(context as any, tempDir)

		expect(storage.getAll()).toEqual(legacyHistory)
		await expect(fs.access(path.join(tempDir, ".kilocode", "task_history.json"))).resolves.toBeUndefined()
	})
})
