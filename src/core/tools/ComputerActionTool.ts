import { execFileSync } from "node:child_process"
import { readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import delay from "delay"
import { Button, imageToJimp, keyboard, Key, mouse, Point, screen } from "@nut-tree-fork/nut-js"
import { Jimp } from "jimp"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { scaleCoordinate } from "../../shared/browserUtils"
import type { NativeToolArgs } from "../../shared/tools"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

type ComputerAction =
	| "key"
	| "type"
	| "mouse_move"
	| "left_click"
	| "left_click_drag"
	| "right_click"
	| "middle_click"
	| "double_click"
	| "scroll"
	| "get_screenshot"
	| "get_cursor_position"

type ComputerActionParams = NativeToolArgs["computer_action"]
type ScreenshotSpace = {
	imageWidth: number
	imageHeight: number
	normalizedGrid: boolean
}

const MAX_LONG_EDGE = 1568
const MAX_PIXELS = 1.15 * 1024 * 1024
const lastScreenshotSpaceByTask = new WeakMap<Task, ScreenshotSpace>()
const NORMALIZED_GRID_MAX = 1000
const NORMALIZED_GRID_STEP = 100
const NORMALIZED_GRID_MINOR_STEP = 50
const COMPUTER_ACTION_TIMEOUT_MS = 15000

mouse.config.autoDelayMs = 100
mouse.config.mouseSpeed = 1000
keyboard.config.autoDelayMs = 10

let xdotoolAvailable: boolean | undefined
let macAccessibilityTrusted: boolean | undefined

function hasXdotool(): boolean {
	if (xdotoolAvailable === undefined) {
		try {
			execFileSync("which", ["xdotool"], { stdio: "ignore" })
			xdotoolAvailable = true
		} catch {
			xdotoolAvailable = false
		}
	}

	return xdotoolAvailable
}

function xdotoolType(text: string): void {
	execFileSync(
		"xdotool",
		[
			"type",
			"--clearmodifiers",
			"--delay",
			String(keyboard.config.autoDelayMs),
			"--",
			text,
		],
		{
			env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" },
		},
	)
}

function hasMacAccessibilityPermission(): boolean {
	if (process.platform !== "darwin") {
		return true
	}

	if (macAccessibilityTrusted !== undefined) {
		return macAccessibilityTrusted
	}

	try {
		const output = execFileSync(
			"osascript",
			[
				"-e",
				'tell application "System Events" to get UI elements enabled',
			],
			{ encoding: "utf8" },
		)
		macAccessibilityTrusted = output.trim().toLowerCase() === "true"
	} catch {
		macAccessibilityTrusted = false
	}

	return macAccessibilityTrusted
}

function assertMacAccessibilityPermission(): void {
	if (!hasMacAccessibilityPermission()) {
		throw new Error(
			'macOS Accessibility permission is required for desktop control. Enable this app in System Settings -> Privacy & Security -> Accessibility.',
		)
	}
}

async function grabScreen(): Promise<ReturnType<typeof imageToJimp>> {
	try {
		return imageToJimp(await screen.grab())
	} catch (error) {
		if (process.platform !== "darwin") {
			throw error
		}

		const tmpPath = join(tmpdir(), `kade-computer-action-${Date.now()}.png`)
		try {
			execFileSync("screencapture", ["-x", tmpPath])
			return (await Jimp.read(readFileSync(tmpPath))) as unknown as ReturnType<typeof imageToJimp>
		} finally {
			try {
				unlinkSync(tmpPath)
			} catch {
				// Ignore cleanup failures.
			}
		}
	}
}

function getScaleToFit(width: number, height: number): number {
	const longEdge = Math.max(width, height)
	const totalPixels = width * height
	const longEdgeScale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
	const pixelScale = totalPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / totalPixels) : 1
	return Math.min(longEdgeScale, pixelScale)
}

function normalizedToPixel(value: number, size: number): number {
	return Math.round((value / NORMALIZED_GRID_MAX) * Math.max(0, size - 1))
}

