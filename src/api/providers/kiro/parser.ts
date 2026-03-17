import { UnifiedTool } from "./types"

/**
 * Event from Kiro API stream.
 */
export interface KiroEvent {
    type: "content" | "thinking" | "tool_use" | "usage" | "context_usage" | "error"
    data?: any
    content?: string
    thinking_content?: string
    tool_use?: any
    usage?: any
    context_usage_percentage?: number
}

/**
 * Parser for AWS Event Stream format.
 */
export class AwsEventStreamParser {
    private buffer = ""
    private lastContent: string | null = null
    private currentToolCall: any = null
    private toolCalls: any[] = []

    private readonly EVENT_PATTERNS: [string, string][] = [
        ['{"content":', "content"],
        ['{"name":', "tool_start"],
        ['{"input":', "tool_input"],
        ['{"stop":', "tool_stop"],
        ['{"usage":', "usage"],
        ['{"contextUsagePercentage":', "context_usage"],
    ]

    feed(chunk: string): KiroEvent[] {
        this.buffer += chunk
        const events: KiroEvent[] = []

        while (true) {
            let earliestPos = -1
            let earliestType = ""

            for (const [pattern, type] of this.EVENT_PATTERNS) {
                const pos = this.buffer.indexOf(pattern)
                if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
                    earliestPos = pos
                    earliestType = type
                }
            }

            if (earliestPos === -1) break

            const jsonEnd = this.findMatchingBrace(this.buffer, earliestPos)
            if (jsonEnd === -1) break

            const jsonStr = this.buffer.substring(earliestPos, jsonEnd + 1)
            this.buffer = this.buffer.substring(jsonEnd + 1)

            try {
                const data = JSON.parse(jsonStr)
                const event = this.processEvent(data, earliestType)
                if (event) events.push(event)
            } catch (e) {
                console.warn("[AwsEventStreamParser] Failed to parse JSON:", jsonStr.substring(0, 100))
            }
        }

