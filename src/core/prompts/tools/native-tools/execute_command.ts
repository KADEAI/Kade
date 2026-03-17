import { type Tool } from "./converters"

const EXECUTE_COMMAND_DESCRIPTION = "Execute a CLI command. Use relative paths and standard shell syntax. Avoid creating scripts when a direct command suffices."

export const execute_command: Tool = {
	name: "execute_command",
	description: EXECUTE_COMMAND_DESCRIPTION,
	params: {
		command: "Shell command to execute",
		cwd: {
			type: ["string", "null"],
			description: "Optional working directory for the command, relative or absolute",
		},
	},
}

export default execute_command
