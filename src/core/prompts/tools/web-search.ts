import { ToolArgs } from "./types"

export function getWebSearchDescription(args: ToolArgs): string {
    return `## web
Description: Search the web for current information. Returns titles, URLs, and descriptions. Use this when you need information that is not in your training data or the current codebase.
Parameters:
- query: (required) The search query string.
- allowed_domains: (optional) List of domains to restrict search to (comma-separated).
- blocked_domains: (optional) List of domains to exclude (comma-separated).
Usage:
<web>
<query>your search query</query>
</web>`
}
