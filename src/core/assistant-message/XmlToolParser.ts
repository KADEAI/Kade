import { ToolName, toolNames, FileEntry } from "@roo-code/types"
import { ToolUse, ToolParamName, toolParamNames } from "../../shared/tools"

export const KILO_XML_ALIASES: Record<string, string> = {
    read: "read_file",
    edit: "edit",
    write: "write_to_file",
    ls: "list_dir",
    grep: "grep",
    glob: "glob",
    cmd: "execute_command",
    todo: "update_todo_list",
    ask: "codebase_search",
    web: "web_search",
    fetch: "web_fetch",
    research: "research_web",
    delete: "delete_file",
    browser: "browser_action",
    browse: "browser_action",
    click: "browser_action",
    type: "browser_action",
    scroll: "browser_action",
    context: "fast_context",
}

export const PRIMARY_PARAMS: Record<string, string[]> = {
    read_file: ["path"],
    execute_command: ["command", "cwd"],
    write_to_file: ["path", "content"],
    edit: ["path", "edit"],
    list_dir: ["path", "recursive"],
    grep: ["query", "path", "file_pattern"],
    glob: ["pattern", "path"],
    update_todo_list: ["todos"],
    codebase_search: ["query"],
    web_search: ["query"],
    web_fetch: ["url"],
    research_web: ["query", "depth"],
    delete_file: ["path"],
    browser_action: ["action", "url", "coordinate", "text"],
    fast_context: ["query", "path"],
}

export const VULNERABLE_PARAMS: ToolParamName[] = [
    "old_text",
    "new_text",
    "edits",
    "code_edit",
    "instructions",
    "arguments",
    "diff",
    "edit",
    "query",
    "reason",
    "content",
]

/**
 * Unified XML Parameter Extraction
 * Extracts <param>value</param> pairs from a block of text.
 * Handles variadic shorthand paths like <src/main.ts> alongside standard tags.
 */
export function extractParamsFromXml(text: string): Record<string, string> {
    const params: Record<string, string> = {}
    const tagRegex = /<([^\/>][^>]*)>([\s\S]*?)(?:<\/\1>|$)/g
    let match

    while ((match = tagRegex.exec(text)) !== null) {
        const tagName = match[1].trim()
        const tagContent = match[2].trim()

        // If it's a known parameter name, use it
        if (toolParamNames.includes(tagName as ToolParamName)) {
            params[tagName] = tagContent
        } else if (!tagName.includes("/") && !tagName.includes(".") && !/^\d/.test(tagName)) {
            // If it's not a path (no slash), not a file (no dot), not numeric, and looks like a generic tag, treat as param
            params[tagName] = tagContent
        }
    }

    return params
}

/**
 * Unified File Entry Conversion
 * Standardizes various line range formats into { path, lineRanges }
 */
export function convertFileEntries(files: any[]): FileEntry[] {
    return files.map((file: any) => {
        const entry: FileEntry = { path: file.path }
        if (file.line_ranges && Array.isArray(file.line_ranges)) {
            entry.lineRanges = file.line_ranges
                .map((range: any) => {
                    if (Array.isArray(range) && range.length >= 2) {
                        return { start: Number(range[0]), end: Number(range[1]) }
                    }
                    if (typeof range === "object" && range !== null && "start" in range && "end" in range) {
                        return { start: Number(range.start), end: Number(range.end) }
                    }
                    if (typeof range === "string") {
                        const match = range.match(/^(\d+)-(\d+)$/)
                        if (match) {
                            return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) }
                        }
                    }
                    return null
                })
                .filter(Boolean)
        } else if (file.lineRanges) {
            entry.lineRanges = file.lineRanges
        } else if (file.start_line !== undefined && file.end_line !== undefined) {
            const start = Number(file.start_line)
            const end = Number(file.end_line)
            if (!isNaN(start) && !isNaN(end)) {
                entry.lineRanges = [{ start, end }]
            }
        }
        return entry
    })
}

/**
 * Re-parse parameters that are likely to contain XML-like content (code, regex, etc.)
 * to avoid truncation from early closing tags in the naive parser.
 */
export function reparseVulnerableParams(params: Record<string, any>, toolContent: string): void {
    for (const paramName of Object.keys(params) as ToolParamName[]) {
        if (VULNERABLE_PARAMS.includes(paramName)) {
            const startTag = `<${paramName}>`
            const endTag = `</${paramName}>`
            // Skip index 0 to avoid matching the tool's own opening tag if tool name equals param name (e.g. <edit>)
            const startIndex = toolContent.indexOf(startTag, 1)
            const endIndex = toolContent.lastIndexOf(endTag)

            if (startIndex !== -1 && endIndex > startIndex) {
                const correctedValue = toolContent.slice(startIndex + startTag.length, endIndex)
                if (paramName === "content") {
                    params[paramName] = correctedValue.replace(/^\n/, "")
                } else {
                    params[paramName] = correctedValue
                }
            }
        }
    }
}

