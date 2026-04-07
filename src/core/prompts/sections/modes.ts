import * as vscode from "vscode"
import type { ModeConfig } from "@roo-code/types"
import { getAllModesWithPrompts } from "../../../shared/modes"
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext"

export async function getModesSection(
	context: vscode.ExtensionContext,
	currentModeSlug: string,
	roleDefinition: string,
	modelId?: string,
	toolProtocol?: string,
): Promise<string> {
	await ensureSettingsDirectoryExists(context)
	const allModes = await getAllModesWithPrompts(context)

	const currentMode = allModes.find((m) => m.slug === currentModeSlug) || allModes[0]

	let details = `====
# CURRENT MODE
- **Mode:** ${currentMode.name}
- **Model:** ${modelId || "Unknown"}
- **Persona:** ${roleDefinition}`
	details += ``
	return details
}
