import { Tool } from "../converters"

export const delete_file: Tool = {
	name: "delete_file",
	description:
		"Delete a file or directory from the workspace. This action is irreversible and requires user approval. For directories, all contained files are validated against protection rules and .kadeignore before deletion. Cannot delete write-protected files or paths outside the workspace.",
	params: {
		path: "Path to the file or directory to delete, relative to the workspace",
	},
}

export default delete_file