export class KiloXmlHandler {
    public openedWithTag: string | undefined = undefined
    public positionalParamIndex = 0
    public positionalContentAccumStartIndex: number | undefined = undefined
    public positionalContentParamName: ToolParamName | undefined = undefined

    public reset() {
        this.openedWithTag = undefined
        this.positionalParamIndex = 0
        this.positionalContentAccumStartIndex = undefined
        this.positionalContentParamName = undefined
    }

    public getCanonicalToolName(name: string): string {
        return KILO_XML_ALIASES[name] || name
    }

    public isKiloTool(name: string): boolean {
        return name in KILO_XML_ALIASES || toolNames.includes(name as ToolName)
    }

    public handleReadVariadic(tagContent: string, currentToolUse: ToolUse): void {
        const currentPath = currentToolUse.params.path
        currentToolUse.params.path = currentPath ? `${currentPath}, ${tagContent}` : tagContent

        const rangeMatch = tagContent.match(/^(.*?)(?::|\s+)(\d+)-(\d+)$/)
        if (!currentToolUse.nativeArgs) {
            currentToolUse.nativeArgs = { files: [] }
        }

        const files = (currentToolUse.nativeArgs as { files: FileEntry[] }).files
        if (rangeMatch) {
            const filePath = rangeMatch[1].trim()
            const start = parseInt(rangeMatch[2], 10)
            const end = parseInt(rangeMatch[3], 10)
            if (!isNaN(start) && !isNaN(end)) {
                files.push({
                    path: filePath,
                    lineRanges: [{ start, end }],
                })
            } else {
                files.push({ path: tagContent.trim() })
            }
        } else {
            files.push({ path: tagContent.trim() })
        }
    }

    public finalizeToolUse(currentToolUse: ToolUse, toolContent: string, accumulator: string): void {
        // Bare text fallback
        if (this.openedWithTag && Object.keys(currentToolUse.params).length === 0) {
            const primaryParams = PRIMARY_PARAMS[currentToolUse.name]
            if (primaryParams && primaryParams.length > 0) {
                const closingTag = `</${this.openedWithTag}>`
                let bareContent = toolContent
                if (bareContent.endsWith(closingTag)) {
                    bareContent = bareContent.slice(0, -closingTag.length)
                }
                const symClosing = `<${this.openedWithTag}>`
                if (bareContent.endsWith(symClosing)) {
                    bareContent = bareContent.slice(0, -symClosing.length)
                }
                bareContent = bareContent.trim()

                if (bareContent) {
                    if (currentToolUse.name === "read_file") {
                        this.handleReadVariadic(bareContent, currentToolUse)
                    } else {
                        currentToolUse.params[primaryParams[0] as ToolParamName] = bareContent
                    }
                }
            }
        }

        // Consolidate vulnerable re-parsing
        reparseVulnerableParams(currentToolUse.params, toolContent)

        // Strip trailing > from positional content accumulation
        if (this.positionalContentParamName && currentToolUse.params[this.positionalContentParamName]) {
            let content = currentToolUse.params[this.positionalContentParamName] as string
            content = content.replace(/>\s*$/, "").replace(/\n$/, "")
            currentToolUse.params[this.positionalContentParamName] = content
        }

        // KILOCODE FIX: Validation & Defaulting for missing params
        applyParamsDefaulting(currentToolUse)
    }
}

/**
 * Shared logic for applying sensible defaults to missing parameters.
 */
export function applyParamsDefaulting(toolUse: ToolUse): void {
    const primaryParams = PRIMARY_PARAMS[toolUse.name]
    if (primaryParams) {
        for (const param of primaryParams) {
            if (!toolUse.params[param as ToolParamName]) {
                if (param === "path" && (toolUse.name === "list_dir" || toolUse.name === "glob" || toolUse.name === "grep")) {
                    toolUse.params[param as ToolParamName] = "."
                }
            }
        }
    }
}

/**
 * Maps raw XML arguments (positional or tagged) to ToolUse params/nativeArgs.
 * Used by UnifiedToolCallParser and other XML-supporting parsers.
 */
