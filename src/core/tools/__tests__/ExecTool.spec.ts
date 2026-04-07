import { describe, expect, it, vi, beforeEach } from "vitest"
import { TOOL_PROTOCOL } from "@roo-code/types"

const listHandle = vi.fn()
const grepHandle = vi.fn()

vi.mock("../ListFilesTool", () => ({
	listDirTool: {
		handle: listHandle,
	},
}))

vi.mock("../SearchFilesTool", () => ({
	grepTool: {
		handle: grepHandle,
	},
}))

import { batchTool } from "../BatchTool"

describe("BatchTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("executes nested tool calls in order and aggregates the results", async () => {
		listHandle.mockImplementation(async (_task, _block, callbacks) => {
			callbacks.pushToolResult("list result")
		})
		grepHandle.mockImplementation(async (_task, _block, callbacks) => {
			callbacks.pushToolResult("grep result")
		})

		const pushToolResult = vi.fn()
		const task = {
			diffEnabled: false,
			didRejectTool: false,
			consecutiveMistakeCount: 0,
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			getTaskMode: vi.fn().mockResolvedValue("code"),
			providerRef: {
				deref: () => ({
					getState: async () => ({
						customModes: [
							{
								slug: "code",
								name: "Code",
								roleDefinition: "Test",
								groups: ["read", "command"] as const,
							},
						],
						experiments: {},
					}),
				}),
			},
			api: {
				getModel: () => ({
					info: {},
				}),
			},
		} as any

		await batchTool.execute(
			{
				calls: [
					{ name: "list", arguments: { path: "src" } },
					{ name: "grep", arguments: { query: "AuthService", path: "src" } },
				],
			},
			task,
			{
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult,
				removeClosingTag: vi.fn((_tag, text) => text || ""),
				toolProtocol: TOOL_PROTOCOL.JSON,
				toolCallId: "group_call_1",
			},
		)

		expect(listHandle).toHaveBeenCalledOnce()
		expect(grepHandle).toHaveBeenCalledOnce()
		expect(listHandle.mock.calls[0][2].toolCallId).toBe("group_call_1::list:0")
		expect(grepHandle.mock.calls[0][2].toolCallId).toBe("group_call_1::grep:1")
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		expect(pushToolResult.mock.calls[0][0]).toContain("[1] list")
		expect(pushToolResult.mock.calls[0][0]).toContain("list result")
		expect(pushToolResult.mock.calls[0][0]).toContain("[2] grep")
		expect(pushToolResult.mock.calls[0][0]).toContain("grep result")
	})

	it("rejects nested batch calls", async () => {
		const pushToolResult = vi.fn()
		const task = {
			diffEnabled: false,
			didRejectTool: false,
			consecutiveMistakeCount: 0,
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			getTaskMode: vi.fn().mockResolvedValue("code"),
			providerRef: {
				deref: () => ({
					getState: async () => ({
						customModes: [],
						experiments: {},
					}),
				}),
			},
			api: {
				getModel: () => ({
					info: {},
				}),
			},
		} as any

		await batchTool.execute(
			{
				calls: [{ name: "batch", arguments: { calls: [] } }],
			},
			task,
			{
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult,
				removeClosingTag: vi.fn((_tag, text) => text || ""),
				toolProtocol: TOOL_PROTOCOL.JSON,
			},
		)

		expect(listHandle).not.toHaveBeenCalled()
		expect(grepHandle).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		expect(pushToolResult.mock.calls[0][0]).toContain('Tool "batch" cannot run inside batch')
	})
})
