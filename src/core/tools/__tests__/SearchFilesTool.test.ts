import os from "os"
import path from "path"
import { promises as fs } from "fs"

import { afterEach, describe, expect, it, vi } from "vitest"

const {
	getBinPathMock,
	execRipgrepMock,
	resolveRecursivePathMock,
	getReadablePathMock,
} = vi.hoisted(() => ({
	getBinPathMock: vi.fn(),
	execRipgrepMock: vi.fn(),
	resolveRecursivePathMock: vi.fn(),
	getReadablePathMock: vi.fn(),
}))

vi.mock("vscode", () => ({
	env: {
		appRoot: "/fake/vscode",
	},
}))

vi.mock("../../../services/ripgrep", () => ({
	getBinPath: getBinPathMock,
	execRipgrep: execRipgrepMock,
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: getReadablePathMock,
	resolveRecursivePath: resolveRecursivePathMock,
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn(() => false),
}))

import { buildGrepIgnoreGlobs, buildOrderedGrepGlobs } from "../searchFilesIgnoreGlobs"
import {
	grepTool,
	isIdentifierLikeQuery,
	looksLikeRegexIntent,
	normalizeGrepQueries,
	normalizeShellRegexQuery,
	resolveCaseInsensitiveSearch,
	shouldUseWholeWordSearch,
} from "../SearchFilesTool"

const tempDirs: string[] = []

afterEach(async () => {
	vi.clearAllMocks()
	await Promise.all(
		tempDirs.splice(0).map(async (dir) => {
			await fs.rm(dir, { recursive: true, force: true })
		}),
	)
})

describe("buildGrepIgnoreGlobs", () => {
	it("filters noisy non-code files by default", () => {
		const globs = buildGrepIgnoreGlobs()

		expect(globs).toContain("!**/*.md")
		expect(globs).toContain("!**/package.nls*.json")
		expect(globs).toContain("!**/locales/**")
		expect(globs).toContain("!**/*.spec.*")
		expect(globs).toContain("!**/__tests__/**")
	})

	it("keeps tests when explicitly requested but still filters other noise", () => {
		const globs = buildGrepIgnoreGlobs({ includeTests: true })

		expect(globs).toContain("!**/*.md")
		expect(globs).toContain("!**/package.nls*.json")
		expect(globs).not.toContain("!**/*.spec.*")
		expect(globs).not.toContain("!**/__tests__/**")
	})

	it("returns no ignore globs when include_all is enabled", () => {
		expect(buildGrepIgnoreGlobs({ includeAll: true })).toEqual([])
	})

	it("lets an explicit include override default noise filters", () => {
		const globs = buildOrderedGrepGlobs({ include: "*.txt" })

		expect(globs.indexOf("!**/*.txt")).toBeGreaterThanOrEqual(0)
		expect(globs.at(-1)).toBe("*.txt")
	})

	it("splits comma-separated include globs without breaking brace globs", () => {
		const globs = buildOrderedGrepGlobs({ include: "*.tsx, *.ts, *.{js,jsx}" })

		expect(globs.slice(-3)).toEqual(["*.tsx", "*.ts", "*.{js,jsx}"])
	})

	it("keeps an explicit exclude as the highest-precedence glob", () => {
		const globs = buildOrderedGrepGlobs({ include: "*.txt", exclude: "sample.txt" })

		expect(globs.at(-2)).toBe("*.txt")
		expect(globs.at(-1)).toBe("!sample.txt")
	})

	it("supports native array include and exclude globs", () => {
		const globs = buildOrderedGrepGlobs({
			include: ["*.tsx", "*.ts"],
			exclude: ["*.spec.ts", "*.test.ts"],
		})

		expect(globs.slice(-4)).toEqual(["*.tsx", "*.ts", "!*.spec.ts", "!*.test.ts"])
	})
})

