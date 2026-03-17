import { Tool } from "./converters"

const FAST_CONTEXT_DESCRIPTION = "A powerful search tool that takes a natural language query and automatically runs multiple parallel grep and file read operations to find the most relevant code in the codebase. Returns exact file paths and line ranges with surrounding context."

export const fast_context: Tool = {
	name: "fast_context",
	description: FAST_CONTEXT_DESCRIPTION,
	params: {
		query: "A natural language description of what you're looking for. Be specific and descriptive.",
		path: {
			type: ["string", "null"],
			description: "Optional subdirectory (relative to the workspace) to limit the search scope",
		},
	},
}

export default fast_context
