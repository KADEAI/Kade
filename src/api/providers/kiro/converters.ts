import { v4 as uuidv4 } from "uuid"
import { ChatCompletionRequest, ChatMessage, Tool, UnifiedMessage, UnifiedTool } from "./types"

export const TOOL_DESCRIPTION_MAX_LENGTH = 10000
export const FAKE_REASONING_ENABLED = true
export const FAKE_REASONING_MAX_TOKENS = 4096

const HIDDEN_MODELS: Record<string, string> = {
    "claude-sonnet-4-5": "claude-sonnet-4.5",
    "claude-4-5-sonnet": "claude-sonnet-4.5",
    "claude-3.7-sonnet": "CLAUDE_3_7_SONNET_20250219_V1_0",
    "claude-3-5-sonnet-20240620": "CLAUDE_3_5_SONNET_20240620_V1_0",
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-opus-4-6": "claude-opus-4.6",
    "claude-sonnet-4-6": "claude-sonnet-4.6",
    "claude-opus-4-5": "claude-opus-4.5",
    "claude-opus-4-5-20251101": "claude-opus-4.5",
}

/**
 * Normalizes model name to Kiro format.
 */
export function normalizeModelName(name: string): string {
    if (!name) return name
    const nameLower = name.toLowerCase()

    // Pattern 1: Standard format - claude-{family}-{major}-{minor}(-{suffix})?
    const standardMatch = nameLower.match(/^(claude-(?:haiku|sonnet|opus)-\d+)-(\d{1,2})(?:-(?:\d{8}|latest|\d+))?$/)
    if (standardMatch) {
        return `${standardMatch[1]}.${standardMatch[2]}`
    }

    // Pattern 2: Standard format without minor - claude-{family}-{major}(-{date})?
    const noMinorMatch = nameLower.match(/^(claude-(?:haiku|sonnet|opus)-\d+)(?:-\d{8})?$/)
    if (noMinorMatch) {
        return noMinorMatch[1]
    }

    // Pattern 3: Legacy format - claude-{major}-{minor}-{family}(-{suffix})?
    const legacyMatch = nameLower.match(/^(claude)-(\d+)-(\d+)-(haiku|sonnet|opus)(?:-(?:\d{8}|latest|\d+))?$/)
    if (legacyMatch) {
        return `${legacyMatch[1]}-${legacyMatch[2]}.${legacyMatch[3]}-${legacyMatch[4]}`
    }

    // Pattern 4: Already normalized with dot but has date suffix
    const dotWithDateMatch = nameLower.match(/^(claude-(?:\d+\.\d+-)?(?:haiku|sonnet|opus)-(?:\d+\.\d+)?)-\d{8}$/)
    if (dotWithDateMatch) {
        return dotWithDateMatch[1]
    }

    // Pattern 5: Inverted format with suffix
    const invertedMatch = nameLower.match(/^claude-(\d+)\.(\d+)-(haiku|sonnet|opus)-(.+)$/)
    if (invertedMatch) {
        return `claude-${invertedMatch[3]}-${invertedMatch[1]}.${invertedMatch[2]}`
    }

    return name
}

/**
 * Extracts text content from various formats.
 */
export function extractTextContent(content: any): string {
    if (content === null || content === undefined) return ""
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === "string") return item
                if (item && typeof item === "object") {
                    if (item.type === "text") return item.text || ""
                    if (item.text) return item.text
                }
                return ""
            })
            .join("")
    }
    return String(content)
}

/**
 * Extracts images from content.
 */
export function extractImagesFromContent(content: any): any[] {
    const images: any[] = []
    if (!Array.isArray(content)) return images

    for (const item of content) {
        if (typeof item !== "object" || item === null) continue

        if (item.type === "image_url" && item.image_url?.url?.startsWith("data:")) {
            try {
                const [header, data] = item.image_url.url.split(",", 2)
                const mediaType = header.split(";")[0].replace("data:", "")
                if (data) images.push({ media_type: mediaType, data })
            } catch (e) { }
        } else if (item.type === "image" && item.source?.type === "base64") {
            if (item.source.data) {
                images.push({
                    media_type: item.source.media_type || "image/jpeg",
                    data: item.source.data,
                })
            }
        }
    }
    return images
}

