import { describe, expect, it } from "vitest"

import { AntigravityHandler } from "../antigravity"
import { GeminiCliHandler } from "../gemini-cli"

describe("native tool support flags", () => {
	it("keeps native tools enabled for Gemini CLI models", () => {
		const handler = new GeminiCliHandler({
			apiModelId: "gemini-2.5-flash",
		} as any)

		expect(handler.getModel().info.supportsNativeTools).toBe(true)
	})

	it("keeps native tools enabled for Antigravity Gemini models", () => {
		const handler = new AntigravityHandler({
			apiModelId: "gemini-3.1-pro-low",
		} as any)

		expect(handler.getModel().info.supportsNativeTools).toBe(true)
	})
})
