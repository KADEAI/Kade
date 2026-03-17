import { ToolArgs } from "./types"

export function getResearchWebDescription(args: ToolArgs): string {
    return `## research_web
Description: Performs deep web research by searching the web and then fetching and analyzing multiple relevant sources in parallel to provide a comprehensive synthesized report. Use this when you need to gather information from multiple websites at once to answer complex questions.
Parameters:
- query: (required) The search query to research.
- depth: (optional) The number of top search results to fetch and analyze (default is 3, max is 5).
Usage:
<research_web>
<query>latest best practices for React Server Components in 2025</query>
<depth>3</depth>
</research_web>`
}