export function populateToolParamsFromXmlArgs(toolName: string, args: string[], toolUse: ToolUse): void {
    const params = toolUse.params
    const native: any = toolUse.nativeArgs || (toolUse.nativeArgs = {} as any)

    switch (toolName) {
        case "read_file": {
            native.files = []
            let currentEntry: any = null

            for (const arg of args) {
                const trimmedArg = arg.trim()
                const isPureRange = /^(\(?\d+-\d+\)?)$/.test(trimmedArg)

                if (isPureRange) {
                    const cleanRange = trimmedArg.replace(/[()]/g, "")
                    const [s, e] = cleanRange.split("-").map(Number)
                    if (currentEntry && !isNaN(s) && !isNaN(e)) {
                        currentEntry.lineRanges.push({ start: s, end: e })
                    }
                } else {
                    const parts = trimmedArg.split(/\s+/)
                    const path = parts[0]
                    currentEntry = { path, lineRanges: [] }

                    for (let i = 1; i < parts.length; i++) {
                        const rangeMatch = parts[i].match(/^(\(?\d+-\d+\)?)$/)
                        if (rangeMatch) {
                            const cleanRange = rangeMatch[1].replace(/[()]/g, "")
                            const rangeParts = cleanRange.split("-")
                            const start = parseInt(rangeParts[0])
                            const end = rangeParts[1] ? parseInt(rangeParts[1]) : start
                            if (!isNaN(start) && !isNaN(end)) {
                                currentEntry.lineRanges.push({ start, end })
                            }
                        }
                    }
                    native.files.push(currentEntry)
                }
            }
            params.path = native.files.map((f: any) => f.path).join(", ")
            if (native.files.length === 1 && native.files[0].lineRanges.length > 0) {
                params.lineRange = native.files[0].lineRanges.map((r: any) => `${r.start}-${r.end}`).join(", ")
            }
            break
        }
        case "edit":
            params.path = args[0]
            native.path = args[0]
            if (args[1]) {
                params.edit = args[1].replace(/^\r?\n/, "")
                // Don't set native.edit - UnifiedToolCallParser will parse it into native.edits array
            }
            break
        case "write_to_file":
            params.path = args[0]
            native.path = args[0]
            if (args[1]) {
                params.content = args[1].replace(/^\r?\n/, "")
                native.content = params.content
            }
            break
        case "list_dir":
            params.path = args[0] || "."
            native.path = args[0] || "."
            if (args[1] === "true") {
                params.recursive = "true"
                native.recursive = true
            }
            break
        case "grep": {
            if (args.length >= 2) {
                const pathArgRaw = args[args.length - 1]
                const queryPartRaw = args.slice(0, -1).join(", ")
                const queries = (queryPartRaw.match(/(".*?"|[^,]+)/g) || [])
                    .map((q) => q.trim().replace(/^"|"$/g, ""))
                    .filter(Boolean)

                if (queries.length > 1) {
                    params.query = queries as any
                    native.query = queries
                } else {
                    params.query = queries[0] || ""
                    native.query = queries[0] || ""
                }

                let pathArg = pathArgRaw
                if (/[\*\?\[\]]/.test(pathArg)) {
                    const lastSlashIndex = Math.max(pathArg.lastIndexOf("/"), pathArg.lastIndexOf("\\"))
                    if (lastSlashIndex !== -1) {
                        const dirPart = pathArg.substring(0, lastSlashIndex)
                        const globPart = pathArg.substring(lastSlashIndex + 1)
                        params.path = dirPart || "."
                        native.path = dirPart || "."
                        params.include = globPart
                        native.include = globPart
                    } else {
                        params.path = "."
                        native.path = "."
                        params.include = pathArg
                        native.include = pathArg
                    }
                } else {
                    params.path = pathArg
                    native.path = pathArg
                }
            } else {
                params.query = args[0] || ""
                native.query = args[0] || ""
                params.path = "."
                native.path = "."
            }
            break
        }
        case "glob":
            params.pattern = args[0]
            params.path = args[1] || "."
            native.pattern = args[0]
            native.path = args[1] || "."
            break
        case "execute_command":
            params.command = args[0]
            native.command = args[0]
            break
        case "update_todo_list":
            params.todos = args[0]
            native.todos = args[0]
            break
        case "codebase_search":
            params.query = args[0] || ""
            native.query = args[0] || ""
            if (args[1]) {
                params.path = args[1]
                native.path = args[1]
            }
            break

        case "browse":
            params.action = "launch"
            params.url = args[0]
            native.action = "launch"
            native.url = args[0]
            break

        case "click":
            params.action = "click"
            params.coordinate = args[0]
            native.action = "click"
            native.coordinate = args[0]
            break

        case "type":
            params.action = "type"
            params.text = args[0]
            native.action = "type"
            native.text = args[0]
            break

        case "scroll":
            params.action = "scroll_down"
            native.action = "scroll_down"
            if (args[0] === "up") {
                params.action = "scroll_up"
                native.action = "scroll_up"
            }
            break
        default:
            // Fallback: positional assignment based on PRIMARY_PARAMS
            const primary = PRIMARY_PARAMS[toolName]
            if (primary) {
                for (let i = 0; i < Math.min(args.length, primary.length); i++) {
                    params[primary[i] as ToolParamName] = args[i]
                    native[primary[i]] = args[i]
                }
            }
    }

    applyParamsDefaulting(toolUse)
}