function fillRect(
	image: ReturnType<typeof imageToJimp>,
	x: number,
	y: number,
	width: number,
	height: number,
	color: number,
): void {
	const xStart = Math.max(0, Math.floor(x))
	const yStart = Math.max(0, Math.floor(y))
	const xEnd = Math.min(image.getWidth(), Math.ceil(x + width))
	const yEnd = Math.min(image.getHeight(), Math.ceil(y + height))

	for (let px = xStart; px < xEnd; px++) {
		for (let py = yStart; py < yEnd; py++) {
			image.setPixelColor(color, px, py)
		}
	}
}

function drawHorizontalLine(
	image: ReturnType<typeof imageToJimp>,
	y: number,
	color: number,
	lineWidth: number,
): void {
	fillRect(image, 0, y - Math.floor(lineWidth / 2), image.getWidth(), lineWidth, color)
}

function drawVerticalLine(
	image: ReturnType<typeof imageToJimp>,
	x: number,
	color: number,
	lineWidth: number,
): void {
	fillRect(image, x - Math.floor(lineWidth / 2), 0, lineWidth, image.getHeight(), color)
}

const GLYPHS: Record<string, string[]> = {
	"0": ["111", "101", "101", "101", "111"],
	"1": ["010", "110", "010", "010", "111"],
	"2": ["111", "001", "111", "100", "111"],
	"3": ["111", "001", "111", "001", "111"],
	"4": ["101", "101", "111", "001", "001"],
	"5": ["111", "100", "111", "001", "111"],
	"6": ["111", "100", "111", "101", "111"],
	"7": ["111", "001", "001", "001", "001"],
	"8": ["111", "101", "111", "101", "111"],
	"9": ["111", "101", "111", "001", "111"],
	",": ["0", "0", "0", "1", "1"],
}

function measureGlyphText(text: string, scale: number): { width: number; height: number } {
	let width = 0
	let maxHeight = 0

	for (const char of text) {
		const glyph = GLYPHS[char]
		if (!glyph) {
			width += scale * 2
			maxHeight = Math.max(maxHeight, scale * 5)
			continue
		}

		const glyphWidth = glyph[0].length * scale
		const glyphHeight = glyph.length * scale
		width += glyphWidth + scale
		maxHeight = Math.max(maxHeight, glyphHeight)
	}

	return {
		width: Math.max(0, width - scale),
		height: maxHeight,
	}
}

function drawGlyphText(
	image: ReturnType<typeof imageToJimp>,
	text: string,
	x: number,
	y: number,
	scale: number,
	color: number,
): void {
	let cursorX = x

	for (const char of text) {
		const glyph = GLYPHS[char]
		if (!glyph) {
			cursorX += scale * 2
			continue
		}

		for (let row = 0; row < glyph.length; row++) {
			for (let col = 0; col < glyph[row].length; col++) {
				if (glyph[row][col] !== "1") {
					continue
				}
				fillRect(image, cursorX + col * scale, y + row * scale, scale, scale, color)
			}
		}

		cursorX += glyph[0].length * scale + scale
	}
}

function drawTextLabel(
	image: ReturnType<typeof imageToJimp>,
	text: string,
	centerX: number,
	centerY: number,
	scale: number,
	textColor: number,
	backgroundColor: number,
): void {
	const { width, height } = measureGlyphText(text, scale)
	const padding = Math.max(2, scale)
	const originX = Math.max(0, Math.round(centerX - width / 2) - padding)
	const originY = Math.max(0, Math.round(centerY - height / 2) - padding)
	const rectWidth = Math.min(image.getWidth() - originX, width + padding * 2)
	const rectHeight = Math.min(image.getHeight() - originY, height + padding * 2)

	fillRect(image, originX, originY, rectWidth, rectHeight, backgroundColor)
	drawGlyphText(image, text, originX + padding, originY + padding, scale, textColor)
}

