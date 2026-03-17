import { Tool } from "./converters"

const ATTEMPT_COMPLETION_DESCRIPTION = "Signal task completion. Use ONLY after verifying all tool results. Formulate a final message without asking further questions."

export const attempt_completion: Tool = {
	name: "attempt_completion",
	description: ATTEMPT_COMPLETION_DESCRIPTION,
	params: {
		result: "Final result message to deliver to the user once the task is complete",
	},
}

export default attempt_completion
