import path from "path"
import fs from "fs"
import { describe, expect, it, vi, beforeEach } from "vitest"

import { GlobTool } from "../GlobTool"
import { splitGlobPatternList } from "../../../shared/globPatterns"

const {
	globMock,
	resolveRecursivePathMock,
	getLineCountsMock,
} = vi.hoisted(() => ({
	globMock: vi.fn(),
	resolveRecursivePathMock: vi.fn(),
	getLineCountsMock: vi.fn(),
}))

vi.mock("glob", () => ({
	glob: globMock,
}))

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/workspace" },
			},
		],
	},
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn((_: string, relPath?: string) => relPath || ""),
	resolveRecursivePath: resolveRecursivePathMock,
}))

vi.mock("../../../services/ripgrep/index", () => ({
	getLineCounts: getLineCountsMock,
}))

describe("GlobTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.restoreAllMocks()
		resolveRecursivePathMock.mockResolvedValue({
			resolvedPath: "zed/crates/agent/templates",
		})
		getLineCountsMock.mockImplementation(async (_absolutePath: string, files?: string[]) =>
			new Map((files ?? []).map((file) => [path.resolve(file), 42])),
		)
	})

	it("falls back to the workspace root when the requested search path does not exist", async () => {
		const tool = new GlobTool()
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			rooIgnoreController: undefined,
		} as any
		const pushToolResult = vi.fn()

		globMock.mockResolvedValue([
			"/workspace/zed/crates/agent/src/templates/edit_file_prompt_xml.hbs",
		])

		await tool.execute(
			{
				path: "zed/crates/agent/templates",
				pattern: "edit_file_prompt",
			},
			task,
			{
				askApproval: vi.fn().mockResolvedValue(true),
				handleError: vi.fn(),
				pushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "unified" as any,
				toolCallId: "test-call",
			},
		)

		expect(globMock).toHaveBeenCalledWith(
			"**/*edit_file_prompt*",
			expect.objectContaining({
				cwd: "/workspace",
			}),
		)
		expect(pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining('Note: Search path "zed/crates/agent/templates" was not found. Searched the workspace root instead.'),
		)
		expect(pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining(
				"zed/crates/agent/src/templates/edit_file_prompt_xml.hbs",
			),
		)
	})

	it("searches across multiple root paths when path is an array", async () => {
		const tool = new GlobTool()
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			rooIgnoreController: undefined,
		} as any
		const pushToolResult = vi.fn()
		vi.spyOn(fs, "existsSync").mockImplementation((targetPath: fs.PathLike) => {
			const normalizedPath = String(targetPath)
			return normalizedPath === "/workspace/src" || normalizedPath === "/workspace/webview-ui/src"
		})

		resolveRecursivePathMock.mockImplementation(async (_cwd: string, relPath: string) => ({
			resolvedPath: relPath,
		}))
		globMock.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
			if (options.cwd === "/workspace/src") {
				return ["/workspace/src/api.ts"]
			}
			if (options.cwd === "/workspace/webview-ui/src") {
				return ["/workspace/webview-ui/src/api.js"]
			}
			return []
		})

		await tool.execute(
			{
				path: ["src", "webview-ui/src"],
				pattern: ["api.ts", "api.js"],
			},
			task,
			{
				askApproval: vi.fn().mockResolvedValue(true),
				handleError: vi.fn(),
				pushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "unified" as any,
				toolCallId: "test-call",
			},
		)

		expect(globMock).toHaveBeenCalledWith(
			"**/api.ts",
			expect.objectContaining({ cwd: "/workspace/src" }),
		)
		expect(globMock).toHaveBeenCalledWith(
			"**/api.js",
			expect.objectContaining({ cwd: "/workspace/webview-ui/src" }),
		)
		expect(getLineCountsMock).toHaveBeenCalledWith("/workspace/src")
		expect(getLineCountsMock).toHaveBeenCalledWith("/workspace/webview-ui/src")
		expect(pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("## src"),
		)
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("api.ts"))
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("## webview-ui/src"))
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("api.js"))
	})

	it("supports multi-pattern partial updates without crashing on array inputs", async () => {
		const tool = new GlobTool()
		const task = {
			cwd: "/workspace",
			say: vi.fn().mockResolvedValue(undefined),
		} as any

		await tool.handlePartial(task, {
			type: "tool_use",
			id: "glob_partial_1",
			name: "glob",
			params: {},
			partial: true,
			nativeArgs: {
				path: ["src", "webview-ui/src"],
				pattern: ["ReadTool.tsx", "ReadToolResult.tsx", "Read.tsx"],
			},
		} as any)

		expect(task.say).toHaveBeenCalledOnce()
		const partialPayload = JSON.parse(task.say.mock.calls[0][1])
		expect(partialPayload.tool).toBe("glob")
		expect(partialPayload.path).toBe("src, webview-ui/src")
		expect(partialPayload.pattern).toBe("ReadTool.tsx|ReadToolResult.tsx|Read.tsx")
	})

	it("expands bare wildcard file patterns recursively", async () => {
		const tool = new GlobTool()
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			rooIgnoreController: undefined,
		} as any

		globMock.mockResolvedValue([])

		await tool.execute(
			{
				path: ".",
				pattern: "*.css|*.tsx",
			},
			task,
			{
				askApproval: vi.fn().mockResolvedValue(true),
				handleError: vi.fn(),
				pushToolResult: vi.fn(),
				removeClosingTag: vi.fn(),
				toolProtocol: "unified" as any,
				toolCallId: "glob-recursive-wildcards",
			},
		)

		expect(globMock).toHaveBeenCalledWith(
			"**/*.css",
			expect.objectContaining({ cwd: "/workspace" }),
		)
		expect(globMock).toHaveBeenCalledWith(
			"**/*.tsx",
			expect.objectContaining({ cwd: "/workspace" }),
		)
	})

	it("splits comma-separated glob patterns without breaking brace globs", async () => {
		const tool = new GlobTool()
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			rooIgnoreController: undefined,
		} as any

		globMock.mockResolvedValue([])

		await tool.execute(
			{
				path: ".",
				pattern: "*.ts,*.tsx,*.{js,jsx}",
			},
			task,
			{
				askApproval: vi.fn().mockResolvedValue(true),
				handleError: vi.fn(),
				pushToolResult: vi.fn(),
				removeClosingTag: vi.fn(),
				toolProtocol: "unified" as any,
				toolCallId: "glob-comma-split",
			},
		)

		expect(globMock).toHaveBeenCalledWith(
			"**/*.ts",
			expect.objectContaining({ cwd: "/workspace" }),
		)
		expect(globMock).toHaveBeenCalledWith(
			"**/*.tsx",
			expect.objectContaining({ cwd: "/workspace" }),
		)
		expect(globMock).toHaveBeenCalledWith(
			"**/*.{js,jsx}",
			expect.objectContaining({ cwd: "/workspace" }),
		)
	})

	it("keeps pipes inside extglob groups when splitting glob lists", () => {
		expect(splitGlobPatternList("@(foo|bar).ts,*.tsx")).toEqual([
			"@(foo|bar).ts",
			"*.tsx",
		])
	})
})
