import cloneDeep from "clone-deep"
import { serializeError } from "serialize-error"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ToolName, ClineAsk, ToolProgressStatus } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import type { ToolParamName, ToolResponse, ToolUse, McpToolUse } from "../../shared/tools"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { AskIgnoredError } from "../task/AskIgnoredError"

import { fetchInstructionsTool } from "../tools/FetchInstructionsTool"
import { listDirTool } from "../tools/ListFilesTool"
import { mkdirTool } from "../tools/MkdirTool"
import { readFileTool } from "../tools/ReadFileTool"
import { getSimpleReadFileToolDescription, simpleReadFileTool } from "../tools/simpleReadFileTool"
import { type ToolProtocol, isNativeProtocol, shouldUseSingleFileRead, TOOL_PROTOCOL } from "@roo-code/types"
import { writeToFileTool } from "../tools/WriteToFileTool"
import { editTool } from "../tools/EditTool"
import { grepTool } from "../tools/SearchFilesTool"
import { globTool } from "../tools/GlobTool"
import { browserActionTool } from "../tools/BrowserActionTool"
import { executeCommandTool } from "../tools/ExecuteCommandTool"
import { useMcpToolTool } from "../tools/UseMcpToolTool"
import { accessMcpResourceTool } from "../tools/accessMcpResourceTool"
import { switchModeTool } from "../tools/SwitchModeTool"
import { attemptCompletionTool, AttemptCompletionCallbacks } from "../tools/AttemptCompletionTool"
import { newTaskTool } from "../tools/NewTaskTool"
import { moveFileTool } from "../tools/MoveFileTool"

import { updateTodoListTool } from "../tools/UpdateTodoListTool"
import { runSlashCommandTool } from "../tools/RunSlashCommandTool"
import { generateImageTool } from "../tools/GenerateImageTool"
import { runSubAgentTool } from "../tools/RunSubAgentTool"

import { formatResponse } from "../prompts/responses"
import { validateToolUse } from "../tools/validateToolUse"
import { Task } from "../task/Task"
import { codebaseSearchTool } from "../tools/CodebaseSearchTool"
import { experiments, EXPERIMENT_IDS } from "../../shared/experiments"

import { yieldPromise } from "../kilocode"
import { evaluateGatekeeperApproval } from "./kilocode/gatekeeper"
import { editFileTool, isFastApplyAvailable } from "../tools/kilocode/editFileTool"
import { deleteFileTool } from "../tools/kilocode/deleteFileTool"
import { newRuleTool } from "../tools/kilocode/newRuleTool"
import { reportBugTool } from "../tools/kilocode/reportBugTool"
import { condenseTool } from "../tools/kilocode/condenseTool"
import { captureAskApproval } from "./kilocode/captureAskApprovalEvent"
import { webSearchTool } from "../tools/WebSearchTool"
import { webFetchTool } from "../tools/FetchTool"
import { researchWebTool } from "../tools/ResearchWebTool"
import { fastContextTool } from "../tools/FastContextTool"


/**
 * Processes and presents assistant message content to the user interface.
 *
 * This function is the core message handling system that:
 * - Sequentially processes content blocks from the assistant's response.
 * - Displays text content to the user.
 * - Executes tool use requests with appropriate user approval.
 * - Manages the flow of conversation by determining when to proceed to the next content block.
 * - Coordinates file system checkpointing for modified files.
 * - Controls the conversation state to determine when to continue to the next request.
 *
 * The function uses a locking mechanism to prevent concurrent execution and handles
 * partial content blocks during streaming. It's designed to work with the streaming
 * API response pattern, where content arrives incrementally and needs to be processed
 * as it becomes available.
 */

