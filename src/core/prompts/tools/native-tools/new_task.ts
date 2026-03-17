import { Tool } from "./converters"

const NEW_TASK_DESCRIPTION = "Create a new task in a specific mode with instructions and an optional checklist."

export const new_task: Tool = {
	name: "new_task",
	description: NEW_TASK_DESCRIPTION,
	params: {
		mode: "Slug of the mode to begin the new task in (e.g., code, debug, architect)",
		message: "Initial user instructions or context for the new task",
		todos: {
			type: ["string", "null"],
			description: "Optional initial todo list written as a markdown checklist; required when the workspace mandates todos",
		},
	},
}

export default new_task
