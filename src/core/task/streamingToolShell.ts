import { resolveToolAlias } from "../../shared/tool-aliases"

export function buildStreamingToolShell(toolCallId: string, toolName: string): Record<string, unknown> | undefined {
	const resolvedToolName = resolveToolAlias(toolName)
	const effectiveToolName =
		resolvedToolName === "edit_file" || toolName === "edit_file"
			? "edit"
			: resolvedToolName === "write_to_file" || toolName === "write_to_file"
				? "write"
				: resolvedToolName

	if (effectiveToolName === "write") {
		return {
			tool: "newFileCreated",
			path: "",
			content: "",
			isOutsideWorkspace: false,
			isProtected: false,
			id: toolCallId,
		}
	}

	if (effectiveToolName === "edit") {
		return {
			tool: "appliedDiff",
			path: "",
			diff: "",
			isOutsideWorkspace: false,
			edits: [],
			id: toolCallId,
		}
	}

	return undefined
}
