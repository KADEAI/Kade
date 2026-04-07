import { describe, expect, it } from "vitest"

import { getAihubmixInferenceBaseUrl, getAihubmixModelsUrl } from "../aihubmix-url"

describe("aihubmix url normalization", () => {
	it("normalizes runtime requests to the OpenAI-compatible /v1 base URL", () => {
		expect(getAihubmixInferenceBaseUrl()).toBe("https://aihubmix.com/v1")
		expect(getAihubmixInferenceBaseUrl("https://aihubmix.com")).toBe("https://aihubmix.com/v1")
		expect(getAihubmixInferenceBaseUrl("https://aihubmix.com/api/v1")).toBe("https://aihubmix.com/v1")
		expect(getAihubmixInferenceBaseUrl("https://aihubmix.com/v1")).toBe("https://aihubmix.com/v1")
		expect(getAihubmixInferenceBaseUrl("https://aihubmix.com/v1/chat/completions")).toBe(
			"https://aihubmix.com/v1",
		)
	})

	it("normalizes model discovery to the documented /api/v1/models endpoint", () => {
		expect(getAihubmixModelsUrl()).toBe("https://aihubmix.com/api/v1/models")
		expect(getAihubmixModelsUrl("https://aihubmix.com")).toBe("https://aihubmix.com/api/v1/models")
		expect(getAihubmixModelsUrl("https://aihubmix.com/api/v1")).toBe("https://aihubmix.com/api/v1/models")
		expect(getAihubmixModelsUrl("https://aihubmix.com/v1")).toBe("https://aihubmix.com/api/v1/models")
		expect(getAihubmixModelsUrl("https://aihubmix.com/v1/chat/completions")).toBe(
			"https://aihubmix.com/api/v1/models",
		)
	})
})