function drawNormalizedGridOverlay(image: ReturnType<typeof imageToJimp>): void {
	const width = image.getWidth()
	const height = image.getHeight()
	const majorLineColor = 0xff0000b8
	const centerLineColor = 0xffa500ff
	const tickColor = 0xadff2fff
	const labelColor = 0xffff00ff
	const labelBgColor = 0x000000a8
	const intersectionColor = 0x00ffffff
	const majorLineWidth = 2
	const centerLineWidth = 4
	const tickLength = Math.max(8, Math.round(Math.min(width, height) / 140))
	const axisScale = Math.max(2, Math.round(Math.min(width, height) / 420))
	const intersectionScale = Math.max(1, axisScale - 1)

	for (let normX = 0; normX <= NORMALIZED_GRID_MAX; normX += NORMALIZED_GRID_STEP) {
		const actualX = normalizedToPixel(normX, width)
		drawVerticalLine(image, actualX, majorLineColor, majorLineWidth)

		for (let tickNormY = NORMALIZED_GRID_MINOR_STEP; tickNormY < NORMALIZED_GRID_MAX; tickNormY += NORMALIZED_GRID_STEP) {
			const tickY = normalizedToPixel(tickNormY, height)
			fillRect(
				image,
				actualX - Math.floor(tickLength / 2),
				tickY - 1,
				tickLength,
				3,
				tickColor,
			)
		}

		drawTextLabel(
			image,
			String(normX),
			actualX,
			Math.max(10, axisScale * 4),
			axisScale,
			labelColor,
			labelBgColor,
		)
	}

	for (let normY = 0; normY <= NORMALIZED_GRID_MAX; normY += NORMALIZED_GRID_STEP) {
		const actualY = normalizedToPixel(normY, height)
		drawHorizontalLine(image, actualY, majorLineColor, majorLineWidth)

		for (let tickNormX = NORMALIZED_GRID_MINOR_STEP; tickNormX < NORMALIZED_GRID_MAX; tickNormX += NORMALIZED_GRID_STEP) {
			const tickX = normalizedToPixel(tickNormX, width)
			fillRect(
				image,
				tickX - 1,
				actualY - Math.floor(tickLength / 2),
				3,
				tickLength,
				tickColor,
			)
		}

		drawTextLabel(
			image,
			String(normY),
			Math.max(10, axisScale * 4),
			actualY,
			axisScale,
			labelColor,
			labelBgColor,
		)
	}

	drawVerticalLine(image, normalizedToPixel(500, width), centerLineColor, centerLineWidth)
	drawHorizontalLine(image, normalizedToPixel(500, height), centerLineColor, centerLineWidth)

	for (let normX = NORMALIZED_GRID_STEP; normX < NORMALIZED_GRID_MAX; normX += NORMALIZED_GRID_STEP) {
		const actualX = normalizedToPixel(normX, width)
		for (let normY = NORMALIZED_GRID_STEP; normY < NORMALIZED_GRID_MAX; normY += NORMALIZED_GRID_STEP) {
			const actualY = normalizedToPixel(normY, height)
			drawTextLabel(
				image,
				`${normX},${normY}`,
				actualX,
				actualY,
				intersectionScale,
				intersectionColor,
				labelBgColor,
			)
		}
	}
}

function parseCoordinate(
	coordinate: string,
	displayWidth: number,
	displayHeight: number,
	screenshotSpace?: ScreenshotSpace,
): Point {
	try {
		const scaled = scaleCoordinate(coordinate, displayWidth, displayHeight)
		const [xStr, yStr] = scaled.split(",")
		return new Point(Number(xStr), Number(yStr))
	} catch {
		const match = coordinate.match(/^\s*(\d+)\s*,\s*(\d+)\s*$/)
		if (!match) {
			throw new Error(
				`Invalid coordinate format: "${coordinate}". Expected "x,y@widthxheight" or "x,y".`,
			)
		}

		const x = Number(match[1])
		const y = Number(match[2])
		if (screenshotSpace) {
			if (screenshotSpace.normalizedGrid && x <= NORMALIZED_GRID_MAX && y <= NORMALIZED_GRID_MAX) {
				return new Point(
					Math.round((x / NORMALIZED_GRID_MAX) * displayWidth),
					Math.round((y / NORMALIZED_GRID_MAX) * displayHeight),
				)
			}
			return new Point(
				Math.round((x / screenshotSpace.imageWidth) * displayWidth),
				Math.round((y / screenshotSpace.imageHeight) * displayHeight),
			)
		}

		return new Point(x, y)
	}
}

