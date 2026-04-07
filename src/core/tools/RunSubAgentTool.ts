import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { getModeBySlug } from "../../shared/modes"
interface RunSubAgentParams {
    prompt: string
    mode?: string
    api_provider?: string
    model_id?: string
    parallelMode?: boolean
    teamId?: string
    teamRole?: "leader" | "worker" | "validator"
}

export class RunSubAgentTool extends BaseTool<"agent"> {
    readonly name = "agent" as const

    parseLegacy(params: Partial<Record<string, string>>): RunSubAgentParams {
        return {
            prompt: params.prompt || "",
            mode: params.mode,
            api_provider: params.api_provider,
            model_id: params.model_id,
            parallelMode: params.parallelMode === "true",
            teamId: params.teamId,
            teamRole: params.teamRole as "leader" | "worker" | "validator" | undefined
        }
    }

    async execute(params: RunSubAgentParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { prompt, mode, api_provider, model_id, parallelMode, teamId, teamRole } = params
        const { pushToolResult, askApproval, handleError } = callbacks

        try {
            const provider = task.providerRef.deref()
            if (!provider) {
                pushToolResult(formatResponse.toolError("Provider reference lost"))
                return
            }

            if (!prompt) {
                task.consecutiveMistakeCount++
                task.recordToolError("agent")
                task.didToolFailInCurrentTurn = true
                pushToolResult(await task.sayAndCreateMissingParamError("agent", "prompt"))
                return
            }

            // Un-escape one level of backslashes before '@'
            const unescapedMessage = prompt.replace(/\\\\@/g, "\\@")

            const state = await provider.getState()

            // Verify mode if provided
            let targetMode
            if (mode) {
                targetMode = getModeBySlug(mode, state.customModes)
                if (!targetMode) {
                    pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
                    return
                }
            }

            const modeToUse = mode || await task.getTaskMode()

            const toolMessage = JSON.stringify({
                tool: "agent",
                mode: modeToUse,
                prompt: prompt,
                api_provider,
                model_id,
                autonomous: true,
                parallelMode: parallelMode ?? true, // Default to parallelMode for isolation
                teamId,
                teamRole: teamRole ?? "worker", // Default to worker role
                id: callbacks.toolCallId,
            })

            const didApprove = await askApproval("tool", toolMessage)
            if (!didApprove) {
                return
            }

            if (task.enableCheckpoints) {
                task.checkpointSave(true)
            }

            // Start sub-agent by creating a new task in the extension
            const subAgentPrompt = `[Sub Agent] ${unescapedMessage}`

            // The mode switch must happen before createTask() because the Task constructor
            // initializes its mode from provider.getState() during initializeTaskMode().
            // 
            // kade_change: If no specific provider/model was requested by the tool,
            // fall back to the user's configured sub-agent model from settings, or their current active profile.
            const subAgentConfig = state.subAgentApiConfiguration || {}
            provider.log(`[RunSubAgentTool] Sub-agent configuration from state: ${JSON.stringify(subAgentConfig)}`)
            provider.log(`[RunSubAgentTool] Main API configuration: ${state.apiConfiguration.apiProvider} / ${state.apiConfiguration.apiModelId}`)

            // kade_change: Properly merge configurations.
            // We want to use sub-agent settings as overrides on top of the main configuration
            // to ensure credentials (API keys) are inherited.
            const baseConfig = {
                ...state.apiConfiguration,
                ...subAgentConfig,
            }

            // If the tool call explicitly requested a provider/model, those take highest precedence.
            const subAgentApiConfig = {
                ...baseConfig,
                apiProvider: api_provider || baseConfig.apiProvider || state.apiConfiguration.apiProvider,
            }

            // Update the specific model ID based on the provider
            const targetProvider = subAgentApiConfig.apiProvider
            const targetModelId = model_id || (subAgentConfig.apiProvider === targetProvider ? subAgentConfig.apiModelId : undefined) || state.apiConfiguration.apiModelId

            if (targetProvider === "openrouter") subAgentApiConfig.openRouterModelId = targetModelId
            else if (targetProvider === "glama") subAgentApiConfig.glamaModelId = targetModelId
            else if (targetProvider === "ollama") subAgentApiConfig.ollamaModelId = targetModelId
            else if (targetProvider === "lmstudio") subAgentApiConfig.lmStudioModelId = targetModelId
            else if (targetProvider === "kilocode") subAgentApiConfig.kilocodeModel = targetModelId
            else if (targetProvider === "anthropic") subAgentApiConfig.apiModelId = targetModelId
            else subAgentApiConfig.apiModelId = targetModelId

            const taskConfig = {
                mode: modeToUse,
                currentApiConfigName: state.currentApiConfigName,
                ...subAgentApiConfig, // Flatten the config for setValues in createTask
            }
            provider.log(`[RunSubAgentTool] Final sub-agent task config: ${taskConfig.apiProvider} / ${taskConfig.apiModelId || (taskConfig as any).openRouterModelId || (taskConfig as any).kilocodeModel}`)

            // We use the provider to create a new task, passing the specific configuration
            await provider.createTask(subAgentPrompt, undefined, task, {
                initialStatus: "active"
            }, taskConfig as any)

            pushToolResult(`Started autonomous sub-agent for: "${prompt}". A new chat has been created for this sub-task.`)
            return
        } catch (error) {
            await handleError("running sub-agent", error)
            return
        }
    }

    override async handlePartial(task: Task, block: ToolUse<"agent">): Promise<void> {
        if (!block.partial) {
            return
        }

        const mode: string | undefined = block.params.mode
        const prompt: string | undefined = block.params.prompt
        const api_provider: string | undefined = block.params.api_provider
        const model_id: string | undefined = block.params.model_id

        const partialMessage = JSON.stringify({
            tool: "agent",
            mode: this.removeClosingTag("mode", mode, block.partial),
            prompt: this.removeClosingTag("prompt", prompt, block.partial),
            api_provider: this.removeClosingTag("api_provider" as any, api_provider, block.partial),
            model_id: this.removeClosingTag("model_id" as any, model_id, block.partial),
            id: block.id,
        })

        await task.say("tool", partialMessage, undefined, block.partial).catch(() => { })
    }
}

export const runSubAgentTool = new RunSubAgentTool()
