import { ApiMessage } from "../task-persistence/apiMessages"

/**
 * Smart Context Generator
 * 
 * Implements a deterministic algorithm to condense conversation history:
 * 1. Preserves recent context (last 3 user messages, last 6 assistant messages).
 * 2. Heavily truncates older messages (first 30 words for user, last 30 words for assistant).
 * 3. Keeps the last user message intact.
 */
export function generateSmartContext(messages: ApiMessage[], slidingWindowSize?: number): ApiMessage[] {
    if (messages.length === 0) {
        return []
    }

    // Constraint: Process up to 50 messages (plus the final current turn message)
    // We treat the "lastMessage" (current turn) as separate.
    // So we look at the history before that.
    const historyMessages = messages.slice(0, messages.length - 1)
    const effectiveHistory = historyMessages.slice(-50) // Take last 50

    // Recent window counts
    const recentUserCount = 3
    const recentAssistantCount = 6

    // We need to identify which messages in `effectiveHistory` are "recent"
    // We can do this by counting from the end of `effectiveHistory`
    const userMessagesInHistory = effectiveHistory.filter(m => m.role === 'user')
    const assistantMessagesInHistory = effectiveHistory.filter(m => m.role === 'assistant')

    // Get the specific message objects that are recent
    const recentUserMessages = new Set(userMessagesInHistory.slice(-recentUserCount))
    const recentAssistantMessages = new Set(assistantMessagesInHistory.slice(-recentAssistantCount))

    let summaryText = "Context Summary:\n\n"

    for (const msg of effectiveHistory) {
        let content = ""
        if (typeof msg.content === 'string') {
            content = msg.content
        } else if (Array.isArray(msg.content)) {
            content = msg.content.map(block => {
                if (block.type === 'text') return block.text
                if (block.type === 'image') return "[Image]"
                if (block.type === 'tool_use') return `[Tool Use: ${block.name}]`
                if (block.type === 'tool_result') return `[Tool Result]`
                return ""
            }).join("\n")
        }

        if (msg.role === 'user') {
            if (recentUserMessages.has(msg)) {
                // Recent User Message: Keep last 200 words
                const processed = wordTruncate(content, 200, true)
                summaryText += `User: ${processed}\n\n`
            } else {
                // Older User Message: Keep LAST 30 words
                const processed = wordTruncate(content, 30, true)
                summaryText += `User: ...${processed}\n\n`
            }
        } else if (msg.role === 'assistant') {
            if (recentAssistantMessages.has(msg)) {
                // Recent Assistant Message: Keep last 850 words
                const processed = wordTruncate(content, 850, true)
                summaryText += `Assistant: ${processed}\n\n`
            } else {
                // Older Assistant Message: Keep LAST 30 words
                const processed = wordTruncate(content, 30, true)
                summaryText += `Assistant: ...${processed}\n\n`
            }
        }
    }

    const lastMessage = messages[messages.length - 1]

    const summaryMessage: ApiMessage = {
        role: "user",
        content: summaryText.trim(),
        ts: Date.now(),
        isSummary: true
    }

    return [summaryMessage, lastMessage]
}

/**
 * Truncates text to a specific number of words.
 * @param text The text to truncate
 * @param count Number of words to keep
 * @param fromEnd If true, keeps the last `count` words. If false, keeps the first `count` words.
 */
function wordTruncate(text: string, count: number, fromEnd: boolean): string {
    const words = text.split(/\s+/)
    if (words.length <= count) {
        return text
    }

    if (fromEnd) {
        return words.slice(words.length - count).join(" ")
    } else {
        return words.slice(0, count).join(" ")
    }
}
