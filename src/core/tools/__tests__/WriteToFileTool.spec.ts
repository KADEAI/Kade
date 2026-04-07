import path from "path"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../utils/fs", async () => {
	const actual = await vi.importActual<typeof import("../../../utils/fs")>("../../../utils/fs")
	return {
		...actual,
		createDirectoriesForFile: vi.fn().mockResolvedValue(undefined),
	}
})

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

import { WriteToFileTool } from "../WriteToFileTool"
import { createDirectoriesForFile } from "../../../utils/fs"

describe("WriteToFileTool.parseLegacy", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("recovers compact colon write payloads when the entire payload lands in path", () => {
		const tool = new WriteToFileTool()

		const result = tool.parseLegacy({
			path: 'game.html:<!DOCTYPE html>\n<html lang="en">\n',
		})

		expect(result).toEqual({
			path: "game.html",
			content: '<!DOCTYPE html>\n<html lang="en">\n',
			write: undefined,
		})
	})

	it("recovers compact pipe write payloads when the separator is over-escaped", () => {
		const tool = new WriteToFileTool()

		const result = tool.parseLegacy({
			path: 'sample_game.html\\|<!DOCTYPE html>\n<html lang="en">\n',
		})

		expect(result).toEqual({
			path: "sample_game.html",
			content: '<!DOCTYPE html>\n<html lang="en">\n',
			write: undefined,
		})
	})

	it("normalizes malformed compact write paths during partial streaming", async () => {
		const tool = new WriteToFileTool()
		const cwd = "/tmp/write-tool-partial"

		await tool.handlePartial(
			{
				cwd,
				providerRef: {
					deref: () => ({
						getState: async () => ({}),
					}),
				},
				diffViewProvider: {
					editType: undefined,
					isEditing: false,
					getActiveStreamingToolCallId: () => undefined,
					getCurrentRelPath: () => undefined,
					setActiveStreamingToolCallId: vi.fn(),
					open: vi.fn().mockResolvedValue(undefined),
					update: vi.fn().mockResolvedValue(undefined),
				},
				rooProtectedController: {
					isWriteProtected: () => false,
				},
				say: vi.fn().mockResolvedValue(undefined),
			} as any,
			{
				type: "tool_use",
				name: "write",
				id: "write_partial_1",
				params: {
					path: 'sample_game.html|<!DOCTYPE html>\n<html lang="en">\n',
					content: '<!DOCTYPE html>\n<html lang="en">\n',
				},
			} as any,
		)

		expect(createDirectoriesForFile).toHaveBeenCalledWith(
			path.resolve(cwd, "sample_game.html"),
		)
		expect(createDirectoriesForFile).not.toHaveBeenCalledWith(
			expect.stringContaining("|<!DOCTYPE html>"),
		)
	})

	it("prefers recovered full content when the parsed content is only a truncated prefix", () => {
		const tool = new WriteToFileTool()

		const result = tool.parseLegacy({
			path:
				'sample_game.html|<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n',
			content: "<!DOCTYPE html>",
		})

		expect(result).toEqual({
			path: "sample_game.html",
			content:
				'<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n',
			write: undefined,
		})
	})

	it("prefers recovered full content when parsed content is only trailing wrapper junk", () => {
		const tool = new WriteToFileTool()

		const result = tool.parseLegacy({
			path:
				'sample_game.html|<!DOCTYPE html>\n<html lang="en">\n<body>\n</body>\n</html>\n',
			content: "}",
		})

		expect(result).toEqual({
			path: "sample_game.html",
			content: '<!DOCTYPE html>\n<html lang="en">\n<body>\n</body>\n</html>\n',
			write: undefined,
		})
	})
})
