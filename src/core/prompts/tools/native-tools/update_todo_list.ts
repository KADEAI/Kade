import { Tool } from "./converters"

const UPDATE_TODO_LIST_DESCRIPTION = "Update the markdown checklist ([ ], [x], [-]). Provide the FULL list to overwrite previous state, OR use patch format with numbers (e.g., '1: completed', '2. [x]') for quick status updates. Trace progress for complex tasks."

export const update_todo_list: Tool = {
	name: "update_todo_list",
	description: UPDATE_TODO_LIST_DESCRIPTION,
	params: {
		todos: "Full markdown checklist in execution order, using [ ] for pending, [x] for completed, and [-] for in progress. OR use patch format with numbers (e.g., '1: completed', '2. [x]', '3: in progress') for quick status updates.",
	},
}

export default update_todo_list
