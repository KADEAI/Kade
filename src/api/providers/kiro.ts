import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import { kiroDefaultModelId, kiroModels, KiroModelId } from "../../../packages/types/src/providers/kiro"
import { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { BaseProvider } from "./base-provider"
import { KiroAuthManager } from "./kiro/auth"
import { buildKiroPayload, convertOpenAiMessagesToUnified, normalizeModelName } from "./kiro/converters"
import { AwsEventStreamParser, ThinkingParser } from "./kiro/parser"
import { getKiroHeaders } from "./kiro/utils"
import { ApiHandlerCreateMessageMetadata } from "../index"

export class KiroHandler extends BaseProvider {
    private authManager: KiroAuthManager
    private options: ApiHandlerOptions

    constructor(options: ApiHandlerOptions) {
        super()
        this.options = options
        this.authManager = new KiroAuthManager({
            sqliteDb: "~/.aws/amzn-q-cli/credentials.db",
            credsFile: options.kiroBaseUrl || "~/.aws/sso/cache/kiro-auth-token.json", 
            region: "us-east-1",
        })
    }

    async *createMessage(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[],
        metadata?: ApiHandlerCreateMessageMetadata,
    ): ApiStream {
        const { id: modelId } = this.getModel()

        // 1. Convert Anthropic messages to OpenAI format (handles images properly)
        const openAiMessages = convertToOpenAiMessages(messages)

        const { systemPrompt: extractedSystem, unifiedMessages } = convertOpenAiMessagesToUnified([
            { role: "system", content: systemPrompt },
            ...openAiMessages,
        ] as any[])

        const payload = buildKiroPayload({
            messages: unifiedMessages,
            systemPrompt: extractedSystem,
            modelId: modelId, 
            conversationId: metadata?.taskId || `conv_${this.authManager.getFingerprint().substring(0, 16)}`,
            profileArn: this.authManager.getProfileArn() || "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
            injectThinking: true,
        })

        // Final payload fix: AWS Q requires these at the root for this specific endpoint
        Object.assign(payload, {
            chatTriggerType: "MANUAL",
            source: "IDE"
        })

        // 2. Execute request with retry for 403 and 429
        let lastError: any
        const maxRetries = 6
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const token = await this.authManager.getAccessToken()
                const region = this.authManager.getRegion() || "us-east-1"
                const url = `https://q.${region}.amazonaws.com/generateAssistantResponse`

                const response = await axios.post(url, payload, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'x-amzn-codewhisperer-optout': 'true',
                        'x-amzn-kiro-agent-mode': 'vibe',
                        'x-amz-user-agent': `aws-sdk-js/1.0.27 KiroIDE-0.10.78-${this.authManager.getFingerprint()}`,
                        'user-agent': `aws-sdk-js/1.0.27 ua/2.1 os/macos#24.0.0 lang/js md/nodejs#22.22.0 api/codewhispererstreaming#1.0.27 m/E KiroIDE-0.10.78-${this.authManager.getFingerprint()}`,
                        'amz-sdk-invocation-id': require('uuid').v4(),
                        'amz-sdk-request': 'attempt=1; max=3',
                        'Connection': 'close'
                    },
                    responseType: "stream",
                    timeout: 60000,
                })

                const streamParser = new AwsEventStreamParser()
                const thinkingParser = new ThinkingParser()

                for await (const chunk of response.data) {
                    // AWS EventStream chunks can be binary or string
                    const data = Buffer.isBuffer(chunk) ? chunk.toString() : chunk
                    const events = streamParser.feed(data)
                    
                    for (const event of events) {
                        if (event.type === "content" && event.content) {
                            const parsed = thinkingParser.feed(event.content)

                            if (parsed.thinking_content) {
                                yield { type: "reasoning", text: parsed.thinking_content }
                            }
                            if (parsed.regular_content) {
                                yield { type: "text", text: parsed.regular_content }
                            }
                        } else if (event.type === "usage") {
                            // Emit usage (simplified)
                            yield {
                                type: "usage",
                                inputTokens: event.usage?.inputTokens || 0,
                                outputTokens: event.usage?.outputTokens || 0,
                            }
                        }
                    }
                }

                // Finalize tool calls
                const toolCalls = streamParser.getToolCalls()
                for (const tc of toolCalls) {
                    yield {
                        type: "tool_call_partial",
                        index: 0,
                        id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                    }
                }

                return // Success
            } catch (error: any) {
                lastError = error
                const status = error.response?.status

                if (status === 403) {
                    console.warn("[KiroHandler] 403 Forbidden, force refreshing token...")
                    await this.authManager.forceRefresh()
                    continue
                }

                if (status === 429) {
                    const delayMs = 1500 * Math.pow(1.5, attempt) // 1.5s, 2.25s, 3.3s...
                    console.log(`[KiroHandler] 429 Too Many Requests. Silent retry in ${Math.round(delayMs)}ms... (Attempt ${attempt + 1}/${maxRetries})`)
                    await new Promise(resolve => setTimeout(resolve, delayMs))
                    continue
                }

                break // Not a retryable error
            }
        }

        throw new Error(`Kiro API Error: ${lastError?.message || "Unknown error"}`)
    }

    getModel() {
        const modelId = this.options.apiModelId
        let id = modelId && modelId in kiroModels ? (modelId as KiroModelId) : kiroDefaultModelId
        const info = kiroModels[id]

        return { 
            id, 
            info 
        }
    }
}
