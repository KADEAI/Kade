/**
 * Sanitizes an OpenAI tool call ID to ensure it contains only alphanumeric
 * characters, underscores, and dashes, and is at most 64 characters long.
 */
export function sanitizeOpenAiCallId(id: string): string {
    if (!id) {
        return "call_" + Math.random().toString(36).substring(2, 9)
    }

    // Remove any characters that are not alphanumeric, underscores, or dashes
    let sanitized = id.replace(/[^a-zA-Z0-9_\-]/g, "")

    // Truncate to 64 characters if necessary
    if (sanitized.length > 64) {
        sanitized = sanitized.slice(0, 64)
    }

    return sanitized
}
