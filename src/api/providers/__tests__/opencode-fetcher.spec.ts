import axios from "axios"
import { describe, expect, it, vi, beforeEach } from "vitest"

import { getOpenCodeModels } from "../fetchers/opencode"

vi.mock("axios")

const mockedAxios = axios as unknown as {
	get: ReturnType<typeof vi.fn>
}

describe("getOpenCodeModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("enriches the list endpoint with OpenCode pricing and model metadata", async () => {
		mockedAxios.get.mockResolvedValue({
			data: {
				object: "list",
				data: [
					{ id: "gpt-5.4", object: "model", created: 1, owned_by: "opencode" },
					{ id: "claude-sonnet-4-5", object: "model", created: 1, owned_by: "opencode" },
				],
			},
		})

		const models = await getOpenCodeModels()

		expect(mockedAxios.get).toHaveBeenCalledWith("https://opencode.ai/zen/v1/models")
		expect(models["gpt-5.4"]).toMatchObject({
			displayName: "GPT 5.4",
			inputPrice: 2.5,
			outputPrice: 15,
			cacheReadsPrice: 0.25,
			contextWindow: 400000,
			maxTokens: 128000,
			supportsImages: true,
		})
		expect(models["claude-sonnet-4-5"]).toMatchObject({
			displayName: "Claude Sonnet 4.5",
			inputPrice: 3,
			outputPrice: 15,
			cacheReadsPrice: 0.3,
			cacheWritesPrice: 3.75,
			contextWindow: 200000,
			supportsPromptCache: true,
		})
	})
})
