import * as path from "path"
import { Anthropic } from "@anthropic-ai/sdk"
import { Task } from "./Task"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { serializeError } from "serialize-error"
import delay from "delay"
import { formatResponse } from "../prompts/responses"
import { findLastIndex } from "../../shared/array"
import { getModelId, getApiProtocol, ToolName, ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import { isNativeProtocol } from "@roo-code/types"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"
import { checkContextWindowExceededError } from "../context/context-management/context-error-handling"
import { isAnyRecognizedKiloCodeError, isPaymentRequiredError } from "../../shared/kilocode/errorUtils"
import { getAppUrl } from "@roo-code/types"
import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser"
import { MarkdownToolCallParser } from "../assistant-message/MarkdownToolCallParser"
import { presentAssistantMessage } from "../assistant-message"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "../../shared/ExtensionMessage"
import { addOrMergeUserContent, yieldPromise } from "./kilocode"
import pWaitFor from "p-wait-for"
import { ApiStream, GroundingSource } from "../../api/transform/stream"
import { ToolUse, McpToolUse } from "../../shared/tools"

/**
 * AgentLoop
 * 
 * The "Brain" of the agent. This class encapsulates the execution loop
 * that drives the task, separating the logic from the Task "Body".
 * 
 * It enables "Native Wiring" by allowing us to run the loop independently
 * of the UI state if needed, or drive the UI state remotely.
 */
export class AgentLoop {
    private task: Task

    private streamingToolCallLengths = new Map<string, number>()
    private partialToolHandlers: Record<string, () => Promise<{ handlePartial: (task: Task, block: ToolUse<any>) => Promise<void> }>> = {
        write_to_file: async () => {
            const { writeToFileTool } = await import("../tools/WriteToFileTool")
            return writeToFileTool
        },
        edit: async () => {
            const { editTool } = await import("../tools/EditTool")
            return editTool
        },
        read_file: async () => {
            const { readFileTool } = await import("../tools/ReadFileTool")
            return readFileTool
        },
        mkdir: async () => {
            const { mkdirTool } = await import("../tools/MkdirTool")
            return mkdirTool
        },
        list_dir: async () => {
            const { listDirTool } = await import("../tools/ListFilesTool")
            return listDirTool
        },
        grep: async () => {
            const { grepTool } = await import("../tools/SearchFilesTool")
            return grepTool
        },
        glob: async () => {
            const { globTool } = await import("../tools/GlobTool")
            return globTool
        },
        move_file: async () => {
            const { moveFileTool } = await import("../tools/MoveFileTool")
            return moveFileTool
        },
        execute_command: async () => {
            const { executeCommandTool } = await import("../tools/ExecuteCommandTool")
            return executeCommandTool
        },
        fetch_instructions: async () => {
            const { fetchInstructionsTool } = await import("../tools/FetchInstructionsTool")
            return fetchInstructionsTool
        },
        switch_mode: async () => {
            const { switchModeTool } = await import("../tools/SwitchModeTool")
            return switchModeTool
        },
        new_task: async () => {
            const { newTaskTool } = await import("../tools/NewTaskTool")
            return newTaskTool
        },
        run_sub_agent: async () => {
            const { runSubAgentTool } = await import("../tools/RunSubAgentTool")
            return runSubAgentTool
        },
        run_slash_command: async () => {
            const { runSlashCommandTool } = await import("../tools/RunSlashCommandTool")
            return runSlashCommandTool
        },
        use_mcp_tool: async () => {
            const { useMcpToolTool } = await import("../tools/UseMcpToolTool")
            return useMcpToolTool
        },
        access_mcp_resource: async () => {
            const { accessMcpResourceTool } = await import("../tools/accessMcpResourceTool")
            return accessMcpResourceTool
        },
        codebase_search: async () => {
            const { codebaseSearchTool } = await import("../tools/CodebaseSearchTool")
            return codebaseSearchTool
        },
        update_todo_list: async () => {
            const { updateTodoListTool } = await import("../tools/UpdateTodoListTool")
            return updateTodoListTool
        },
        generate_image: async () => {
            const { generateImageTool } = await import("../tools/GenerateImageTool")
            return generateImageTool
        },
        attempt_completion: async () => {
            const { attemptCompletionTool } = await import("../tools/AttemptCompletionTool")
            return attemptCompletionTool
        },
    }

    constructor(task: Task) {
        this.task = task
    }

    private countCompletedToolCalls(blocks: any[]): number {
        return blocks.filter(
            (b: any) =>
                (b.type === "tool_use" || b.type === "mcp_tool_use") &&
                !b.partial &&
                b.isComplete !== false,
        ).length
    }

    private trimBlocksToCompletedToolLimit(blocks: any[], maxToolCalls: number): any[] {
        if (maxToolCalls <= 0 || blocks.length === 0) {
            return blocks
        }

        let completed = 0
        for (let i = 0; i < blocks.length; i++) {
            const b: any = blocks[i]
            const isCompleteTool =
                (b.type === "tool_use" || b.type === "mcp_tool_use") &&
                !b.partial &&
                b.isComplete !== false

            if (isCompleteTool) {
                completed++
                if (completed >= maxToolCalls) {
                    // Keep content up to and including the Nth complete tool.
                    // Drop everything after that boundary in this turn.
                    return blocks.slice(0, i + 1)
                }
            }
        }

        return blocks
    }

    /**
     * Optimized streaming simulation with minimal latency.
     * Removed artificial delays for better responsiveness.
     */
    private async simulateStreamingText(text: string, previousLength: number = 0): Promise<void> {
        console.log(`[simulateStreamingText] Streaming new characters. Total: ${text.length}, Previous: ${previousLength}`)

        // Only stream the NEW part of the text
        const newText = text.slice(previousLength)
        if (newText.length === 0) return

        // OPTIMIZATION: Remove artificial delays for immediate responsiveness
        // Send the complete new text at once for minimal latency
        const cumulativeText = text

        await this.task.say("completion_result", cumulativeText, undefined, false, undefined, undefined, { skipSave: true })

        console.log(`[simulateStreamingText] Finished streaming chunk immediately`)
    }
    /**
     * Handles UI updates for partial tool execution across all protocols.
     */
    private async handlePartialUpdate(partialToolUse: ToolUse | McpToolUse, toolCallId?: string): Promise<void> {
        if (partialToolUse.type !== "tool_use") {
            return
        }

        // kilocode_change: Allow final updates to ensure no truncation.
        // If we skipped this, the very last chunk (which closes the boolean) would not be sent to the UI.
        // if (!partialToolUse.partial) {
        //    return;
        // }

        if (partialToolUse.name === "edit") {
            const filePath = (partialToolUse as any).params?.file_path || (partialToolUse as any).params?.path;
            const nativeEdits = (partialToolUse as any).nativeArgs?.edits;
            const edits = (partialToolUse as any).params?.edits || nativeEdits || (partialToolUse as any).params?.edit;

            // If the Unified parser has already parsed edits into nativeArgs.edits (array),
            // copy them to params.edits so handlePartial uses them directly instead of
            // trying to re-parse the raw string through parseLegacy.
            if (Array.isArray(nativeEdits) && nativeEdits.length > 0) {
                (partialToolUse as any).params.edits = nativeEdits;
            }
            if (!filePath || !edits) {
                return
            }
        }

        if (partialToolUse.name === "attempt_completion") {
            if (toolCallId) {
                const resultContent = (partialToolUse as any).params?.result || "";
                const prevLen = this.streamingToolCallLengths.get(toolCallId) || 0;

                if (resultContent.length > prevLen) {
                    await this.simulateStreamingText(resultContent, prevLen);
                }
                this.streamingToolCallLengths.set(toolCallId, resultContent.length);
                return
            }
        }

        const handlerLoader = this.partialToolHandlers[partialToolUse.name]
        if (!handlerLoader) {
            return
        }

        try {
            const handler = await handlerLoader()
            await handler.handlePartial(this.task, partialToolUse as ToolUse<any>)
        } catch (error) {
            console.error(`[AgentLoop] Error in handlePartial for ${partialToolUse.name}:`, error)
        }
    }

    private getLatestToolUseBlock(): ToolUse | McpToolUse | undefined {
        for (let i = this.task.assistantMessageContent.length - 1; i >= 0; i--) {
            const block = this.task.assistantMessageContent[i]
            if (block?.type === "tool_use" || block?.type === "mcp_tool_use") {
                return block as ToolUse | McpToolUse
            }
        }

        return undefined
    }

    private stripTextAfterCompletedToolCall(blocks: any[]): any[] {
        if (blocks.length === 0) {
            return blocks
        }

        const sanitized: any[] = []
        let sawCompletedTool = false

        for (const block of blocks) {
            const isToolBlock = block?.type === "tool_use" || block?.type === "mcp_tool_use"
            const isCompletedTool = isToolBlock && !block?.partial && block?.isComplete !== false

            if (block?.type === "text") {
                if (sawCompletedTool) {
                    continue
                }
                sanitized.push(block)
                continue
            }

            sanitized.push(block)

            if (isCompletedTool) {
                sawCompletedTool = true
            }
        }

        return sanitized
    }


    public async run(
        userContent: Anthropic.Messages.ContentBlockParam[],
        includeFileDetails: boolean = false,
    ): Promise<boolean> {
        interface StackItem {
            userContent: Anthropic.Messages.ContentBlockParam[]
            includeFileDetails: boolean
            retryAttempt?: number
            userMessageWasRemoved?: boolean
        }

        const stack: StackItem[] = [{ userContent, includeFileDetails, retryAttempt: 0 }]

        // kilocode_change: Reset lock state to prevent stale locks from blocking execution
        this.task.presentAssistantMessageLocked = false
        this.task.presentAssistantMessageHasPendingUpdates = false
        this.task.userMessageContentReady = false

        while (stack.length > 0) {
            const currentItem = stack.pop()!
            const currentUserContent = currentItem.userContent
            const currentIncludeFileDetails = currentItem.includeFileDetails

            if (this.task.abort) {
                throw new Error(
                    `[AgentLoop] task ${this.task.taskId}.${this.task.instanceId} aborted`,
                )
            }

            // --- 1. Mistake Limit Check ---
            if (this.task.consecutiveMistakeLimit > 0 && this.task.consecutiveMistakeCount >= this.task.consecutiveMistakeLimit) {
                const { response, text, images } = await this.task.ask(
                    "mistake_limit_reached",
                    // t("common:errors.mistake_limit_guidance") // Accessing i18n directly if needed, or passed in
                    "Mistake limit reached. Please provide guidance.",
                )

                if (response === "messageResponse") {
                    currentUserContent.push(
                        ...[
                            { type: "text" as const, text: formatResponse.tooManyMistakes(text) },
                            ...formatResponse.imageBlocks(images),
                        ],
                    )

                    await this.task.say("user_feedback", text, images)
                    TelemetryService.instance.captureConsecutiveMistakeError(this.task.taskId)
                }

                this.task.consecutiveMistakeCount = 0
            }

            // --- 2. Start API Request UI ---
            const modelId = getModelId(this.task.apiConfiguration)
            const apiProtocol = getApiProtocol(this.task.apiConfiguration.apiProvider, modelId)

            await this.task.say("api_req_started", JSON.stringify({ apiProtocol }))

            // kilocode_change: Luxury Spa Treatment - Refresh all active file reads on every turn
            // This ensures that any file the agent has seen is always up-to-date in its history
            // before the next request is made.
            // 🚀 OPTIMIZATION: Use smart refresh to leverage hot cache from recent read tools
            if (this.task.luxurySpa.activeFileReads.size > 0) {
                // console.log(`[AgentLoop] 🧖 Starting Luxury Spa Treatment for ${this.task.luxurySpa.activeFileReads.size} files...`)
                await this.task.luxurySpa.smartRefresh()
            }

            // --- 3. Load Context ---
            // Accessing private loadContext
            const [parsedUserContent, environmentDetails, clinerulesError] = await this.task.loadContext(
                currentUserContent,
                currentIncludeFileDetails,
            )

            if (clinerulesError) {
                await this.task.say(
                    "error",
                    "Issue with processing the /newrule command. Double check that, if '.kilocode/rules' already exists, it's a directory and not a file.",
                )
            }

            const contentWithoutEnvDetails = parsedUserContent.filter((block: any) => {
                if (block.type === "text" && typeof block.text === "string") {
                    const trimmed = block.text.trim()
                    // Check for both new markdown format and old XML format for backward compatibility
                    const isEnvironmentDetailsBlock =
                        trimmed.startsWith("## Environment Context") ||
                        (trimmed.startsWith("<environment_details>") && trimmed.endsWith("</environment_details>"))
                    return !isEnvironmentDetailsBlock
                }
                return true
            })

            // Interleaved thinking support
            const finalUserContent = addOrMergeUserContent(contentWithoutEnvDetails, [])

            // --- 4. Add User Message to History ---
            const isEmptyUserContent = currentUserContent.length === 0
            const shouldAddUserMessage =
                ((currentItem.retryAttempt ?? 0) === 0 && !isEmptyUserContent) || currentItem.userMessageWasRemoved

            if (shouldAddUserMessage) {
                await this.task.addToApiConversationHistory({ role: "user", content: finalUserContent })
                TelemetryService.instance.captureConversationMessage(this.task.taskId, "user")
            }

            // Update api_req_started message with details
            const lastApiReqIndex = findLastIndex(this.task.clineMessages, (m) => m.say === "api_req_started")
            if (this.task.clineMessages[lastApiReqIndex]) {
                this.task.clineMessages[lastApiReqIndex].text = JSON.stringify({
                    apiProtocol,
                } satisfies ClineApiReqInfo)
            }

            // PERF: Use debounced versions — say("api_req_started") above already triggers
            // addToClineMessages which saves and posts state. Avoid redundant blocking I/O.
            this.task.providerRef.deref()?.debouncedPostStateToWebview()


            // --- 5. Execute Stream and Process Chunks ---
            try {
                let cacheWriteTokens = 0
                let cacheReadTokens = 0
                let inputTokens = 0
                let outputTokens = 0
                let totalCost: number | undefined
                let inferenceProvider: string | undefined
                let usageMissing = false
                const apiRequestStartTime = performance.now()

                // Reset Streaming State
                this.task.currentStreamingContentIndex = 0
                this.task.currentStreamingDidCheckpoint = false
                this.task.assistantMessageContent = []
                this.task.didCompleteReadingStream = false
                this.task.userMessageContent = []
                this.task.userMessageContentReady = false
                this.task.didRejectTool = false
                this.task.didAlreadyUseTool = false
                this.task.didToolFailInCurrentTurn = false
                this.task.presentAssistantMessageLocked = false
                this.task.presentAssistantMessageHasPendingUpdates = false
                this.task.assistantMessageParser?.reset()
                this.task.streamingToolCallIndices.clear()
                NativeToolCallParser.clearAllStreamingToolCalls()
                NativeToolCallParser.clearRawChunkState()

                await this.task.diffViewProvider.reset()

                // Cache model info
                this.task.cachedStreamingModel = this.task.api.getModel()
                const streamModelInfo = this.task.cachedStreamingModel.info
                const streamProtocol = resolveToolProtocol(this.task.apiConfiguration, streamModelInfo)
                const shouldUseParser = streamProtocol === TOOL_PROTOCOL.UNIFIED || streamProtocol === TOOL_PROTOCOL.MARKDOWN
                const shouldSkipNativeTools = streamProtocol === TOOL_PROTOCOL.MARKDOWN || streamProtocol === TOOL_PROTOCOL.UNIFIED

                // Start Stream
                const stream: ApiStream = this.task.attemptApiRequest(currentItem.retryAttempt)
                let assistantMessage = ""
                let hasTextContent = false
                let hasToolUses = false
                let reasoningMessage = ""
                let currentReasoningPhase: string | undefined = undefined
                let reasoningStartTime: number | undefined
                let pendingGroundingSources: GroundingSource[] = []
                this.task.isStreaming = true

                // kilocode_change: Stream-interrupt-on-tool-complete
                // Count completed (closed) tool blocks seen during streaming.
                // When this reaches maxToolCalls, we break the stream immediately so
                // the AI sees results sooner — exactly how JSON/native tool calling works.
                let completedToolCallCount = 0
                const configuredMaxToolCalls = Number(this.task.apiConfiguration?.maxToolCalls ?? 10)
                let maxToolCalls = Number.isFinite(configuredMaxToolCalls)
                    ? Math.max(0, Math.floor(configuredMaxToolCalls))
                    : 10
                if (this.task.apiConfiguration?.disableBatchToolUse) {
                    maxToolCalls = 1
                }
                // kilocode_change: The unified parser expands multi-file R blocks into N individual
                // read_file tool calls — a hard cap would cut off all but the first file.
                // Disable the limit entirely for the unified protocol; it uses a single stream turn
                // per message anyway, so the AI won't see results until the next turn regardless.
                if (streamProtocol === TOOL_PROTOCOL.UNIFIED) {
                    maxToolCalls = 0
                }
                let shouldTerminateStreamForToolLimit = false

                const antThinkingContent: any[] = []

                let streamAbortSignal: AbortSignal | undefined
                let streamAbortListener: (() => void) | undefined
                let streamAbortPromise: Promise<never> | undefined

                const iterator = stream[Symbol.asyncIterator]()

                // Helper to race iterator.next() with abort signal
                const nextChunkWithAbort = async () => {
                    const nextPromise = iterator.next()
                    // Setup abort promise if we have a controller and haven't set it up yet
                    if (!streamAbortPromise && this.task.currentRequestAbortController) {
                        streamAbortSignal = this.task.currentRequestAbortController.signal
                        streamAbortPromise = new Promise<never>((_, reject) => {
                            if (streamAbortSignal!.aborted) {
                                reject(new Error("Request cancelled by user"))
                            } else {
                                streamAbortListener = () => reject(new Error("Request cancelled by user"))
                                streamAbortSignal!.addEventListener("abort", streamAbortListener)
                            }
                        })
                    }

                    if (streamAbortPromise) {
                        return await Promise.race([nextPromise, streamAbortPromise])
                    }
                    return await nextPromise
                }

                // --- Stream Loop ---
                let item = await nextChunkWithAbort()
                while (!item.done) {
                    const chunk = item.value
                    item = await nextChunkWithAbort()
                    if (!chunk) continue

                    const finalizeReasoning = async () => {
                        if (reasoningMessage) {
                            const lastReasoningIndex = findLastIndex(
                                this.task.clineMessages,
                                (m) => m.type === "say" && m.say === "reasoning",
                            )
                            if (lastReasoningIndex !== -1 && this.task.clineMessages[lastReasoningIndex].partial) {
                                this.task.clineMessages[lastReasoningIndex].partial = false
                                if (reasoningStartTime) {
                                    const durationMs = Date.now() - reasoningStartTime
                                        ; (this.task.clineMessages[lastReasoningIndex] as any).metadata = {
                                            ...this.task.clineMessages[lastReasoningIndex].metadata,
                                            reasoningDurationMs: durationMs,
                                        }
                                }
                                await this.task.updateClineMessage(this.task.clineMessages[lastReasoningIndex])
                                // Reset reasoning vars so we don't finalize twice
                                reasoningMessage = ""
                                reasoningStartTime = undefined
                            }
                        }
                    }

                    switch (chunk.type) {
                        case "reasoning":
                            if (reasoningStartTime === undefined) {
                                reasoningStartTime = Date.now()
                            }

                            if (chunk.title) {
                                currentReasoningPhase = chunk.title
                            }
                            const metadata: any = {}
                            if (currentReasoningPhase) {
                                metadata.reasoningPhase = currentReasoningPhase
                            }

                            if (chunk.text) {
                                reasoningMessage += chunk.text
                            }

                            await this.task.say("reasoning", reasoningMessage, undefined, true, undefined, undefined, {
                                metadata: Object.keys(metadata).length > 0 ? metadata : undefined
                            })
                            break

                        case "usage":
                            inputTokens += chunk.inputTokens
                            outputTokens += chunk.outputTokens
                            cacheWriteTokens += chunk.cacheWriteTokens ?? 0
                            cacheReadTokens += chunk.cacheReadTokens ?? 0
                            totalCost = chunk.totalCost
                            inferenceProvider = chunk.inferenceProvider
                            break

                        case "grounding":
                            if (chunk.sources && chunk.sources.length > 0) {
                                pendingGroundingSources.push(...chunk.sources)
                            }
                            break

                        case "ant_thinking":
                            antThinkingContent.push({
                                type: "thinking",
                                thinking: chunk.thinking,
                                signature: chunk.signature,
                            })
                            break

                        case "ant_redacted_thinking":
                            antThinkingContent.push({
                                type: "redacted_thinking",
                                data: chunk.data,
                            })
                            break

                        case "tool_call_partial":
                            if (shouldSkipNativeTools) break
                            await finalizeReasoning()
                            // console.log(`[AgentLoop] 📦 Received tool_call_partial chunk:`, { ... });
                            const events = NativeToolCallParser.processRawChunk({
                                index: chunk.index,
                                id: chunk.id,
                                name: chunk.name,
                                arguments: chunk.arguments,
                            })

                            for (const event of events) {
                                // console.log(`[AgentLoop] 🔄 Processing event:`, event.type, { ... });
                                if (event.type === "tool_call_start") {
                                    // console.log(`[AgentLoop] Starting streaming tool call: ${event.name} (${event.id})`);
                                    NativeToolCallParser.startStreamingToolCall(event.id, event.name as ToolName)
                                    // Finalize preceding text block
                                    const lastBlock = this.task.assistantMessageContent[this.task.assistantMessageContent.length - 1]
                                    if (lastBlock?.type === "text" && lastBlock.partial) {
                                        lastBlock.partial = false
                                    }

                                    // Prevent ID collision: if the ID already exists, it means a previous tool call
                                    // with the same ID hasn't been properly cleaned up. Log a warning and skip this start.
                                    if (this.task.streamingToolCallIndices.has(event.id)) {
                                        console.warn(`[AgentLoop] Duplicate tool_call_start for id ${event.id}. Skipping to avoid collision.`)
                                    } else {
                                        const toolUseIndex = this.task.assistantMessageContent.length
                                        this.task.streamingToolCallIndices.set(event.id, toolUseIndex)

                                        const partialToolUse: ToolUse = {
                                            type: "tool_use",
                                            name: event.name as ToolName,
                                            params: {},
                                            partial: true,
                                        }
                                            ; (partialToolUse as any).id = event.id
                                        this.task.assistantMessageContent.push(partialToolUse)
                                        this.task.userMessageContentReady = false

                                        // FIXED: Show WriteTool UI immediately for write_to_file calls
                                        if (event.name === "write_to_file") {
                                            // console.log(`[AgentLoop] 🚀 Showing WriteTool UI immediately for ${event.name}`);
                                            // Send an immediate partial message to show the UI with empty content
                                            this.task.say("tool", JSON.stringify({
                                                tool: "newFileCreated",
                                                path: "",
                                                content: "",
                                                isOutsideWorkspace: false,
                                                isProtected: false,
                                            }), undefined, true).catch(error => {
                                                console.error("[AgentLoop] Error showing immediate WriteTool UI:", error)
                                            })
                                        }

                                        presentAssistantMessage(this.task)
                                    }


                                } else if (event.type === "tool_call_delta") {
                                    const partialToolUse = NativeToolCallParser.processStreamingChunk(event.id, event.delta)
                                    if (partialToolUse) {
                                        // console.log(`[AgentLoop] 📝 Got partial tool use: ${partialToolUse.name}`, { ... });
                                        const toolUseIndex = this.task.streamingToolCallIndices.get(event.id)
                                        if (toolUseIndex !== undefined) {
                                            ; (partialToolUse as any).id = event.id
                                            this.task.assistantMessageContent[toolUseIndex] = partialToolUse

                                            // Process partial updates sequentially to avoid race conditions
                                            // First, handle the tool-specific partial update
                                            try {
                                                await this.handlePartialUpdate(partialToolUse, event.id)
                                            } catch (error) {
                                                console.error("[AgentLoop] Error in handlePartialUpdate:", error)
                                            }

                                            // Then update UI (except for attempt_completion which is handled separately)
                                            if (partialToolUse.name !== "attempt_completion") {
                                                try {
                                                    await presentAssistantMessage(this.task)
                                                } catch (error) {
                                                    console.error("[AgentLoop] Error in presentAssistantMessage:", error)
                                                }
                                            }
                                        }
                                    } else {
                                        console.log(`[AgentLoop] No partial tool use returned from chunk`);
                                    }
                                } else if (event.type === "tool_call_end") {
                                    const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
                                    const toolUseIndex = this.task.streamingToolCallIndices.get(event.id)
                                    if (finalToolUse && toolUseIndex !== undefined) {
                                        // console.log(`[AgentLoop] 🏁 Tool call ended: ${finalToolUse.name}`, { ... });
                                        ; (finalToolUse as any).id = event.id
                                        this.task.assistantMessageContent[toolUseIndex] = finalToolUse
                                        this.task.streamingToolCallIndices.delete(event.id)
                                        this.task.userMessageContentReady = false

                                        if (finalToolUse.name === "attempt_completion") {
                                            const resultContent = (finalToolUse as any).params?.result || "";
                                            const prevLen = this.streamingToolCallLengths.get(event.id) || 0;
                                            if (resultContent.length > prevLen) {
                                                await this.simulateStreamingText(resultContent, prevLen);
                                            }
                                            await this.task.say("completion_result", resultContent, undefined, false, undefined, undefined, { skipSave: true })
                                            this.streamingToolCallLengths.delete(event.id);
                                            // Ensure final state is sent to UI
                                            await this.handlePartialUpdate(finalToolUse, event.id);
                                        } else {
                                            // kilocode_change: Call handlePartial for the active streaming tool (Native)
                                            // This ensures that the final "partial: false" state is sent to the tool UI.
                                            await this.handlePartialUpdate(finalToolUse, event.id);
                                        }

                                        presentAssistantMessage(this.task).catch(error => {
                                            console.error("[AgentLoop] Error in presentAssistantMessage:", error)
                                        })
                                    } else if (toolUseIndex !== undefined) {
                                        const existingToolUse = this.task.assistantMessageContent[toolUseIndex]
                                        if (existingToolUse?.type === "tool_use") {
                                            existingToolUse.partial = false
                                                ; (existingToolUse as any).id = event.id
                                        }
                                        this.task.streamingToolCallIndices.delete(event.id)
                                        this.task.userMessageContentReady = false
                                        presentAssistantMessage(this.task).catch(error => {
                                            console.error("[AgentLoop] Error in presentAssistantMessage:", error)
                                        })
                                    }
                                }
                            }
                            break

                        case "tool_call": // Legacy
                            if (shouldSkipNativeTools) break
                            await finalizeReasoning()
                            const toolUse = NativeToolCallParser.parseToolCall({
                                id: chunk.id,
                                name: chunk.name as ToolName,
                                arguments: chunk.arguments,
                            })
                            if (toolUse) {
                                toolUse.id = chunk.id
                                this.task.assistantMessageContent.push(toolUse)
                                this.task.userMessageContentReady = false
                                presentAssistantMessage(this.task)
                            }
                            break

                        case "text":
                            // Only finalize reasoning for non-whitespace text content.
                            // Some providers (e.g., MiniMax via OpenRouter) send whitespace-only
                            // text chunks interleaved with reasoning, which would prematurely
                            // close the reasoning block and cause duplicate "Thought for" UI blocks.
                            if (chunk.text?.trim()) {
                                await finalizeReasoning()
                            }
                            hasTextContent = true
                            if (shouldUseParser && this.task.assistantMessageParser) {
                                // Detect "End Tool use" or "End Tool" case-insensitively
                                const markerRegex = /End Tool (?:use)?/i
                                const combined = assistantMessage + chunk.text
                                const markerMatch = combined.match(markerRegex)
                                let hasEndToolUseMarker = false
                                let textToProcess = chunk.text

                                if (markerMatch && markerMatch.index !== undefined) {
                                    // Found the marker! Truncate textToProcess so we don't process anything after it.
                                    const markerEndIndex = markerMatch.index + markerMatch[0].length
                                    const amountFromChunk = markerEndIndex - assistantMessage.length
                                    textToProcess = chunk.text.slice(0, Math.max(0, amountFromChunk))
                                    hasEndToolUseMarker = true
                                }

                                const prevBlockCount = this.task.assistantMessageContent.length
                                
                                // kilocode_change: Check how many tools were finalized BEFORE processing this chunk.
                                const completedBefore = this.countCompletedToolCalls(this.task.assistantMessageContent as any[])
                                const alreadyHadCompletedTool = (this.task.assistantMessageParser as any).hasCompletedToolCall?.() ?? false

                                const result = this.task.assistantMessageParser.processChunk(textToProcess) as { blocks: any[], safeIndex: number }
                                this.task.assistantMessageContent = this.stripTextAfterCompletedToolCall(result.blocks)
                                
                                // kilocode_change: Only accumulate text if we haven't reached the tool limit yet.
                                // Trailing text after the LAST allowed tool call is hallucination and must NOT be saved to history.
                                const completedAfter = this.countCompletedToolCalls(this.task.assistantMessageContent as any[])
                                // We are at limit if we already had a completed tool (and maxToolCalls is 1) or if we hit the limit now.
                                const isAtLimit = maxToolCalls > 0 && (completedBefore >= maxToolCalls || (maxToolCalls === 1 && alreadyHadCompletedTool))
                                const justReachedLimit = maxToolCalls > 0 && completedAfter >= maxToolCalls && !alreadyHadCompletedTool

                                if (!isAtLimit) {
                                    if (justReachedLimit) {
                                        // If we just reached the limit, use safeIndex to include the tool closer but exclude trailing text.
                                        assistantMessage += textToProcess.slice(0, result.safeIndex)
                                    } else {
                                        assistantMessage += textToProcess
                                    }
                                }

                                // Check if we have trailing text in the current chunk after a tool call was finalized
                                const hasTrailingTextInChunk = justReachedLimit && result.safeIndex < textToProcess.length && textToProcess.slice(result.safeIndex).trim().length > 0

                                // kilocode_change: If trailing text detected after tool, terminate stream immediately.
                                // This prevents the AI from seeing its own hallucinated output.
                                if ((isAtLimit || hasTrailingTextInChunk) && textToProcess.trim()) {
                                    console.log(`[AgentLoop] ✂️ Stream cut: Trailing text detected after tool call. Terminating stream.`)
                                    
                                    this.task.assistantMessageParser.finalizeContentBlocks()
                                    this.task.assistantMessageContent = this.stripTextAfterCompletedToolCall(
                                        this.task.assistantMessageParser.getContentBlocks(),
                                    )
                                    
                                    if (maxToolCalls > 0) {
                                        this.task.assistantMessageContent = this.trimBlocksToCompletedToolLimit(
                                            this.task.assistantMessageContent as any[],
                                            maxToolCalls,
                                        )
                                    }
                                    
                                    const activeBlock = this.getLatestToolUseBlock()
                                    const preBreakPromises: Promise<any>[] = [presentAssistantMessage(this.task).catch(error => {
                                        console.error("[AgentLoop] Error in presentAssistantMessage (trailing text cut):", error)
                                    })]
                                    if (activeBlock) {
                                        preBreakPromises.push(this.handlePartialUpdate(activeBlock))
                                    }
                                    await Promise.all(preBreakPromises)
                                    
                                    shouldTerminateStreamForToolLimit = true
                                    try {
                                        if (typeof iterator.return === "function") {
                                            await iterator.return(undefined)
                                        }
                                    } catch (error) {
                                        console.warn("[AgentLoop] Failed to close stream iterator on trailing text:", error)
                                    }
                                    break
                                }

                                if (this.task.assistantMessageContent.length > prevBlockCount) {
                                    this.task.userMessageContentReady = false
                                    hasToolUses = true
                                }

                                if (maxToolCalls > 0) {
                                    this.task.assistantMessageContent = this.trimBlocksToCompletedToolLimit(
                                        this.task.assistantMessageContent as any[],
                                        maxToolCalls,
                                    )
                                    const newlyClosedCount = this.countCompletedToolCalls(this.task.assistantMessageContent as any[])
                                    if (newlyClosedCount > completedToolCallCount) {
                                        completedToolCallCount = newlyClosedCount
                                    }
                                }

                                if ((maxToolCalls > 0 && completedToolCallCount >= maxToolCalls) || hasEndToolUseMarker) {
                                    console.log(`[AgentLoop] ✂️ Stream cut: ${hasEndToolUseMarker ? "End Tool use marker detected" : `${completedToolCallCount}/${maxToolCalls} tool calls complete`}. Interrupting stream.`)

                                    this.task.assistantMessageParser.finalizeContentBlocks()
                                    this.task.assistantMessageContent = this.stripTextAfterCompletedToolCall(
                                        this.task.assistantMessageParser.getContentBlocks(),
                                    )

                                    if (maxToolCalls > 0) {
                                        this.task.assistantMessageContent = this.trimBlocksToCompletedToolLimit(
                                            this.task.assistantMessageContent as any[],
                                            maxToolCalls,
                                        )
                                    }

                                    const activeBlock = this.getLatestToolUseBlock()
                                    const preBreakPromises: Promise<any>[] = [presentAssistantMessage(this.task).catch(error => {
                                        console.error("[AgentLoop] Error in presentAssistantMessage (pre-break):", error)
                                    })]
                                    if (activeBlock) {
                                        preBreakPromises.push(this.handlePartialUpdate(activeBlock))
                                    }
                                    await Promise.all(preBreakPromises)
                                    
                                    shouldTerminateStreamForToolLimit = true
                                    try {
                                        if (typeof iterator.return === "function") {
                                            await iterator.return(undefined)
                                        }
                                    } catch (error) {
                                        console.warn("[AgentLoop] Failed to close stream iterator on tool-call limit:", error)
                                    }
                                    break
                                }

                                // Normal update (no interrupt)
                                const activeBlock = this.getLatestToolUseBlock()
                                const promises: Promise<any>[] = [presentAssistantMessage(this.task).catch(error => {
                                    console.error("[AgentLoop] Error in presentAssistantMessage (XML/Unified):", error)
                                })]
                                if (activeBlock) {
                                    promises.push(this.handlePartialUpdate(activeBlock))
                                }
                                await Promise.all(promises)
                            } else {
                                assistantMessage += chunk.text
                                const lastBlock = this.task.assistantMessageContent[this.task.assistantMessageContent.length - 1]
                                if (lastBlock?.type === "text" && lastBlock.partial) {
                                    lastBlock.content = assistantMessage
                                } else {
                                    this.task.assistantMessageContent.push({
                                        type: "text",
                                        content: assistantMessage,
                                        partial: true,
                                    })
                                    this.task.userMessageContentReady = false
                                }
                                presentAssistantMessage(this.task).catch(error => {
                                    console.error("[AgentLoop] Error in presentAssistantMessage:", error)
                                })
                            }
                            break
                    }

                    if (shouldTerminateStreamForToolLimit) {
                        break
                    }

                    if (this.task.abort) {
                        if (!this.task.abandoned) {
                            // cleanup logic would be here
                        }
                        break
                    }

                    if (this.task.didRejectTool) {
                        assistantMessage += "\n\n[Response interrupted by user feedback]"
                        break
                    }
                    if (this.task.didAlreadyUseTool) {
                        assistantMessage += "\n\n[Response interrupted. Only one tool allowed.]"
                        break
                    }
                }

                // Finalize loop logic - Abort controller cleanup
                this.task.isStreaming = false
                if (streamAbortSignal && streamAbortListener) {
                    streamAbortSignal.removeEventListener("abort", streamAbortListener)
                }
                this.task.currentRequestAbortController = undefined
                this.task.didCompleteReadingStream = true

                // ** THE FIX **
                // Explicitly finalize the parser to process any buffered text from the last chunk.
                if (shouldUseParser && this.task.assistantMessageParser) {
                    this.task.assistantMessageParser.finalizeContentBlocks();
                    this.task.assistantMessageContent = this.stripTextAfterCompletedToolCall(
                        this.task.assistantMessageParser.getContentBlocks(),
                    );

                    if (maxToolCalls > 0) {
                        this.task.assistantMessageContent = this.trimBlocksToCompletedToolLimit(
                            this.task.assistantMessageContent as any[],
                            maxToolCalls,
                        )
                    }

                    // Silently drop incomplete unified/xml tool calls at stream end.
                    // They are usually truncated (missing closer/args) and should never execute.
                    this.task.assistantMessageContent = this.task.assistantMessageContent.filter((block: any) => {
                        if (
                            (block.type === "tool_use" || block.type === "mcp_tool_use") &&
                            (block as any).isComplete === false
                        ) {
                            console.warn(
                                `[AgentLoop] Dropping incomplete tool call at stream end: ${(block as any).name || "unknown"} (${(block as any).id || "no-id"})`,
                            )
                            return false
                        }
                        return true
                    })

                    // Defensive recovery: if text-based parsing collapses to zero blocks even though
                    // the model streamed non-empty text, keep the raw assistant text as a normal text block
                    // instead of letting the turn become an "empty send".
                    if (
                        this.task.assistantMessageContent.length === 0 &&
                        assistantMessage.trim().length > 0
                    ) {
                        const recoveredText =
                            typeof (this.task.assistantMessageParser as any).trimRawMessageAfterLastCompletedTool === "function"
                                ? (this.task.assistantMessageParser as any).trimRawMessageAfterLastCompletedTool(assistantMessage)
                                : assistantMessage

                        if (recoveredText.trim().length > 0) {
                            console.warn("[AgentLoop] Recovered raw assistant text after parser produced zero blocks.")
                            this.task.assistantMessageContent.push({
                                type: "text",
                                content: recoveredText.trim(),
                                partial: false,
                            })
                        }
                    }

                    // kilocode_change: Call handlePartial for the active streaming tool (Unified/XML)
                    // This ensures that any pending text flushed during finalization (e.g. the last few lines of a write)
                    // is sent to the tool UI.
                    const activeBlock = this.getLatestToolUseBlock()
                    if (activeBlock) {
                        await this.handlePartialUpdate(activeBlock);
                    }
                }

                // Update api_req_started message with cost info to stop spinner
                // The UI shows spinner until the message has a cost value
                const apiReqIndex = findLastIndex(this.task.clineMessages, (m) => m.say === "api_req_started")
                if (apiReqIndex !== -1 && this.task.clineMessages[apiReqIndex]) {
                    const existingInfo = JSON.parse(this.task.clineMessages[apiReqIndex].text || "{}")
                    this.task.clineMessages[apiReqIndex].text = JSON.stringify({
                        ...existingInfo,
                        cost: totalCost ?? 0,
                        tokensIn: inputTokens,
                        tokensOut: outputTokens,
                        cacheWrites: cacheWriteTokens,
                        cacheReads: cacheReadTokens,
                        inferenceProvider,
                        usageMissing,
                    } satisfies ClineApiReqInfo)
                    await this.task.updateClineMessage(this.task.clineMessages[apiReqIndex])
                }

                // Finalize partial blocks
                const partialBlocks = this.task.assistantMessageContent.filter((block: any) => block.partial)
                partialBlocks.forEach((block: any) => (block.partial = false))

                // Finalize Native Tools (Hybrid Recovery) - skip when text-based protocol handles tools
                if (!shouldSkipNativeTools) {
                    const finalEvents = NativeToolCallParser.finalizeRawChunks()
                    for (const event of finalEvents) {
                        if (event.type === "tool_call_end") {
                            const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
                            const toolUseIndex = this.task.streamingToolCallIndices.get(event.id)
                            if (finalToolUse && toolUseIndex !== undefined) {
                                (finalToolUse as any).id = event.id
                                this.task.assistantMessageContent[toolUseIndex] = finalToolUse
                                this.task.userMessageContentReady = false

                                // kilocode_change: Ensure final update is sent during recovery
                                await this.handlePartialUpdate(finalToolUse, event.id);
                            }
                        }
                    }
                }

                // kilocode_change: Call presentAssistantMessage WITHOUT await!
                // It may block on user interaction (tool approvals), so we let it run async.
                // The pWaitFor below will wait for userMessageContentReady which 
                // presentAssistantMessage sets when ALL blocks are processed.
                presentAssistantMessage(this.task).catch((error) => {
                    console.error("[AgentLoop] Error in presentAssistantMessage:", error)
                    this.task.userMessageContentReady = true // Ensure we don't hang
                    this.task.presentAssistantMessageLocked = false // Failsafe unlock
                })

                // Reasoning completion
                if (reasoningMessage) {
                    const lastReasoningIndex = findLastIndex(
                        this.task.clineMessages,
                        (m) => m.type === "say" && m.say === "reasoning",
                    )
                    if (lastReasoningIndex !== -1 && this.task.clineMessages[lastReasoningIndex].partial) {
                        this.task.clineMessages[lastReasoningIndex].partial = false
                        if (reasoningStartTime) {
                            const durationMs = Date.now() - reasoningStartTime
                                ; (this.task.clineMessages[lastReasoningIndex] as any).metadata = {
                                    ...this.task.clineMessages[lastReasoningIndex].metadata,
                                    reasoningDurationMs: durationMs,
                                }
                        }
                        await this.task.updateClineMessage(this.task.clineMessages[lastReasoningIndex])
                    }
                }

                await this.task.saveClineMessages()
                // PERF: Use debounced — saveClineMessages above already triggers metadata update
                this.task.providerRef.deref()?.debouncedPostStateToWebview()
                const assistantMessageParser = this.task.assistantMessageParser
                this.task.assistantMessageParser?.reset()

                // Finalize turn and add to history
                // (Already finalized parser and blocks above)

                const toolProtocol = resolveToolProtocol(this.task.apiConfiguration, this.task.api.getModel().info)
                const isTextBasedProtocol = (toolProtocol as string) === "unified" || (toolProtocol as string) === "markdown"
                let assistantHistoryText = assistantMessage
                if (
                    isTextBasedProtocol &&
                    assistantMessageParser &&
                    "trimRawMessageAfterLastCompletedTool" in assistantMessageParser &&
                    typeof assistantMessageParser.trimRawMessageAfterLastCompletedTool === "function"
                ) {
                    assistantHistoryText = assistantMessageParser.trimRawMessageAfterLastCompletedTool(assistantMessage)
                }

                const hasFinalTextContent = assistantHistoryText.length > 0
                const hasFinalToolUses = this.task.assistantMessageContent.some(
                    (block: any) => block.type === "tool_use" || block.type === "mcp_tool_use"
                ) || this.task.userMessageContent.some(
                    (block: any) => block.type === "text" && (block as any)._toolUseId
                )

                if (hasFinalTextContent || hasFinalToolUses) {
                    if (pendingGroundingSources.length > 0) {
                        const sourcesText = "\n\nGrounding Sources:\n" + pendingGroundingSources.map(s => `- ${s}`).join("\n")
                        assistantHistoryText += sourcesText
                    }

                    // Build assistant content
                    const assistantContent: Anthropic.Messages.ContentBlockParam[] = []
                    assistantContent.push(...antThinkingContent as any)
                    if (assistantHistoryText) {
                        assistantContent.push({ type: "text", text: assistantHistoryText })
                    }

                    // Add tool uses...
                    // For Unified/Markdown protocol, tool calls are already in the text block, so we skip adding
                    // formal tool_use blocks to avoid "Double Vision" (AI seeing the same call twice).
                    if (!isTextBasedProtocol) {
                        const toolUseBlocks = this.task.assistantMessageContent.filter(
                            (block: any) => block.type === "tool_use" || block.type === "mcp_tool_use"
                        )
                        for (const block of toolUseBlocks) {
                            if (block.type === "mcp_tool_use") {
                                const mcpBlock = block as any
                                if (mcpBlock.id) {
                                    assistantContent.push({
                                        type: "tool_use",
                                        id: mcpBlock.id,
                                        name: mcpBlock.name,
                                        input: mcpBlock.arguments
                                    })
                                }
                            } else {
                                const toolUse = block as ToolUse
                                // kilocode_change: Only add JSON tool_use blocks for real native protocol IDs
                                // Skip xml_ prefixed IDs (synthetic IDs from XML parser for EditHistoryService)
                                // and toolUseId (XML protocol internal tracking)
                                const id = toolUse.id || (toolUse as any).toolUseId
                                if (id && !id.startsWith("xml_")) {
                                    const input = toolUse.nativeArgs || toolUse.params
                                    const toolNameForHistory = toolUse.originalName ?? toolUse.name
                                    assistantContent.push({
                                        type: "tool_use",
                                        id: id,
                                        name: toolNameForHistory,
                                        input: input as any
                                    })
                                }
                            }
                        }
                    }

                    await this.task.addToApiConversationHistory({
                        role: "assistant",
                        content: assistantContent
                    }, reasoningMessage || undefined)

                    TelemetryService.instance.captureConversationMessage(this.task.taskId, "assistant")

                    // WAIT FOR TOOLS - this waits for presentAssistantMessage to finish processing
                    // For text blocks, this is instant. For tools, it waits for execution/user approval.
                    // The "Thinking" spinner is stopped by api_req_finished sent in tool handlers.
                    // Added safety timeout to prevent indefinite hang
                    try {
                        // Increased timeout to 5 minutes for free models which can be slower
                        // Free models on kilo gateway may have rate limiting or slower response times
                        const timeoutMs = 300_000 // 5 minutes
                        await pWaitFor(() => this.task.userMessageContentReady, { timeout: timeoutMs, interval: 100 })
	                    } catch (e) {
	                        console.warn("[AgentLoop] Timeout waiting for tool execution. Auto-continuing to prevent deadlock.");
	                        this.task.userMessageContentReady = true;
	                        this.task.presentAssistantMessageLocked = false;
	                        this.task.presentAssistantMessageHasPendingUpdates = false;

	                        // Never auto-continue a task that has already been cancelled or abandoned.
	                        // Doing so can revive stale chats after the UI has moved on.
	                        if (this.task.abort || this.task.abandoned || this.task.abortReason === "user_cancelled") {
	                            await this.task.say("api_req_finished")
	                            return false
	                        }

	                        // Auto-continue genuinely live tasks instead of pausing forever.
	                        if (this.task.userMessageContent.length === 0) {
	                            this.task.userMessageContent.push({
	                                type: "text" as const,
	                                text: "[System: Continuing after timeout]",
	                            })
	                        }
	                    }

                    // For Unified protocol, where tool calls are part of the text,
                    // we must ensure the thinking spinner is cleared once all tools are done.
                    const protocol = resolveToolProtocol(this.task.apiConfiguration, this.task.api.getModel().info)
                    if ((protocol as string) === "unified" && hasFinalToolUses) {
                        await this.task.say("api_req_finished")
                    }

                    // Check if attempt_completion was used - if so and no feedback was given, task is done
                    const usedAttemptCompletion = this.task.assistantMessageContent.some(
                        (block: any) => block.type === "tool_use" && block.name === "attempt_completion"
                    )

                    if (usedAttemptCompletion && this.task.userMessageContent.length === 0) {
                        // Task completed and user accepted - exit the loop
                        await this.task.say("api_req_finished")
                        return false
                    }

                    // kilocode_change: In our conversation-first approach, we don't nag the AI
                    // with "noToolsUsed" anymore. We trust it to respond conversationally
                    // and wait for user input if no actions are needed.
                    /*
                    const didToolUse = this.task.assistantMessageContent.some(
                        (block: any) => block.type === "tool_use" || block.type === "mcp_tool_use"
                    )
         
                    if (!didToolUse) {
                        // NAG Logic
                        const toolProtocol = resolveToolProtocol(this.task.apiConfiguration, this.task.api.getModel().info)
                        this.task.userMessageContent.push({ type: "text", text: formatResponse.noToolsUsed(toolProtocol) })
                        this.task.consecutiveMistakeCount++
                    }
                    */

                    // kilocode_change start: Dynamic Context Processing
                    // Updated to handle _toolUseIds array for multi-file reads AND @file mentions
                    if (this.task.userMessageContent.length > 0) {
                        // Collect all file mentions first to ensure deterministic processing
                        const fileMentions: Map<string, { start: number; end: number }[]> = new Map()

                        for (const block of this.task.userMessageContent) {
                            // 1. Scan for @file mentions in text blocks
                            if (block.type === "text") {
                                const text = block.text
                                // Regex to find <file_content path="..."> tags (generated by mentions)
                                const fileContentRegex = /<file_content\s+path="([^"]+)"/g
                                let match
                                while ((match = fileContentRegex.exec(text)) !== null) {
                                    const filePath = match[1]
                                    if (filePath) {
                                        console.log(`[AgentLoop] 🧖 Tracking mentioned file for Luxury Spa: ${filePath}`)
                                        // Track full file (undefined range) for mentions
                                        if (!fileMentions.has(filePath)) {
                                            fileMentions.set(filePath, [])
                                        }
                                    }
                                }
                            }

                            // 2. Scan for tool use IDs (read_file, edit, etc.)
                            // kilocode_change: Get ALL tool IDs - use array if present, fall back to single ID
                            const toolUseIds: string[] = (block as any)._toolUseIds ||
                                ((block as any).tool_use_id ? [(block as any).tool_use_id] :
                                    ((block as any)._toolUseId ? [(block as any)._toolUseId] : []))

                            // Process each tool ID (handles multi-file reads correctly)
                            for (const toolUseId of toolUseIds) {
                                if (!toolUseId) continue

                                const toolUse = this.task.assistantMessageContent.find((b: any) =>
                                    (b.type === 'tool_use' || b.type === 'mcp_tool_use') && (b as any).id === toolUseId
                                )

                                if (toolUse) {
                                    const name = (toolUse as any).name
                                    const args = (toolUse as any).params || (toolUse as any).input || (toolUse as any).nativeArgs || (toolUse as any).arguments || {}
                                    const rawPath = args.path || args.file_path || args.target_file
                                    const isError = (block as any).is_error

                                    if (!isError && rawPath) {
                                        const filePaths = typeof rawPath === 'string' ? rawPath.split(',').map(p => p.trim()).filter(Boolean) : [rawPath]
                                        for (const filePath of filePaths) {
                                            // 1. Handle Reads: Track and prune old context
                                            if (name === 'read_file' || name === 'read') {
                                                // kilocode_change: Extract line ranges from nativeArgs if available
                                                const nativeArgs = (toolUse as any).nativeArgs || {}
                                                let lineRanges: { start: number; end: number }[] | undefined
                                                // kilocode_change: Use the clean path from nativeArgs.files if available
                                                // For XML shorthand, args.path may contain line range (e.g. "file.txt 1-7")
                                                // but nativeArgs.files[].path is already clean
                                                let cleanFilePath = filePath

                                                // Check for line ranges in nativeArgs.files (multi-file format)
                                                if (nativeArgs.files && Array.isArray(nativeArgs.files)) {
                                                    const fileEntry = nativeArgs.files.find((f: any) =>
                                                        f.path === filePath ||
                                                        f.path === rawPath ||
                                                        filePath.includes(f.path) ||
                                                        f.path.includes(filePath)
                                                    )
                                                    if (fileEntry) {
                                                        // Use the clean path from nativeArgs
                                                        cleanFilePath = fileEntry.path
                                                        if (fileEntry.lineRanges && fileEntry.lineRanges.length > 0) {
                                                            lineRanges = fileEntry.lineRanges
                                                                .filter((r: any) => r.start !== undefined && r.end !== undefined)
                                                                .map((r: any) => ({ start: r.start, end: r.end }))
                                                        }
                                                    }
                                                } else if (filePaths.length === 1) {
                                                    // Fallback: Check for legacy/standard params in 'args'
                                                    if (args.line_range) {
                                                        const ranges = Array.isArray(args.line_range) ? args.line_range : [args.line_range]
                                                        const extractedRanges: { start: number; end: number }[] = []
                                                        for (const range of ranges) {
                                                            const match = String(range).match(/(\d+)-(\d+)/)
                                                            if (match) {
                                                                const start = parseInt(match[1])
                                                                const end = parseInt(match[2])
                                                                if (!isNaN(start) && !isNaN(end)) {
                                                                    extractedRanges.push({ start, end })
                                                                }
                                                            }
                                                        }
                                                        if (extractedRanges.length > 0) {
                                                            lineRanges = extractedRanges
                                                        }
                                                    } else if (args.start_line && args.end_line) {
                                                        const start = parseInt(args.start_line)
                                                        const end = parseInt(args.end_line)
                                                        if (!isNaN(start) && !isNaN(end)) {
                                                            lineRanges = [{ start, end }]
                                                        }
                                                    }

                                                    // kilocode_change: If we still have a range in the path but no lineRanges extracted,
                                                    // strip the range from the path to get a clean filename for tracking
                                                    if (!lineRanges) {
                                                        const rangeMatch = cleanFilePath.match(/^(.*?)(?::|\s+)(\d+)-(\d+)$/)
                                                        if (rangeMatch) {
                                                            cleanFilePath = rangeMatch[1].trim()
                                                            const start = parseInt(rangeMatch[2], 10)
                                                            const end = parseInt(rangeMatch[3], 10)
                                                            if (!isNaN(start) && !isNaN(end)) {
                                                                lineRanges = [{ start, end }]
                                                            }
                                                        }
                                                    }
                                                }

                                                // Store in Map with line ranges using clean path (merge additive)
                                                // Collect first, merge later for deterministic ordering
                                                if (!fileMentions.has(cleanFilePath)) {
                                                    fileMentions.set(cleanFilePath, [])
                                                }
                                                if (lineRanges && lineRanges.length > 0) {
                                                    const existing = fileMentions.get(cleanFilePath) || []
                                                    fileMentions.set(cleanFilePath, [...existing, ...lineRanges])
                                                }
                                            }

                                            // 2. Handle Modifications: Invalidate context and add reminders
                                            const isModification = name === 'edit' || name === 'write_to_file' || name === 'replace_in_file' || name === 'apply_diff' || name === 'edit_file'
                                            const isDeletion = name === 'delete_file'

                                            if (isDeletion) {
                                                this.task.luxurySpa.activeFileReads.delete(filePath)
                                                this.task.luxurySpa.fileEditCounts.delete(path.resolve(this.task.cwd, filePath))
                                            } else if (isModification) {
                                                // kilocode_change: Modified files get tracked as full-file if not already partial.
                                                // We normalize the path (e.g. stripping ./ ) to match how reads are tracked.
                                                const normalizedPath = filePath.replace(/^(\.\/|\.\\)/, "")
                                                if (!fileMentions.has(normalizedPath)) {
                                                    fileMentions.set(normalizedPath, [])
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Now apply all collected mentions in a deterministic order (sorted by path)
                        // This ensures consistent merging regardless of processing order
                        const sortedPaths = Array.from(fileMentions.keys()).sort()
                        for (const cleanFilePath of sortedPaths) {
                            const lineRanges = fileMentions.get(cleanFilePath)
                            // If lineRanges is empty array, it means full file (undefined)
                            const rangesToMerge = lineRanges && lineRanges.length > 0 ? lineRanges : undefined
                            this.task.luxurySpa.mergeLineRanges(cleanFilePath, rangesToMerge)
                        }

                        // Refresh once after all merges for efficiency
                        await this.task.luxurySpa.refreshAllActiveContexts()
                    }
                    // kilocode_change end

                    if (this.task.userMessageContent.length > 0 || this.task.isPaused) {
                        stack.push({
                            userContent: [...this.task.userMessageContent],
                            includeFileDetails: false,
                        })
                        await new Promise((resolve) => setTimeout(resolve, 0))

                        continue
                    }
                    // No more content to process - exit the loop (task complete or conversational response)
                    // Send api_req_finished to clear the "Thinking" indicator
                    await this.task.say("api_req_finished")
                    break // Exit the while loop
                } else {
                    // Empty Response Handling
                    // ... Simplified for now
                    await this.task.say("api_req_finished")
                    return true // End loop on error
                }

            } catch (error: any) {
                console.error("AgentLoop Error", error)
                this.task.isStreaming = false
                
                if (this.task.abort) {
                    // Task is fully aborting (background close/delete)
                    this.task.abortReason = "streaming_failed"
                    await this.task.say("api_req_finished")
                    await this.task.abortTask()
                    return true
                }
                
                // If it's just a stream cancellation from the stop button or network error
                const isAbort = error.name === "AbortError" || 
                                error.message?.includes("Abort") || 
                                error.message?.includes("aborted") ||
                                error.message?.includes("cancelled by user");
                                
                if (isAbort) {
                    // Clean up partial blocks so they don't break the API on the next turn
                    if (this.task.assistantMessageContent) {
                        this.task.assistantMessageContent.forEach((block: any) => {
                            block.partial = false
                        })
                        // Remove partial tool calls that haven't been completed
                        this.task.assistantMessageContent = this.task.assistantMessageContent.filter((block: any) => {
                            if ((block.type === "tool_use" || block.type === "mcp_tool_use") && (block as any).isComplete === false) {
                                return false
                            }
                            // Also remove incomplete Native tool calls
                            if (block.type === "tool_use" && !block.name) {
                                return false
                            }
                            return true
                        })
                    }

                    await this.task.say("api_req_finished")
                    await this.task.say("text", "\n\n[Response interrupted by user]")
                    return false
                }
                
                this.task.abortReason = "streaming_failed"
                await this.task.say("api_req_finished")
                await this.task.say("error", `Streaming failed: ${error.message}`)
                return false
            }
        } // End While(stack)

        return false
    }
}
