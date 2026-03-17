import type { ToolName, ModeConfig } from "@roo-code/types"

import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS, DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { Mode, getModeConfig, isToolAllowedForMode, getGroupName } from "../../../shared/modes"

import { ToolArgs } from "./types"
import { getExecuteCommandDescription } from "./execute-command"
import { getReadFileDescription } from "./read-file"
import { getSimpleReadFileDescription } from "./simple-read-file"
import { getFetchInstructionsDescription } from "./fetch-instructions"
import { shouldUseSingleFileRead } from "@roo-code/types"
import { getWriteToFileDescription } from "./write-to-file"
import { getSearchFilesDescription } from "./search-files"
import { getListFilesDescription } from "./list-files"
import { getBrowserActionDescription } from "./browser-action"
import { getAttemptCompletionDescription } from "./attempt-completion"
import { getUseMcpToolDescription } from "./use-mcp-tool"
import { getAccessMcpResourceDescription } from "./access-mcp-resource"
import { getSwitchModeDescription } from "./switch-mode"
import { getNewTaskDescription } from "./new-task"
import { getCodebaseSearchDescription } from "./codebase-search"
import { getUpdateTodoListDescription } from "./update-todo-list"
import { getGenerateImageDescription } from "./generate-image"
import { getRunSubAgentDescription } from "./run-sub-agent"
import { getWebSearchDescription } from "./web-search"
import { getWebFetchDescription } from "./web-fetch"
import { getResearchWebDescription } from "./research-web"
import { getGlobDescription } from "./glob"
import { getFastContextDescription } from "./fast-context"
import { getRunSlashCommandDescription } from "./run-slash-command"
import { getDeleteFileDescription } from "./delete-file" // kade_change
import { CodeIndexManager } from "../../../services/code-index/manager"

// kade_change start: Morph fast apply
import { isFastApplyAvailable } from "../../tools/kilocode/editFileTool"
import { getEditFileDescription } from "./edit-file"
import { type ClineProviderState } from "../../webview/ClineProvider"
import { ManagedIndexer } from "../../../services/code-index/managed/ManagedIndexer"
// kade_change end

// Map of tool names to their description functions
const toolDescriptionMap: Record<string, (args: ToolArgs) => string | undefined> = {
	execute_command: (args) => getExecuteCommandDescription(args),
	read_file: (args) => {
		// Check if the current model should use the simplified read_file tool
		const modelId = args.settings?.modelId
		if (modelId && shouldUseSingleFileRead(modelId)) {
			return getSimpleReadFileDescription(args)
		}
		return getReadFileDescription(args)
	},
	fetch_instructions: (args) => getFetchInstructionsDescription(args.settings?.enableMcpServerCreation),
	write_to_file: (args) => getWriteToFileDescription(args),
	grep: (args) => getSearchFilesDescription(args),
	list_dir: (args) => getListFilesDescription(args),
	glob: (args) => getGlobDescription(args),
	browser_action: (args) => getBrowserActionDescription(args),
	attempt_completion: (args) => getAttemptCompletionDescription(args),
	use_mcp_tool: (args) => getUseMcpToolDescription(args),
	run_sub_agent: (args) => getRunSubAgentDescription(args),
	access_mcp_resource: (args) => getAccessMcpResourceDescription(args),
	codebase_search: (args) => getCodebaseSearchDescription(args),
	switch_mode: () => getSwitchModeDescription(),
	new_task: (args) => getNewTaskDescription(args),
	edit_file: (args) => {
		return `## edit_file
Description: Edit a file by replacing a specific block of text. This tool uses Old: and New: markers for precision.
Parameters:
- path: (required) Path to the file.
- edit: (required) One or more Old:/New: blocks specifying the exact text to find and the new text to replace it with.
Usage:
<edit_file>
<path>...</path>
<edit>
Old:
...
New:
...
</edit>
</edit_file>`
	}, // kade_change: Strategic Search/Replace
	delete_file: (args) => getDeleteFileDescription(args), // kade_change
	apply_diff: (args) =>
		args.diffStrategy ? args.diffStrategy.getToolDescription({ cwd: args.cwd, toolOptions: args.toolOptions }) : "",
	update_todo_list: (args) => getUpdateTodoListDescription(args),
	run_slash_command: () => getRunSlashCommandDescription(),
	generate_image: (args) => getGenerateImageDescription(args),
	web_search: (args) => getWebSearchDescription(args),
	web_fetch: (args) => getWebFetchDescription(args),
	research_web: (args) => getResearchWebDescription(args),
	fast_context: (args) => getFastContextDescription(args),
}