describe("grep matching defaults", () => {
	it("keeps plain symbol queries as literal substring searches by default", () => {
		expect(isIdentifierLikeQuery("zed")).toBe(true)
		expect(shouldUseWholeWordSearch("zed", { literal: true })).toBe(false)
		expect(shouldUseWholeWordSearch("AuthService", { literal: true })).toBe(false)
	})

	it("keeps punctuation-heavy queries as exact literal searches instead of forcing whole-word", () => {
		expect(isIdentifierLikeQuery("(.function.zed)")).toBe(false)
		expect(shouldUseWholeWordSearch("(.function.zed)", { literal: true })).toBe(false)
		expect(shouldUseWholeWordSearch("foo.bar", { literal: true })).toBe(false)
	})

	it("still honors explicit whole-word requests", () => {
		expect(shouldUseWholeWordSearch("zed", { literal: true, wholeWord: true })).toBe(true)
		expect(shouldUseWholeWordSearch("zed", { literal: true, wholeWord: false })).toBe(false)
	})

	it("defaults to case-insensitive search unless case-sensitive behavior is explicitly requested", () => {
		expect(resolveCaseInsensitiveSearch({})).toBe(true)
		expect(resolveCaseInsensitiveSearch({ case_insensitive: true })).toBe(true)
		expect(resolveCaseInsensitiveSearch({ case_insensitive: false })).toBe(false)
		expect(resolveCaseInsensitiveSearch({ case_sensitive: true, case_insensitive: true })).toBe(false)
	})

	it("detects shell-style regex intent and normalizes escaped regex operators", () => {
		expect(looksLikeRegexIntent(String.raw`send.*button\|button.*send`)).toBe(true)
		expect(normalizeShellRegexQuery(String.raw`send.*button\|button.*send`)).toBe(
			"send.*button|button.*send",
		)
		expect(
			normalizeGrepQueries(String.raw`send.*button\|button.*send`, {
				explicitLiteral: false,
			}),
		).toEqual({
			queries: ["send.*button|button.*send"],
			literal: false,
		})
	})
})

describe("grep result formatting", () => {
	it("counts only actual match lines and marks context separately", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-tool-"))
		tempDirs.push(tempDir)

		const filePath = path.join(tempDir, "sample.ts")
		await fs.writeFile(
			filePath,
			["before", "const zed = true", "after"].join("\n"),
			"utf8",
		)

		const jsonOutput = [
			JSON.stringify({
				type: "context",
				data: {
					path: { text: filePath },
					lines: { text: "before\n" },
					line_number: 1,
				},
			}),
			JSON.stringify({
				type: "match",
				data: {
					path: { text: filePath },
					lines: { text: "const zed = true\n" },
					line_number: 2,
					submatches: [{ start: 6, end: 9 }],
				},
			}),
			JSON.stringify({
				type: "context",
				data: {
					path: { text: filePath },
					lines: { text: "after\n" },
					line_number: 3,
				},
			}),
		].join("\n")

		const result = await (grepTool as any).parseRipgrepJsonOutput(jsonOutput, tempDir)

		expect(result.count).toBe(1)
		expect(result.output).toContain("  1 →before")
		expect(result.output).toContain("  2*→const →zed← = true")
		expect(result.output).toContain("  3 →after")
	})

	it("emits compact multi-query output without spacer separators", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-tool-"))
		tempDirs.push(tempDir)

		const filePath = path.join(tempDir, "sample.ts")
		await fs.writeFile(filePath, ["const alpha = true", "const beta = true"].join("\n"), "utf8")

		const task = {
			cwd: tempDir,
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn(),
			updateClineMessage: vi.fn(),
			clineMessages: [],
		} as any

		const askApproval = vi.fn().mockResolvedValue(true)
		const pushToolResult = vi.fn()
		const handleError = vi.fn()

		resolveRecursivePathMock.mockResolvedValue({ resolvedPath: "." })
		getReadablePathMock.mockImplementation((_: string, targetPath?: string) => targetPath || "")
		getBinPathMock.mockResolvedValue("/fake/rg")
		execRipgrepMock
			.mockResolvedValueOnce(
				JSON.stringify({
					type: "match",
					data: {
						path: { text: filePath },
						lines: { text: "const alpha = true\n" },
						line_number: 1,
						submatches: [{ start: 6, end: 11 }],
					},
				}),
			)
			.mockResolvedValueOnce(
				JSON.stringify({
					type: "match",
					data: {
						path: { text: filePath },
						lines: { text: "const beta = true\n" },
						line_number: 2,
						submatches: [{ start: 6, end: 10 }],
					},
				}),
			)

		await grepTool.execute(
			{
				path: ".",
				query: ["alpha", "beta"],
			},
			task,
			{
				askApproval,
				pushToolResult,
				handleError,
				toolCallId: "grep_test_compact",
			} as any,
		)

		const output = pushToolResult.mock.calls[0][0]
		expect(output).toContain('Query: "alpha" (1 matches, max 75)')
		expect(output).toContain('Query: "beta" (1 matches, max 75)')
		expect(output).not.toContain("\n\n---\n\n")
		expect(output).not.toContain("file_name|L = total amount of lines in file")
		expect(output).not.toContain("## sample.ts|L2\n\n")
	})

	it("returns an explicit no-match message instead of an empty tool result", async () => {
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn(),
			updateClineMessage: vi.fn(),
			clineMessages: [],
		} as any

		const askApproval = vi.fn().mockResolvedValue(true)
		const pushToolResult = vi.fn()
		const handleError = vi.fn()

		resolveRecursivePathMock.mockResolvedValue({ resolvedPath: "src" })
		getReadablePathMock.mockImplementation((_: string, targetPath?: string) => targetPath || "")
		getBinPathMock.mockResolvedValue("/fake/rg")
		execRipgrepMock.mockResolvedValue("")

		await grepTool.execute(
			{
				path: "src",
				query: String.raw`send.*button\|button.*send`,
			},
			task,
			{
				askApproval,
				pushToolResult,
				handleError,
				toolCallId: "grep_test_no_matches",
			} as any,
		)

		expect(execRipgrepMock).toHaveBeenCalledWith(
			"/fake/rg",
			expect.arrayContaining(["-e", "send.*button|button.*send"]),
		)
		expect(execRipgrepMock.mock.calls[0][1]).not.toContain("-F")
		expect(pushToolResult).toHaveBeenCalledWith(
			'No matches found for query "send.*button|button.*send".',
		)
	})

	it("treats include as a file pattern alias when building ripgrep args", async () => {
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn(),
			updateClineMessage: vi.fn(),
			clineMessages: [],
		} as any

		const askApproval = vi.fn().mockResolvedValue(true)
		const pushToolResult = vi.fn()
		const handleError = vi.fn()

		resolveRecursivePathMock.mockResolvedValue({ resolvedPath: "src" })
		getReadablePathMock.mockImplementation((_: string, targetPath?: string) => targetPath || "")
		getBinPathMock.mockResolvedValue("/fake/rg")
		execRipgrepMock.mockResolvedValue("")

		await grepTool.execute(
			{
				path: "src",
				query: "AuthService",
				include: "*.ts,*.tsx",
			},
			task,
			{
				askApproval,
				pushToolResult,
				handleError,
				toolCallId: "grep_test_include_alias",
			} as any,
		)

		expect(execRipgrepMock).toHaveBeenCalledWith(
			"/fake/rg",
			expect.arrayContaining(["--glob", "*.ts", "--glob", "*.tsx"]),
		)
	})
})