        return events
    }

    private findMatchingBrace(text: string, startPos: number): number {
        if (startPos >= text.length || text[startPos] !== "{") return -1
        let braceCount = 0
        let inString = false
        let escapeNext = false

        for (let i = startPos; i < text.length; i++) {
            const char = text[i]
            if (escapeNext) {
                escapeNext = false
                continue
            }
            if (char === "\\" && inString) {
                escapeNext = true
                continue
            }
            if (char === '"') {
                inString = !inString
                continue
            }
            if (!inString) {
                if (char === "{") braceCount++
                else if (char === "}") {
                    braceCount--
                    if (braceCount === 0) return i
                }
            }
        }
        return -1
    }

    private processEvent(data: any, type: string): KiroEvent | null {
        switch (type) {
            case "content":
                const content = data.content || ""
                if (content === this.lastContent) return null
                this.lastContent = content
                return { type: "content", content }
            case "tool_start":
                if (this.currentToolCall) this.finalizeToolCall()
                this.currentToolCall = {
                    id: data.toolUseId || `call_${Math.random().toString(36).substring(2, 11)}`,
                    type: "function",
                    function: {
                        name: data.name || "",
                        arguments: typeof data.input === "object" ? JSON.stringify(data.input) : data.input || "",
                    },
                }
                if (data.stop) this.finalizeToolCall()
                return null
            case "tool_input":
                if (this.currentToolCall) {
                    const input = typeof data.input === "object" ? JSON.stringify(data.input) : data.input || ""
                    this.currentToolCall.function.arguments += input
                }
                return null
            case "tool_stop":
                if (this.currentToolCall && data.stop) this.finalizeToolCall()
                return null
            case "usage":
                return { type: "usage", usage: data.usage }
            case "context_usage":
                return { type: "context_usage", context_usage_percentage: data.contextUsagePercentage }
            default:
                return null
        }
    }

    private finalizeToolCall() {
        if (!this.currentToolCall) return
        // Try to normalize JSON arguments
        try {
            const args = this.currentToolCall.function.arguments
            if (args.trim()) {
                const parsed = JSON.parse(args)
                this.currentToolCall.function.arguments = JSON.stringify(parsed)
            } else {
                this.currentToolCall.function.arguments = "{}"
            }
        } catch (e) {
            // If it fails, we keep it as is or set to empty if totally broken
            if (!this.currentToolCall.function.arguments.includes("{")) {
                this.currentToolCall.function.arguments = "{}"
            }
        }
        this.toolCalls.push(this.currentToolCall)
        this.currentToolCall = null
    }

    getToolCalls(): any[] {
        if (this.currentToolCall) this.finalizeToolCall()
        // Simple deduplication
        const seen = new Set()
        return this.toolCalls.filter((tc) => {
            const key = `${tc.function.name}:${tc.function.arguments}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }
}

/**
 * States of the thinking block parser.
 */
enum ParserState {
    PRE_CONTENT = 0,
    IN_THINKING = 1,
    STREAMING = 2,
}

/**
 * Thinking block parser for streaming responses.
 */
export class ThinkingParser {
    private state = ParserState.PRE_CONTENT
    private initialBuffer = ""
    private thinkingBuffer = ""
    private openTag = ""
    private closeTag = ""
    private isFirstThinkingChunk = true
    private readonly OPEN_TAGS = ["<thinking>", "<think>", "<reasoning>"]

    feed(content: string): {
        thinking_content?: string
        regular_content?: string
        is_first_thinking_chunk: boolean
        is_last_thinking_chunk: boolean
    } {
        if (this.state === ParserState.STREAMING) {
            return { regular_content: content, is_first_thinking_chunk: false, is_last_thinking_chunk: false }
        }

        if (this.state === ParserState.PRE_CONTENT) {
            this.initialBuffer += content
            const stripped = this.initialBuffer.trimStart()

            for (const tag of this.OPEN_TAGS) {
                if (stripped.startsWith(tag)) {
                    this.state = ParserState.IN_THINKING
                    this.openTag = tag
                    this.closeTag = `</${tag.substring(1)}`
                    const afterTag = stripped.substring(tag.length)
                    this.thinkingBuffer = afterTag
                    this.initialBuffer = ""
                    return this.processThinkingBuffer()
                }
            }

            // If buffer has content and no tag, transition to streaming quickly
            if (this.initialBuffer.length > 20) {
                this.state = ParserState.STREAMING
                const res = {
                    regular_content: this.initialBuffer,
                    is_first_thinking_chunk: false,
                    is_last_thinking_chunk: false,
                }
                this.initialBuffer = ""
                return res
            }

            return { is_first_thinking_chunk: false, is_last_thinking_chunk: false }
        }

        if (this.state === ParserState.IN_THINKING) {
            this.thinkingBuffer += content
            return this.processThinkingBuffer()
        }

        return { is_first_thinking_chunk: false, is_last_thinking_chunk: false }
    }

    private processThinkingBuffer() {
        if (this.thinkingBuffer.includes(this.closeTag)) {
            const idx = this.thinkingBuffer.indexOf(this.closeTag)
            const thinking = this.thinkingBuffer.substring(0, idx)
            const after = this.thinkingBuffer.substring(idx + this.closeTag.length)
            this.state = ParserState.STREAMING
            const isFirst = this.isFirstThinkingChunk
            this.isFirstThinkingChunk = false
            return {
                thinking_content: thinking,
                regular_content: after.trimStart(),
                is_first_thinking_chunk: isFirst,
                is_last_thinking_chunk: true,
            }
        }

        // Cautious sending: keep some buffer to avoid splitting the close tag
        const MAX_TAG_LENGTH = 20
        if (this.thinkingBuffer.length > MAX_TAG_LENGTH) {
            const send = this.thinkingBuffer.substring(0, this.thinkingBuffer.length - MAX_TAG_LENGTH)
            this.thinkingBuffer = this.thinkingBuffer.substring(this.thinkingBuffer.length - MAX_TAG_LENGTH)
            const isFirst = this.isFirstThinkingChunk
            this.isFirstThinkingChunk = false
            return { thinking_content: send, is_first_thinking_chunk: isFirst, is_last_thinking_chunk: false }
        } else if (this.state === ParserState.IN_THINKING) {
            // If we are in thinking but buffer is small, still send it if it's clearly not a tag
            // but for now let's just ensure we return an object
            return { is_first_thinking_chunk: false, is_last_thinking_chunk: false }
        }

        return { is_first_thinking_chunk: false, is_last_thinking_chunk: false }
    }

    finalize() {
        if (this.state === ParserState.IN_THINKING) {
            return {
                thinking_content: this.thinkingBuffer,
                is_first_thinking_chunk: this.isFirstThinkingChunk,
                is_last_thinking_chunk: true,
            }
        }
        return { regular_content: this.initialBuffer + this.thinkingBuffer }
    }
}
