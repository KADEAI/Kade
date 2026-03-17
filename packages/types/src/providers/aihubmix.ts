import type { ModelInfo } from "../model.js"

export const aihubmixDefaultModelId = "claude-3-5-sonnet-20241022"

export const aihubmixDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	supportsNativeTools: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	description: "Claude 3.5 Sonnet via AIHubMix",
}