describe("grep partial rendering", () => {
	it("supports multi-path partial updates", async () => {
		const task = {
			cwd: "/workspace",
			say: vi.fn().mockResolvedValue(undefined),
		} as any

		await grepTool.handlePartial(task, {
			type: "tool_use",
			id: "grep_partial_1",
			name: "grep",
			params: {},
			partial: true,
			nativeArgs: {
				path: ["sample.txt", "sample2.txt"],
				query: "error|warning",
			},
		} as any)

		expect(task.say).toHaveBeenCalledOnce()
		const partialPayload = JSON.parse(task.say.mock.calls[0][1])
		expect(partialPayload.tool).toBe("grep")
		expect(partialPayload.path).toBe("sample.txt, sample2.txt")
		expect(partialPayload.regex).toBe("error|warning")
	})

	it("supports query arrays in partial updates", async () => {
		const task = {
			cwd: "/workspace",
			say: vi.fn().mockResolvedValue(undefined),
		} as any

		await grepTool.handlePartial(task, {
			type: "tool_use",
			id: "grep_partial_2",
			name: "grep",
			params: {},
			partial: true,
			nativeArgs: {
				path: ["sample.txt", "sample2.txt"],
				query: ["error", "warning"],
			},
		} as any)

		expect(task.say).toHaveBeenCalledOnce()
		const partialPayload = JSON.parse(task.say.mock.calls[0][1])
		expect(partialPayload.tool).toBe("grep")
		expect(partialPayload.path).toBe("sample.txt, sample2.txt")
		expect(partialPayload.regex).toBe("error|warning")
	})
})