/**
 * Sanitizes JSON Schema for Kiro API.
 */
export function sanitizeJsonSchema(schema: any): any {
    if (!schema || typeof schema !== "object") return {}
    const result: any = {}
    for (const [key, value] of Object.entries(schema)) {
        if (key === "required" && Array.isArray(value) && value.length === 0) continue
        if (key === "additionalProperties") continue

        if (key === "properties" && typeof value === "object" && value !== null) {
            result[key] = {}
            for (const [pName, pValue] of Object.entries(value)) {
                result[key][pName] = sanitizeJsonSchema(pValue)
            }
        } else if (Array.isArray(value)) {
            result[key] = value.map((v) => (typeof v === "object" ? sanitizeJsonSchema(v) : v))
        } else if (value && typeof value === "object") {
            result[key] = sanitizeJsonSchema(value)
        } else {
            result[key] = value
        }
    }
    return result
}

/**
 * Merges adjacent messages with same role.
 */
export function mergeAdjacentMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
    if (messages.length === 0) return []
    const merged: UnifiedMessage[] = []

    for (const msg of messages) {
        if (merged.length === 0) {
            merged.push({ ...msg })
            continue
        }

        const last = merged[merged.length - 1]
        if (msg.role === last.role) {
            last.content = extractTextContent(last.content) + "\n" + extractTextContent(msg.content)
            if (msg.tool_calls) {
                last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls]
            }
            if (msg.tool_results) {
                last.tool_results = [...(last.tool_results || []), ...msg.tool_results]
            }
            if (msg.images) {
                last.images = [...(last.images || []), ...msg.images]
            }
        } else {
            merged.push({ ...msg })
        }
    }
    return merged
}

/**
 * Ensures alternating roles by inserting synthetic assistant messages.
 */
export function ensureAlternatingRoles(messages: UnifiedMessage[]): UnifiedMessage[] {
    if (messages.length === 0) return []
    const result: UnifiedMessage[] = []

    for (const msg of messages) {
        if (result.length > 0 && result[result.length - 1].role === msg.role) {
            if (msg.role === "user") {
                // Insert synthetic assistant message
                result.push({ role: "assistant", content: "(empty)" })
            } else {
                // Insert synthetic user message
                result.push({ role: "user", content: "(empty)" })
            }
        }
        result.push(msg)
    }
    return result
}

/**
 * Converts OpenAI messages to unified format.
 */
export function convertOpenAiMessagesToUnified(messages: ChatMessage[]): {
    systemPrompt: string
    unifiedMessages: UnifiedMessage[]
} {
    let systemPrompt = ""
    const nonSystem: ChatMessage[] = []

    for (const msg of messages) {
        if (msg.role === "system") {
            systemPrompt += extractTextContent(msg.content) + "\n"
        } else {
            nonSystem.push(msg)
        }
    }

    const unified: UnifiedMessage[] = []
    let pendingResults: any[] = []
    let pendingImages: any[] = []

    for (const msg of nonSystem) {
        if (msg.role === "tool") {
            pendingResults.push({
                type: "tool_result",
                tool_use_id: msg.tool_call_id || "",
                content: extractTextContent(msg.content) || "(empty result)",
            })
            // Extract images from tool results (MCP screenshots)
            const images = extractImagesFromContent(msg.content)
            if (images.length > 0) pendingImages.push(...images)
        } else {
            if (pendingResults.length > 0) {
                unified.push({
                    role: "user",
                    content: "",
                    tool_results: [...pendingResults],
                    images: pendingImages.length > 0 ? [...pendingImages] : null,
                })
                pendingResults = []
                pendingImages = []
            }

            let toolCalls = null
            if (msg.role === "assistant" && msg.tool_calls) {
                toolCalls = msg.tool_calls.map((tc: any) => ({
                    id: tc.id || "",
                    type: "function",
                    function: {
                        name: tc.function?.name || "",
                        arguments: tc.function?.arguments || "{}",
                    },
                }))
            }

            let toolResults = null
            let images = null
            if (msg.role === "user") {
                images = extractImagesFromContent(msg.content)
                // Check for tool results embedded in user message
                if (Array.isArray(msg.content)) {
                    toolResults = msg.content
                        .filter((item: any) => item.type === "tool_result")
                        .map((item: any) => ({
                            type: "tool_result",
                            tool_use_id: item.tool_use_id || "",
                            content: extractTextContent(item.content) || "(empty result)",
                        }))
                }
            }

            unified.push({
                role: msg.role,
                content: extractTextContent(msg.content),
                tool_calls: toolCalls,
                tool_results: toolResults?.length ? toolResults : null,
                images: images?.length ? images : null,
            })
        }
    }

    if (pendingResults.length > 0) {
        unified.push({
            role: "user",
            content: "",
            tool_results: [...pendingResults],
            images: pendingImages.length > 0 ? [...pendingImages] : null,
        })
    }

    return { systemPrompt: systemPrompt.trim(), unifiedMessages: unified }
}