function getKeyFromToken(token: string): Key {
	const normalized = token.trim().toLowerCase()
	const direct: Record<string, Key> = {
		enter: Key.Enter,
		return: Key.Enter,
		tab: Key.Tab,
		escape: Key.Escape,
		esc: Key.Escape,
		backspace: Key.Backspace,
		delete: Key.Delete,
		space: Key.Space,
		spacebar: Key.Space,
		up: Key.Up,
		down: Key.Down,
		left: Key.Left,
		right: Key.Right,
		arrowup: Key.Up,
		arrowdown: Key.Down,
		arrowleft: Key.Left,
		arrowright: Key.Right,
		home: Key.Home,
		end: Key.End,
		pageup: Key.PageUp,
		pagedown: Key.PageDown,
		shift: Key.LeftShift,
		ctrl: Key.LeftControl,
		control: Key.LeftControl,
		alt: Key.LeftAlt,
		option: Key.LeftAlt,
		cmd: Key.LeftCmd,
		command: Key.LeftCmd,
		meta: Key.LeftMeta,
		super: Key.LeftSuper,
	}

	if (direct[normalized]) {
		return direct[normalized]
	}

	if (/^[a-z]$/.test(normalized)) {
		return Key[normalized.toUpperCase() as keyof typeof Key] as unknown as Key
	}

	if (/^[0-9]$/.test(normalized)) {
		return Key[`Num${normalized}` as keyof typeof Key] as unknown as Key
	}

	if (/^f([1-9]|1[0-9]|2[0-4])$/.test(normalized)) {
		return Key[normalized.toUpperCase() as keyof typeof Key] as unknown as Key
	}

	throw new Error(`Unsupported key token: "${token}"`)
}

function parseKeyChord(text: string): Key[] {
	return text
		.split("+")
		.map((token) => token.trim())
		.filter(Boolean)
		.map(getKeyFromToken)
}

function describeAction(params: { action?: ComputerAction; coordinate?: string; text?: string }): string {
	const parts = [`computer_action ${params.action ?? "(pending)"}`]
	if (params.coordinate) {
		parts.push(params.coordinate)
	}
	if (params.text) {
		parts.push(params.text)
	}
	return parts.join(" ")
}

async function withActionTimeout<T>(
	label: string,
	operation: () => Promise<T> | T,
	timeoutMs: number = COMPUTER_ACTION_TIMEOUT_MS,
): Promise<T> {
	return Promise.race([
		Promise.resolve().then(operation),
		delay(timeoutMs).then(() => {
			throw new Error(`Timed out while ${label}.`)
		}),
	])
}

export class ComputerActionTool extends BaseTool<"computer_action"> {
	readonly name = "computer_action" as const

	parseLegacy(params: Partial<Record<string, string>>): ComputerActionParams {
		return {
			action: params.action as ComputerAction,
			coordinate: params.coordinate,
			text: params.text,
		}
	}

	private async requireCoordinate(
		task: Task,
		pushToolResult: ToolCallbacks["pushToolResult"],
		params: ComputerActionParams,
	): Promise<Point | undefined> {
		if (!params.coordinate) {
			task.consecutiveMistakeCount++
			task.recordToolError("computer_action")
			pushToolResult(await task.sayAndCreateMissingParamError("computer_action", "coordinate"))
			return undefined
		}

		return parseCoordinate(
			params.coordinate,
			await withActionTimeout("reading display width", () => screen.width()),
			await withActionTimeout("reading display height", () => screen.height()),
			lastScreenshotSpaceByTask.get(task),
		)
	}

