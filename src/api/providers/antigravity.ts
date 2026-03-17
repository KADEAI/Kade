import { Anthropic } from "@anthropic-ai/sdk"
import { StringDecoder } from "string_decoder"
import { type AntigravityModelId, antigravityDefaultModelId, antigravityModels, ModelInfo } from "@roo-code/types"
import { ApiHandlerOptions } from "../../shared/api"
import { t } from "../../i18n"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { antigravityOAuthManager } from "../../integrations/antigravity/oauth"
import { generateFingerprint, buildFingerprintHeaders, Fingerprint } from "../../integrations/antigravity/fingerprint"
import * as crypto from "crypto"

import { ANTIGRAVITY_VERSION } from "../../integrations/antigravity/constants"

// Code Assist API Configuration

const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
**Absolute paths only**
**Proactiveness**

<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>
`

const CLAUDE_INTERLEAVED_THINKING_HINT =
    "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";

/**
 * Strips unsupported keywords from JSON schemas for Claude/Antigravity compatibility.
 */
function cleanSchemaForClaude(schema: any): any {
    if (!schema || typeof schema !== "object") return schema;
    const cleaned = { ...schema };
    const unsupported = ["additionalProperties", "minLength", "maxLength", "pattern", "format", "default"];
    unsupported.forEach(key => delete cleaned[key]);
    if (cleaned.properties) {
        Object.keys(cleaned.properties).forEach(key => {
            cleaned.properties[key] = cleanSchemaForClaude(cleaned.properties[key]);
        });
    }
    if (cleaned.items) cleaned.items = cleanSchemaForClaude(cleaned.items);
    return cleaned;
}

// Using production endpoint as primary, consistent with 9router
const ANTIGRAVITY_ENDPOINTS = [
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://autopush-cloudcode-pa.sandbox.googleapis.com",
]
const CODE_ASSIST_API_VERSION = "v1internal"

// Models ported from 9router
const ANTIGRAVITY_MODELS: Record<string, ModelInfo> = {
    "gemini-3.1-pro-low": {
        maxTokens: 8192,
        contextWindow: 2097152,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Gemini 3 Pro Low (Antigravity)",
        supportsReasoningEffort: true,
        reasoningEffort: "low",
    },
    "gemini-3.1-pro-high": {
        maxTokens: 8192,
        contextWindow: 2097152,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Gemini 3 Pro High (Antigravity)",
        supportsReasoningEffort: true,
        reasoningEffort: "high",
    },
    "gemini-3-flash": {
        maxTokens: 8192,
        contextWindow: 1048576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Gemini 3 Flash (Antigravity)",
        supportsReasoningEffort: true,
    },
    "gemini-2.5-flash": {
        maxTokens: 8192,
        contextWindow: 1048576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Gemini 2.5 Flash (Antigravity)",
        supportsReasoningBudget: true,
    },
    "claude-sonnet-4-5": {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude Sonnet 4.5 (Antigravity)",
    },
    "claude-sonnet-4-5-thinking": {
        maxTokens: 32768,
        contextWindow: 200000,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude Sonnet 4.5 Thinking (Antigravity)",
        supportsReasoningBudget: true,
        requiredReasoningBudget: true,
    },
    "claude-opus-4-5-thinking": {
        maxTokens: 32768,
        contextWindow: 200000,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Claude Opus 4.5 Thinking (Antigravity)",
        supportsReasoningBudget: true,
        requiredReasoningBudget: true,
    },
}

export class AntigravityHandler extends BaseProvider implements SingleCompletionHandler {
    protected options: ApiHandlerOptions
    private fingerprint: Fingerprint

    constructor(options: ApiHandlerOptions) {
        super()
        this.options = options
        this.fingerprint = generateFingerprint()
    }

    private getBaseUrl(index: number = 0): string {
        return ANTIGRAVITY_ENDPOINTS[index] || ANTIGRAVITY_ENDPOINTS[0]
    }

    private async callEndpoint(method: string, body: any, accessToken: string): Promise<any> {
        return this.executeWithFallback("generateContent", async (url) => {
            const response = await fetch(`${url}/${CODE_ASSIST_API_VERSION}:${method}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    ...buildFingerprintHeaders(this.fingerprint),
                },
                body: JSON.stringify(body),
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`${response.status} - ${errorText}`)
            }

            return await response.json()
        })
    }

    /**
     * Parse Server-Sent Events from a stream
     */
    private async *parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
        const reader = stream.getReader()
        const decoder = new TextDecoder("utf-8")
        let buffer = ""

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6).trim()
                        if (data === "[DONE]") continue

                        try {
                            const parsed = JSON.parse(data)
                            yield parsed
                        } catch (e) {
                            console.error("Error parsing SSE data:", e)
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock()
        }

        // Process any remaining buffer
        if (buffer && buffer.startsWith("data: ")) {
            const data = buffer.slice(6).trim()
            if (data !== "[DONE]") {
                try {
                    yield JSON.parse(data)
                } catch (e) {
                    console.error("Error parsing final SSE data:", e)
                }
            }
        }
    }

    private parseRetryHeaders(response: Response): number | null {
        try {
            const retryAfter = response.headers.get('retry-after')
            if (retryAfter) {
                const seconds = parseInt(retryAfter, 10)
                if (!isNaN(seconds) && seconds > 0) return seconds * 1000

                const date = new Date(retryAfter)
                if (!isNaN(date.getTime())) {
                    const diff = date.getTime() - Date.now()
                    return diff > 0 ? diff : null
                }
            }

            const resetAfter = response.headers.get('x-ratelimit-reset-after')
            if (resetAfter) {
                const seconds = parseInt(resetAfter, 10)
                if (!isNaN(seconds) && seconds > 0) return seconds * 1000
            }

            const resetTimestamp = response.headers.get('x-ratelimit-reset')
            if (resetTimestamp) {
                const ts = parseInt(resetTimestamp, 10) * 1000
                const diff = ts - Date.now()
                return diff > 0 ? diff : null
            }
        } catch (e) {
            console.error("Error parsing retry headers:", e)
        }
        return null
    }

    private parseRetryFromErrorMessage(errorMessage: string): number | null {
        if (!errorMessage) return null

        const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i)
        if (!match) return null

        let totalMs = 0
        if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000 // hours
        if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000 // minutes
        if (match[3]) totalMs += parseInt(match[3]) * 1000 // seconds

        return totalMs > 0 ? totalMs : null
    }

    private async executeWithFallback<T>(
        operationName: string,
        operation: (url: string) => Promise<T>
    ): Promise<T> {
        let lastError: any = null
        const fallbackCount = ANTIGRAVITY_ENDPOINTS.length
        const MAX_AUTO_RETRIES = 3
        const retryAttemptsByUrl: Record<number, number> = {}

        for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
            const url = this.getBaseUrl(urlIndex)

            // Initialize retry counter for this URL
            if (!retryAttemptsByUrl[urlIndex]) {
                retryAttemptsByUrl[urlIndex] = 0
            }

            try {
                return await operation(url)
            } catch (error: any) {
                lastError = error

                // Parse status from error message since we don't have the response object here if it threw
                // The error message format is usually "STATUS - Message" from our throw above
                let status = 0
                let errorMessage = error.message || ""

                const statusMatch = errorMessage.match(/^(\d{3}) - /)
                if (statusMatch) {
                    status = parseInt(statusMatch[1])
                    errorMessage = errorMessage.substring(statusMatch[0].length)
                }

                if (status === 429 || status === 503 || status === 500) {
                    let retryMs = this.parseRetryFromErrorMessage(errorMessage)

                    // Note: We can't access headers here easily because we threw an Error, 
                    // but we parsed the text body. If we need headers we'd need to change 
                    // the operation signature to return Response or throw a custom error with headers.
                    // For now, relying on body parsing and default backoff.

                    const MAX_RETRY_AFTER_MS = 10000

                    if (retryMs && retryMs <= MAX_RETRY_AFTER_MS) {
                        console.log(`[Antigravity] Retry-After detected: ${Math.ceil(retryMs / 1000)}s, waiting...`)
                        await new Promise(resolve => setTimeout(resolve, retryMs))
                        urlIndex-- // Retry same URL
                        continue
                    }

                    // Auto retry for 429, 500, 503 when retryMs is 0 or undefined
                    if ((status === 429 || status === 500 || status === 503) && (!retryMs || retryMs === 0) && retryAttemptsByUrl[urlIndex] < MAX_AUTO_RETRIES) {
                        retryAttemptsByUrl[urlIndex]++
                        // Exponential backoff: 2s, 4s, 8s...
                        const backoffMs = Math.min(1000 * Math.pow(2, retryAttemptsByUrl[urlIndex]), MAX_RETRY_AFTER_MS)
                        console.log(`[Antigravity] 429 auto retry ${retryAttemptsByUrl[urlIndex]}/${MAX_AUTO_RETRIES} after ${backoffMs / 1000}s`)
                        await new Promise(resolve => setTimeout(resolve, backoffMs))
                        urlIndex-- // Retry same URL
                        continue
                    }

                    console.log(`[Antigravity] ${status}, Retry-After too long or missing, trying fallback`)

                    if (urlIndex + 1 < fallbackCount) {
                        continue
                    }
                }

                // For 401, fail fast — bad/expired token, no point retrying endpoints
                if (status === 401) {
                    throw error
                }

                // For 403, only fail-fast if it's a genuine permission error (not a license/project-context issue).
                // License/project errors (e.g. #3501 SUBSCRIPTION_REQUIRED) should bubble up so the
                // outer catch in createMessage can retry without the project ID.
                if (status === 403) {
                    const msg = (error.message || "").toLowerCase()
                    const isLicenseOrProjectError =
                        msg.includes("#3501") ||
                        msg.includes("subscription_required") ||
                        msg.includes("code assist license") ||
                        msg.includes("service_disabled") ||
                        msg.includes("has not been used in project") ||
                        msg.includes("failed_precondition") ||
                        msg.includes("precondition check failed") ||
                        msg.includes("invalid project resource name") ||
                        (msg.includes("resource projects/") && msg.includes("could not be found")) ||
                        (msg.includes("project") && msg.includes("not found"))
                    if (!isLicenseOrProjectError) {
                        throw error
                    }
                    // License/project 403 — throw so the outer catch can strip project ID and retry
                    throw error
                }

                // For other errors, try next fallback
                if (urlIndex + 1 < fallbackCount) {
                    console.log(`[Antigravity] Error on ${url}, trying fallback ${urlIndex + 1}`)
                    continue
                }

                throw error
            }
        }

        throw lastError || new Error("All endpoints failed")
    }

    async *createMessage(
        systemInstruction: string,
        messages: Anthropic.Messages.MessageParam[],
        metadata?: ApiHandlerCreateMessageMetadata,
    ): ApiStream {
        const accessToken = await antigravityOAuthManager.getAccessToken()
        if (!accessToken) {
            throw new Error(t("common:errors.antigravity.authFailed"))
        }

        let projectId = await antigravityOAuthManager.getProjectId()
        if (!projectId) {
            throw new Error(t("common:errors.antigravity.projectMissing"))
        }

        const { id: model, info, reasoning: thinkingConfig, maxTokens } = this.getModel()

        const isClaude = model.toLowerCase().includes("claude")
        const fullSystemInstruction = `${ANTIGRAVITY_SYSTEM_INSTRUCTION}\n\n${systemInstruction}`

        // Build tool ID to name map for Gemini message transformation
        const toolIdToName = new Map<string, string>()
        for (const m of messages) {
            if (Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === "tool_use") {
                        toolIdToName.set(part.id, part.name)
                    }
                }
            }
        }

        // Prepare request body for Code Assist API
        // Both Gemini and Claude models via this proxy use the Gemini-style 'contents' structure
        const requestBody: any = {
            model: model,
            project: projectId,
            userAgent: "antigravity",
            requestType: "agent",
            requestId: `agent-${crypto.randomUUID()}`,
            request: {
                contents: messages.flatMap((message) =>
                    convertAnthropicMessageToGemini(message, {
                        includeThoughtSignatures: true,
                        toolIdToName
                    })
                ),
                systemInstruction: {
                    role: "user",
                    parts: [{
                        text: isClaude && metadata?.tools && metadata.tools.length > 0
                            ? fullSystemInstruction + `\n\n${CLAUDE_INTERLEAVED_THINKING_HINT}`
                            : fullSystemInstruction
                    }]
                },
                generationConfig: {
                    temperature: this.options.modelTemperature ?? 0.7,
                    maxOutputTokens: isClaude ? 64000 : (this.options.modelMaxTokens ?? maxTokens ?? 8192),
                },
                sessionId: `-${crypto.randomUUID()}`,
                toolConfig: isClaude ? { functionCallingConfig: { mode: "VALIDATED" } } : undefined,
            },
        }

        // Add tool definitions if present
        if (metadata?.tools && metadata.tools.length > 0) {
            const functionDeclarations = metadata.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: isClaude ? cleanSchemaForClaude(tool.input_schema) : tool.input_schema
            }));
            requestBody.request.tools = [{ functionDeclarations }];
        }

        // Add thinking config if applicable
        if (thinkingConfig) {
            if (isClaude) {
                // Claude models via Antigravity require specific thinking configuration
                requestBody.request.generationConfig.thinkingConfig = {
                    include_thoughts: true,
                    thinking_budget: thinkingConfig.thinkingBudget || maxTokens || 8192
                }
            } else {
                requestBody.request.generationConfig.thinkingConfig = thinkingConfig
            }
        }

        let streamGenerator: AsyncGenerator<any> | undefined;
        let lastStreamError: any = null;
        const MAX_STREAM_RETRIES = 3;

        for (let attempt = 0; attempt < MAX_STREAM_RETRIES; attempt++) {
            try {
                await this.executeWithFallback("streamGenerateContent", async (url) => {
                    const headers: Record<string, string> = {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                        ...buildFingerprintHeaders(this.fingerprint),
                        "Accept": "text/event-stream",
                    }

                    if (isClaude && thinkingConfig) {
                        headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"
                    }

                    const response = await fetch(`${url}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(requestBody),
                    })

                    if (!response.ok || !response.body) {
                        const errorText = await response.text()
                        throw new Error(`${response.status} - ${errorText}`)
                    }

                    streamGenerator = this.parseSSEStream(response.body)
                    return streamGenerator
                })
                
                if (streamGenerator) break;
            } catch (error: any) {
                lastStreamError = error;
                const errorMsg = (error.message || "").toLowerCase();
                // If it's a transient server error, hide it and retry silently
                if (errorMsg.includes("500") || errorMsg.includes("503") || errorMsg.includes("429")) {
                    console.log(`[Antigravity] Hiding transient error ${error.message}, retrying silently (attempt ${attempt + 1})`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                    continue;
                }
                throw error; // Permanent error, let it surface
            }
        }

        try {

            // Re-throw if no stream generator (shouldn't happen if no error thrown)
            if (!streamGenerator) {
                throw new Error("Failed to initialize stream")
            }

            // Process the SSE stream
            let lastUsageMetadata: any = undefined

            for await (const jsonData of streamGenerator) {
                // Extract content from the response
                const responseData = jsonData.response || jsonData
                const candidate = responseData.candidates?.[0]

                if (candidate?.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.text) {
                            // Check if this is a thinking/reasoning part
                            if (part.thought === true) {
                                yield {
                                    type: "reasoning",
                                    text: part.text,
                                }
                            } else {
                                yield {
                                    type: "text",
                                    text: part.text,
                                }
                            }
                        }
                    }
                }

                // Store usage metadata for final reporting
                if (responseData.usageMetadata) {
                    lastUsageMetadata = responseData.usageMetadata
                }

                // Check if this is the final chunk
                if (candidate?.finishReason) {
                    break
                }
            }

            // Yield final usage information
            if (lastUsageMetadata) {
                const inputTokens = lastUsageMetadata.promptTokenCount ?? 0
                const outputTokens = lastUsageMetadata.candidatesTokenCount ?? 0
                const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
                const reasoningTokens = lastUsageMetadata.thoughtsTokenCount

                yield {
                    type: "usage",
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    reasoningTokens,
                    totalCost: 0, // Free tier - all costs are 0
                }
            }
        } catch (error: any) {
            // If the error is a project context issue (SERVICE_DISABLED, license error, project not found),
            // retry once WITHOUT a project ID — the API will use its own default routing.
            // This matches the AntigravityManager reference implementation's isProjectContextError behavior.
            const errorMsg = (error.message || "").toLowerCase()
            const isProjectContextError =
                errorMsg.includes("service_disabled") ||
                errorMsg.includes("has not been used in project") ||
                errorMsg.includes("failed_precondition") ||
                errorMsg.includes("precondition check failed") ||
                errorMsg.includes("#3501") ||
                errorMsg.includes("subscription_required") ||
                (errorMsg.includes("google cloud project") && errorMsg.includes("code assist license")) ||
                errorMsg.includes("invalid project resource name projects/") ||
                (errorMsg.includes("resource projects/") && errorMsg.includes("could not be found")) ||
                (errorMsg.includes("project") && errorMsg.includes("not found"))
            if (isProjectContextError && requestBody.project) {
                console.log(`[Antigravity] Project ${projectId} context error, retrying without project ID`)
                delete requestBody.project

                let retryStreamGenerator: AsyncGenerator<any> | undefined
                await this.executeWithFallback("streamGenerateContent", async (url) => {
                    const retryHeaders: Record<string, string> = {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                        ...buildFingerprintHeaders(this.fingerprint),
                        "Accept": "text/event-stream",
                    }
                    if (isClaude && thinkingConfig) {
                        retryHeaders["anthropic-beta"] = "interleaved-thinking-2025-05-14"
                    }
                    const response = await fetch(`${url}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`, {
                        method: "POST",
                        headers: retryHeaders,
                        body: JSON.stringify(requestBody),
                    })
                    if (!response.ok || !response.body) {
                        const errorText = await response.text()
                        throw new Error(`${response.status} - ${errorText}`)
                    }
                    retryStreamGenerator = this.parseSSEStream(response.body)
                    return retryStreamGenerator
                })

                if (!retryStreamGenerator) {
                    throw new Error("Failed to initialize stream with default project")
                }

                let lastUsageMetadata: any = undefined
                for await (const jsonData of retryStreamGenerator) {
                    const responseData = jsonData.response || jsonData
                    const candidate = responseData.candidates?.[0]
                    if (candidate?.content?.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.text) {
                                if (part.thought === true) {
                                    yield { type: "reasoning", text: part.text }
                                } else {
                                    yield { type: "text", text: part.text }
                                }
                            }
                        }
                    }
                    if (responseData.usageMetadata) {
                        lastUsageMetadata = responseData.usageMetadata
                    }
                    if (candidate?.finishReason) break
                }
                if (lastUsageMetadata) {
                    yield {
                        type: "usage",
                        inputTokens: lastUsageMetadata.promptTokenCount ?? 0,
                        outputTokens: lastUsageMetadata.candidatesTokenCount ?? 0,
                        cacheReadTokens: lastUsageMetadata.cachedContentTokenCount,
                        reasoningTokens: lastUsageMetadata.thoughtsTokenCount,
                        totalCost: 0,
                    }
                }
                return
            }

            console.error("[Antigravity] API Error:", error)
            throw new Error(t("common:errors.antigravity.apiError", { error: error.message }))
        }
    }

    override getModel() {
        const modelId = this.options.apiModelId
        // Handle :thinking suffix before checking if model exists
        const baseModelId = modelId?.endsWith(":thinking") ? modelId.replace(":thinking", "") : modelId

        let id = baseModelId || antigravityDefaultModelId

        // Handle Gemini 3 Pro default to -low if no tier specified
        // This matches opencode-antigravity-auth behavior where Pro defaults to Low tier
        if (id === "gemini-3-pro" || id === "gemini-3-pro-preview") {
            id = "gemini-3-pro-low"
        }

        // Claude thinking models via Antigravity often expect a tier suffix or specific ID
        // The reference resolver maps many Claude variants. For now, ensuring we use the base ID.
        if (id.startsWith("claude-") && id.includes("-thinking")) {
            // If the user selected a thinking model, we keep it as is
        }

        let info: ModelInfo | undefined

        // Check local 9router models first
        if (id && id in ANTIGRAVITY_MODELS) {
            info = ANTIGRAVITY_MODELS[id]
        } else {
            // Fallback to shared types or default
            info = antigravityModels[id as AntigravityModelId]
            if (!info) {
                id = antigravityDefaultModelId
                info = antigravityModels[id as AntigravityModelId]
            }
        }

        const params = getModelParams({ format: "gemini", modelId: id, model: info, settings: this.options })

        return { id, info, ...params }
    }

    async completePrompt(prompt: string): Promise<string> {
        const accessToken = await antigravityOAuthManager.getAccessToken()
        if (!accessToken) {
            throw new Error(t("common:errors.antigravity.authFailed"))
        }

        const projectId = await antigravityOAuthManager.getProjectId()
        if (!projectId) {
            throw new Error(t("common:errors.antigravity.projectMissing"))
        }

        try {
            const { id: model } = this.getModel()

            const requestBody = {
                model: model,
                project: projectId,
                userAgent: "antigravity",
                requestType: "agent",
                requestId: `agent-${crypto.randomUUID()}`,
                request: {
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    systemInstruction: {
                        role: "user",
                        parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }]
                    },
                    generationConfig: {
                        temperature: this.options.modelTemperature ?? 0.7,
                    },
                    sessionId: `-${crypto.randomUUID()}`,
                },
            }

            const data = await this.callEndpoint("generateContent", requestBody, accessToken)

            // Extract text from response
            const responseData = data.response || data

            if (responseData.candidates && responseData.candidates.length > 0) {
                const candidate = responseData.candidates[0]
                if (candidate.content && candidate.content.parts) {
                    const textParts = candidate.content.parts
                        .filter((part: any) => part.text && !part.thought)
                        .map((part: any) => part.text)
                        .join("")
                    return textParts
                }
            }

            return ""
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(t("common:errors.antigravity.completionError", { error: error.message }))
            }
            throw error
        }
    }
}