/**
 * Builds Kiro API payload.
 */
export function buildKiroPayload(options: {
    messages: UnifiedMessage[]
    systemPrompt: string
    modelId: string
    conversationId: string
    profileArn: string
    injectThinking?: boolean
}): any {
    const { messages, systemPrompt, modelId, conversationId, profileArn, injectThinking = true } = options

    // 1. Normalize and merge
    let processed = mergeAdjacentMessages(messages)
    processed = ensureAlternatingRoles(processed)
    if (processed.length > 0 && processed[0].role !== "user") {
        processed.unshift({ role: "user", content: "(empty)" })
    }

    // 2. Construct Kiro payload
    const kiroMessages = processed.map((msg): any => {
        if (msg.role === "assistant") {
            const toolUses = msg.tool_calls?.map((tc: any) => ({
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
                toolUseId: tc.id,
            }))
            return {
                assistantResponseMessage: {
                    content: extractTextContent(msg.content) || " ",
                    toolUses: toolUses?.length ? toolUses : undefined,
                },
            }
        } else {
            const toolResults = msg.tool_results?.map((tr: any) => ({
                content: [{ text: tr.content }],
                status: tr.status || "success",
                toolUseId: tr.tool_use_id,
            }))
            const images = msg.images?.map((img: any) => ({
                format: img.media_type.split("/").pop() || "jpeg",
                source: { bytes: img.data },
            }))
            
            let messageContent = extractTextContent(msg.content) || "(empty)"
            
            return {
                userInputMessage: {
                    content: messageContent,
                    userInputMessageContext: toolResults?.length ? { toolResults } : undefined,
                    images: images?.length ? images : undefined,
                },
            }
        }
    })

    let finalSystemPrompt = systemPrompt
    if (injectThinking && FAKE_REASONING_ENABLED) {
        finalSystemPrompt += `\n\n<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${FAKE_REASONING_MAX_TOKENS}</max_thinking_length>`
    }

    // Prepend the system prompt to the first user message
    if (kiroMessages.length > 0 && kiroMessages[0].userInputMessage) {
        kiroMessages[0].userInputMessage.content = `${finalSystemPrompt}\n\n${kiroMessages[0].userInputMessage.content}`
    } else {
        kiroMessages.unshift({
            userInputMessage: {
                content: finalSystemPrompt,
            }
        })
    }

    // The "Infinite" AWS Q format requires currentMessage inside conversationState
    const lastMessage = kiroMessages.pop()
    const utterance = lastMessage?.userInputMessage?.content || ""

    // For multi-turn conversations, we need the ID of the last assistant message.
    let customParentMessageId: string | undefined = undefined
    if (kiroMessages.length > 0) {
        for (let i = kiroMessages.length - 1; i >= 0; i--) {
            if (kiroMessages[i].assistantResponseMessage) {
                customParentMessageId = kiroMessages[i].assistantResponseMessage.messageId
                break
            }
        }
        if (!customParentMessageId) customParentMessageId = uuidv4()
    }

    return {
        conversationState: {
            chatTriggerType: "MANUAL",
            conversationId: conversationId,
            currentMessage: {
                userInputMessage: {
                    content: utterance,
                    modelId: HIDDEN_MODELS[modelId] || modelId,
                    origin: "AI_EDITOR",
                },
            },
            history: kiroMessages,
            customParentMessageId: customParentMessageId,
        },
        profileArn: profileArn,
    }
}
