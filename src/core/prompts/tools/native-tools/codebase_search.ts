import { Tool } from "./converters"

const CODEBASE_SEARCH_DESCRIPTION = "Semantic search to find files relevant to a query. Use this FIRST for any new exploration. Queries must be in English."

export const codebase_search: Tool = {
	name: "codebase_search",
	description: CODEBASE_SEARCH_DESCRIPTION,
	params: {
		query: "Meaning-based search query describing the information you need",
		path: {
			type: ["string", "null"],
			description: "Optional subdirectory (relative to the workspace) to limit the search scope",
		},
	},
}

export default codebase_search
