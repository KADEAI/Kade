import type { ClineSayTool } from "../../shared/ExtensionMessage"

export function isWriteToolAction(tool: ClineSayTool): boolean {
	return ["editedExistingFile", "appliedDiff", "newFileCreated", "generateImage", "mkdir", "moveFile"].includes(tool.tool)
}

export function isReadOnlyToolAction(tool: ClineSayTool): boolean {
	return [
		"readFile",
		"listFiles",
		"listFilesTopLevel",
		"listFilesRecursive",
		"searchFiles",
		"grep",
		"glob",
		"listDirTopLevel",
		"listDirRecursive",
		"codebaseSearch",
		"fastContext",
		"runSlashCommand",
	].includes(tool.tool)
}
