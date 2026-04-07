import { ToolArgs } from "./types"

export function getWriteToFileDescription(args: ToolArgs): string {
  if (args.compact) {
    return `## write
Write complete content to a file. Used for creation or full rewrites. Skip line numbers.
<write><path>...</path><content>...</content></write>`
  }

  return `## write
Description: Request to write content to a file. This tool is primarily used for **creating new files** or for scenarios where a **complete rewrite of an existing file is intentionally required**. If the file exists, it will be overwritten. If it doesn't exist, it will be created. This tool will automatically create any directories needed to write the file.

**Important:** You should prefer using other editing tools over write when making changes to existing files, since write is slower and cannot handle large files. Use write primarily for new file creation.

When using this tool, use it directly with the desired content. You do not need to display the content before using the tool. ALWAYS provide the COMPLETE file content in your response. This is NON-NEGOTIABLE. Partial updates or placeholders like '// rest of code unchanged' are STRICTLY FORBIDDEN. You MUST include ALL parts of the file, even if they haven't been modified. Failure to do so will result in incomplete or broken code.

When creating a new project, organize all new files within a dedicated project directory unless the user specifies otherwise. Structure the project logically, adhering to best practices for the specific type of project being created.

Parameters:
- path: (required) The path of the file to write to (relative to the current workspace directory ${args.cwd})
- content: (required) The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. Do NOT include line numbers in the content.

Usage:
<write>
<path>File path here</path>
<content>
Your file content here
</content>
</write>

Example: Writing a configuration file
<write>
<path>frontend-config.json</path>
<content>
{
  "apiEndpoint": "https://api.example.com",
  "theme": {
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d",
    "fontFamily": "Arial, sans-serif"
  },
  "features": {
    "darkMode": true,
    "notifications": true,
    "analytics": false
  },
  "version": "1.0.0"
}
</content>
</write>`
}
