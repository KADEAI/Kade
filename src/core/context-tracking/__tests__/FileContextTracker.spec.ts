import type { Mock } from "vitest"

import * as vscode from "vscode"

import { FileContextTracker } from "../FileContextTracker"

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
		createFileSystemWatcher: vi.fn(),
	},
	Uri: {
		file: vi.fn((fsPath: string) => ({ fsPath })),
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
}))

describe("FileContextTracker", () => {
	let tracker: FileContextTracker
	let mockWatcher: {
		onDidChange: Mock
		onDidCreate: Mock
		onDidDelete: Mock
		dispose: Mock
	}
	let onDidChange: (() => void) | undefined
	let onDidCreate: (() => void) | undefined
	let onDidDelete: (() => void) | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		onDidChange = undefined
		onDidCreate = undefined
		onDidDelete = undefined

		mockWatcher = {
			onDidChange: vi.fn((handler: () => void) => {
				onDidChange = handler
				return { dispose: vi.fn() }
			}),
			onDidCreate: vi.fn((handler: () => void) => {
				onDidCreate = handler
				return { dispose: vi.fn() }
			}),
			onDidDelete: vi.fn((handler: () => void) => {
				onDidDelete = handler
				return { dispose: vi.fn() }
			}),
			dispose: vi.fn(),
		}

		// @ts-expect-error test mock
		vscode.workspace.createFileSystemWatcher.mockReturnValue(mockWatcher)

		tracker = new FileContextTracker({} as any, "task-1")
		vi.spyOn(tracker, "addFileToFileContextTracker").mockResolvedValue(undefined)
	})

	it("registers change, create, and delete watchers for tracked files", async () => {
		await tracker.setupFileWatcher("src/LuxurySpa.ts")

		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
			expect.objectContaining({
				base: "/workspace/src",
				pattern: "LuxurySpa.ts",
			}),
		)
		expect(mockWatcher.onDidChange).toHaveBeenCalledTimes(1)
		expect(mockWatcher.onDidCreate).toHaveBeenCalledTimes(1)
		expect(mockWatcher.onDidDelete).toHaveBeenCalledTimes(1)
	})

	it("marks externally changed files as recently modified for all watcher events", async () => {
		const trackSpy = vi.spyOn(tracker, "trackFileContext").mockResolvedValue(undefined)
		await tracker.setupFileWatcher("src/LuxurySpa.ts")

		onDidChange?.()
		onDidCreate?.()
		onDidDelete?.()

		expect(trackSpy).toHaveBeenCalledTimes(3)
		expect(trackSpy).toHaveBeenCalledWith("src/LuxurySpa.ts", "user_edited")
		expect(tracker.peekRecentlyModifiedFiles()).toEqual(["src/LuxurySpa.ts"])
		expect(tracker.getAndClearRecentlyModifiedFiles()).toEqual(["src/LuxurySpa.ts"])
		expect(tracker.peekRecentlyModifiedFiles()).toEqual([])
	})

	it("ignores the next watcher event for files just edited by Roo", async () => {
		const trackSpy = vi.spyOn(tracker, "trackFileContext").mockResolvedValue(undefined)
		await tracker.setupFileWatcher("src/LuxurySpa.ts")

		tracker.markFileAsEditedByRoo("src/LuxurySpa.ts")
		onDidChange?.()

		expect(trackSpy).not.toHaveBeenCalled()
		expect(tracker.peekRecentlyModifiedFiles()).toEqual([])
	})
})
