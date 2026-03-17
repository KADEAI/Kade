import { Tool } from "./converters"

const LIST_DIR_DESCRIPTION = "List files and directories. Set 'recursive: true' for subdirectories."

export const list_dir: Tool = {
	name: "list_dir",
	description: LIST_DIR_DESCRIPTION,
	params: {
		path: "Directory path to inspect (relative to workspace). Defaults to current directory.",
		recursive: {
			type: "boolean",
			description: "Set true for full recursive listing, false for top-level only",
		},
	},
	required: [],
}

export default list_dir
