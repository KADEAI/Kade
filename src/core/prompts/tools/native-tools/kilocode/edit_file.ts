import { Tool } from "../converters"

export const edit_file: Tool = {
	name: "edit_file",
	description:
		"Use this tool to make an edit to a file. A less intelligent apply model will read your request, so be clear about the change while minimizing unchanged code. Specify each edit sequentially and replace omitted sections with // ... existing code ... placeholders. Provide enough surrounding context to avoid ambiguity, always use the placeholder when skipping existing content, show before-and-after context when deleting, and gather all edits for the file in a single request.",
	params: {
		target_file: "Full path of the file to modify",
		instructions: "Single first-person sentence summarizing the edit to guide the apply model",
		code_edit: "Only the edited lines using // ... existing code ... wherever unchanged content is omitted",
	},
}

export default edit_file
