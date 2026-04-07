import os from "os"
import path from "path"
import fs from "fs/promises"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

import { MkdirTool } from "../MkdirTool"

describe("MkdirTool", () => {
	let tempDir: string | undefined

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
			tempDir = undefined
		}
	})

	it("lists directory contents instead of creating directories", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mkdir-tool-"))
		await fs.mkdir(path.join(tempDir, "nested"))
		await fs.writeFile(path.join(tempDir, "alpha.txt"), "alpha")

		const tool = new MkdirTool()
		const pushToolResult = vi.fn()
		const task = {
			cwd: tempDir,
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
		} as any

		await tool.execute(
			{ path: "." },
			task,
			{
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "unified" as any,
				toolCallId: "test-call",
			},
		)

		expect(pushToolResult).toHaveBeenCalledWith("alpha.txt\nnested/")
		expect(task.recordToolError).not.toHaveBeenCalled()
		expect(task.didToolFailInCurrentTurn).toBe(false)
	})

	it("defaults to listing the cwd when no path is provided", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mkdir-tool-"))
		await fs.writeFile(path.join(tempDir, "sample.txt"), "sample")

		const tool = new MkdirTool()
		const pushToolResult = vi.fn()
		const task = {
			cwd: tempDir,
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
		} as any

		await tool.execute(
			{},
			task,
			{
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "unified" as any,
				toolCallId: "test-call",
			},
		)

		expect(pushToolResult).toHaveBeenCalledWith("sample.txt")
	})
})
