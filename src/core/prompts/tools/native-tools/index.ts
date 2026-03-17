import type OpenAI from "openai"
import accessMcpResource from "./access_mcp_resource"

import attemptCompletion from "./attempt_completion"
import browserAction from "./browser_action"
import codebaseSearch from "./codebase_search"
import executeCommand from "./execute_command"
import fetchInstructions from "./fetch_instructions"
import generateImage from "./generate_image"
import listDir from "./list_dir"
import newTask from "./new_task"
import { read_file } from "./read_file"
import runSlashCommand from "./run_slash_command"
import runSubAgent from "./run_sub_agent"
import edit from "./edit"
import grep from "./grep"
import glob from "./glob"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import writeToFile from "./write_to_file"

import deleteFile from "./kilocode/delete_file"
import editFile from "./kilocode/edit_file"
import { web_search } from "./web_search"
import { web_fetch } from "./web_fetch"
import research_web from "./research_web"
import { fast_context } from "./fast_context"
import { Tool, convertToOpenAI } from "./converters"


export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"

/**
 * Get native tools array, optionally customizing based on settings.
 */
export function getNativeTools(
	partialReadsEnabled: boolean = true,
	enableSubAgents: boolean = false,
): any[] {
	const tools: (Tool | OpenAI.Chat.ChatCompletionTool)[] = [
		// Core File Operations (Most Common)
		read_file,
		edit,
		writeToFile,

		// File Search & Discovery
		grep,
		codebaseSearch,
		fast_context,
		listDir,
		glob,

		// System & Command Tools
		executeCommand,
		runSlashCommand,

		// Task & Mode Tools
		switchMode,
		fetchInstructions,
		updateTodoList,

		// Browser & Web Tools
		browserAction,
		web_search,
		web_fetch,
		research_web,

		// MCP & Integrations
		accessMcpResource,
		generateImage,

		// Additional Edit Tools (kilocode)
		editFile, // kade_change
		// deleteFile, // kade_change: hidden
	]

	if (enableSubAgents) {
		tools.push(runSubAgent as any)
	}

	// We return the tools exactly as defined. 
	// No more OpenAI boilerplate wrappers.
	return tools
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools(true)
