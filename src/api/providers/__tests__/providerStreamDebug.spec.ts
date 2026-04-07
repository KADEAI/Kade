import { describe, expect, it, vi } from "vitest"

import { ProviderStreamDebugCollector } from "../providerStreamDebug"

describe("ProviderStreamDebugCollector", () => {
	it("logs empty native turns when no text or tool call was emitted", () => {
		const collector = new ProviderStreamDebugCollector({
			providerName: "KiloCode",
			modelId: "xiaomi/mimo-v2-pro:free",
			toolProtocol: "json",
		})
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		collector.recordReasoning("Need to call glob")
		collector.recordUsage(100, 0)

		expect(
			collector.logEmptyNativeTurn({
				outputTokens: 0,
			}),
		).toBe(true)
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("[PROVIDER_STREAM_DEBUG] empty_native_turn"),
		)

		errorSpy.mockRestore()
	})

	it("does not log once text was emitted", () => {
		const collector = new ProviderStreamDebugCollector({
			providerName: "Antigravity",
			modelId: "gemini-3-flash",
			toolProtocol: "json",
		})
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		collector.recordText("done")
		collector.recordUsage(100, 10)

		expect(collector.logEmptyNativeTurn()).toBe(false)
		expect(errorSpy).not.toHaveBeenCalled()

		errorSpy.mockRestore()
	})
})
