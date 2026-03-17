import { Tool } from "./converters"

const SWITCH_MODE_DESCRIPTION = "Switch to a different mode (e.g., 'code', 'ask', 'architect'). Requires user approval."

export const switch_mode: Tool = {
	name: "switch_mode",
	description: SWITCH_MODE_DESCRIPTION,
	params: {
		mode_slug: "Slug of the mode to switch to (e.g., code, ask, architect)",
		reason: "Explanation for why the mode switch is needed",
	},
}

export default switch_mode
