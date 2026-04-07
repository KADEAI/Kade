import type { ModelInfo } from "../model.js"

export type ZedModelId = string

// Zed models are fetched dynamically from the authenticated account.
export const zedDefaultModelId: ZedModelId = ""

export const zedModels = {} as const satisfies Record<string, ModelInfo>
