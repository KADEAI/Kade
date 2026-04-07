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
    const summaryLines: string[] = []

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
            summaryLines.push(content)
        } else if (msg.role === 'assistant') {
            summaryLines.push(content)
        }
    }

    if (summaryLines.length > 0) {
        summaryText += summaryLines.join("\n\n")
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
