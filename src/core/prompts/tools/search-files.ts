import { ToolArgs } from "./types"

export function getSearchFilesDescription(args: ToolArgs): string {
	if (args.compact) {
		return `## grep
Regex search across files. Uses Rust regex syntax.
<grep><path>...</path><query>...</query><file_pattern>...</file_pattern></grep>`
	}

	return `## grep
Description: Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.

Craft your regex patterns carefully to balance specificity and flexibility. By default this tool is code-first: it filters out common noise such as docs, locales, generated files, assets, lockfiles, and build output. Use this tool to find code patterns, TODO comments, function definitions, or any text-based information across the project. The results include surrounding context, so analyze the surrounding code to better understand the matches. Leverage this tool in combination with other tools for more comprehensive analysis - for example, use it to find specific code patterns, then use read_file to examine the full context of interesting matches.

Parameters:
- path: (required) The path of the directory to search in (relative to the current workspace directory ${args.cwd}). This directory will be recursively searched.
- query: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).
- include_all: (optional) Set to true when you intentionally want to include normally filtered noisy files like docs, locales, generated files, and assets.

Usage:
<grep>
<path>Directory path here</path>
<query>Your regex pattern here</query>
<file_pattern>file pattern here (optional)</file_pattern>
</grep>

Example: Searching for all .ts files in the current directory
<grep>
<path>.</path>
<query>.*</query>
<file_pattern>*.ts</file_pattern>
</grep>

Example: Searching for function definitions in JavaScript files
<grep>
<path>src</path>
<query>function\\s+\\w+</query>
<file_pattern>*.js</file_pattern>
</grep>`
}
