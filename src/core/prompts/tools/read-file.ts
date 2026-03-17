// kade_change start
import { getSupportedBinaryFormats } from "../../../integrations/misc/extract-text"
import { SUPPORTED_IMAGE_FORMATS } from "../../tools/helpers/imageHelpers"
// kade_change end

import { ToolArgs } from "./types"

export function getReadFileDescription(args: ToolArgs): string {
  const maxConcurrentReads = args.settings?.maxConcurrentFileReads ?? 5
  const isMultipleReadsEnabled = maxConcurrentReads > 1
  const supportsImages = args.supportsComputerUse // kade_change: supportsComputerUse==supportsImages in kilo

  if (args.compact) {
    return `## read_file
Read contents of ${isMultipleReadsEnabled ? "up to 5 files" : "a file"}. The tool outputs line-numbered content.
<read_file><args><file><path>...</path>${args.partialReadsEnabled ? "<line_range>...</line_range>" : ""}</file></args></read_file>`
  }

  return `## read_file
Description: Request to read the contents of ${isMultipleReadsEnabled ? "one or more files" : "a file"}. The tool outputs line-numbered content (e.g. "1 | const x = 1") for easy reference when creating diffs or discussing code.${args.partialReadsEnabled ? " Use line ranges to efficiently read specific portions of large files." : ""} Supports text extraction from ${getSupportedBinaryFormats()
      .concat(supportsImages ? SUPPORTED_IMAGE_FORMATS : [])
      .join(" and ") /*kade_change*/
    } files, but may not handle other binary files properly.

${isMultipleReadsEnabled ? `**IMPORTANT: You can read a maximum of ${maxConcurrentReads} files in a single request.** If you need to read more files, use multiple sequential read_file requests.` : "**IMPORTANT: Multiple file reads are currently disabled. You can only read one file at a time.**"}

${args.partialReadsEnabled ? `By specifying line ranges, you can efficiently read specific portions of large files without loading the entire file into memory.` : ""}
Parameters:
- args: Contains one or more file elements, where each file contains:
  - path: (required) File path (relative to workspace directory ${args.cwd})
  ${args.partialReadsEnabled ? `- line_range: (optional) One or more line range elements in format "start-end" (1-based, inclusive)` : ""}

Usage:
<read_file>
<args>
  <file>
    <path>path/to/file</path>
    ${args.partialReadsEnabled ? `<line_range>start-end</line_range>` : ""}
  </file>
</args>
</read_file>

Examples:

1. Reading a single file:
<read_file>
<args>
  <file>
    <path>src/app.ts</path>
    ${args.partialReadsEnabled ? `<line_range>1-1000</line_range>` : ""}
  </file>
</args>
</read_file>

${isMultipleReadsEnabled ? `2. Reading multiple files (within the ${maxConcurrentReads}-file limit):` : ""}${isMultipleReadsEnabled
      ? `
<read_file>
<args>
  <file>
    <path>src/app.ts</path>
  </file>
  <file>
    <path>src/utils.ts</path>
  </file>
</args>
</read_file>`
      : ""
    }

${isMultipleReadsEnabled ? "3. " : "2. "}Reading an entire file:
<read_file>
<args>
  <file>
    <path>config.json</path>
  </file>
</args>
</read_file>


IMPORTANT:
- ${isMultipleReadsEnabled ? `Read related files together in a single operation (max ${maxConcurrentReads}) by wrapping them in <args>.` : "Read files sequentially."}
- ${args.partialReadsEnabled ? `Use line ranges for large files when possible.` : ""}
- Obtain necessary context before making changes.`
}
