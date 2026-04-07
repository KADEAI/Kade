import { describe, expect, it, vi } from "vitest"

import { listDirTool } from "../ListFilesTool"

describe("ListDirTool partial rendering", () => {
	it("supports multi-path partial updates", async () => {
		const task = {
			cwd: "/workspace",
			say: vi.fn().mockResolvedValue(undefined),
		} as any

		await listDirTool.handlePartial(task, {
			type: "tool_use",
			id: "list_partial_1",
			name: "list",
			params: {},
			partial: true,
			nativeArgs: {
				path: ["src", "webview-ui"],
			},
		} as any)

		expect(task.say).toHaveBeenCalledOnce()
		const partialPayload = JSON.parse(task.say.mock.calls[0][1])
		expect(partialPayload.tool).toBe("listDirTopLevel")
		expect(partialPayload.path).toBe("src, webview-ui")
	})
})
