import { describe, expect, it, vi } from "vitest"

import {
	ReadFileTool,
	joinNativeReadResults,
	joinNativeReadSections,
	wrapNativeReadResult,
} from "../ReadFileTool"

describe("ReadFileTool.parseLegacy", () => {
	it("parses inline line range, head, and tail suffixes in path shorthand", () => {
		const tool = new ReadFileTool()

		const result = tool.parseLegacy({
			path: "fifty_lines.txt:L1-5, head.txt:H10, tail.txt:T3",
		})

		expect(result).toEqual({
			files: [
				{
					path: "fifty_lines.txt",
					lineRanges: [{ start: 1, end: 5 }],
				},
				{
					path: "head.txt",
					lineRanges: [],
					head: 10,
				},
				{
					path: "tail.txt",
					lineRanges: [],
					tail: 3,
				},
			],
		})
	})

	it("parses combined head and tail modifiers on a single file target", () => {
		const tool = new ReadFileTool()

		const result = tool.parseLegacy({
			path: "combo.txt:H100,T100",
		})

		expect(result).toEqual({
			files: [
				{
					path: "combo.txt",
					lineRanges: [],
					head: 100,
					tail: 100,
				},
			],
		})
	})

	it("wraps native read results with the plain-text read header", () => {
		const result = wrapNativeReadResult("src/app.ts", "Lines 1-2:\n1→const a = 1\n2→const b = 2")

		expect(result).toContain("Read result for src/app.ts")
		expect(result).toContain("Read Content:")
		expect(result).toContain("EOF")
	})

	it("uses stronger separators for range sections and multi-file results", () => {
		const sectioned = joinNativeReadSections(["Lines 1-1:\n1→a", "Lines 10-10:\n10→b"])
		const multi = joinNativeReadResults(["one", "two"])

		expect(sectioned).toContain("----- READ SECTION BREAK -----")
		expect(multi).toContain("========== NEXT READ RESULT ==========")
	})

	it("treats malformed native file entries as a normal missing-path error", async () => {
		const tool = new ReadFileTool()
		const pushToolResult = vi.fn()
		const sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing required parameter: path")

		await tool.execute(
			{
				files: [{ path: undefined as any }],
			},
			{
				api: {
					getModel: () => ({
						info: {},
					}),
				},
				apiConfiguration: {},
				consecutiveMistakeCount: 0,
				recordToolError: vi.fn(),
				sayAndCreateMissingParamError,
			} as any,
			{
				handleError: vi.fn(),
				pushToolResult,
				askApproval: vi.fn(),
				removeClosingTag: vi.fn(),
				toolProtocol: "json" as any,
			},
		)

		expect(sayAndCreateMissingParamError).toHaveBeenCalledWith("read", "path")
		expect(pushToolResult).toHaveBeenCalledWith("Error: Missing required parameter: path")
	})
})
