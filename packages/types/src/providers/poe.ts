// kilocode_change - new file
import type { ModelInfo } from "../model.js"

export const POE_BASE_URL = "https://api.poe.com"

export const poeDefaultModelId = "claude-3-5-sonnet-20241022"

export const poeDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	supportsNativeTools: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	description: "Claude 3.5 Sonnet via Poe",
}
