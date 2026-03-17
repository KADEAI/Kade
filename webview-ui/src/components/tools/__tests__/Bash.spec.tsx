import React from "react"
import { act, render, screen, waitFor } from "@testing-library/react"

import { ExtensionStateContext, type ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { Bash } from "../Bash"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("Bash", () => {
	const renderBash = (ui: React.ReactElement, collapseCodeToolsByDefault = false) => {
		return render(
			<ExtensionStateContext.Provider
				value={{ collapseCodeToolsByDefault } as ExtensionStateContextType}>
				{ui}
			</ExtensionStateContext.Provider>,
		)
	}

	beforeEach(() => {
		vi.restoreAllMocks()
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: vi.fn().mockImplementation(() => ({
				matches: false,
				media: "",
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		})
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not auto-scroll terminal output when chat browsing released bottom pinning", async () => {
		const rafSpy = vi.spyOn(window, "requestAnimationFrame")
		const { rerender } = renderBash(
			<Bash command="npm test" output="line 1" isRunning allowOutputAutoScroll={false} />,
		)

		const output = screen.getByTestId("bash-output")
		Object.defineProperty(output, "scrollHeight", { configurable: true, value: 200 })
		Object.defineProperty(output, "clientHeight", { configurable: true, value: 100 })
		Object.defineProperty(output, "scrollTop", { configurable: true, writable: true, value: 100 })

		rerender(
			<ExtensionStateContext.Provider
				value={{ collapseCodeToolsByDefault: false } as ExtensionStateContextType}>
				<Bash
					command="npm test"
					output={"line 1\nline 2"}
					isRunning
					allowOutputAutoScroll={false}
				/>
			</ExtensionStateContext.Provider>,
		)

		await waitFor(() => {
			expect(rafSpy).not.toHaveBeenCalled()
			expect((output as HTMLDivElement).scrollTop).toBe(100)
		})
	})

	it("keeps auto-scrolling terminal output when chat is still pinned", async () => {
		const rafSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0)
				return 1
			})
		const { rerender } = renderBash(
			<Bash command="npm test" output="line 1" isRunning allowOutputAutoScroll />,
		)

		const output = screen.getByTestId("bash-output")
		Object.defineProperty(output, "scrollHeight", { configurable: true, value: 200 })
		Object.defineProperty(output, "clientHeight", { configurable: true, value: 100 })
		Object.defineProperty(output, "scrollTop", { configurable: true, writable: true, value: 100 })

		rerender(
			<ExtensionStateContext.Provider
				value={{ collapseCodeToolsByDefault: false } as ExtensionStateContextType}>
				<Bash
					command="npm test"
					output={"line 1\nline 2"}
					isRunning
					allowOutputAutoScroll
				/>
			</ExtensionStateContext.Provider>,
		)

		await waitFor(() => {
			expect(rafSpy).toHaveBeenCalled()
			expect((output as HTMLDivElement).scrollTop).toBe(200)
		})
	})

	it("waits before auto-collapsing after the command completes", async () => {
		vi.useFakeTimers()
		const { rerender } = renderBash(<Bash command="npm test" output="done" isRunning />)

		expect(screen.getByTestId("bash-output")).toBeInTheDocument()

		rerender(
			<ExtensionStateContext.Provider
				value={{ collapseCodeToolsByDefault: false } as ExtensionStateContextType}>
				<Bash command="npm test" output="done" isRunning={false} />
			</ExtensionStateContext.Provider>,
		)

		expect(screen.getByTestId("bash-output")).toBeInTheDocument()

		act(() => {
			vi.advanceTimersByTime(1400)
		})
		expect(screen.getByTestId("bash-output")).toBeInTheDocument()

		act(() => {
			vi.advanceTimersByTime(100)
		})

		expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument()
	})

	it("cancels the pending auto-collapse if the command starts running again", async () => {
		vi.useFakeTimers()
		const { rerender } = renderBash(<Bash command="npm test" output="line 1" isRunning />)

		rerender(
			<ExtensionStateContext.Provider
				value={{ collapseCodeToolsByDefault: false } as ExtensionStateContextType}>
				<Bash command="npm test" output="line 1" isRunning={false} />
			</ExtensionStateContext.Provider>,
		)
		act(() => {
			vi.advanceTimersByTime(1000)
		})

		rerender(
			<ExtensionStateContext.Provider
				value={{ collapseCodeToolsByDefault: false } as ExtensionStateContextType}>
				<Bash command="npm test" output="line 1\nline 2" isRunning />
			</ExtensionStateContext.Provider>,
		)
		act(() => {
			vi.advanceTimersByTime(1000)
		})

		expect(screen.getByTestId("bash-output")).toBeInTheDocument()
	})

	it("starts collapsed when the display setting is enabled and the command is idle", () => {
		renderBash(<Bash command="npm test" output="done" isRunning={false} />, true)

		expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument()
	})

	it("stays collapsed while running when the display setting is enabled", () => {
		renderBash(<Bash command="npm test" output="line 1" isRunning />, true)

		expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument()
	})
})
