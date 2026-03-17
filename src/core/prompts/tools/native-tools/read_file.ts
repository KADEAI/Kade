import { Tool } from "./converters"

const READ_FILE_DESCRIPTION = "Read file(s) from the workspace. Supports line ranges and multiple files. Examples: 'index.html', 'src/app.ts 1-50', 'foo.js, bar.js, baz.js 10-20'."

export const read_file: Tool = {
	name: "read_file",
	description: "Read file(s) from the workspace. Supports line ranges and multiple files. Examples: 'index.html', 'src/app.ts 1-50', 'foo.js, bar.js, baz.js 10-20'.",
	params: {
		path: "File path or paths (relative to workspace). Single file: 'index.html'. With range: 'app.ts 1-50'. Multiple: 'a.js, b.js, c.js 10-20'. NOTE: Parameter name is 'path', NOT 'file_path'.",
		start_line: {
			type: "number",
			description: "Start line number to read (1-based). Optional. Only used for single file reads."
		},
		end_line: {
			type: "number",
			description: "End line number to read (1-based). Optional. Only used for single file reads."
		}
	},
	required: ["path"],
}
