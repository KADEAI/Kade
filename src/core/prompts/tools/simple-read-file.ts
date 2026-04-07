import { ToolArgs } from "./types"

/**
 * Generate a simplified read tool description for models that only support single file reads
 * Uses the simpler format: <read><path>file/path.ext</path></read>
 */
export function getSimpleReadFileDescription(args: ToolArgs): string {
	return `## read
Description: Request to read the contents of a file. The tool outputs line-numbered content (e.g. "1 | const x = 1") for easy reference when discussing code.

Parameters:
- path: (required) File path (relative to workspace directory ${args.cwd})

Usage:
<read>
<path>path/to/file</path>
</read>

Examples:

1. Reading a TypeScript file:
<read>
<path>src/app.ts</path>
</read>

2. Reading a configuration file:
<read>
<path>config.json</path>
</read>

3. Reading a markdown file:
<read>
<path>README.md</path>
</read>`
}