export function getToolDescriptionsForMode(
	mode: Mode,
	cwd: string,
	supportsComputerUse: boolean,
	codeIndexManager?: CodeIndexManager,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	mcpHub?: McpHub,
	customModes?: ModeConfig[],
	experiments?: Record<string, boolean>,
	partialReadsEnabled?: boolean,
	settings?: Record<string, any>,
	enableMcpServerCreation?: boolean,
	modelId?: string,
	clineProviderState?: ClineProviderState, // kade_change
	compact?: boolean,
): string {
	const config = getModeConfig(mode, customModes)
	const args: ToolArgs = {
		cwd,
		supportsComputerUse,
		diffStrategy,
		browserViewportSize,
		mcpHub,
		partialReadsEnabled,
		settings: {
			...settings,
			enableMcpServerCreation,
			modelId,
		},
		experiments,
		compact,
	}

	const tools = new Set<string>()

	// Add tools from mode's groups
	config.groups.forEach((groupEntry) => {
		const groupName = getGroupName(groupEntry)
		const toolGroup = TOOL_GROUPS[groupName]
		if (toolGroup) {
			toolGroup.tools.forEach((tool) => {
				if (
					isToolAllowedForMode(
						tool as ToolName,
						mode,
						customModes ?? [],
						undefined,
						undefined,
						experiments ?? {},
					)
				) {
					tools.add(tool)
				}
			})
		}
	})

	// Add always available tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	// Conditionally exclude codebase_search if feature is disabled or not configured
	// kade_change start
	// kade_change start
	// We now always include codebase_search because it uses the JIT engine which requires no index.
	// The original check for ManagedIndexer or codeIndexManager is no longer needed to gate the tool itself.
	// kade_change end

	// kade_change: Remove Morph Fast Apply logic, force Traditional Edit via edit_file
	tools.delete("edit") // Use edit_file instead
	tools.delete("apply_diff")

	// Conditionally exclude update_todo_list if disabled in settings
	if (settings?.todoListEnabled === false) {
		tools.delete("update_todo_list")
	}

	// Conditionally exclude generate_image if experiment is not enabled
	if (!experiments?.imageGeneration) {
		tools.delete("generate_image")
	}

	// Conditionally exclude run_slash_command if experiment is not enabled
	if (!experiments?.runSlashCommand) {
		tools.delete("run_slash_command")
	}

	// Conditionally include run_sub_agent if experiment is enabled and not disabled in settings
	if (experiments?.enableSubAgents && settings?.subAgentToolEnabled !== false) {
		tools.add("run_sub_agent")
	}

	// Map tool descriptions for allowed tools
	const descriptions = Array.from(tools).map((toolName) => {
		const descriptionFn = toolDescriptionMap[toolName]
		if (!descriptionFn) {
			return undefined
		}

		const description = descriptionFn({
			...args,
			toolOptions: undefined, // No tool options in group-based approach
		})

		return description
	})

	return `# Tools\n\n${descriptions.filter(Boolean).join("\n\n")}`
}

// Export individual description functions for backward compatibility
export {
	getExecuteCommandDescription,
	getReadFileDescription,
	getSimpleReadFileDescription,
	getFetchInstructionsDescription,
	getWriteToFileDescription,
	getSearchFilesDescription,
	getListFilesDescription,
	getBrowserActionDescription,
	getAttemptCompletionDescription,
	getUseMcpToolDescription,
	getAccessMcpResourceDescription,
	getSwitchModeDescription,
	getEditFileDescription, // kade_change: Morph fast apply
	getCodebaseSearchDescription,
	getRunSlashCommandDescription,
	getGenerateImageDescription,
	getResearchWebDescription,
	getRunSubAgentDescription,
}

// Export native tool definitions (JSON schema format for OpenAI-compatible APIs)
export { nativeTools } from "./native-tools"
