import { Tool } from "./converters"

const SEARCH_AND_REPLACE_DESCRIPTION = "Surgical edits to a file. Provide exact 'search' and 'replace' pairs. Content must match exactly (whitespace/indentation included)."

export const search_and_replace: Tool = {
	name: "search_and_replace",
	description: SEARCH_AND_REPLACE_DESCRIPTION,
	params: {
		path: "The path of the file to modify, relative to the current workspace directory.",
		operations: {
			type: "array",
			description: "Array of search and replace operations to perform on the file.",
			items: {
				type: "object",
				properties: {
					search: {
						type: "string",
						description: "The exact text to find in the file. Must match exactly, including whitespace.",
					},
					replace: {
						type: "string",
						description: "The text to replace the search text with.",
					},
				},
				required: ["search", "replace"],
			},
		},
	},
}

export default search_and_replace
