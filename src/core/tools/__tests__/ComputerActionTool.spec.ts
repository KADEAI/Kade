import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockMouse, mockKeyboard, mockScreen } = vi.hoisted(() => ({
	mockMouse: {
		config: { autoDelayMs: 0, mouseSpeed: 0 },
		setPosition: vi.fn(),
		leftClick: vi.fn(),
		rightClick: vi.fn(),
		click: vi.fn(),
		doubleClick: vi.fn(),
		pressButton: vi.fn(),
		releaseButton: vi.fn(),
		scrollUp: vi.fn(),
		scrollDown: vi.fn(),
		scrollLeft: vi.fn(),
		scrollRight: vi.fn(),
		getPosition: vi.fn(),
	},
	mockKeyboard: {
		config: { autoDelayMs: 0 },
		pressKey: vi.fn(),
		releaseKey: vi.fn(),
		type: vi.fn(),
	},
	mockScreen: {
		width: vi.fn(),
		height: vi.fn(),
		grab: vi.fn(),
	},
}))

vi.mock("@nut-tree-fork/nut-js", () => ({
	Button: { LEFT: "LEFT", MIDDLE: "MIDDLE" },
	Key: {},
	Point: class Point {
		x: number
		y: number

		constructor(x: number, y: number) {
			this.x = x
			this.y = y
		}
	},
	imageToJimp: vi.fn(),
	keyboard: mockKeyboard,
	mouse: mockMouse,
	screen: mockScreen,
}))

vi.mock("jimp", () => ({
	Jimp: {
		read: vi.fn(),
	},
}))

import { computerActionTool } from "../ComputerActionTool"

describe("ComputerActionTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useRealTimers()
		mockScreen.width.mockResolvedValue(1000)
		mockScreen.height.mockResolvedValue(1000)
		mockMouse.setPosition.mockResolvedValue(undefined)
		mockMouse.leftClick.mockResolvedValue(undefined)
		mockMouse.getPosition.mockResolvedValue({ x: 100, y: 200 })
		mockKeyboard.pressKey.mockResolvedValue(undefined)
		mockKeyboard.releaseKey.mockResolvedValue(undefined)
		mockKeyboard.type.mockResolvedValue(undefined)
	})

	it("executes mouse_move and emits a result without going through generic askApproval", async () => {
		const pushToolResult = vi.fn()
		const askApproval = vi.fn()
		const handleError = vi.fn()
		const task = {
			say: vi.fn().mockResolvedValue(undefined),
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(),
			consecutiveMistakeCount: 0,
		} as any

		await computerActionTool.execute(
			{
				action: "mouse_move",
				coordinate: "500,500",
			},
			task,
			{
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag: vi.fn((_tag, text) => text || ""),
				toolProtocol: "unified" as any,
			},
		)

		expect(task.say).toHaveBeenCalledWith(
			"tool",
			"computer_action mouse_move 500,500",
			undefined,
			false,
		)
		expect(askApproval).not.toHaveBeenCalled()
		expect(mockMouse.setPosition).toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledWith("Moved cursor to 500,500.")
		expect(handleError).not.toHaveBeenCalled()
	})

	it("surfaces a timeout error when a desktop action hangs", async () => {
		vi.useFakeTimers()
		mockMouse.leftClick.mockImplementation(() => new Promise(() => {}))

		const pushToolResult = vi.fn()
		const handleError = vi.fn().mockResolvedValue(undefined)
		const task = {
			say: vi.fn().mockResolvedValue(undefined),
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(),
			consecutiveMistakeCount: 0,
		} as any

		const execution = computerActionTool.execute(
			{
				action: "left_click",
				coordinate: "500,500",
			},
			task,
			{
				askApproval: vi.fn(),
				handleError,
				pushToolResult,
				removeClosingTag: vi.fn((_tag, text) => text || ""),
				toolProtocol: "unified" as any,
			},
		)

		await vi.advanceTimersByTimeAsync(15000)
		await execution

		expect(handleError).toHaveBeenCalledWith(
			"executing computer action",
			expect.objectContaining({
				message: expect.stringContaining("Timed out while performing left_click."),
			}),
		)
		expect(task.recordToolError).toHaveBeenCalledWith(
			"computer_action",
			expect.stringContaining("Timed out while performing left_click."),
		)
	})
})
