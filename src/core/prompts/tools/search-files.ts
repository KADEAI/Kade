import { ToolArgs } from "./types"

export function getSearchFilesDescription(args: ToolArgs): string {
	if (args.compact) {
		return `## grep
Fast text search across files. Use | for multi-query search.
<grep><path>...</path><query>...</query><file_pattern>...</file_pattern></grep>`
	}

	return `## grep
Description: Fast text search across files with context-rich results. Use it to locate code, strings, comments, symbols, or related terms across the project.

Keep it simple. For multiple queries, prefer one query string with | separators such as auth|login|session. The search is case-sensitive by default, treats simple identifier-like queries as whole-word searches, and filters common noise such as docs, locales, generated files, assets, lockfiles, and build output unless include_all is true. After you find candidate files, use read to inspect exact code.

Parameters:
- path: (optional) The path to search in (relative to the current workspace directory ${args.cwd}). Defaults to the current directory.
- query: (required) The text or pattern to search for. For multiple queries, prefer foo|bar|baz in one query string.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).
- include_all: (optional) Set to true when you intentionally want to include normally filtered noisy files like docs, locales, generated files, and assets.

Usage:
<grep>
<path>Directory path here (optional)</path>
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