export async function presentAssistantMessage(cline: Task) {
	if (cline.abort) {
		throw new Error(`[Task#presentAssistantMessage] task ${cline.taskId}.${cline.instanceId} aborted`)
	}

	if (cline.presentAssistantMessageLocked) {
		cline.presentAssistantMessageHasPendingUpdates = true
		return
	}

	cline.presentAssistantMessageLocked = true

	try {
		while (true) {
			cline.presentAssistantMessageHasPendingUpdates = false

			// High-frequency logging removed for performance during streaming

			if (cline.currentStreamingContentIndex >= cline.assistantMessageContent.length) {
				// This may happen if the last content block was completed before
				// streaming could finish. If streaming is finished, and we're out of
				// bounds then this means we already  presented/executed the last
				// content block and are ready to continue to next request.
				if (cline.didCompleteReadingStream) {
					cline.userMessageContentReady = true
				}
				return
			}

			let block: any
	let wasPartialAtStart = false
	try {
		// kade_change: avoid cloneDeep for performance during streaming
		block = cline.assistantMessageContent[cline.currentStreamingContentIndex]
		wasPartialAtStart = block?.partial || false


		// kade_change: Generate stable ID for XML tools that lack one
		// Use existing toolUseId from XML parser if available, otherwise generate xml_ prefixed ID
		if (block && block.type === "tool_use" && !block.id) {
			if ((block as any).toolUseId) {
				// Use the xml_ prefixed ID from XML parser
				block.id = (block as any).toolUseId
			} else {
				// Generate xml_ prefixed ID for EditHistoryService (won't be added to API history)
				block.id = `xml_${cline.taskId}_${cline.currentStreamingContentIndex}`
			}
		}
	} catch (error) {
		console.error(`ERROR cloning block:`, error)
		console.error(
			`Block content:`,
			JSON.stringify(cline.assistantMessageContent[cline.currentStreamingContentIndex], null, 2),
		)
		return
	}

	switch (block.type) {
		case "mcp_tool_use": {
			// Handle native MCP tool calls (from mcp_serverName_toolName dynamic tools)
			// These are converted to the same execution path as use_mcp_tool but preserve
			// their original name in API history
			const mcpBlock = block as McpToolUse

			// Determine protocol from the tool call ID prefix (same logic as tool_use case)
			const mcpToolCallId = mcpBlock.id
			let mcpToolProtocol: ToolProtocol = TOOL_PROTOCOL.MARKDOWN
			if (mcpToolCallId) {
				if (mcpToolCallId.startsWith("unified_")) {
					mcpToolProtocol = "unified" as any
				} else if (mcpToolCallId.startsWith("xml_")) {
					mcpToolProtocol = TOOL_PROTOCOL.MARKDOWN
				}
			}
			const isUnifiedOrXmlMcp = (mcpToolProtocol as string) === "unified" || mcpToolProtocol === TOOL_PROTOCOL.MARKDOWN

			if (cline.didRejectTool) {
				const errorMessage = !mcpBlock.partial
					? `Skipping MCP tool ${mcpBlock.name} due to user rejecting a previous tool.`
					: `MCP tool ${mcpBlock.name} was interrupted and not executed due to user rejecting a previous tool.`

				if (mcpToolCallId && !isUnifiedOrXmlMcp) {
					// For native protocol, we must send a tool_result for every tool_use to avoid API errors
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: mcpToolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				}
				break
			}

			if (cline.didAlreadyUseTool) {
				const errorMessage = `MCP tool [${mcpBlock.name}] was not executed because a tool has already been used in this message. Only one tool may be used per message.`

				if (mcpToolCallId && !isUnifiedOrXmlMcp) {
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: mcpToolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				}
				break
			}

			// Track if we've already pushed a tool result
			let hasToolResult = false
			const toolCallId = mcpToolCallId
			const toolProtocol = mcpToolProtocol

			const pushToolResult = (content: ToolResponse) => {
				if (hasToolResult) {
					console.warn(
						`[presentAssistantMessage] Skipping duplicate tool_result for mcp_tool_use: ${toolCallId}`,
					)
					return
				}

				if (toolProtocol === TOOL_PROTOCOL.MARKDOWN) {
					// For native protocol, only allow ONE tool_result per tool call
					let resultContent: string
					let imageBlocks: Anthropic.ImageBlockParam[] = []

					if (typeof content === "string") {
						resultContent = content || "(tool did not return anything)"
					} else {
						const textBlocks = content.filter((item) => item.type === "text")
						imageBlocks = content.filter((item) => item.type === "image") as Anthropic.ImageBlockParam[]
						resultContent =
							textBlocks.map((item) => (item as Anthropic.TextBlockParam).text).join("\n") ||
							"(tool did not return anything)"
					}

					if (toolCallId) {
						cline.userMessageContent.push({
							type: "tool_result",
							tool_use_id: toolCallId,
							content: resultContent,
						} as Anthropic.ToolResultBlockParam)

						if (imageBlocks.length > 0) {
							cline.userMessageContent.push(...imageBlocks)
						}
					}
				} else {
					// For unified/XML protocol, use text-based results (no tool_result blocks)
					const resultHeader = `[mcp_tool: ${mcpBlock.serverName}/${mcpBlock.toolName}]`
					let resultBody = ""
					if (typeof content === "string") {
						resultBody = content || "(tool did not return anything)"
					} else {
						resultBody =
							content
								.filter((item) => item.type === "text")
								.map((item) => (item as Anthropic.TextBlockParam).text)
								.join("\n\n") || "(tool did not return anything)"
					}
					const fullResult = `${resultHeader}\n${resultBody}`

					const lastIndex = cline.userMessageContent.length - 1
					if (lastIndex >= 0 && cline.userMessageContent[lastIndex].type === "text") {
						const lastBlock = cline.userMessageContent[lastIndex] as Anthropic.TextBlockParam
						lastBlock.text += `\n\n${fullResult}`
						if (!(lastBlock as any)._toolUseIds) {
							(lastBlock as any)._toolUseIds = (lastBlock as any)._toolUseId ? [(lastBlock as any)._toolUseId] : []
						}
						if (toolCallId) {
							if (!(lastBlock as any)._toolUseIds.includes(toolCallId)) {
								(lastBlock as any)._toolUseIds.push(toolCallId)
							}
							; (lastBlock as any)._toolUseId = toolCallId
						}
					} else {
						cline.userMessageContent.push({
							type: "text",
							text: fullResult,
							_toolUseId: toolCallId,
							_toolUseIds: toolCallId ? [toolCallId] : []
						} as any)
					}
				}

				hasToolResult = true
				if (!isUnifiedOrXmlMcp) {
					cline.didAlreadyUseTool = true
				}
			}

			const toolDescription = () => `[mcp_tool: ${mcpBlock.serverName}/${mcpBlock.toolName}]`

			const askApproval = async (
				type: ClineAsk,
				partialMessage?: string,
				progressStatus?: ToolProgressStatus,
				isProtected?: boolean,
			) => {
				const { response, text, images } = await cline.ask(
					type,
					partialMessage,
					false,
					progressStatus,
					isProtected || false,
				)

				if (response !== "yesButtonClicked") {
					if (text) {
						await cline.say("user_feedback", text, images)
						pushToolResult(
							formatResponse.toolResult(
								formatResponse.toolDeniedWithFeedback(text, toolProtocol),
								images,
							),
						)
					} else {
						pushToolResult(formatResponse.toolDenied(toolProtocol))
					}
					cline.didRejectTool = true
					return false
				}

				if (text) {
					await cline.say("user_feedback", text, images)
					pushToolResult(
						formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text, toolProtocol), images),
					)
				}

				return true
			}

            const handleError = async (action: string, error: Error) => {
                // Silently ignore AskIgnoredError - this is an internal control flow
                // signal, not an actual error. It occurs when a newer ask supersedes an older one.
                if (error instanceof AskIgnoredError) {
                    return
                }
                const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
                // Error is already displayed inline via ToolError component in the tool result
                // No need to create a separate error message block
                pushToolResult(formatResponse.toolError(errorString, toolProtocol))
            }

			if (!mcpBlock.partial) {
				cline.recordToolUsage("use_mcp_tool") // Record as use_mcp_tool for analytics
				TelemetryService.instance.captureToolUsage(cline.taskId, "use_mcp_tool", toolProtocol)
			}

			// Resolve sanitized server name back to original server name
			// The serverName from parsing is sanitized (e.g., "my_server" from "my server")
			// We need the original name to find the actual MCP connection
			const mcpHub = cline.providerRef.deref()?.getMcpHub()
			let resolvedServerName = mcpBlock.serverName
			if (mcpHub) {
				const originalName = mcpHub.findServerNameBySanitizedName(mcpBlock.serverName)
				if (originalName) {
					resolvedServerName = originalName
				}
			}

			// Execute the MCP tool using the same handler as use_mcp_tool
			// Create a synthetic ToolUse block that the useMcpToolTool can handle
			const syntheticToolUse: ToolUse<"use_mcp_tool"> = {
				type: "tool_use",
				id: mcpBlock.id,
				name: "use_mcp_tool",
				params: {
					server_name: resolvedServerName,
					tool_name: mcpBlock.toolName,
					arguments: JSON.stringify(mcpBlock.arguments),
				},
				partial: mcpBlock.partial,
				nativeArgs: {
					server_name: resolvedServerName,
					tool_name: mcpBlock.toolName,
					arguments: mcpBlock.arguments,
				},
			}

			await useMcpToolTool.handle(cline, syntheticToolUse, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag: (tag, text) => text || "",
				toolProtocol,
			})
			break
		}
		case "text": {
			if (cline.didRejectTool) {
				break
			}

			let content = block.content

			if (content) {
				// Have to do this for partial and complete since sending
				// content in thinking tags to markdown renderer will
				// automatically be removed.
				// Remove thinking tags and environment details.
				// For performance, we only do this when the content is likely to contain these tags.
				if (content.includes("<")) {
					content = content.replace(/<thinking>\s?/g, "")
					content = content.replace(/\s?<\/thinking>/g, "")
					content = content.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, "")
					content = content.replace(/## Environment Context[\s\S]*?(?=\n## |$)/g, "")
				}

				// Remove partial XML tag at the very end of the content (for
				// tool use and thinking tags), Prevents scrollview from
				// jumping when tags are automatically removed.
				const lastOpenBracketIndex = content.lastIndexOf("<")

				if (lastOpenBracketIndex !== -1) {
					const possibleTag = content.slice(lastOpenBracketIndex)

					// Check if there's a '>' after the last '<' (i.e., if the
					// tag is complete) (complete thinking and tool tags will
					// have been removed by now.)
					const hasCloseBracket = possibleTag.includes(">")

					if (!hasCloseBracket) {
						// Extract the potential tag name.
						let tagContent: string

						if (possibleTag.startsWith("</")) {
							tagContent = possibleTag.slice(2).trim()
						} else {
							tagContent = possibleTag.slice(1).trim()
						}

						// Check if tagContent is likely an incomplete tag name
						// (letters and underscores only).
						const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)

						// Preemptively remove < or </ to keep from these
						// artifacts showing up in chat (also handles closing
						// thinking tags).
						const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"

						// If the tag is incomplete and at the end, remove it
						// from the content.
						if (isOpeningOrClosing || isLikelyTagName) {
							content = content.slice(0, lastOpenBracketIndex).trim()
						}
					}
				}

				// Strip leaked Unified tool-call remnants from chat text.
				// This is a final UI safeguard in case parser streaming produced plain-text artifacts.
				content = content.replace(/^\s*<<<\s*(?:tool:|tool\s+)?[a-zA-Z_][\w-]*(?:\([^)]*)?\s*$/gm, "")
				content = content.replace(/^\s*>>>\s*$/gm, "")
				content = content.trim()
			}

			// PERF: Skip say() for empty content after stripping — avoids a full
			// addToClineMessages + updateClineMessage cycle for nothing visible.
			if (!content && block.partial) {
				break
			}

			await cline.say("text", content, undefined, block.partial)
			break
		}
		case "tool_use": {
			// kade_change: Skip attempt_completion tools during streaming since they're handled separately
			if (block.name === "attempt_completion" && block.partial) {
				console.log("[presentAssistantMessage] Skipping attempt_completion during streaming (handled by AgentLoop)")
				break
			}

			// kade_change: Only fetch state and save checkpoint for the final execution, not for streaming updates
			let state: any
			let mode: any
			let customModes: any
			let stateExperiments: any
			let apiConfiguration: any

			if (!block.partial) {
				state = await cline.providerRef.deref()?.getState()
				mode = state?.mode
				customModes = state?.customModes
				stateExperiments = state?.experiments
				apiConfiguration = state?.apiConfiguration
				await checkpointSaveAndMark(cline)
			}

			// kade_change start
			// Fast Apply + native tool aliases compatibility:
			if (
				!block.partial &&
				isFastApplyAvailable(state as any) &&
				block.originalName === "edit_file" &&
				block.name === "edit"
			) {
				block.name = "edit_file"
				block.originalName = undefined
			}
			// kade_change end

			const toolDescription = (): string => {
				const toolName = block.originalName || block.name
				const getPath = () => block.params.path || block.params.file_path || block.params.target_file || ""

				switch (block.name) {
					case "execute_command":
						return `[${toolName} for '${block.params.command}'${block.params.cwd ? ` in '${block.params.cwd}'` : ""
							}]`
					case "read_file":
						// Check if this model should use the simplified description
						const modelId = cline.api.getModel().id
						if (shouldUseSingleFileRead(modelId)) {
							return getSimpleReadFileToolDescription(toolName, block.params)
						} else {
							// Prefer native typed args when available; fall back to legacy params
							// Check if nativeArgs exists (native protocol)
							if (block.nativeArgs) {
								return readFileTool.getReadFileToolDescription(toolName, block.nativeArgs)
							}
							return readFileTool.getReadFileToolDescription(toolName, block.params)
						}
					case "fetch_instructions":
						return `[${toolName} for '${block.params.task}']`
					case "write_to_file":
						return `[${toolName} for '${getPath()}']`
					case "search_files":
					case "grep":
						return `[${toolName} for '${block.params.query || block.params.regex}'${getPath() ? ` in '${getPath()}'` : ""
							}${block.params.file_pattern ? ` (pattern: '${block.params.file_pattern}')` : ""}]`
					// kade_change start
					case "edit_file":
						return `[${toolName} for '${getPath()}']`
					case "delete_file":
						return `[${toolName} for '${getPath()}']`
					// kade_change end
					case "edit":
						return `[${toolName} for '${getPath()}']`
					case "list_files":
					case "list_dir":
						return `[${toolName} for '${getPath()}']`
					case "mkdir":
						return `[${toolName} for '${getPath()}']`
					case "glob":
						return `[${toolName} for '${block.params.pattern}'${getPath() ? ` in '${getPath()}'` : ""}]`
					case "move_file":
						return `[${toolName} from '${block.params.source}' to '${block.params.destination}']`
					case "browser_action":
						return `[${toolName} for '${block.params.action}']`
					case "use_mcp_tool":
						return `[${toolName} for '${block.params.server_name}']`
					case "access_mcp_resource":
						return `[${toolName} for '${block.params.server_name}']`
					case "attempt_completion":
						return `[${toolName}]`
					case "switch_mode":
						return `[${toolName} to '${block.params.mode_slug}'${block.params.reason ? ` because: ${block.params.reason}` : ""
							}]`
					case "codebase_search": // Add case for the new tool
						return `[${toolName} for '${block.params.query}']`
					case "fast_context":
						return `[${toolName} for '${block.params.query}']`
					case "research_web":
						return `[${toolName} for '${block.params.query}']`
					case "update_todo_list":
						return `[${toolName}]`
					case "new_task": {
						const mode = block.params.mode ?? defaultModeSlug
						const message = block.params.message ?? "(no message)"
						const modeName = getModeBySlug(mode, customModes)?.name ?? mode
						return `[${toolName} in ${modeName} mode: '${message}']`
					}
					// kade_change start
					case "new_rule":
						return `[${toolName} for '${getPath()}']`
					case "report_bug":
						return `[${toolName}]`
					case "condense":
						return `[${toolName}]`
					// kade_change end
					case "run_slash_command":
						return `[${toolName} for '${block.params.command}'${block.params.args ? ` with args: ${block.params.args}` : ""
							}]`
					case "generate_image":
						return `[${toolName} for '${getPath()}']`
					default:
						return `[${toolName}]`
				}
			}

			if (cline.didRejectTool) {
				// Ignore any tool content after user has rejected tool once.
				// For native protocol, we must send a tool_result for every tool_use to avoid API errors
				const toolCallId = block.id
				const errorMessage = !block.partial
					? `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`
					: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`

				if (toolCallId) {
					// Native protocol: MUST send tool_result for every tool_use
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				} else {
					// XML protocol: send as consolidated text
					const lastIndex = cline.userMessageContent.length - 1
					if (lastIndex >= 0 && cline.userMessageContent[lastIndex].type === "text") {
						const lastBlock = cline.userMessageContent[lastIndex] as Anthropic.TextBlockParam
						lastBlock.text += `\n\n${errorMessage}`
					} else {
						cline.userMessageContent.push({
							type: "text",
							text: errorMessage,
						})
					}
				}

				break
			}

			if (cline.didAlreadyUseTool) {
				// Ignore any content after a tool has already been used.
				// For native protocol, we must send a tool_result for every tool_use to avoid API errors
				const toolCallId = block.id
				const errorMessage = `Tool [${block.name}] was not executed because a tool has already been used in this message. Only one tool may be used per message. You must assess the first tool's result before proceeding to use the next tool.`

				if (toolCallId) {
					// Native protocol: MUST send tool_result for every tool_use
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				} else {
					// XML protocol: send as consolidated text
					const lastIndex = cline.userMessageContent.length - 1
					if (lastIndex >= 0 && cline.userMessageContent[lastIndex].type === "text") {
						const lastBlock = cline.userMessageContent[lastIndex] as Anthropic.TextBlockParam
						lastBlock.text += `\n\n${errorMessage}`
					} else {
						cline.userMessageContent.push({
							type: "text",
							text: errorMessage,
						})
					}
				}

				break
			}

			// Track if we've already pushed a tool result for this tool call (native protocol only)
			let hasToolResult = false

			// Determine protocol by checking if this tool call has an ID.
			// Native protocol tool calls ALWAYS have an ID (set when parsed from tool_call chunks).
			// XML protocol tool calls now have synthetic IDs with xml_ prefix (for EditHistoryService).
			// Unified protocol tool calls have IDs with unified_ prefix.
			// kade_change: Handle xml_ prefix and toolUseId field
			const toolCallId = (block as any).id || (block as any).toolUseId
			let toolProtocol: ToolProtocol = TOOL_PROTOCOL.MARKDOWN
			if (toolCallId) {
				if (toolCallId.startsWith("unified_")) {
					toolProtocol = "unified" as any
				} else if (toolCallId.startsWith("xml_")) {
					// XML parser generated ID - keep XML protocol but use ID for EditHistoryService
					toolProtocol = TOOL_PROTOCOL.MARKDOWN
				} else {
					// Native protocol - real API-generated ID
					toolProtocol = TOOL_PROTOCOL.MARKDOWN
				}
			}

			// Multiple native tool calls feature is on hold - always disabled
			// Previously resolved from experiments.isEnabled(..., EXPERIMENT_IDS.MULTIPLE_NATIVE_TOOL_CALLS)
			const isMultipleNativeToolCallsEnabled = false

			const pushToolResult = (content: ToolResponse) => {
				// kade_change: Removed [STDOUT] prefix for a cleaner look
				if (typeof content === "string") {
					content = content
				} else if (Array.isArray(content)) {
					content = content.map((block) => {
						if (block.type === "text") {
							return { ...block, text: block.text }
						}
						return block
					})
				}

				if (toolProtocol === TOOL_PROTOCOL.MARKDOWN) {
					// For native protocol, only allow ONE tool_result per tool call
					if (hasToolResult) {
						console.warn(
							`[presentAssistantMessage] Skipping duplicate tool_result for tool_use_id: ${toolCallId}`,
						)
						return
					}

					// For native protocol, tool_result content must be a string
					// Images are added as separate blocks in the user message
					let resultContent: string
					let imageBlocks: Anthropic.ImageBlockParam[] = []

					if (typeof content === "string") {
						resultContent = content || "(tool did not return anything)"
					} else {
						// Separate text and image blocks
						const textBlocks = content.filter((item) => item.type === "text")
						imageBlocks = content.filter((item) => item.type === "image") as Anthropic.ImageBlockParam[]

						// Convert text blocks to string for tool_result
						resultContent =
							textBlocks.map((item) => (item as Anthropic.TextBlockParam).text).join("\n") ||
							"(tool did not return anything)"
					}

					// Add tool_result with text content only
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: resultContent,
					} as Anthropic.ToolResultBlockParam)

					// Add image blocks separately after tool_result
					if (imageBlocks.length > 0) {
						cline.userMessageContent.push(...imageBlocks)
					}

					hasToolResult = true
				} else {
					// For XML and Unified protocol, add as a single consolidated text block
					const resultHeader = `${toolDescription()}`
					let resultBody = ""
					if (typeof content === "string") {
						resultBody = content || "(tool did not return anything)"
					} else {
						resultBody =
							content
								.filter((item) => item.type === "text")
								.map((item) => (item as Anthropic.TextBlockParam).text)
								.join("\n\n") || "(tool did not return anything)"
					}
					const fullResult = `${resultHeader}\n${resultBody}`

					// Check if we can append to the last text block to keep things consolidated
					const lastIndex = cline.userMessageContent.length - 1
					if (lastIndex >= 0 && cline.userMessageContent[lastIndex].type === "text") {
						const lastBlock = cline.userMessageContent[lastIndex] as Anthropic.TextBlockParam
						lastBlock.text += `\n\n${fullResult}`
						// kade_change: Use an array of tool IDs to track ALL tools that contributed to this block.
						// This fixes the issue where multi-file reads only update the last file's context.
						if (!(lastBlock as any)._toolUseIds) {
							// Migrate any existing single ID to the new array format
							(lastBlock as any)._toolUseIds = (lastBlock as any)._toolUseId ? [(lastBlock as any)._toolUseId] : []
						}
						if (toolCallId) {
							if (!(lastBlock as any)._toolUseIds.includes(toolCallId)) {
								(lastBlock as any)._toolUseIds.push(toolCallId)
							}
							// Keep _toolUseId for backward compatibility (set to the last one)
							; (lastBlock as any)._toolUseId = toolCallId
						}
					} else {
						// kade_change: Initialize with array format for new blocks
						cline.userMessageContent.push({
							type: "text",
							text: fullResult,
							_toolUseId: toolCallId,
							_toolUseIds: toolCallId ? [toolCallId] : []
						} as any)
					}
				}
				// For XML protocol: Only one tool per message is allowed
				// For native protocol with experimental flag enabled: Multiple tools can be executed in sequence
				// For native protocol with experimental flag disabled: Single tool per message (default safe behavior)
				// kade_change start
				// For XML and Unified protocols: Multiple sequential tools are allowed per message.
				// For native protocol with experimental flag disabled: Single tool per message (default safe behavior)
                // For MARKDOWN and UNIFIED protocols: Multiple sequential tools are allowed per message
                // Do not set didAlreadyUseTool = true to allow multiple tools
				// kade_change end
				// If toolProtocol is NATIVE and isMultipleNativeToolCallsEnabled is true,
				// allow multiple tool calls in sequence (don't set didAlreadyUseTool)
			}

			const askApproval = async (
				type: ClineAsk,
				partialMessage?: string,
				progressStatus?: ToolProgressStatus,
				isProtected?: boolean,
			) => {
				// kade_change start: YOLO mode with AI gatekeeper
				const state = await cline.providerRef.deref()?.getState()
				if (cline.yoloMode || state?.yoloMode) {
					// If gatekeeper is configured, use it to evaluate the approval
					const approved = await evaluateGatekeeperApproval(cline, block.name, block.params)
					if (!approved) {
						// Gatekeeper denied the action
						pushToolResult(formatResponse.toolDenied())
						cline.didRejectTool = true
						captureAskApproval(block.name, false)
						return false
					}
					captureAskApproval(block.name, true)
					return true
				}
				// kade_change end

				const { response, text, images } = await cline.ask(
					type,
					partialMessage,
					false,
					progressStatus,
					isProtected || false,
				)

				if (response !== "yesButtonClicked") {
					// Handle both messageResponse and noButtonClicked with text.
					if (text) {
						await cline.say("user_feedback", text, images)
						pushToolResult(
							formatResponse.toolResult(
								formatResponse.toolDeniedWithFeedback(text, toolProtocol),
								images,
							),
						)
					} else {
						pushToolResult(formatResponse.toolDenied(toolProtocol))
					}
					cline.didRejectTool = true
					captureAskApproval(block.name, false) // kade_change
					return false
				}

				// Handle yesButtonClicked with text.
				if (text) {
					await cline.say("user_feedback", text, images)
					pushToolResult(
						formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text, toolProtocol), images),
					)
				}

				captureAskApproval(block.name, true) // kade_change
				return true
			}

			const askFinishSubTaskApproval = async () => {
				// Ask the user to approve this task has completed, and he has
				// reviewed it, and we can declare task is finished and return
				// control to the parent task to continue running the rest of
				// the sub-tasks.
				const toolMessage = JSON.stringify({ tool: "finishTask" })
				return await askApproval("tool", toolMessage)
			}

			const handleError = async (action: string, error: Error) => {
				// Silently ignore AskIgnoredError - this is an internal control flow
                // signal, not an actual error. It occurs when a newer ask supersedes an older one.
                if (error instanceof AskIgnoredError) {
                    return
                }
                const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
                // Error is already displayed inline via ToolError component in the tool result
                // No need to create a separate error message block
                pushToolResult(formatResponse.toolError(errorString, toolProtocol))
            }

			// If block is partial, remove partial closing tag so its not
			// presented to user.
			const removeClosingTag = (tag: ToolParamName, text?: string): string => {
				if (!block.partial) {
					return text || ""
				}

				if (!text) {
					return ""
				}

				// This regex dynamically constructs a pattern to match the
				// closing tag:
				// - Optionally matches whitespace before the tag.
				// - Matches '<' or '</' optionally followed by any subset of
				//   characters from the tag name.
				const tagRegex = new RegExp(
					`\\s?<\/?${tag
						.split("")
						.map((char) => `(?:${char})?`)
						.join("")}$`,
					"g",
				)

				return text.replace(tagRegex, "")
			}

			// Keep browser open during an active session so other tools can run.
			if (!block.partial) {
				try {
					const messages = cline.clineMessages || []
					const hasStarted = messages.some((m: any) => m.say === "browser_action_result")
					let isClosed = false
					for (let i = messages.length - 1; i >= 0; i--) {
						const m = messages[i]
						if (m.say === "browser_action") {
							try {
								const act = JSON.parse(m.text || "{}")
								isClosed = act.action === "close"
							} catch { }
							break
						}
					}
					const sessionActive = hasStarted && !isClosed
					// Only auto-close when no active browser session is present, and this isn't a browser_action
					if (!sessionActive && block.name !== "browser_action") {
						await cline.browserSession.closeBrowser()
					}
				} catch {
					// On any unexpected error, fall back to conservative behavior
					if (block.name !== "browser_action") {
						await cline.browserSession.closeBrowser()
					}
				}
			}

			if (!block.partial) {
				cline.recordToolUsage(block.name)
				TelemetryService.instance.captureToolUsage(cline.taskId, block.name, toolProtocol)
			}

			// Validate tool use before execution - ONLY for complete (non-partial) blocks.
			// Validating partial blocks would cause validation errors to be thrown repeatedly
			// during streaming, pushing multiple tool_results for the same tool_use_id and
			// potentially causing the stream to appear frozen.
			if (!block.partial) {
				const modelInfo = cline.api.getModel()
				// Resolve aliases in includedTools before validation
				// e.g., "edit_file" should resolve to "apply_diff"
				const rawIncludedTools = modelInfo?.info?.includedTools
				const { resolveToolAlias } = await import("../prompts/tools/filter-tools-for-mode")
				const includedTools = rawIncludedTools?.map((tool) => resolveToolAlias(tool))

				try {
					validateToolUse(
						block.name as ToolName,
						mode ?? defaultModeSlug,
						customModes ?? [],
						{ apply_diff: cline.diffEnabled },
						block.params,
						stateExperiments,
						includedTools,
					)
				} catch (error) {
					cline.consecutiveMistakeCount++
					// For validation errors (unknown tool, tool not allowed for mode), we need to:
					// 1. Send a tool_result with the error (required for native protocol)
					// 2. NOT set didAlreadyUseTool = true (the tool was never executed, just failed validation)
					// This prevents the stream from being interrupted with "Response interrupted by tool use result"
					// which would cause the extension to appear to hang
					const errorContent = formatResponse.toolError(error.message, toolProtocol)
					if (toolProtocol === TOOL_PROTOCOL.MARKDOWN && toolCallId) {
						// For native protocol, push tool_result directly without setting didAlreadyUseTool
						cline.userMessageContent.push({
							type: "tool_result",
							tool_use_id: toolCallId,
							content: typeof errorContent === "string" ? errorContent : "(validation error)",
							is_error: true,
						} as Anthropic.ToolResultBlockParam)
					} else {
						// For XML protocol, use the standard pushToolResult
						pushToolResult(errorContent)
					}
					break
				}
			}

			// Check for identical consecutive tool calls.
			if (!block.partial) {
				// Use the detector to check for repetition, passing the ToolUse
				// block directly.
				const repetitionCheck = cline.toolRepetitionDetector.check(block)

				// If execution is not allowed, notify user and break.
				if (!repetitionCheck.allowExecution && repetitionCheck.askUser) {
					// Handle repetition similar to mistake_limit_reached pattern.
					const { response, text, images } = await cline.ask(
						repetitionCheck.askUser.messageKey as ClineAsk,
						repetitionCheck.askUser.messageDetail.replace("{toolName}", block.name),
					)

					if (response === "messageResponse") {
						// Add user feedback to userContent.
						cline.userMessageContent.push(
							{
								type: "text" as const,
								text: `Tool repetition limit reached. User feedback: ${text}`,
							},
							...formatResponse.imageBlocks(images),
						)

						// Add user feedback to chat.
						await cline.say("user_feedback", text, images)

						// Track tool repetition in telemetry.
						TelemetryService.instance.captureConsecutiveMistakeError(cline.taskId)
					}

					// Return tool result message about the repetition
					pushToolResult(
						formatResponse.toolError(
							`Tool call repetition limit reached for ${block.name}. Please try a different approach.`,
							toolProtocol,
						),
					)
					break
				}
			}

			// await checkpointSaveAndMark(cline) // kade_change: moved out of switch
			switch (block.name) {
				case "write_to_file":
					// FAST-PATH: Skip handle() for partial blocks - AgentLoop handles streaming
					if (block.partial) {
						break
					}
					// await checkpointSaveAndMark(cline) // kade_change
					await writeToFileTool.handle(cline, block as ToolUse<"write_to_file">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change: use computed toolCallId for XML/Native/Unified
					})
					break
				case "update_todo_list":
					await updateTodoListTool.handle(cline, block as ToolUse<"update_todo_list">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change: use computed toolCallId
					})
					break
				case "edit":
					// FAST-PATH: Skip handle() for partial blocks - AgentLoop handles streaming
					if (block.partial) {
						break
					}
					// await checkpointSaveAndMark(cline) // kade_change
					if (toolProtocol === TOOL_PROTOCOL.MARKDOWN || (toolProtocol as string) === "unified") {
						// For native and unified protocol, handle the tool normally with toolCallId
						await editTool.handle(cline, block as ToolUse<"edit">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
							toolCallId, // kade_change: use computed toolCallId
						})
					} else {
						// For XML protocol, handle the tool normally without toolCallId
						await editTool.handle(cline, block as ToolUse<"edit">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
							toolCallId,
						})
					}
					break
				// kade_change start: Morph fast apply
				case "edit_file":
				case "delete_file":
				case "new_rule":
				case "report_bug":
				case "condense":
					if (block.partial) {
						break
					}
					if (block.name === "edit_file") {
						await editTool.handle(cline, block as unknown as ToolUse<"edit">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
							toolCallId, // kade_change: use computed toolCallId
						})
					} else if (block.name === "delete_file") {
						await deleteFileTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					} else if (block.name === "new_rule") {
						await newRuleTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					} else if (block.name === "report_bug") {
						await reportBugTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					} else if (block.name === "condense") {
						await condenseTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					}
					break
				// kade_change end
				case "read_file":
					// FAST-PATH: Skip handle() for partial blocks - AgentLoop handles streaming
					if (block.partial) {
						break
					}
					// Check if this model should use the simplified single-file read tool
					// Only use simplified tool for XML protocol - native protocol works with standard tool
					const modelId = cline.api.getModel().id
					if (shouldUseSingleFileRead(modelId) && toolProtocol !== TOOL_PROTOCOL.MARKDOWN && (toolProtocol as string) !== "unified") {
						await simpleReadFileTool(
							cline,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
						)
					} else {
						// Type assertion is safe here because we're in the "read_file" case
						await readFileTool.handle(cline, block as ToolUse<"read_file">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
							toolCallId, // kade_change: use computed toolCallId
						})
					}
					break
				case "fetch_instructions":
					await fetchInstructionsTool.handle(cline, block as ToolUse<"fetch_instructions">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "list_dir":
					await listDirTool.handle(cline, block as ToolUse<"list_dir">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "mkdir":
					await mkdirTool.handle(cline, block as ToolUse<"mkdir">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId,
					})
					break
				case "move_file":
					await moveFileTool.handle(cline, block as ToolUse<"move_file">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId,
					})
					break
				case "codebase_search":
					await codebaseSearchTool.handle(cline, block as ToolUse<"codebase_search">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "fast_context":
					await fastContextTool.handle(cline, block as ToolUse<"fast_context">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId,
					})
					break
				case "grep":
					await grepTool.handle(cline, block as ToolUse<"grep">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "glob":
					await globTool.handle(cline, block as ToolUse<"glob">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "browser_action":
					await browserActionTool(
						cline,
						block as ToolUse<"browser_action">,
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
					)
					break
				case "execute_command":
					console.info(`[presentAssistantMessage] execute_command case reached, partial=${block.partial}, wasPartialAtStart=${wasPartialAtStart}`)
					await executeCommandTool.handle(cline, block as ToolUse<"execute_command">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "use_mcp_tool":
					await useMcpToolTool.handle(cline, block as ToolUse<"use_mcp_tool">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "access_mcp_resource":
					await accessMcpResourceTool.handle(cline, block as ToolUse<"access_mcp_resource">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break

				case "switch_mode":
					await switchModeTool.handle(cline, block as ToolUse<"switch_mode">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "new_task":
					await newTaskTool.handle(cline, block as ToolUse<"new_task">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId, // kade_change
					})
					break
				case "attempt_completion": {
					const completionCallbacks: AttemptCompletionCallbacks = {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						askFinishSubTaskApproval,
						toolDescription,
						toolProtocol,
					}
					await attemptCompletionTool.handle(
						cline,
						block as ToolUse<"attempt_completion">,
						completionCallbacks,
					)
					break
				}
				// kade_change start
				case "new_rule":
					await newRuleTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				case "report_bug":
					await reportBugTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				case "condense":
					await condenseTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				// kade_change end
				case "web_search":
					await webSearchTool.handle(cline, block as ToolUse<"web_search">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break
				case "web_fetch":
					await webFetchTool.handle(cline, block as ToolUse<"web_fetch">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break
				case "research_web":
					await researchWebTool.handle(cline, block as ToolUse<"research_web">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break


				case "run_sub_agent":
					await runSubAgentTool.handle(cline, block as ToolUse<"run_sub_agent">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break

				case "run_slash_command":
					await runSlashCommandTool.handle(cline, block as ToolUse<"run_slash_command">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break
				case "generate_image":
					await checkpointSaveAndMark(cline)
					await generateImageTool.handle(cline, block as ToolUse<"generate_image">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break
				default: {
					// Handle unknown/invalid tool names
					// This is critical for native protocol where every tool_use MUST have a tool_result
					// Note: This case should rarely be reached since validateToolUse now checks for unknown tools

					// CRITICAL: Don't process partial blocks for unknown tools - just let them stream in.
					// If we try to show errors for partial blocks, we'd show the error on every streaming chunk,
					// creating a loop that appears to freeze the extension. Only handle complete blocks.
					if (block.partial) {
						break
					}

					const errorMessage = `Unknown tool "${block.name}". This tool does not exist. Please use one of the available tools.`
					cline.consecutiveMistakeCount++
					cline.recordToolError(block.name as ToolName, errorMessage)
					await cline.say("error", t("tools:unknownToolError", { toolName: block.name }))
					// Push tool_result directly for native protocol WITHOUT setting didAlreadyUseTool
					// This prevents the stream from being interrupted with "Response interrupted by tool use result"
					if (toolProtocol === TOOL_PROTOCOL.MARKDOWN && toolCallId) {
						cline.userMessageContent.push({
							type: "tool_result",
							tool_use_id: toolCallId,
							content: formatResponse.toolError(errorMessage, toolProtocol),
							is_error: true,
						} as Anthropic.ToolResultBlockParam)
					} else {
						pushToolResult(formatResponse.toolError(errorMessage, toolProtocol))
					}
					break
				}
			}

			break
		}
	}

	// NOTE: When tool is rejected, iterator stream is interrupted and it waits
	// for `userMessageContentReady` to be true. Future calls to present will
	// skip execution since `didRejectTool` and iterate until `contentIndex` is
	// set to message length and it sets userMessageContentReady to true itself
	// (instead of preemptively doing it in iterator).

	// CRITICAL FIX: We must only finalize the block (increment index and set ready=true)
	// if the block was NON-PARTIAL when we started processing it.
	// If it was partial at start, but now is not, it means the stream ended while we were 
	// processing a delta. We must NOT finalize yet, as the next loop iteration will 
	// handle the non-partial execution of the tool.
	const shouldFinalize = (!wasPartialAtStart || cline.didRejectTool || cline.didAlreadyUseTool)

	if (shouldFinalize) {
		// Block is finished streaming and executing.

		// Call next block if it exists (if not then read stream will call it
		// when it's ready).
		// Need to increment regardless, so when read stream calls this function
		// again it will be streaming the next block.
		cline.currentStreamingContentIndex++

		if (cline.currentStreamingContentIndex < cline.assistantMessageContent.length) {
			// There are already more content blocks to stream, so continue loop
			await yieldPromise()
			continue
		} else {
			// CRITICAL FIX: If we're out of bounds and the stream is complete, set userMessageContentReady
			// This handles the case where assistantMessageContent is empty or becomes empty after processing
			if (cline.didCompleteReadingStream) {
				cline.userMessageContentReady = true
			}
		}
	}

	// Block is partial, but the read stream may have finished or we have pending updates.
	if (cline.presentAssistantMessageHasPendingUpdates) {
		await yieldPromise()
		continue
	}

	break // Exit the while loop
		}
	} finally {
		cline.presentAssistantMessageLocked = false
	}
}

/**
 * save checkpoint and mark done in the current streaming task.
 * @param task The Task instance to checkpoint save and mark.
 * @returns
 */
async function checkpointSaveAndMark(task: Task) {
	if (task.currentStreamingDidCheckpoint) {
		return
	}
	try {
		// kade_change: order changed to prevent second execution while still awaiting the save
		task.currentStreamingDidCheckpoint = true
		await task.checkpointSave(true)
	} catch (error) {
		console.error(`[Task#presentAssistantMessage] Error saving checkpoint: ${error.message}`, error)
	}
}
