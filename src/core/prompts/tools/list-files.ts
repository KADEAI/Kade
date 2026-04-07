import { ToolArgs } from "./types"

export function getListFilesDescription(args: ToolArgs): string {
	if (args.compact) {
		return `## list
List files and directories.
<list><path>...</path><recursive>true/false</recursive></list>`
	}

	return `## list
Description: Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.
Parameters:
- path: (required) The path of the directory to list contents for (relative to the current workspace directory ${args.cwd})
- recursive: (optional) Whether to list files recursively. Use true for recursive listing, false or omit for top-level only.
Usage:
<list>
<path>Directory path here</path>
<recursive>true or false (optional)</recursive>
</list>

Example: Requesting to list all files in the current directory
<list>
<path>.</path>
<recursive>false</recursive>
</list>`
}
