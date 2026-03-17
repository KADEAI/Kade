import type { CustomModePrompts, ModeConfig } from "@roo-code/types"

import { addCustomInstructions } from "../core/prompts/sections/custom-instructions"
import { getModeBySlug, modes } from "./modes"

// Extension-only helper: kept out of shared/modes so browser bundles
// can consume mode metadata without pulling in Node-backed prompt logic.
export async function getFullModeDetails(
	modeSlug: string,
	customModes?: ModeConfig[],
	customModePrompts?: CustomModePrompts,
	options?: {
		cwd?: string
		globalCustomInstructions?: string
		language?: string
	},
): Promise<ModeConfig> {
	const baseMode = (getModeBySlug(modeSlug, customModes) || modes.find((mode) => mode.slug === modeSlug) || modes[0])!
	const promptComponent = customModePrompts?.[modeSlug]

	const baseCustomInstructions = promptComponent?.customInstructions || baseMode.customInstructions || ""
	const baseWhenToUse = promptComponent?.whenToUse || baseMode.whenToUse || ""
	const baseDescription = promptComponent?.description || baseMode.description || ""

	let fullCustomInstructions = baseCustomInstructions
	if (options?.cwd) {
		const customInstructionsOptions: Parameters<typeof addCustomInstructions>[4] = {}
		if (options.language !== undefined) {
			customInstructionsOptions.language = options.language
		}

		fullCustomInstructions = await addCustomInstructions(
			baseCustomInstructions,
			options.globalCustomInstructions || "",
			options.cwd,
			modeSlug,
			customInstructionsOptions,
		)
	}

	return {
		...baseMode,
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition,
		whenToUse: baseWhenToUse,
		description: baseDescription,
		customInstructions: fullCustomInstructions,
	}
}
