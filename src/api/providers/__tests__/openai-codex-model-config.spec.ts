import { describe, expect, it } from "vitest"

import { OpenAiCodexHandler } from "../openai-codex"

describe("OpenAiCodex model config", () => {
	it("does not exclude write from native tools", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.4" } as any)
		const model = handler.getModel()

		expect(model.info.excludedTools ?? []).not.toContain("write")
		expect(model.info.excludedTools ?? []).toContain("apply_diff")
	})
})
