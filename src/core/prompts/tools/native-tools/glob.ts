import { Tool } from "./converters"

const GLOB_DESCRIPTION = "Find files using glob patterns (*, **, ?, [], {}). Ideal for discovering project structure or identifying file types."

export const glob: Tool = {
	name: "glob",
	description: GLOB_DESCRIPTION,
	params: {
		path: "Directory path to search in, relative to the workspace",
		pattern: "Glob pattern to match files (supports *, **, ?, [], {} patterns)",
	},
}

export default glob
