import { ToolArgs } from "./types"

export function getFastContextDescription(args: ToolArgs): string {
	return `## fast_context
Description: A powerful search tool that takes a natural language query and automatically runs multiple parallel grep and file read operations to find the most relevant code in the codebase. It generates search patterns from your query, runs them in parallel via ripgrep, scores and ranks the results, then reads the top-matching files to extract relevant code sections with exact line numbers.

Use this tool when you need deep, precise context about a specific topic, feature, or concept across the codebase. It is more thorough than a single grep — it runs multiple search patterns and reads the top-matching files automatically.

Parameters:
- query: (required) A natural language description of what you're looking for. Be specific and descriptive.
- path: (optional) Limit search to a specific subdirectory (relative to the current workspace directory ${args.cwd}).

Usage:
<fast_context>
<query>Your natural language query here</query>
<path>Optional subdirectory path</path>
</fast_context>

Example: Finding authentication logic
<fast_context>
<query>How does the authentication middleware validate JWT tokens</query>
</fast_context>

Example: Scoped search
<fast_context>
<query>How are tool results rendered in the chat UI</query>
<path>webview-ui/src/components</path>
</fast_context>
`
}
