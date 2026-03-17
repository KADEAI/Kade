import { z } from "zod"

import type { Keys, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

const kilocodeExperimentIds = ["morphFastApply", "speechToText", "enableSubAgents", "yoloMode"] as const // kade_change
export const experimentIds = [
	"powerSteering",
	"multiFileApplyDiff",
	"preventFocusDisruption",
	"imageGeneration",
	"runSlashCommand",
	"multipleNativeToolCalls",
] as const

export const experimentIdsSchema = z.enum([...experimentIds, ...kilocodeExperimentIds])

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	morphFastApply: z.boolean().optional(), // kade_change
	speechToText: z.boolean().optional(), // kade_change
	enableSubAgents: z.boolean().optional(), // kade_change
	yoloMode: z.boolean().optional(), // kade_change
	powerSteering: z.boolean().optional(),
	multiFileApplyDiff: z.boolean().optional(),
	preventFocusDisruption: z.boolean().optional(),
	imageGeneration: z.boolean().optional(),
	runSlashCommand: z.boolean().optional(),
	multipleNativeToolCalls: z.boolean().optional(),
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>
