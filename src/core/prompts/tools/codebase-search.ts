import { ToolArgs } from "./types"

export function getCodebaseSearchDescription(args: ToolArgs): string {
	return `## ask
Description: Find files most relevant to the search query using semantic search. Searches based on meaning rather than exact text matches. By default searches entire workspace. Reuse the user's exact wording unless there's a clear reason not to - their phrasing often helps semantic search. Queries MUST be in English (translate if needed).

Recommendation: Use this tool for exploring unfamiliar codebases or finding functionality when the file structure is unknown. It effectively locates code based on meaning. For specific file patterns, consider \`search_files\`.

Parameters:
- query: (required) The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory ${args.cwd}). Leave empty for entire workspace.

Usage:
<ask>
<query>Your natural language query here</query>
<path>Optional subdirectory path</path>
</ask>

Example: Searching for user authentication code
<ask>
<query>User login and password hashing</query>
<path>src/auth</path>
</ask>

Example: Searching entire workspace
<ask>
<query>database connection pooling</query>
<path></path>
</ask>
`
}
