/**
 * Pure utility functions for EditTool error detection.
 * Extracted for testability.
 */

/** Edit-specific error patterns from the backend EditTool.ts */
const EDIT_ERROR_PATTERNS = [
    "The tool execution failed",
    "Could not find a unique match",
    "Could not find text to replace_all",
    "Overlapping edits detected",
    "error while editing",
    "File not found",
    "Invalid edit block",
    "Failed to read file",
] as const;

/**
 * Determines if a toolResult represents an actual edit failure.
 *
 * Only content-based pattern matching is used — we intentionally ignore
 * `toolResult.is_error` because the forward scan in ChatRow may pick up
 * an unrelated API error (e.g. Gemini timeout) that occurred *after* a
 * successful edit, setting `is_error: true` on a message that has nothing
 * to do with the edit itself.
 */
export function getEditErrorMessage(toolResult: any): string | null {
    if (!toolResult) return null;

    const content =
        typeof toolResult.content === "string"
            ? toolResult.content
            : JSON.stringify(toolResult.content);

    for (const pattern of EDIT_ERROR_PATTERNS) {
        if (content.includes(pattern)) {
            return content;
        }
    }

    return null;
}

export { EDIT_ERROR_PATTERNS };
