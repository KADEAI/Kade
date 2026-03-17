import { Tool } from "./converters"

const GREP_DESCRIPTION = "Regex search across files in a directory. Supports literal strings, whole words, multiple queries, and a stricter code-first default filter. Use 'include_all' to search docs, locales, generated files, and other noisy artifacts too."

export const grep: Tool = {
	name: "grep",
	description: "Regex search across files.",
	params: {
		path: "Directory to search (relative to workspace). Defaults to current directory.",
		query: "Search pattern(s); string or array.",
		include: "Optional: Glob pattern to filter files (e.g. '*.ts').",
		include_all: {
			type: "boolean",
			description: "If true, include docs, locales, generated files, assets, lockfiles, and other normally filtered noise."
		},
		exclude: "Optional: Glob pattern to exclude files.",
		case_sensitive: {
			type: "boolean",
			description: "If true, search is case sensitive. Default is false (case insensitive)."
		},

	},
	required: ["query"],
}

export default grep
