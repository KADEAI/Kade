import { Tool } from "./converters"

const FETCH_INSTRUCTIONS_DESCRIPTION = "Retrieve instructions for predefined tasks (e.g., 'create_mcp_server', 'create_mode')."

export const fetch_instructions: Tool = {
	name: "fetch_instructions",
	description: FETCH_INSTRUCTIONS_DESCRIPTION,
	params: {
		task: {
			type: "string",
			description: "Task identifier to fetch instructions for",
			enum: ["create_mcp_server", "create_mode"],
		},
	},
}

export default fetch_instructions
