import type { Mock } from "vitest"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"

import {
	getVisibleProviderOrLog,
	getSidebarProviderOrLog,
	getVisibleTabProviderOrLog,
} from "../registerCommands"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("vscode", () => ({
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	window: {
		createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
	},
}))

vi.mock("../../core/webview/ClineProvider")

describe("getVisibleProviderOrLog", () => {
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			hide: vi.fn(),
			name: "mock",
			replace: vi.fn(),
			show: vi.fn(),
			dispose: vi.fn(),
		}
		vi.clearAllMocks()
	})

	it("returns the visible provider if found", () => {
		const mockProvider = {} as ClineProvider
		;(ClineProvider.getVisibleInstance as Mock).mockReturnValue(mockProvider)

		const result = getVisibleProviderOrLog(mockOutputChannel)

		expect(result).toBe(mockProvider)
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalled()
	})

	it("logs and returns undefined if no provider found", () => {
		;(ClineProvider.getVisibleInstance as Mock).mockReturnValue(undefined)

		const result = getVisibleProviderOrLog(mockOutputChannel)

		expect(result).toBeUndefined()
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("Cannot find any visible Kilo Code instances.")
	})
})

describe("provider routing helpers", () => {
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			hide: vi.fn(),
			name: "mock",
			replace: vi.fn(),
			show: vi.fn(),
			dispose: vi.fn(),
		}
		vi.clearAllMocks()
	})

	it("returns the sidebar provider if found", () => {
		const mockProvider = {} as ClineProvider
		;(ClineProvider.getSidebarInstance as Mock).mockReturnValue(mockProvider)

		const result = getSidebarProviderOrLog(mockOutputChannel)

		expect(result).toBe(mockProvider)
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalled()
	})

	it("logs and returns undefined if no sidebar provider found", () => {
		;(ClineProvider.getSidebarInstance as Mock).mockReturnValue(undefined)

		const result = getSidebarProviderOrLog(mockOutputChannel)

		expect(result).toBeUndefined()
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("Cannot find a visible Kilo Code sidebar instance.")
	})

	it("returns the visible tab provider if found", () => {
		const mockProvider = {} as ClineProvider
		;(ClineProvider.getVisibleTabInstance as Mock).mockReturnValue(mockProvider)

		const result = getVisibleTabProviderOrLog(mockOutputChannel)

		expect(result).toBe(mockProvider)
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalled()
	})

	it("logs and returns undefined if no visible tab provider found", () => {
		;(ClineProvider.getVisibleTabInstance as Mock).mockReturnValue(undefined)

		const result = getVisibleTabProviderOrLog(mockOutputChannel)

		expect(result).toBeUndefined()
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("Cannot find a visible Kilo Code editor tab instance.")
	})
})
