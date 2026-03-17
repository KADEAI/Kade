import { Tool } from "./converters"

const EDIT_DESCRIPTION = "Apply multiple search-and-replace blocks to a file. Supports fuzzy matching. Use 'oldText' and 'newText' for each edit."

export const edit: Tool = {
	name: "edit",
	description: EDIT_DESCRIPTION,
	params: {
		path: "The path to the file to edit (relative to workspace).",
		edit: {
			type: "array",
			description: "Search/replace blocks. Example of multi-block edit:\n\n[\n  { \"oldText 10-12\": \"foo\", \"newText\": \"bar\" },\n  { \"oldText 20-25\": \"baz\", \"newText\": \"qux\" }\n]",
			items: {
				type: "object",
				properties: {
					oldText: {
						type: "string",
						description: "The exact code to find. Line numbers are REQUIRED. The line range goes after the oldText ",
					},
					newText: {
						type: "string",
						description: "The replacement code.",
					},
				},
				required: [],
			},
		},
	},
	required: ["path", "edit"],
}

export default edit
