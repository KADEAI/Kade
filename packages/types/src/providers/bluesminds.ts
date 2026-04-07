import type { ModelInfo } from "../model.js"

export const bluesmindsDefaultModelId = "deepseek-chat"

export const bluesmindsDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 128_000,
	supportsImages: false,
	supportsPromptCache: true,
	supportsNativeTools: false,
	defaultToolProtocol: "unified",
	inputPrice: 0,
	outputPrice: 0,
	description: "DeepSeek Chat via Bluesminds",
}
