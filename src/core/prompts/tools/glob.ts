import { ToolArgs } from "./types"

export function getGlobDescription(args: ToolArgs): string {
    if (args.compact) {
        return `## glob
Find files using glob patterns.
<glob><path>...</path><pattern>...</pattern></glob>`
    }

    return `## glob
Description: Request to find files using glob patterns. This tool is useful for finding files that match a specific naming pattern (e.g., all TypeScript files, or files in a specific directory structure) without needing regex.

Parameters:
- path: (required) The path of the directory to search in (relative to the current workspace directory ${args.cwd})
- pattern: (required) The glob pattern to match files against (e.g., "**/*.ts", "src/**/*.test.js")

Usage:
<glob>
<path>Directory path here</path>
<pattern>Glob pattern here</pattern>
</glob>

Example: Finding all TypeScript files in the src directory
<glob>
<path>src</path>
<pattern>**/*.ts</pattern>
</glob>`
}
