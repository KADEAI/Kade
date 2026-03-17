export function normalizeErrorText(rawText?: string | null): string {
    if (!rawText) {
        return ""
    }

    return rawText
        .replace(/<tool_use_error>(.*?)<\/tool_use_error>/gs, "$1")
        .replace(/^The tool execution failed[:.]?\s*/i, "")
        .replace(/\s+/g, " ")
        .trim()
}

export function summarizeErrorText(rawText?: string | null, maxLength = 140): string {
    const normalized = normalizeErrorText(rawText)
    if (!normalized) {
        return ""
    }

    const firstLine = normalized
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? normalized

    if (firstLine.length <= maxLength) {
        return firstLine
    }

    return `${firstLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function extractToolErrorText(toolResult?: any): string | null {
    if (!toolResult) {
        return null
    }

    if (typeof toolResult.error === "string" && toolResult.error.trim()) {
        return normalizeErrorText(toolResult.error)
    }

    const content = toolResult.content

    if (typeof content === "string") {
        return normalizeErrorText(content)
    }

    if (Array.isArray(content)) {
        const joined = content
            .map((item: any) => {
                if (typeof item === "string") return item
                if (typeof item?.text === "string") return item.text
                return ""
            })
            .filter(Boolean)
            .join("\n")

        return normalizeErrorText(joined)
    }

    if (content && typeof content === "object") {
        return normalizeErrorText(JSON.stringify(content, null, 2))
    }

    return null
}

export function getToolErrorSummary(toolResult?: any, maxLength = 140): string | null {
    const fullText = extractToolErrorText(toolResult)
    if (!fullText) {
        return null
    }

    const summary = summarizeErrorText(fullText, maxLength)
    return summary || null
}

export function isLikelyToolFailureText(text?: string | null): boolean {
    const normalized = normalizeErrorText(text)
    if (!normalized) {
        return false
    }

    const lower = normalized.toLowerCase()

    return (
        lower.includes("the tool execution failed") ||
        lower.startsWith("errors.geminicli") ||
        lower.startsWith("error reading file") ||
        lower.startsWith("error writing file") ||
        lower.startsWith("error editing file") ||
        lower.startsWith("error creating") ||
        lower.startsWith("error listing") ||
        lower.startsWith("error searching") ||
        lower.startsWith("error moving") ||
        lower.startsWith("error fetching") ||
        lower.startsWith("error executing") ||
        lower.includes("file not found") ||
        lower.includes("no such file or directory") ||
        lower.includes("permission denied")
    )
}
