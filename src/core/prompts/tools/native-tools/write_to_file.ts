import { type Tool } from "./converters"

const WRITE_TO_FILE_DESCRIPTION = "Write content to a file (overwrites existing). Primarily for new files; prefer 'edit' for changes. Provide COMPLETE content without placeholders or line numbers."

export const write_to_file: Tool = {
	name: "write_to_file",
	description: WRITE_TO_FILE_DESCRIPTION,
	params: {
		path: "Path to the file to write, relative to the workspace",
		content: "Full contents that the file should contain with no omissions or line numbers",
	},
}

export default write_to_file
