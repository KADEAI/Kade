import { Tool } from "./converters"

const RUN_SLASH_COMMAND_DESCRIPTION = "Execute a slash command (e.g., 'init', 'test') for predefined templates."

export const run_slash_command: Tool = {
	name: "run_slash_command",
	description: RUN_SLASH_COMMAND_DESCRIPTION,
	params: {
		command: "Name of the slash command to run (e.g., init, test, deploy)",
		args: {
			type: ["string", "null"],
			description: "Optional additional context or arguments for the command",
		},
	},
}

export default run_slash_command
