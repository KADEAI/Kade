import type { AssertEqual, Equals, Keys, Values, ExperimentId, Experiments } from "@roo-code/types"

export const EXPERIMENT_IDS = {
	MORPH_FAST_APPLY: "morphFastApply", // kade_change
	SPEECH_TO_TEXT: "speechToText", // kade_change
	YOLO_MODE: "yoloMode", // kade_change - REMOVED
	MULTI_FILE_APPLY_DIFF: "multiFileApplyDiff",
	POWER_STEERING: "powerSteering",
	PREVENT_FOCUS_DISRUPTION: "preventFocusDisruption",
	IMAGE_GENERATION: "imageGeneration",
	RUN_SLASH_COMMAND: "runSlashCommand",
	MULTIPLE_NATIVE_TOOL_CALLS: "multipleNativeToolCalls",
} as const

// type _AssertExperimentIds = AssertEqual<Equals<ExperimentId, Values<typeof EXPERIMENT_IDS>>>

type ExperimentKey = Keys<typeof EXPERIMENT_IDS>

interface ExperimentConfig {
	enabled: boolean
}

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	MORPH_FAST_APPLY: { enabled: false }, // kade_change
	SPEECH_TO_TEXT: { enabled: false }, // kade_change
	YOLO_MODE: { enabled: false }, // kade_change - REMOVED (hidden from UI)
	MULTI_FILE_APPLY_DIFF: { enabled: true },
	POWER_STEERING: { enabled: false },
	PREVENT_FOCUS_DISRUPTION: { enabled: true },
	IMAGE_GENERATION: { enabled: false },
	RUN_SLASH_COMMAND: { enabled: false },
	MULTIPLE_NATIVE_TOOL_CALLS: { enabled: false },
}

export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.enabled,
	]),
) as Record<ExperimentId, boolean>

export const experiments = {
	get: (id: ExperimentKey): ExperimentConfig | undefined => experimentConfigsMap[id],
	isEnabled: (experimentsConfig: Partial<Experiments>, id: ExperimentId) =>
		experimentsConfig[id] ?? experimentDefault[id],
} as const
