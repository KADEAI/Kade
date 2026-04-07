import { describe, expect, it, vi } from "vitest"

import { surfaceToolFailureMessage } from "../toolFailureFallback"

describe("surfaceToolFailureMessage", () => {
	it("emits a visible non-interactive error row to break out of partial tool UI", async () => {
		const say = vi.fn().mockResolvedValue(undefined)

		await surfaceToolFailureMessage({ say }, "Tool validation failed")

		expect(say).toHaveBeenCalledWith(
			"error",
			"Tool validation failed",
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})
})
