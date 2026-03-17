import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { API } from "../api"
import { ClineProvider } from "../../core/webview/ClineProvider"

vi.mock("vscode")
vi.mock("../../core/webview/ClineProvider")

describe("API - CancelTask Command", () => {
	let api: API
	let mockOutputChannel: vscode.OutputChannel
	let mockProvider: ClineProvider

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockProvider = {
			context: {} as vscode.ExtensionContext,
			cancelTask: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
			getCurrentTaskStack: vi.fn().mockReturnValue([]),
			viewLaunched: true,
		} as unknown as ClineProvider

		api = new API(mockOutputChannel, mockProvider, undefined, false)
		;(api as any).taskMap.set("task-123", mockProvider)
	})

	it("should forward the requested task id to the provider", async () => {
		await api.cancelTask("task-123")

		expect(mockProvider.cancelTask).toHaveBeenCalledWith("task-123")
		expect((api as any).taskMap.has("task-123")).toBe(false)
	})
})