	async execute(
		params: ComputerActionParams,
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			if (!params.action) {
				task.consecutiveMistakeCount++
				task.recordToolError("computer_action")
				pushToolResult(await task.sayAndCreateMissingParamError("computer_action", "action"))
				return
			}

			await task.say("tool", describeAction(params), undefined, false).catch(() => {})
			if (
				process.platform === "darwin" &&
				params.action !== "get_screenshot" &&
				params.action !== "get_cursor_position"
			) {
				assertMacAccessibilityPermission()
			}

			task.consecutiveMistakeCount = 0
			task.recordToolUsage("computer_action")

			switch (params.action) {
				case "key": {
					if (!params.text) {
						task.recordToolError("computer_action")
						pushToolResult(await task.sayAndCreateMissingParamError("computer_action", "text"))
						return
					}
					const keys = parseKeyChord(params.text)
					await withActionTimeout("pressing key input", async () => {
						await keyboard.pressKey(...keys)
						await keyboard.releaseKey(...keys)
					})
					pushToolResult("Pressed key input.")
					return
				}

				case "type": {
					if (!params.text) {
						task.recordToolError("computer_action")
						pushToolResult(await task.sayAndCreateMissingParamError("computer_action", "text"))
						return
					}
					if (process.platform === "linux" && hasXdotool()) {
						await withActionTimeout("typing text via xdotool", () => xdotoolType(params.text!))
					} else {
						await withActionTimeout("typing text", () => keyboard.type(params.text!))
					}
					pushToolResult("Typed text.")
					return
				}

				case "get_cursor_position": {
					const pos = await withActionTimeout("getting cursor position", () => mouse.getPosition())
					pushToolResult(
						`Cursor position: ${pos.x},${pos.y} in display pixels. After get_screenshot, plain x,y uses the normalized 0-1000 screenshot grid; x,y@WIDTHxHEIGHT remains the explicit screenshot-space form.`,
					)
					return
				}

				case "mouse_move": {
					const point = await this.requireCoordinate(task, pushToolResult, params)
					if (!point) {
						return
					}
					await withActionTimeout("moving the cursor", () => mouse.setPosition(point))
					pushToolResult(`Moved cursor to ${point.x},${point.y}.`)
					return
				}

				case "left_click":
				case "right_click":
				case "middle_click":
				case "double_click": {
					if (params.coordinate) {
						const point = await this.requireCoordinate(task, pushToolResult, params)
						if (!point) {
							return
						}
						await withActionTimeout("moving the cursor", () => mouse.setPosition(point))
					}

					await withActionTimeout(`performing ${params.action}`, async () => {
						if (params.action === "left_click") {
							await mouse.leftClick()
						} else if (params.action === "right_click") {
							await mouse.rightClick()
						} else if (params.action === "middle_click") {
							await mouse.click(Button.MIDDLE)
						} else {
							await mouse.doubleClick(Button.LEFT)
						}
					})

					pushToolResult(`Completed ${params.action}.`)
					return
				}

				case "left_click_drag": {
					const point = await this.requireCoordinate(task, pushToolResult, params)
					if (!point) {
						return
					}
					await withActionTimeout("dragging the cursor", async () => {
						await mouse.pressButton(Button.LEFT)
						await mouse.setPosition(point)
						await mouse.releaseButton(Button.LEFT)
					})
					pushToolResult(`Dragged to ${point.x},${point.y}.`)
					return
				}

				case "scroll": {
					const point = await this.requireCoordinate(task, pushToolResult, params)
					if (!point) {
						return
					}
					if (!params.text) {
						task.recordToolError("computer_action")
						pushToolResult(await task.sayAndCreateMissingParamError("computer_action", "text"))
						return
					}

					const [direction, amountText] = params.text.split(":")
					const amount = amountText ? Number.parseInt(amountText, 10) : 300
					if (!direction || Number.isNaN(amount) || amount <= 0) {
						throw new Error(`Invalid scroll directive: "${params.text}"`)
					}

					await withActionTimeout(`scrolling ${direction.toLowerCase()}`, async () => {
						await mouse.setPosition(point)
						switch (direction.toLowerCase()) {
							case "up":
								await mouse.scrollUp(amount)
								break
							case "down":
								await mouse.scrollDown(amount)
								break
							case "left":
								await mouse.scrollLeft(amount)
								break
							case "right":
								await mouse.scrollRight(amount)
								break
							default:
								throw new Error(`Unsupported scroll direction: "${direction}"`)
						}
					})

					pushToolResult(`Scrolled ${direction.toLowerCase()} by ${amount}.`)
					return
				}

				case "get_screenshot": {
					await delay(1000)
					const cursor = await withActionTimeout("getting cursor position", () => mouse.getPosition())
					const logicalWidth = await withActionTimeout("reading display width", () => screen.width())
					const logicalHeight = await withActionTimeout("reading display height", () => screen.height())
					const image = await withActionTimeout("capturing a screenshot", () => grabScreen())
					const scale = getScaleToFit(image.getWidth(), image.getHeight())
					if (scale < 1) {
						image.resize(
							Math.floor(image.getWidth() * scale),
							Math.floor(image.getHeight() * scale),
						)
					}

					const imageWidth = image.getWidth()
					const imageHeight = image.getHeight()
					lastScreenshotSpaceByTask.set(task, {
						imageWidth,
						imageHeight,
						normalizedGrid: true,
					})
					drawNormalizedGridOverlay(image)
					const cursorX = Math.max(
						0,
						Math.min(imageWidth - 1, Math.round((cursor.x / logicalWidth) * imageWidth)),
					)
					const cursorY = Math.max(
						0,
						Math.min(imageHeight - 1, Math.round((cursor.y / logicalHeight) * imageHeight)),
					)
					const crosshairColor = 0xff00ffff
					const crosshairSize = 20

					for (let x = Math.max(0, cursorX - crosshairSize); x <= Math.min(imageWidth - 1, cursorX + crosshairSize); x++) {
						image.setPixelColor(crosshairColor, x, cursorY)
						if (cursorY > 0) image.setPixelColor(crosshairColor, x, cursorY - 1)
						if (cursorY < imageHeight - 1) image.setPixelColor(crosshairColor, x, cursorY + 1)
					}
					for (let y = Math.max(0, cursorY - crosshairSize); y <= Math.min(imageHeight - 1, cursorY + crosshairSize); y++) {
						image.setPixelColor(crosshairColor, cursorX, y)
						if (cursorX > 0) image.setPixelColor(crosshairColor, cursorX - 1, y)
						if (cursorX < imageWidth - 1) image.setPixelColor(crosshairColor, cursorX + 1, y)
					}

					const imageDataUrl = await (image as any).getBase64("image/png")
					pushToolResult(
						formatResponse.toolResult(
							`Screenshot captured with a normalized 0-1000 grid overlay. Use plain x,y grid coordinates such as 500,500 for the center. Explicit screenshot-space coordinates x,y@${imageWidth}x${imageHeight} are still supported. The magenta crosshair marks the current cursor position.`,
							[imageDataUrl],
						),
					)
					return
				}
			}
		} catch (error) {
			task.recordToolError("computer_action", error instanceof Error ? error.message : String(error))
			await handleError("executing computer action", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"computer_action">): Promise<void> {
		const partialMessage = describeAction({
			action: block.params.action as ComputerAction | undefined,
			coordinate: this.removeClosingTag("coordinate", block.params.coordinate, block.partial),
			text: this.removeClosingTag("text", block.params.text, block.partial),
		})
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => {})
	}
}

export const computerActionTool = new ComputerActionTool()
