import { ToolName, ToolUse, McpToolUse } from "../../shared/tools"
import { AssistantMessageContent } from "./parseAssistantMessage"
import { populateToolParamsFromXmlArgs } from "./XmlToolParser"

export class MarkdownToolCallParser {
    private pendingBuffer = ""
    private finalizedBlocks: AssistantMessageContent[] = []
    private bufferStartIndex = 0
    private mcpToolNames: Map<string, { serverName: string, toolName: string }> = new Map()
    private toolCounter = 0 // Increments for each NEW tool block encountered

    constructor() { }

    /**
     * Register MCP tool names so the parser can recognize them.
     * Accepts an array of {compositeName, serverName, toolName} objects.
     */
    public setMcpToolNames(tools: Array<{ compositeName: string, serverName: string, toolName: string }>) {
        this.mcpToolNames = new Map(tools.map(t => [t.compositeName, { serverName: t.serverName, toolName: t.toolName }]))
    }

    private isFinalized = false
    private hasFinalizedTool = false
    private currentTurnId = Date.now().toString()

    /**
     * Returns true if a tool call has been finalized (closed) in this turn.
     * Used by AgentLoop to stop accumulating trailing text after tool calls.
     */
    public hasCompletedToolCall(): boolean {
        return this.hasFinalizedTool
    }

    public reset() {
        this.pendingBuffer = ""
        this.finalizedBlocks = []
        this.bufferStartIndex = 0
        this.isFinalized = false
        this.hasFinalizedTool = false
        this.currentTurnId = Date.now().toString()
        this.toolCounter = 0
    }

    public processChunk(chunk: string): { blocks: AssistantMessageContent[], safeIndex: number } {
        this.pendingBuffer += chunk
        const { finalized, pending, safeIndex } = this.parseMessage(this.pendingBuffer, false)
        if (safeIndex > 0 || finalized.length > 0) {
            this.finalizedBlocks.push(...finalized)
            this.pendingBuffer = this.pendingBuffer.slice(safeIndex)
            this.bufferStartIndex += safeIndex
        }

        return {
            blocks: [...this.finalizedBlocks, ...pending],
            safeIndex
        }
    }

    public finalizeContentBlocks(): void {
        this.isFinalized = true
        // Parse everything remaining as final
        const { finalized, pending } = this.parseMessage(this.pendingBuffer, true)
        // Everything returned is finalized (since isFinalized=true)
        this.finalizedBlocks.push(...finalized, ...pending)
        this.pendingBuffer = ""
    }

    public getContentBlocks(): AssistantMessageContent[] {
        const { finalized, pending } = this.parseMessage(this.pendingBuffer, this.isFinalized)
        return [...this.finalizedBlocks, ...finalized, ...pending]
    }

    public trimRawMessageAfterLastCompletedTool(message: string): string {
        const segments: string[] = []
        let currentIndex = 0
        let sawCompletedTool = false

        const knownToolShortNames = new Set([
            "read", "edit", "write", "ls", "glob", "grep", "search", "cmd", "execute_command", "todo", "done",
            "web", "research", "fetch", "browse", "click", "type", "scroll", "image", "ask",
            "edit_file", "new_rule", "report_bug", "agent", "run_sub_agent", "condense", "sub", "diff",
            "delete", "delete_file", "fast_context", "context", "mv", "move", "rename", "browser_action", "browser", "semgrep", "wrap", "mkdir", "find",
        ])

        const toolStartRegex = /(?<!\\)```\s*(?:tool[:\s]+)?([\w-]+?)(?=\s|--|```|$)(?:[ \t]*(.*))?/g
        let match: RegExpExecArray | null

        while ((match = toolStartRegex.exec(message)) !== null) {
            let toolShortName = match[1]
            let argsStr = match[2] || ""

            if (toolShortName.startsWith("tool_")) {
                toolShortName = toolShortName.slice(5)
            }

            const isMcpTool = this.mcpToolNames.has(toolShortName) || this.mcpToolNames.has(toolShortName.replace(/-/g, '_'))
            if (!knownToolShortNames.has(toolShortName) && !isMcpTool) {
                continue
            }

            const startIndex = match.index
            let startTagEndIndex = startIndex + match[0].length
            let isOneLiner = false
            const remaining = message.slice(startTagEndIndex)
            const isCompact = argsStr.startsWith("(") || (!argsStr.trim() && remaining.trimStart().startsWith("("))

            if (isCompact) {
                if (!argsStr.trim()) {
                    const wsMatch = remaining.match(/^\s+/)
                    if (wsMatch) startTagEndIndex += wsMatch[0].length
                }

                const parenSearch = message.slice(startTagEndIndex)
                if (parenSearch.startsWith("(")) {
                    let depth = 0
                    let quote: string | null = null
                    let escape = false
                    let foundEnd = false
                    for (let i = 0; i < parenSearch.length; i++) {
                        const char = parenSearch[i]
                        if (escape) {
                            escape = false
                            continue
                        }
                        if (char === "\\") {
                            escape = true
                            continue
                        }
                        if (quote) {
                            if (char === quote) quote = null
                            continue
                        }
                        if (char === '"' || char === "'" || char === "`") {
                            quote = char
                            continue
                        }
                        if (char === "(") depth++
                        else if (char === ")") {
                            depth--
                            if (depth === 0) {
                                argsStr = parenSearch.slice(1, i)
                                startTagEndIndex += i + 1
                                foundEnd = true
                                break
                            }
                        }
                    }
                    if (!foundEnd) {
                        break
                    }
                }

                const afterParen = message.slice(startTagEndIndex)
                const trailingCloser = afterParen.match(/^[ \t]*```/)
                if (trailingCloser) {
                    isOneLiner = true
                    startTagEndIndex += trailingCloser[0].length
                }
            }

            const isContentTool = ["write", "edit", "write_to_file", "edit_file", "new_rule", "todo", "wrap"].includes(toolShortName)
            if (isContentTool && !isOneLiner) {
                const explicitCloserRegex = new RegExp(`\\/?${toolShortName}\`{1,3}$`)
                const trimmedArgs = argsStr.trim()
                const closerMatch = trimmedArgs.match(explicitCloserRegex)
                if (closerMatch) {
                    isOneLiner = true
                    argsStr = trimmedArgs.slice(0, -closerMatch[0].length).trim()
                }
            }

            if (!isOneLiner && !isContentTool) {
                const closer = "```"
                const trimmedArgs = argsStr.trim()
                if (trimmedArgs.endsWith(closer) || match[0].trim().endsWith(closer)) {
                    isOneLiner = true
                }
            }

            let endIndex = -1
            if (isOneLiner) {
                endIndex = startTagEndIndex
            } else {
                const remainingText = message.slice(startTagEndIndex)
                let closingRegex: RegExp
                if (["edit", "write", "edit_file", "write_to_file", "todo", "wrap"].includes(toolShortName)) {
                    closingRegex = new RegExp(`(?:^|[\\r\\n])[ \\t]*(?<!\\\\)\\/${toolShortName}(?:\`{1,3})?(?:[ \\t]*(?:[\\r\\n]|$))`)
                } else {
                    closingRegex = /(?:^|[\r\n])[ \t]*`{3}[ \t]*/
                }
                const nextToolRegex = /(?:^|[\r\n])[ \t]*(?<!\\)```\s*(?:tool[:\s]+)?([\w-]+)/
                const endMatch = remainingText.match(closingRegex)
                const nextToolMatch = remainingText.match(nextToolRegex)
                const strictTools = ['edit', 'write', 'edit_file', 'write_to_file', 'new_rule', 'todo', 'wrap']
                const isStrictTool = strictTools.includes(toolShortName)

                let actualEndMatch = endMatch
                let isImplicitClose = false
                let consumeClosingMatch = true

                if (nextToolMatch && !isStrictTool) {
                    if (!endMatch || (endMatch.index !== undefined && nextToolMatch.index !== undefined && nextToolMatch.index < endMatch.index)) {
                        actualEndMatch = nextToolMatch
                        isImplicitClose = true
                        consumeClosingMatch = false
                    }
                }

                if (!actualEndMatch || actualEndMatch.index === undefined) {
                    break
                }

                if (isImplicitClose && !consumeClosingMatch) {
                    endIndex = startTagEndIndex + actualEndMatch.index
                    toolStartRegex.lastIndex = endIndex
                } else {
                    endIndex = startTagEndIndex + actualEndMatch.index + actualEndMatch[0].length
                    toolStartRegex.lastIndex = endIndex
                }
            }

            if (!sawCompletedTool && startIndex > currentIndex) {
                const cleanLeadingText = this.cleanTextContent(message.slice(currentIndex, startIndex))
                if (cleanLeadingText) {
                    segments.push(cleanLeadingText)
                }
            }

            if (endIndex > startIndex) {
                segments.push(message.slice(startIndex, endIndex).trimEnd())
                sawCompletedTool = true
                currentIndex = endIndex
            }
        }

        if (!sawCompletedTool) {
            return message
        }

        return segments.join("\n\n").trimEnd()
    }

    private parseMessage(message: string, isFinalized: boolean): { finalized: AssistantMessageContent[], pending: AssistantMessageContent[], safeIndex: number } {
        const contentBlocks: AssistantMessageContent[] = []
        let currentIndex = 0
        let lastSafeIndex = 0
        let finalizedBlockCount = 0

        const knownToolShortNames = [
            "read", "edit", "write", "ls", "glob", "grep", "search", "cmd", "execute_command", "todo", "done",
            "web", "research", "fetch", "browse", "click", "type", "scroll", "image", "ask",
            "edit_file", "new_rule", "report_bug", "agent", "run_sub_agent", "condense", "sub", "diff",
            "delete", "delete_file", "fast_context", "context", "mv", "move", "rename", "browser_action", "browser", "semgrep", "wrap", "mkdir", "find"
        ]

        // 1. Find positions of <think> tags to skip
        const getThinkingRanges = (str: string) => {
            const ranges: { start: number, end: number }[] = []
            const tagRegex = /<\/?think>/gi
            let tagMatch
            let startPos = -1
            let depth = 0
            while ((tagMatch = tagRegex.exec(str)) !== null) {
                if (tagMatch[0].toLowerCase() === "<think>") {
                    if (depth === 0) startPos = tagMatch.index
                    depth++
                } else {
                    depth = Math.max(0, depth - 1)
                    if (depth === 0 && startPos !== -1) {
                        ranges.push({ start: startPos, end: tagMatch.index + tagMatch[0].length })
                        startPos = -1
                    }
                }
            }
            if (startPos !== -1) ranges.push({ start: startPos, end: str.length })
            return ranges
        }

        const thinkingRanges = getThinkingRanges(message)
        const isInsideThinking = (pos: number) => thinkingRanges.some(r => pos >= r.start && pos < r.end)

        // 1b. Find positions of markdown code blocks to skip
        // IMPORTANT: For MarkdownToolCallParser, we must NOT skip ```toolname blocks
        // since those ARE tool calls. Only skip regular code blocks (```js, ```python, etc.)
        const toolShortNamesSet = new Set(knownToolShortNames)
        const getCodeRanges = (str: string) => {
            const ranges: { start: number, end: number }[] = []
            let i = 0
            while (i < str.length) {
                if (str.slice(i, i + 3) === "```") {
                    const start = i
                    i += 3
                    // Check if this is a tool block - extract the language/name after ```
                    let nameEnd = i
                    while (nameEnd < str.length && /[a-zA-Z0-9_-]/.test(str[nameEnd])) nameEnd++
                    const blockName = str.slice(i, nameEnd)
                    
                    // KILOCODE FIX: If blockName is empty, this is a closing ``` tag, not an opener.
                    // Skip it entirely - don't treat it as a code block opener.
                    if (!blockName) {
                        // Just move past the ``` and continue
                        continue
                    }
                    
                    // If it's a known tool name or registered MCP tool, DON'T skip it
                    if (toolShortNamesSet.has(blockName) || this.mcpToolNames.has(blockName) || this.mcpToolNames.has(blockName.replace(/-/g, '_'))) {
                        i = start + 1 // Move past just the first backtick, let tool parser handle it
                        continue
                    }
                    
                    const endMatch = str.indexOf("```", i)
                    if (endMatch !== -1) {
                        ranges.push({ start, end: endMatch + 3 })
                        i = endMatch + 3
                    } else {
                        // Unclosed fenced block (streaming) - treat rest as code
                        ranges.push({ start, end: str.length })
                        break
                    }
                } else if (str[i] === "`") {
                    const start = i
                    i += 1
                    // Only look for closing single backtick on the same line
                    const nextNewline = str.indexOf("\n", i)
                    const endLimit = nextNewline !== -1 ? nextNewline : str.length
                    let found = false
                    for (let j = i; j < endLimit; j++) {
                        if (str[j] === "`") {
                            ranges.push({ start, end: j + 1 })
                            i = j + 1
                            found = true
                            break
                        }
                    }
                    if (!found) {
                        // Unclosed single backtick on this line, ignore to prevent swallowing text
                    }
                } else {
                    i++
                }
            }
            return ranges
        }

        const codeRanges = getCodeRanges(message)
        const isInsideCode = (pos: number) => codeRanges.some(r => pos >= r.start && pos < r.end)

        // 2. State Machine for ``` Markdown Block Tools ```
        // Tools use markdown code block syntax: ```toolname\n...content...\n```
        // KILOCODE FIX: Support escaping. If the AI writes \```tool it will NOT trigger.
        // Negative lookbehind (?<!\\) added before ```
        // The tool name is captured on the same line as the opening ```, content follows on next lines.
        const toolStartRegex = /(?<!\\)```\s*(?:tool[:\s]+)?([\w-]+?)(?=\s|--|```|$)(?:[ \t]*(.*))?/g
        let match: RegExpExecArray | null

        while ((match = toolStartRegex.exec(message)) !== null) {
            // Check if inside thinking block or markdown code block
            if (isInsideThinking(match.index) || isInsideCode(match.index)) continue

            let toolShortName = match[1]
            let argsStr = match[2] || ""

            const isXml = false

            if (toolShortName.startsWith("tool_")) {
                toolShortName = toolShortName.slice(5)
            }

            let startIndex = match.index
            let startTagEndIndex = startIndex + match[0].length
            let isOneLiner = false

            // KILOCODE FIX: Compact Args Detector
            // It's compact if it STARTS with '(' or if it's empty and the NEXT char is '('
            const remaining = message.slice(startTagEndIndex)
            const isCompact = argsStr.startsWith("(") || (!argsStr.trim() && remaining.trimStart().startsWith("("))

            // If compact syntax, we need to manually find the arguments block (...)
            if (isCompact) {
                // If it was empty argsStr, we need to skip whitespace to find the (
                if (!argsStr.trim()) {
                    const wsMatch = remaining.match(/^\s+/)
                    if (wsMatch) startTagEndIndex += wsMatch[0].length
                }

                const parenSearch = message.slice(startTagEndIndex)
                if (parenSearch.startsWith("(")) {
                    // Find balanced closing paren (quote and escape aware)
                    let depth = 0
                    let quote: string | null = null
                    let escape = false
                    let foundEnd = false
                    for (let i = 0; i < parenSearch.length; i++) {
                        const char = parenSearch[i]
                        if (escape) {
                            escape = false
                            continue
                        }
                        if (char === "\\") {
                            escape = true
                            continue
                        }
                        if (quote) {
                            if (char === quote) quote = null
                            continue
                        }
                        if (char === '"' || char === "'" || char === "`") {
                            quote = char
                            continue
                        }

                        if (char === "(") depth++
                        else if (char === ")") {
                            depth--
                            if (depth === 0) {
                                argsStr = parenSearch.slice(1, i)
                                startTagEndIndex += i + 1
                                foundEnd = true
                                break
                            }
                        }
                    }
                    if (!foundEnd) {
                        // KILOCODE FIX: If partial stream, wait for closing paren!
                        if (!isFinalized) {
                            break // Treat as incomplete tool, buffer it.
                        }
                    }
                }

                // If it followed by closer on the same line (one-liner compact)
                const afterParen = message.slice(startTagEndIndex)
                let trailingCloser = afterParen.match(/^[ \t]*```/)

                if (trailingCloser) {
                    isOneLiner = true
                    startTagEndIndex += trailingCloser[0].length
                }
            }


            // Verify it's a known tool or a registered MCP tool
            const isMcpTool = this.mcpToolNames.has(toolShortName) || this.mcpToolNames.has(toolShortName.replace(/-/g, '_'))
            if (!knownToolShortNames.includes(toolShortName) && !isMcpTool) continue

            // IMPORTANT: write/edit/todo tools NEVER use one-liner syntax — they always need a content block.
            // Treating them as one-liners would cut off their content entirely.
            // wrap tool also MUST use a content block as it wraps message content.
            const isContentTool = ["write", "edit", "write_to_file", "edit_file", "new_rule", "todo", "wrap"].includes(toolShortName)
            
            // KILOCODE FIX: Allow content tools to be one-liners IF they explicitly contain their closing tag in argsStr
            // e.g. ```write\nexample.txt "content"\n/write```
            if (isContentTool && !isOneLiner) {
                const explicitCloserRegex = new RegExp(`\\/?${toolShortName}\`{1,3}$`);
                const trimmedArgs = argsStr.trim();
                const closerMatch = trimmedArgs.match(explicitCloserRegex);
                if (closerMatch) {
                    isOneLiner = true;
                    argsStr = trimmedArgs.slice(0, -closerMatch[0].length).trim();
                }
            }

            if (!isOneLiner && !isContentTool) {
                const closer = "```"
                const trimmedArgs = argsStr.trim()
                if (trimmedArgs.endsWith(closer)) {
                    isOneLiner = true
                    argsStr = trimmedArgs.slice(0, -closer.length).trim()
                } else if (match[0].trim().endsWith(closer)) {
                    isOneLiner = true
                    // If it's a one-liner but argsStr didn't end with ```, 
                    // it means there was trailing whitespace. Clean up argsStr.
                    if (argsStr.includes(closer)) {
                        const lastCloserIndex = argsStr.lastIndexOf(closer)
                        argsStr = argsStr.slice(0, lastCloserIndex).trim()
                    }
                }
            }
            argsStr = argsStr.trim()

            // 2a. Flush previous text
            if (startIndex > currentIndex) {
                const textBefore = message.slice(currentIndex, startIndex)
                const cleanText = this.cleanTextContent(textBefore)
                // KILOCODE FIX: Prevent context poisoning. 
                // If we have already finalized a tool call in this turn, any subsequent text 
                // is likely a hallucination of the result or redundant "thought" that 
                // should not be treated as a separate content block.
                // We also check finalizedBlockCount to allow multiple tools in one parse pass.
                if (cleanText && !this.hasFinalizedTool && finalizedBlockCount === 0) {
                    contentBlocks.push({
                        type: "text",
                        content: cleanText,
                        partial: false // Text before a tool is always complete
                    })
                }
            }

            // 2b. Find the end of the block
            let content = ""
            let isClosed = false
            let endIndex = -1

            if (isOneLiner) {
                content = ""
                isClosed = true
                endIndex = startTagEndIndex
            } else {
                const remainingText = message.slice(startTagEndIndex)
                // KILOCODE MOD: Syntax-Aware Closer detection
                let closingRegex: RegExp
                if (['edit', 'write', 'edit_file', 'write_to_file', 'todo', 'wrap'].includes(toolShortName)) {
                    // KILOCODE FIX: Content tools MUST only close on a tag at the start of a line.
                    // This prevents "insane regex" or code content containing the tool name from
                    // prematurely closing the block.
                    // KILOCODE FIX: Support escaping. If the AI writes \/edit``` (with a backslash)
                    // it will NOT close the block. This allows writing code about the parser.
                    // KILOCODE FIX: Relax trailing requirement to allow streaming to continue without waiting for newline after closing tag
                    // KILOCODE FIX: Accept /toolname with optional backticks OR just /toolname alone (AI often forgets backticks)
                    closingRegex = new RegExp(`(?:^|[\\r\\n])[ \\t]*(?<!\\\\)\\/${toolShortName}(?:\`{1,3})?(?:[ \\t]*(?:[\\r\\n]|$))`)
                } else {
                    // For non-content tools, we use the standard ``` closer.
                    // A line with just ``` closes the block (like a regular code block).
                    closingRegex = /(?:^|[\r\n])[ \t]*`{3}[ \t]*/
                }

                // KILOCODE MOD: Auto-Close on Next Tool
                const nextToolRegex = /(?:^|[\r\n])[ \t]*(?<!\\)```\s*(?:tool[:\s]+)?([\w-]+)/

                const endMatch = remainingText.match(closingRegex)
                // KILOCODE FIX: Allow implicit close even for content tools (write/edit) 
                // if a new tool start is detected. This prevents dropped files when 
                // the AI omits the closing tag in high-speed sequences.
                const nextToolMatch = remainingText.match(nextToolRegex)

                let actualEndMatch = endMatch
                let isImplicitClose = false
                let consumeClosingMatch = true

                // KILOCODE FIX: Only tools that consume arbitrary, multi-line content (like code or rules)
                // should be "strict". Tools that only take flags/args (like read, ls, glob) should 
                // allow implicit closing if a new tool start is detected.
                const strictTools = ['edit', 'write', 'edit_file', 'write_to_file', 'new_rule', 'todo', 'wrap']
                const isStrictTool = strictTools.includes(toolShortName)

                if (isStrictTool) {
                    const recoveryFenceRegex = /(?:^|[\r\n])[ \t]*```[ \t]*(?:\r?\n|$)/g
                    let recoveryFenceMatch: RegExpExecArray | null

                    while ((recoveryFenceMatch = recoveryFenceRegex.exec(remainingText)) !== null) {
                        const afterFence = remainingText.slice(recoveryFenceMatch.index + recoveryFenceMatch[0].length)
                        const nextToolAfterFence = afterFence.match(/^[ \t\r\n]*(?<!\\)```\s*(?:tool[:\s]+)?([\w-]+)/)
                        if (!nextToolAfterFence) {
                            continue
                        }

                        const nextToolName = nextToolAfterFence[1].startsWith("tool_")
                            ? nextToolAfterFence[1].slice(5)
                            : nextToolAfterFence[1]
                        const isKnownNextTool = knownToolShortNames.includes(nextToolName)
                            || this.mcpToolNames.has(nextToolName)
                            || this.mcpToolNames.has(nextToolName.replace(/-/g, '_'))

                        if (!isKnownNextTool) {
                            continue
                        }

                        if (!actualEndMatch || (actualEndMatch.index !== undefined && recoveryFenceMatch.index < actualEndMatch.index)) {
                            actualEndMatch = recoveryFenceMatch
                            isImplicitClose = true
                            consumeClosingMatch = true
                        }
                        break
                    }
                }

                // KILOCODE FIX: Only tools that do NOT consume arbitrary content (like read, ls)
                // allow implicit closing via a next-tool lookahead.
                // Content-consuming tools (write, edit) are "Safe Havens" and MUST either
                // find their explicit closer or wait for the message to be finalized.
                if (nextToolMatch && !isStrictTool) {
                    if (!endMatch || (endMatch.index !== undefined && nextToolMatch.index !== undefined && nextToolMatch.index < endMatch.index)) {
                        actualEndMatch = nextToolMatch
                        isImplicitClose = true
                        consumeClosingMatch = false
                    }
                }

                if (actualEndMatch && actualEndMatch.index !== undefined) {
                    // KILOCODE FIX: Buffering safety check.
                    // For implicit close, `actualEndMatch` is the start of the next tool, so we have 100% confidence.
                    // Only for explicit close do we need to check for partial matches or EOF ambiguity.
                    const isAtEnd = actualEndMatch.index + actualEndMatch[0].length === remainingText.length
                    // If it's an implicit close (next tool detected), we don't wait.
                    // If it's an explicit close, we wait for a newline or EOF to ensure we have the full tag.
                    // KILOCODE FIX: Always recognize closing tag as complete if we see it, regardless of trailing content
                    const shouldWait = false

                    if (!isFinalized && isAtEnd && shouldWait) {
                        content = remainingText.slice(0, actualEndMatch.index)
                        if (content.startsWith("\n")) content = content.slice(1)
                        isClosed = false
                        endIndex = startTagEndIndex + actualEndMatch.index
                    } else {
                        content = remainingText.slice(0, actualEndMatch.index)
                        if (content.startsWith("\n")) content = content.slice(1)
                        isClosed = true

                        // For explicit close, skip the closer ``` or `/edit```
                        // For implicit close, we STOP before the ``` so the next loop iteration picks it up
                        if (isImplicitClose && !consumeClosingMatch) {
                            endIndex = startTagEndIndex + actualEndMatch.index
                            // KILOCODE FIX: For implicit close, we must reset the regex lastIndex 
                            // to the start of the NEXT tool so the next iteration of the while loop 
                            // picks it up immediately.
                            toolStartRegex.lastIndex = endIndex
                        } else {
                            endIndex = startTagEndIndex + actualEndMatch.index + actualEndMatch[0].length
                            toolStartRegex.lastIndex = endIndex
                        }
                    }
                } else {
                    content = remainingText
                    if (content.startsWith("\n")) content = content.slice(1)

                    if (isFinalized) {
                        // KILOCODE FIX: If the message is finalized, we MUST close the tool block
                        // even if the closing tag is missing. This prevents "Never Terminate" hangs.
                        isClosed = true
                        endIndex = message.length
                    } else {
                        // KILOCODE FIX: Streaming safety - do not strip partial tags as it causes flickering/missing lines.
                        // Never auto-close an unterminated tool block at stream end.
                        // It must remain incomplete so execution can be blocked safely.
                        isClosed = false
                        endIndex = message.length 
                    }
                }
            }

            // 2c. Create Tool Use (or McpToolUse for MCP tools)
            // Use simple counter-based ID - same tool block gets same counter value
            const toolCallId = `unified_${this.currentTurnId}_${toolShortName}_${this.toolCounter}`
            // Only increment counter when tool is finalized (closed)
            // so re-parsing the same partial tool during streaming yields a stable ID.
            if (isClosed) {
                this.toolCounter++
                this.hasFinalizedTool = true
            }
            const shouldBePartial = !isClosed

            // MCP tools get a special McpToolUse block type
            if (isMcpTool) {
                const { serverName, toolName } = this.parseMcpToolName(toolShortName)
                let mcpArguments: Record<string, unknown> = {}
                const trimmedContent = content.trim()
                if (trimmedContent) {
                    try {
                        mcpArguments = JSON.parse(trimmedContent)
                    } catch {
                        // If JSON parsing fails, pass content as a raw "input" argument
                        mcpArguments = { input: trimmedContent }
                    }
                }

                const mcpToolUse: McpToolUse = {
                    type: "mcp_tool_use" as const,
                    id: toolCallId,
                    name: toolShortName,
                    serverName,
                    toolName,
                    arguments: mcpArguments,
                    partial: shouldBePartial,
                }
                    // KILOCODE: Critical for atomic execution
                    ; (mcpToolUse as any).isComplete = isClosed

                contentBlocks.push(mcpToolUse)
                currentIndex = endIndex
                if (isClosed) {
                    lastSafeIndex = currentIndex
                    finalizedBlockCount = contentBlocks.length
                    this.hasFinalizedTool = true
                }
                if (!isClosed) break
                continue
            }

            const toolUse = this.createToolUse(toolShortName, argsStr, shouldBePartial, toolCallId)

            // 2d. Attach Content or Parse XML Args
            if (isXml) {
                // ... XML Arg Parsing logic (identical to original) ...
                let inner = content.trim()
                const regexArgs: string[] = []
                // KILOCODE FIX: Allow slashes in tag names for shorthand paths (e.g. <src/file.ts>)
                // but forbid starting with / to avoid matching closing tags.
                const tagRegex = /<([^\/>][^>]*)>([\s\S]*?)(?:<\/\1>|$)/g
                let match
                let hasMatches = false
                const knownParamNames = new Set([
                    "path", "content", "edit", "query", "command", "pattern", "todos", "result", "url",
                    "depth", "action", "coordinate", "text", "prompt", "output_path", "image", "target_file",
                    "mode", "explanation", "code", "file_result", "notice", "operation", "start_line", "end_line"
                ])

                // KILOCODE FIX: For vulnerable params (edit, content), extract using indexOf/lastIndexOf
                // to avoid greedy regex breaking on nested HTML/XML tags
                const vulnerableParams = ["edit", "content", "code"]
                let extractedVulnerableParam = false

                for (const paramName of vulnerableParams) {
                    if (knownParamNames.has(paramName)) {
                        const startTag = `<${paramName}>`
                        const endTag = `</${paramName}>`
                        const startIndex = inner.indexOf(startTag)
                        const endIndex = inner.lastIndexOf(endTag)

                        if (startIndex !== -1 && endIndex > startIndex) {
                            const paramContent = inner.slice(startIndex + startTag.length, endIndex)
                            regexArgs.push(paramContent)
                            extractedVulnerableParam = true
                            hasMatches = true
                            break
                        }
                    }
                }

                // Only use greedy regex if we didn't extract a vulnerable param
                if (!extractedVulnerableParam) {
                    while ((match = tagRegex.exec(inner)) !== null) {
                        hasMatches = true
                        const tagName = match[1]
                        const tagContent = match[2]
                        if (knownParamNames.has(tagName.toLowerCase()) || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tagName)) {
                            regexArgs.push(tagContent)
                        } else {
                            regexArgs.push(tagName)
                            regexArgs.push(tagContent)
                        }
                    }
                }

                if (hasMatches) {
                    if (toolShortName === "write" || toolShortName === "write_to_file") {
                        if (regexArgs.length > 1) {
                            const lastIdx = regexArgs.length - 1
                            regexArgs[lastIdx] = regexArgs[lastIdx].replace(/<\/(?:c|co|con|cont|conte|conten|content|w|wr|wri|writ|write)?>?$/, "")
                        }
                    }
                    this.populateXmlArgs(toolShortName, regexArgs, toolUse)
                } else {
                    if (inner.startsWith("<") && inner.endsWith(">")) {
                        const singleArgInnerMatch = inner.match(/^<([^>]+)>([\s\S]*?)<\/\1>$/)
                        if (singleArgInnerMatch) {
                            this.populateXmlArgs(toolShortName, [singleArgInnerMatch[2]], toolUse)
                        } else {
                            const singleArg = inner.slice(1, -1).trim()
                            this.populateXmlArgs(toolShortName, [singleArg], toolUse)
                        }
                    } else if (inner.length > 0 && !inner.includes(">") && !inner.includes("<")) {
                        this.populateXmlArgs(toolShortName, [inner], toolUse)
                    } else {
                        if (inner.startsWith("<")) {
                            let val = inner.slice(1)
                            if (val.slice(-1) === ">") val = val.slice(0, -1)
                            this.populateXmlArgs(toolShortName, [val.trim()], toolUse)
                        } else {
                            this.populateXmlArgs(toolShortName, [inner], toolUse)
                        }
                    }
                }
            } else {
                if (this.isContentConsumingTool(this.mapShortNameToToolName(toolShortName))) {
                    this.appendContentToTool(toolUse, content)
                } else if (!argsStr && content.trim()) {
                    // Compact syntax without parens for non-content tools
                    // Treat the content as the args string and re-populate
                    const contentAsArgs = toolShortName === "read"
                        ? content.trim()
                        : content.trim().replace(/\n/g, " ")
                    this.populateToolArgs(toolShortName, contentAsArgs, toolUse)
                }
            }

            // KILOCODE MOD: Split multi-file or multi-anchor read_file calls
            // Note: Since this logic expands 1 tool into N, we must be careful with finalizedBlockCount.
            // If the original tool was closed, ALL generated tools are closed (and finalized).
            let generatedTools: any[] = []
            if (toolUse.name === "read_file" && toolUse.nativeArgs?.additional_anchors && toolUse.nativeArgs.additional_anchors.length > 0) {
                // console.log(`[UnifiedToolCallParser] 🔍 read_file with additional_anchors: ${toolUse.nativeArgs.additional_anchors.length}, files: ${JSON.stringify(toolUse.nativeArgs.files)}`)
                generatedTools.push(toolUse)
                toolUse.nativeArgs.additional_anchors.forEach((anchor: number, index: number) => {
                    const newToolUse = {
                        ...toolUse,
                        id: `${toolUse.id}_anchor_${index + 1}`,
                        params: { ...toolUse.params, mode: "indentation", indentation: { anchor_line: anchor } },
                        nativeArgs: { ...toolUse.nativeArgs, mode: "indentation", indentation: { anchor_line: anchor }, additional_anchors: undefined }
                    }
                    generatedTools.push(newToolUse)
                })
            } else if (toolUse.name === "read_file" && toolUse.nativeArgs?.files && toolUse.nativeArgs.files.length > 1) {
                // console.log(`[UnifiedToolCallParser] 🔍 read_file with multiple files: ${toolUse.nativeArgs.files.length}, files: ${JSON.stringify(toolUse.nativeArgs.files)}`)
                toolUse.nativeArgs.files.forEach((file: any, index: number) => {
                    const newToolUse = {
                        ...toolUse,
                        id: `${toolUse.id}_${index}`,
                        params: {
                            ...toolUse.params,
                            path: file.path,
                            lineRange: (file.lineRanges && file.lineRanges.length > 0) ? file.lineRanges.map((r: any) => `${r.start}-${r.end}`).join(", ") : undefined
                        },
                        nativeArgs: { ...toolUse.nativeArgs, files: [file] }
                    }
                    generatedTools.push(newToolUse)
                })
            } else {
                // console.log(`[UnifiedToolCallParser] 🔍 read_file single file: ${toolUse.name}, files: ${JSON.stringify(toolUse.nativeArgs?.files)}, path: ${toolUse.params?.path}`)
                generatedTools.push(toolUse)
            }

            // console.log(`[UnifiedToolCallParser] 🔍 Generated ${generatedTools.length} tool(s) from ${toolUse.name}`)
            contentBlocks.push(...generatedTools)

            currentIndex = endIndex
            // KILOCODE FIX: lastSafeIndex must ONLY advance for closed tools.
            // If we advance it for partial tools, the pendingBuffer is sliced and we 
            // lose the tool header on the next chunk, causing text leakage.
            if (isClosed) lastSafeIndex = endIndex
            if (isClosed) {
                finalizedBlockCount = contentBlocks.length
            }

            if (!isClosed) {
                break
            }
        }

        // 3. Flush remaining text after last tool
        if (currentIndex < message.length) {
            const remainingText = message.slice(currentIndex)
            // KILOCODE MOD: If not finalized, do not leak partial tool start markers
            // We want to hold back `, ``, or ``` at the end of the text
            let textToClean = remainingText
            if (!isFinalized) {
                const suffixMatch = remainingText.match(/`{1,3}$/)
                if (suffixMatch) {
                    textToClean = remainingText.slice(0, -suffixMatch[0].length)
                }
            }

            const cleanText = this.cleanTextContent(textToClean)
            // KILOCODE FIX: Prevent context poisoning. 
            // Do not emit trailing text if a tool has already been finalized in this message.
            // This is the "God Mode" kill switch for trailing text.
            if (cleanText && !this.hasFinalizedTool && finalizedBlockCount === 0) {
                contentBlocks.push({
                    type: "text",
                    content: cleanText,
                    partial: !isFinalized
                })
            }
            // Text is rarely finalized unless isFinalized is true.
        }

        return {
            finalized: contentBlocks.slice(0, finalizedBlockCount),
            pending: contentBlocks.slice(finalizedBlockCount),
            safeIndex: lastSafeIndex
        }
    }






    /**
     * Parse an MCP tool name (format: "serverName_toolName") into its components.
     * The server name is everything before the first underscore, the tool name is the rest.
     */
    private parseMcpToolName(mcpToolName: string): { serverName: string, toolName: string } {
        // Look up from the registered mapping first (exact match)
        const exact = this.mcpToolNames.get(mcpToolName)
        if (exact) return exact
        // Try with hyphens normalized to underscores
        const normalized = this.mcpToolNames.get(mcpToolName.replace(/-/g, '_'))
        if (normalized) return normalized
        // Fallback: split on first underscore
        const underscoreIdx = mcpToolName.indexOf("_")
        if (underscoreIdx === -1) {
            return { serverName: mcpToolName, toolName: mcpToolName }
        }
        return {
            serverName: mcpToolName.slice(0, underscoreIdx),
            toolName: mcpToolName.slice(underscoreIdx + 1)
        }
    }

    private isContentConsumingTool(toolName: string): boolean {
        return [
            "write_to_file", "edit", "new_rule", "edit_file",
            "update_todo_list", "todo", "execute_command",
            "wrap"
        ].includes(toolName)
    }

    private createToolUse(shortName: string, argsStr: string, partial: boolean, id: string): any {
        const canonicalName = this.mapShortNameToToolName(shortName)
        const toolUse: any = {
            type: "tool_use",
            name: canonicalName,
            id: id,
            originalName: shortName,
            params: {},
            nativeArgs: {},
            partial: partial,
            isComplete: !partial // KILOCODE: Critical for atomic execution
        }

        this.populateToolArgs(shortName, argsStr, toolUse)

        return toolUse
    }

    private mapShortNameToToolName(shortName: string): ToolName {
        const mapping: Record<string, ToolName> = {
            "read": "read_file",
            "edit": "edit",
            "write": "write_to_file",
            "ls": "list_dir",
            "glob": "glob",
            "search": "grep",
            "cmd": "execute_command",
            "todo": "update_todo_list",
            "done": "attempt_completion",
            "web": "web_search",
            "research": "research_web",
            "fetch": "web_fetch",
            "browse": "browser_action",
            "browser": "browser_action",
            "click": "browser_action",
            "type": "browser_action",
            "scroll": "browser_action",
            "image": "generate_image",
            "ask": "codebase_search",
            "edit_file": "edit_file",
            "new_rule": "new_rule",
            "report_bug": "report_bug",
            "agent": "run_sub_agent",
            "run_sub_agent": "run_sub_agent",
            "sub": "run_sub_agent",
            "condense": "condense",
            "diff": "edit",
            "execute_command": "execute_command",
            "delete": "delete_file",
            "delete_file": "delete_file",
            "fast_context": "fast_context",
            "context": "fast_context",
            "semgrep": "fast_context",
            "mkdir": "mkdir",
            "find": "glob",
            "mv": "move_file",
            "move": "move_file",
            "rename": "move_file",
            "wrap": "wrap" as ToolName
        }
        return mapping[shortName] || (shortName as ToolName)
    }

    private populateToolArgs(shortName: string, argsStr: string, toolUse: any) {
        const params = toolUse.params
        const native = toolUse.nativeArgs

        // Helper to parse --flags into a dictionary.
        // Returns both raw (with quotes) and clean (without quotes) values.
        const parseFlags = (input: string): Record<string, string> => {
            const flags: Record<string, string> = {}
            let i = 0
            
            while (i < input.length) {
                // Skip whitespace
                while (i < input.length && /\s/.test(input[i])) i++
                if (i >= input.length) break
                
                // Look for --flag
                if (input[i] === '-' && input[i + 1] === '-') {
                    i += 2
                    const flagStart = i
                    // Extract flag name
                    while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) i++
                    const flagName = input.slice(flagStart, i)
                    
                    // Skip whitespace after flag name
                    while (i < input.length && /\s/.test(input[i])) i++
                    if (i >= input.length) break
                    
                    // Extract value (handle quotes with escape sequences)
                    let value = ""
                    const quoteChar = input[i]
                    
                    if (quoteChar === '"' || quoteChar === "'" || quoteChar === "`") {
                        // Quoted value - parse until matching unescaped quote
                        i++ // skip opening quote
                        let escaped = false
                        while (i < input.length) {
                            const char = input[i]
                            if (escaped) {
                                value += char
                                escaped = false
                            } else if (char === '\\') {
                                value += char
                                escaped = true
                            } else if (char === quoteChar) {
                                i++ // skip closing quote
                                break
                            } else {
                                value += char
                            }
                            i++
                        }
                    } else {
                        // Unquoted value - read until next --flag or end
                        const valueStart = i
                        while (i < input.length) {
                            // Stop at next --flag
                            if (input[i] === '-' && input[i + 1] === '-') break
                            i++
                        }
                        value = input.slice(valueStart, i).trim()
                    }
                    
                    flags[flagName] = value
                } else {
                    i++
                }
            }
            
            return flags
        }

        // Raw flag extractor that preserves the full raw value (including quotes) up to the next --flag
        // Used for multi-value flags where we need to split on commas only between quoted tokens
        const getRawFlagValue = (input: string, flagName: string): string | undefined => {
            const flagPattern = `--${flagName}`
            const flagIndex = input.indexOf(flagPattern)
            if (flagIndex === -1) return undefined
            
            let i = flagIndex + flagPattern.length
            // Skip whitespace after flag name
            while (i < input.length && /\s/.test(input[i])) i++
            if (i >= input.length) return undefined
            
            const valueStart = i
            const quoteChar = input[i]
            
            if (quoteChar === '"' || quoteChar === "'" || quoteChar === "`") {
                // Quoted value - parse until matching unescaped quote
                i++ // skip opening quote
                let escaped = false
                while (i < input.length) {
                    const char = input[i]
                    if (escaped) {
                        escaped = false
                    } else if (char === '\\') {
                        escaped = true
                    } else if (char === quoteChar) {
                        i++ // include closing quote
                        break
                    }
                    i++
                }
                return input.slice(valueStart, i)
            } else {
                // Unquoted value - read until next --flag or end
                while (i < input.length) {
                    if (input[i] === '-' && input[i + 1] === '-') break
                    i++
                }
                return input.slice(valueStart, i).trim()
            }
        }

        const flags = parseFlags(argsStr)

        if (shortName === 'ask') {
            // Use raw value to correctly split on commas between quoted items
            const rawQuery = getRawFlagValue(argsStr, 'query') || argsStr.trim()
            // Split on commas that are between quoted strings or between unquoted tokens
            const queries = (rawQuery.match(/("[^"]*"|'[^']*'|`[^`]*`|[^,]+)/g) || [])
                .map(q => q.trim().replace(/^"|"$|^'|'$|^`|`$/g, ""))
                .filter(Boolean)

            if (queries.length > 1) {
                params.query = queries
                native.query = queries
            } else {
                params.query = queries[0] || ""
                native.query = queries[0] || ""
            }
            return
        }

        if (shortName === "cmd" || shortName === "execute_command") {
            const command = flags.run || flags.command || argsStr.trim()
            const cwd = flags.cwd
            params.command = this.normalizeCmdCommand(command)
            native.command = params.command
            if (cwd) {
                params.cwd = cwd
                native.cwd = cwd
            }
            return
        }

        switch (shortName) {
            case "read": {
                // For markdown format: first token is the path (positional), then flags
                // Extract path before any -- flags
                const beforeFlags = argsStr.split(/\s+--/)[0].trim()
                const rawPath = getRawFlagValue(argsStr, 'path')
                const pathStr = rawPath !== undefined ? rawPath : (flags.path || beforeFlags || argsStr.trim())
                const linesStr = flags.lines
                const headStr = flags.head
                const tailStr = flags.tail

                if (pathStr) {
                    // pathStr is the raw flag value (may include outer quotes).
                    // Two supported formats:
                    //   1. Multiple individually-quoted tokens: "a, b.txt", "c.ts", "d.md"
                    //      → split on quoted token boundaries, each token is one path
                    //   2. Single quoted string with comma+space-separated paths: "game.py, pizza.txt"
                    //      → strip outer quotes, split on ", " inside
                    //   3. Unquoted comma+space-separated: game.py, pizza.txt
                    //      → split on ", "
                    let paths: string[]
                    const multiQuotedTokens = pathStr.match(/("[^"]+"|'[^']+'|`[^`]+`)/g)
                    if (multiQuotedTokens && multiQuotedTokens.length > 1) {
                        // Multiple individually-quoted tokens
                        paths = multiQuotedTokens.map(p => p.slice(1, -1)).filter(Boolean)
                    } else {
                        // Single quoted or unquoted — strip outer quotes then split on ", "
                        let inner = pathStr.trim()
                        if ((inner.startsWith('"') && inner.endsWith('"')) ||
                            (inner.startsWith("'") && inner.endsWith("'")) ||
                            (inner.startsWith("`") && inner.endsWith("`"))) {
                            inner = inner.slice(1, -1)
                        }
                        paths = inner
                            .split(/[\r\n]+|, */)
                            .map(p => p.trim())
                            .filter(Boolean)
                    }

                    native.files = []
                    paths.forEach((p, idx) => {
                        let parsedPath = p
                        let inlineRange: { start: number, end: number } | undefined

                        const inlineRangeMatch = p.match(/^(.*?):L(\d+)-(\d+)$/i)
                        if (inlineRangeMatch) {
                            parsedPath = inlineRangeMatch[1].trim()
                            inlineRange = {
                                start: parseInt(inlineRangeMatch[2]),
                                end: parseInt(inlineRangeMatch[3])
                            }
                        }

                        const fileEntry: any = { path: parsedPath, lineRanges: [] }

                        if (headStr) {
                            fileEntry.head = parseInt(headStr)
                        }
                        if (tailStr) {
                            fileEntry.tail = parseInt(tailStr)
                        }

                        if (inlineRange) {
                            fileEntry.lineRanges.push(inlineRange)
                        } else if (linesStr) {
                            const allRanges = linesStr.split(",").map(r => r.trim())
                            const rangeStr = allRanges[idx] || allRanges[0]
                            if (rangeStr) {
                                const rangeMatch = rangeStr.match(/^(\d+)-(\d+)$/)
                                if (rangeMatch) {
                                    fileEntry.lineRanges.push({
                                        start: parseInt(rangeMatch[1]),
                                        end: parseInt(rangeMatch[2])
                                    })
                                }
                            }
                        }
                        native.files.push(fileEntry)
                    })

                    params.path = native.files.map((file: any) => file.path).join(", ")
                    if (linesStr && !native.files.some((file: any) => file.lineRanges && file.lineRanges.length > 0)) {
                        params.lineRange = linesStr
                    }
                    if (headStr) params.head = headStr
                    if (tailStr) params.tail = tailStr
                }
                break
            }
            case "edit": {
                // For markdown format: first line is the path (positional)
                const pathMatch = argsStr.trim().split(/\s+/)[0]
                const path = flags.path || pathMatch || ""
                params.path = path
                native.path = path
                break
            }
            case "write":
            case "write_to_file": {
                // For markdown format: first line is the path (positional), rest is handled by content appending
                // Extract path from argsStr (first line before any flags or newlines)
                const pathMatch = argsStr.trim().split(/\s+/)[0]
                const path = flags.path || pathMatch || ""
                
                params.path = path
                params.target_file = path
                native.path = path
                native.target_file = path
                break;
            }
            case "ls": {
                const beforeFlags = argsStr.split(/\s+--/)[0].trim()
                // Check if beforeFlags is actually a flag (starts with --) or empty
                // If so, use "." as the default path instead of treating the flag as path
                const path = flags.path || (beforeFlags && !beforeFlags.startsWith("--") ? beforeFlags : ".")
                params.path = path
                native.path = params.path
                if (flags.recursive === "true" || argsStr.includes("--recursive true") || argsStr.includes("--recursive")) {
                    params.recursive = "true"
                    native.recursive = true
                }
                break
            }
            case "find":
            case "glob": {
                const beforeFlags = argsStr.split(/\s+--/)[0].trim()
                if (flags.pattern) {
                    params.pattern = flags.pattern
                    params.path = flags.path || "."
                } else {
                    // Match pattern (quoted or unquoted) and then the path
                    // Improved regex to handle spaces in quoted patterns and correctly isolate the path
                    const match = beforeFlags.match(/^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|((?:[^\s\\]|\\ )+))(?:\s+(.+))?$/s)
                    if (match) {
                        params.pattern = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""
                        params.path = flags.path || match[5]?.trim() || "."
                    } else {
                        params.pattern = beforeFlags
                        params.path = flags.path || "."
                    }
                }
                // Clean up quotes from the path
                if (params.path) {
                    params.path = params.path.replace(/^["'`]|["'`]$/g, "")
                }
                native.pattern = params.pattern
                native.path = params.path
                break
            }
            case "mv":
            case "move":
            case "rename": {
                // If we have flags, use them primarily
                if (flags.source || flags.rename || flags.path || flags.from) {
                    params.source = flags.source || flags.rename || flags.path || flags.from
                    params.destination = flags.to || flags.new || flags.destination || ""
                } else if (argsStr.trim()) {
                    // Try positional split
                    // Look for common separators like " to " or " -> "
                    const positionalMatch = argsStr.trim().match(/^(.+?)\s+(?:--to|--new|--destination|to|into|->)\s+(.+)$/i)
                    if (positionalMatch) {
                        params.source = positionalMatch[1].trim()
                        params.destination = positionalMatch[2].trim()
                    } else {
                        const parts = argsStr.trim().split(/\s+/)
                        if (parts.length >= 2) {
                            params.source = parts[0]
                            params.destination = parts[parts.length - 1]
                        } else {
                            params.source = argsStr.trim()
                            params.destination = ""
                        }
                    }
                }

                // Cleanup quotes
                if (params.source) params.source = params.source.replace(/^["'`]|["'`]$/g, "")
                if (params.destination) params.destination = params.destination.replace(/^["'`]|["'`]$/g, "")

                native.source = params.source
                native.destination = params.destination
                if (flags.rename || shortName === "rename") {
                    params.isRename = true
                    native.isRename = true
                }
                break
            }
            case "grep":
            case "search": {
                const beforeFlags = argsStr.split(/\s+--/)[0].trim()
                let rawQuery: string
                if (flags.query) {
                    rawQuery = flags.query
                    params.path = flags.path || "."
                } else {
                    // Match query (quoted or unquoted) and then the path
                    // Improved regex to handle spaces in quoted queries and correctly isolate the path
                    // This regex correctly handles escaped quotes and separates the first token (query) from the rest (path)
                    const match = beforeFlags.match(/^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|((?:[^\s\\]|\\ )+))(?:\s+(.+))?$/s)
                    if (match) {
                        rawQuery = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""
                        params.path = flags.path || match[5]?.trim() || "."
                    } else {
                        rawQuery = beforeFlags
                        params.path = flags.path || "."
                    }
                }
                // Handle literal \n in queries since AI often escapes them
                if (typeof rawQuery === 'string' && rawQuery.includes("\\n")) {
                    rawQuery = rawQuery.replace(/\\n/g, "\n")
                }
                // Clean up quotes from the path
                if (params.path) {
                    params.path = params.path.replace(/^["'`]|["'`]$/g, "")
                }
                
                // KILOCODE: Support pipe-separated multi-query syntax (e.g., "query1|query2|query3")
                // Split on | to create an array of queries for SearchFilesTool
                if (rawQuery.includes("|")) {
                    const queries = rawQuery.split("|").map(q => q.trim()).filter(Boolean)
                    params.query = queries
                    native.query = queries
                } else {
                    params.query = rawQuery
                    native.query = rawQuery
                }
                native.path = params.path

                // Schema uses --case-sensitive. If present, it means case_insensitive should be false.
                if (flags['case-sensitive'] !== undefined || flags.case_sensitive === "true") {
                    params.case_insensitive = false
                    native.case_insensitive = false
                } else if (flags['case-insensitive'] !== undefined || flags.case_insensitive === "true") {
                    params.case_insensitive = true
                    native.case_insensitive = true
                }
                break
            }
            case "todo":
                params.todos = argsStr.trim()
                native.todos = argsStr.trim()
                break
            case "done":
                params.result = argsStr.trim()
                native.result = params.result
                break
            case "web":
                params.query = flags.query || argsStr.trim()
                native.query = params.query
                break
            case "research": {
                params.query = flags.topic || flags.query || argsStr.trim()
                native.query = params.query
                if (flags.depth) {
                    params.depth = flags.depth
                    native.depth = parseInt(flags.depth)
                }
                break
            }
            case "fetch":
                params.url = flags.url || argsStr.trim()
                native.url = params.url
                break
            case "browse":
            case "browser":
                params.action = "launch"
                params.url = flags.url || argsStr.trim()
                native.action = "launch"
                native.url = params.url
                break
            case "click": {
                params.action = "click"
                params.coordinate = flags.coordinate || argsStr.trim()
                native.action = "click"
                native.coordinate = params.coordinate
                break
            }
            case "type":
                params.action = "type"
                params.text = flags.text || argsStr.trim()
                native.action = "type"
                native.text = params.text
                break
            case "scroll":
                params.action = flags.direction === "up" ? "scroll_up" : "scroll_down"
                native.action = params.action
                break
            case "image":
                params.prompt = flags.prompt || ""
                params.output_path = flags.path || ""
                native.prompt = params.prompt
                native.path = params.output_path
                break
            case "edit_file":
                params.target_file = flags.path || argsStr.trim()
                native.target_file = params.target_file
                break
            case "new_rule":
            case "mkdir":
                params.path = flags.path || argsStr.trim()
                native.path = params.path
                break
            case "agent":
            case "sub":
            case "run_sub_agent":
                params.prompt = flags.prompt || argsStr.trim()
                native.prompt = params.prompt
                if (flags.mode) {
                    params.mode = flags.mode
                    native.mode = flags.mode
                }
                break
            case "fast_context":
            case "context":
            case "semgrep":
                params.query = flags.query || argsStr.trim()
                native.query = params.query
                if (flags.path) {
                    params.path = flags.path
                    native.path = flags.path
                }
                break
            case "browser_action":
                params.action = flags.action || argsStr.trim()
                native.action = params.action
                if (flags.url) { params.url = flags.url; native.url = flags.url }
                if (flags.coordinate) { params.coordinate = flags.coordinate; native.coordinate = flags.coordinate }
                if (flags.text) { params.text = flags.text; native.text = flags.text }
                if (flags.size) { params.size = flags.size; native.size = flags.size }
                if (flags.path) { params.path = flags.path; native.path = flags.path }
                break
            case "wrap": {
                const wrapKeys = ["effect", "emotion", "gui", "color", "bg", "border", "shadow", "style", "intensity"]
                for (const key of wrapKeys) {
                    if (flags[key]) {
                        params[key] = flags[key]
                        native[key] = flags[key]
                    } else {
                        const regex = new RegExp(`${key}\\s*=\\s*(?:\\"([^\\"]*)\\"|\\'([^\\']*)\\'|([^,;\\s]+))`, "i")
                        const m = argsStr.match(regex)
                        if (m) {
                            const val = (m[1] ?? m[2] ?? m[3]).trim()
                            params[key] = val
                            native[key] = val
                        }
                    }
                }
                break
            }
        }
    }

    private normalizeCmdCommand(input: string): string {
        let command = (input || "").trim()
        if (!command) return command

        // Check if command contains shell metacharacters that need quote protection
        const hasShellMetachars = /[;&|<>()$`\\'"{}[\]!*?~]/.test(command)
        
        // Handle parser wrapper artifacts like ("npm test"), but keep legitimate shell groups.
        // We recursively strip outer parens and quotes if they wrap the ENTIRE command.
        let prev = ""
        while (command !== prev && command.length > 0) {
            prev = command

            // 1. Strip matching outer parens if they wrap the whole command and are balanced
            if (this.isWrappedBySinglePairOfParens(command)) {
                const inner = command.slice(1, -1).trim()
                // Only unwrap if it looks like an artifact (e.g. inner also had quotes that get stripped)
                // OR if it's a very simple command that wouldn't normally be a subshell
                const unquotedInner = this.stripMatchingOuterQuotes(inner)
                if (unquotedInner !== inner || !inner.includes(" ")) {
                    command = inner
                }
            }

            // 2. Strip matching outer quotes ONLY if the inner content doesn't need them
            const trimmed = command.trim()
            if (trimmed.length >= 2) {
                const first = trimmed[0]
                const last = trimmed[trimmed.length - 1]
                
                // If wrapped in quotes, check if we should strip them
                if ((first === '"' || first === "'" || first === "`") && last === first && !this.isEscaped(trimmed, trimmed.length - 1)) {
                    const inner = trimmed.slice(1, -1)
                    
                    // CRITICAL: Don't strip quotes if the inner content has embedded quotes or complex shell syntax
                    // that would break when passed to shell -c
                    const hasEmbeddedQuotes = inner.includes('"') || inner.includes("'") || inner.includes("`")
                    const hasComplexShellSyntax = /[;&|<>()$`\\]/.test(inner)
                    
                    // Only strip if it's a simple command without embedded quotes or complex syntax
                    if (!hasEmbeddedQuotes && !hasComplexShellSyntax) {
                        const unquoted = this.stripMatchingOuterQuotes(command)
                        if (unquoted !== command) {
                            command = unquoted.trim()
                        }
                    } else {
                        // Keep the quotes - they're protecting the command
                        break
                    }
                }
            }
        }

        return command
    }

    private stripMatchingOuterQuotes(value: string): string {
        const trimmed = value.trim()
        if (trimmed.length < 2) return trimmed

        const first = trimmed[0]
        const last = trimmed[trimmed.length - 1]
        if ((first === '"' || first === "'" || first === "`") && last === first && !this.isEscaped(trimmed, trimmed.length - 1)) {
            const inner = trimmed.slice(1, -1)
            // Unescape only backslashes escaping the quote character or backslash itself.
            // Other escapes (like \n, \t) are left intact for shell command propagation.
            const escapeRegex = new RegExp(`\\\\([\\\\${first}])`, 'g')
            return inner.replace(escapeRegex, '$1')
        }

        return trimmed
    }

    private isEscaped(value: string, index: number): boolean {
        let slashCount = 0
        for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) {
            slashCount++
        }
        return slashCount % 2 === 1
    }

    private isWrappedBySinglePairOfParens(value: string): boolean {
        const trimmed = value.trim()
        if (!(trimmed.startsWith("(") && trimmed.endsWith(")"))) return false

        let depth = 0
        let quote: '"' | "'" | "`" | null = null
        let escape = false

        for (let i = 0; i < trimmed.length; i++) {
            const char = trimmed[i]

            if (escape) {
                escape = false
                continue
            }

            if (char === "\\") {
                escape = true
                continue
            }

            if (quote) {
                if (char === quote) {
                    quote = null
                }
                continue
            }

            if (char === '"' || char === "'" || char === "`") {
                quote = char
                continue
            }

            if (char === "(") {
                depth++
                continue
            }

            if (char === ")") {
                depth--
                if (depth < 0) return false
                if (depth === 0 && i < trimmed.length - 1) {
                    return false
                }
            }
        }

        return depth === 0
    }

    private populateXmlArgs(shortName: string, args: string[], toolUse: any) {
        // console.log(`[UnifiedToolCallParser] 🔍 populateXmlArgs called: shortName=${shortName}, args.length=${args.length}, args=${JSON.stringify(args)}`)
        populateToolParamsFromXmlArgs(shortName, args, toolUse)
        // console.log(`[UnifiedToolCallParser] 🔍 After populateToolParamsFromXmlArgs: native.files=${JSON.stringify(toolUse.nativeArgs?.files)}`)

        // Custom post-processing for UnifiedToolCallParser specific logic
        if (shortName === "edit" || shortName === "write" || shortName === "write_to_file") {
            if (args.length > 1) {
                this.appendContentToTool(toolUse, args.slice(1).join("\n"))
            }
        }
    }

    private sanitizeNestedToolCalls(content: string): string {
        // Convert nested ```toolname ...``` inside content blocks to tool:toolname(...) 
        // so they don't get re-parsed as real tool calls.
        // Handles both one-liners and multi-line nested blocks.
        return content
            // Multi-line: ```write\nfoo\ncontent\n/write```
            .replace(/```\s*([\w-]+)\s+([^\n]+)\n[\s\S]*?(?:\/\1)?```/g, (_, name, args) => {
                return `tool:${name}(${args.trim()})`
            })
            // One-liner: ```cmd\nnpm run build```
            .replace(/```\s*([\w-]+)\n([^`]+)```/g, (_, name, val) => {
                const inner = val ? val.trim().replace(/^["'`]|["'`]$/g, "") : ""
                return `tool:${name}("${inner}")`
            })
    }

    private appendContentToTool(toolUse: any, content: string) {
        if (toolUse.isArgBased) return

        if (toolUse.name === "edit" || toolUse.name === "edit_file") {
            let contentToProcess = content

            // KILOCODE FIX: Strip "Content:" anchor if present at the beginning
            // This anchor is a cognitive checkpoint for the model but should not appear in actual content
            if (contentToProcess.trimStart().startsWith("Content:")) {
                contentToProcess = contentToProcess.replace(/^\s*Content:\s*\n?/, "")
            }

            // KILOCODE MOD: Support multi-line path (path on next line)
            const hasPath = toolUse.name === "edit" ? !!toolUse.params.path : !!toolUse.params.target_file
            if (!hasPath) {
                const firstNewline = contentToProcess.indexOf('\n')
                let potentialPath = ""
                if (firstNewline === -1) {
                    potentialPath = contentToProcess.trim()
                    if (potentialPath) contentToProcess = ""
                } else {
                    // Extract first line as path
                    potentialPath = contentToProcess.slice(0, firstNewline).trim()
                    contentToProcess = contentToProcess.slice(firstNewline + 1)
                }

                if (potentialPath) {
                    if (toolUse.name === "edit") {
                        toolUse.params.path = potentialPath
                        toolUse.nativeArgs.path = potentialPath
                    } else {
                        toolUse.params.target_file = potentialPath
                        toolUse.nativeArgs.target_file = potentialPath
                    }
                }
            }

            if (toolUse.name === "edit") {
                toolUse.params.edit = (toolUse.params.edit || "") + contentToProcess
                // KILOCODE FIX: Remove escape backslashes from literals like \/edit``` or \```tool in edit content
                toolUse.params.edit = toolUse.params.edit.replace(/\\(```[a-zA-Z0-9_-]+|(?:\/)(?:edit|write|edit_file|write_to_file|todo|wrap)(?:`{1,3}))/g, '$1')
                const edits = this.parseEditBlocks(toolUse.params.edit)
                // Propagate line range hints from the tool call header to individual blocks
                // If the header has multiple ranges, assign them sequentially
                if (toolUse.nativeArgs.ranges && toolUse.nativeArgs.ranges.length > 0) {
                    edits.forEach((edit: any, idx: number) => {
                        // Per-block range (Old (10-20):) takes priority
                        if (edit.start_line !== undefined) return

                        // Otherwise use range from header if available for this block index
                        const range = toolUse.nativeArgs.ranges[idx]
                        if (range) {
                            edit.start_line = range.start
                            edit.end_line = range.end
                        }
                    })
                } else if (toolUse.params.start_line !== undefined || toolUse.params.end_line !== undefined) {
                    // Legacy single-range support
                    edits.forEach((edit: any) => {
                        if (edit.start_line === undefined) edit.start_line = toolUse.params.start_line
                        if (edit.end_line === undefined) edit.end_line = toolUse.params.end_line
                    })
                }
                toolUse.nativeArgs.edits = edits
            } else {
                toolUse.params.instructions = (toolUse.params.instructions || "") + content
                toolUse.nativeArgs.instructions = toolUse.params.instructions
            }
        } else if (toolUse.name === "write_to_file" || toolUse.name === "new_rule") {
            let cleanContent = content
            
            // KILOCODE MOD: Support multi-line path (path on next line) - extract before Content: marker
            const hasPath = !!(toolUse.params.path || toolUse.params.target_file)
            if (!hasPath) {
                // Check if first line is the path (before "Content:" marker)
                const contentMarkerIndex = cleanContent.indexOf("Content:")
                if (contentMarkerIndex !== -1) {
                    // Extract everything before "Content:" as potential path
                    const beforeContent = cleanContent.slice(0, contentMarkerIndex).trim()
                    if (beforeContent) {
                        toolUse.params.path = beforeContent
                        toolUse.params.target_file = beforeContent
                        toolUse.nativeArgs.path = beforeContent
                        toolUse.nativeArgs.target_file = beforeContent
                    }
                    // Remove the path line and Content: marker
                    cleanContent = cleanContent.slice(contentMarkerIndex)
                } else {
                    // No Content: marker, first line is path
                    const firstNewline = cleanContent.indexOf('\n')
                    let potentialPath = ""
                    if (firstNewline === -1) {
                        potentialPath = cleanContent.trim()
                        if (potentialPath) cleanContent = ""
                    } else {
                        potentialPath = cleanContent.slice(0, firstNewline).trim()
                        cleanContent = cleanContent.slice(firstNewline + 1)
                    }
                    if (potentialPath) {
                        toolUse.params.path = potentialPath
                        toolUse.params.target_file = potentialPath
                        toolUse.nativeArgs.path = potentialPath
                        toolUse.nativeArgs.target_file = potentialPath
                    }
                }
            }
            
            // KILOCODE FIX: Strip "Content:" anchor if present at the beginning
            if (cleanContent.trimStart().startsWith("Content:")) {
                cleanContent = cleanContent.replace(/^\s*Content:\s*\n?/, "")
            }
            
            if (!toolUse.params.content) {
                // Only strip the very first leading newline that follows the tool header
                cleanContent = cleanContent.replace(/^\r?\n/, "")
            }
            // KILOCODE MOD: intentionally left out this.sanitizeNestedToolCalls(cleanContent) 
            // so valid AI double-angle tags don't get gobbled/renamed.
            // KILOCODE FIX: Remove escape backslashes from literals like \/write```
            const unescapedContent = cleanContent.replace(/\\(```[a-zA-Z0-9_-]+|(?:\/)(?:edit|write|edit_file|write_to_file|todo|wrap)(?:`{1,3}))/g, '$1')
            toolUse.params.content = (toolUse.params.content || "") + unescapedContent
            toolUse.nativeArgs.content = toolUse.params.content
        } else if (toolUse.name === "update_todo_list" || toolUse.name === "todo") {
            toolUse.params.todos = (toolUse.params.todos || "") + content
            toolUse.nativeArgs.todos = toolUse.params.todos
        } else if (toolUse.name === "execute_command") {
            const hasExisting = (toolUse.params.command || "").trim().length > 0
            if (hasExisting && content.trim().length > 0) {
                toolUse.params.command = (toolUse.params.command || "").trimEnd() + " " + content.trimStart()
            } else {
                toolUse.params.command = (toolUse.params.command || "") + content
            }
            toolUse.nativeArgs.command = toolUse.params.command
        } else if (
            toolUse.name === "web_search" ||
            toolUse.name === "research_web"
        ) {
            let cleanContent = content
            if (!toolUse.params.query) {
                cleanContent = content.replace(/^\r?\n/, "")
            }

            // KILOCODE MOD: If query is already an array (multi-query), 
            // append content as a new query if it's substantial, 
            // or just avoid concatenating strings which results in [object Object] or "q1,q2" strings.
            if (Array.isArray(toolUse.params.query)) {
                const trimmed = cleanContent.trim()
                if (trimmed) {
                    toolUse.params.query.push(trimmed)
                    toolUse.nativeArgs.query.push(trimmed)
                }
            } else {
                toolUse.params.query = (toolUse.params.query || "") + cleanContent
                toolUse.nativeArgs.query = toolUse.params.query
            }
        } else if (toolUse.name === "wrap") {
            let cleanContent = content
            if (!toolUse.params.content) {
                cleanContent = content.replace(/^\r?\n/, "")
            }
            toolUse.params.content = (toolUse.params.content || "") + cleanContent
            toolUse.nativeArgs.content = toolUse.params.content
        }
    }

    private parseEditBlocks(diffContent: string): any[] {
        // NOTE: We do NOT strip diff_N headers anymore; we parse them to extract line context.
        const sanitized = diffContent
        const edits: any[] = []

        // V4 Regex: Context-Aware Header Matching.
        // Added 'diff_\\d+' to the list of recognized headers.
        // Also updated range matching to support BOTH comma and hyphen separators: (\d+)(?:[-]|,[\t ]*)(\d+)
        // Support both "Old start-end:" and "Old (start-end):"
        const headerRegex = /^\s*(?:(Old|Original|SEARCH|New|Updated|REPLACE|diff_\d+)(?:(?:[\t ]*(?:\(?[\t ]*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?[\t ]*\)?))|(?=:))(:|(?=\s*\r?\n))|(rm|remove|delete)[\t ]+(?:(?:\(?[\t ]*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?[\t ]*\)?)))/gim

        let match
        const headers: { index: number; length: number; type: string; start?: string; end?: string; }[] = []

        while ((match = headerRegex.exec(sanitized)) !== null) {
            headers.push({
                index: match.index,
                length: match[0].length,
                type: match[1] || match[5],
                start: match[2] || match[6],
                end: match[3] || match[7]
            })
        }

        if (headers.length === 0) return []

        const blocks = headers.map((h, i) => {
            const nextHeader = headers[i + 1]
            // Calculate content start (skip the header line)
            const contentStart = h.index + h.length
            const contentEnd = nextHeader ? nextHeader.index : sanitized.length
            const content = sanitized.slice(contentStart, contentEnd)
            return { ...h, content }
        })

        const pendingOlds: { oldText: string, start_line?: number, end_line?: number }[] = []
        let currentRange: { start: number, end: number } | undefined

        for (const block of blocks) {
            const isOld = /Old|Original|SEARCH/i.test(block.type)
            const isDelete = /rm|remove|delete/i.test(block.type)
            const isDiffHeaders = /diff_\d+/i.test(block.type)

            const normalizeBlock = (rawContent: string): string => {
                // KILOCODE FIX: Improved artifact stripping.
                // When we split the message by headers, the 'content' of a block 
                // naturally starts with a newline (immediately after "Old:\n")
                // and ends with one (immediately before "New:\n").
                // We MUST remove exactly one leading and one trailing newline if they exist,
                // but we must NOT strip intentional blank lines or indentation.

                let processed = rawContent

                // 1. Remove exactly one leading newline if it exists (possibly preceded by spaces)
                processed = processed.replace(/^[ \t]*\r?\n/, "")

                // 2. Remove exactly one trailing newline if it exists (possibly preceded by spaces)
                processed = processed.replace(/\r?\n[ \t]*$/, "")

                // 3. Sanitize nested tool calls inside content blocks.
                // Convert ```toolname\n...``` to tool:toolname("...") so they
                // don't get re-parsed as real tool calls when the content is later processed.
                processed = processed.replace(
                    /```\s*([\w-]+)\n([^`]*)```/g,
                    (_, name, val) => {
                        const inner = val ? val.replace(/^["'`]|["'`]$/g, "") : ""
                        return `tool:${name}("${inner}")`
                    }
                )

                return processed
            }

            if (isDiffHeaders) {
                // Update current context for subsequent blocks
                if (block.start) {
                    currentRange = {
                        start: parseInt(block.start),
                        end: block.end ? parseInt(block.end) : parseInt(block.start)
                    }
                }
                // diff_N blocks don't produce edits directly, they just set context
                continue
            }

            if (isDelete) {
                if (block.start) {
                    edits.push({
                        type: "line_deletion",
                        start_line: parseInt(block.start),
                        end_line: block.end ? parseInt(block.end) : parseInt(block.start),
                        oldText: "",
                        newText: ""
                    })
                }
            } else if (isOld) {
                const startLine = block.start ? parseInt(block.start) : currentRange?.start
                const endLine = block.end ? parseInt(block.end) : block.start ? parseInt(block.start) : currentRange?.end

                pendingOlds.push({
                    oldText: normalizeBlock(block.content),
                    start_line: startLine,
                    end_line: endLine,
                })
            } else {
                // This is a New/Updated/REPLACE block
                const matchingOld = pendingOlds.shift()
                const newText = normalizeBlock(block.content)
                
                // Check if New block has its own line numbers (e.g., "New (136-140):")
                const newStartLine = block.start ? parseInt(block.start) : undefined
                const newEndLine = block.end ? parseInt(block.end) : (block.start ? parseInt(block.start) : undefined)
                
                if (matchingOld) {
                    const isDeletion = newText === "" && matchingOld.start_line !== undefined
                    edits.push({
                        ...(isDeletion ? { type: "line_deletion" } : {}),
                        oldText: matchingOld.oldText,
                        newText,
                        // Prefer Old block's line numbers, but fall back to New block's if Old had none
                        start_line: matchingOld.start_line ?? newStartLine,
                        end_line: matchingOld.end_line ?? newEndLine,
                    })
                } else if (newStartLine !== undefined) {
                    // Orphaned New block WITH line numbers = line-range replacement (empty Old)
                    // This is the new format: "New (136-140):" with line-numbered content
                    edits.push({
                        oldText: "", // Empty - will be filled from file content by EditTool
                        newText,
                        start_line: newStartLine,
                        end_line: newEndLine,
                    })
                } else if (edits.length > 0) {
                    // An orphaned New block without line numbers appends to the previous one
                    const prevNewText = edits[edits.length - 1].newText
                    edits[edits.length - 1].newText = prevNewText + "\n" + newText
                }
            }
        }

        // Handle trailing Old blocks (Streaming partials or deletions?)
        // If we end with Old blocks, they are likely partial tool calls being streamed.
        for (const p of pendingOlds) {
            edits.push({
                oldText: p.oldText,
                newText: "", // Partial
                start_line: p.start_line,
                end_line: p.end_line
            })
        }
    return edits
}

private cleanTextContent(text: string): string {
    let clean = text

    const knownToolShortNames = [
        "read", "edit", "write", "ls", "glob", "grep", "search", "cmd", "execute_command", "todo", "done",
        "web", "research", "fetch", "browse", "click", "type", "scroll", "image", "ask",
        "edit_file", "new_rule", "report_bug", "agent", "run_sub_agent", "condense", "sub", "diff",
        "delete", "delete_file", "fast_context", "context", "mv", "move", "rename", "browser_action", "browser", "semgrep", "wrap", "mkdir", "find"
    ]
    const escapedToolNames = [...knownToolShortNames, ...this.mcpToolNames.keys()]
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .sort((a, b) => b.length - a.length)
    const toolHeaderPattern = escapedToolNames.length > 0
        ? `(?:${escapedToolNames.join("|")})`
        : "a^"
    const fence = "```"

    // KILOCODE FIX: Unescape escaped tool starts \```tool
    clean = clean.replace(/\\(```[a-zA-Z0-9_-]+)/g, "$1")

    // 1. During streaming, partial prefixes like "tool:" can leak
    // into text blocks before the full tool call is recognized in the next chunk.
    clean = clean.replace(/`{0,3}tool:[\w-]*(?:\([^)]*)?$/gm, "")

    // 2. Remove leaked tool headers that sometimes surface as plain text.
    // Preserve normal markdown fences like ```python and ```mermaid.
    clean = clean.replace(new RegExp(`^\\s*${fence}\\s*(?:tool:|tool\\s+)?${toolHeaderPattern}(?:\\([^)]*\\))?\\s*$`, "gm"), "")

    // 3. Strip XML/native tool call patterns that models sometimes generate alongside codeblock tools.
    // This handles <minimax:tool_call>,  , <invoke>, <function_call>, etc.
    // Remove entire XML tool call blocks (multiline)
    clean = clean.replace(/<(?:[\w-]+:)?tool_call>[\s\S]*?<\/(?:[\w-]+:)?tool_call>/g, "")
    clean = clean.replace(/<invoke\s[^>]*>[\s\S]*?<\/invoke>/g, "")
    clean = clean.replace(/<function_call>[\s\S]*?<\/function_call>/g, "")
    // Remove orphaned opening tags (streaming - closing tag hasn't arrived yet)
    clean = clean.replace(/<(?:[\w-]+:)?tool_call>[\s\S]*$/g, "")
    clean = clean.replace(/<invoke\s+name="[^"]*">\s*(?:<parameter\s[^>]*>[^<]*<\/parameter>\s*)*$/g, "")

 return clean.trim()
}

    private cleanBlockContent(t: string): string {
        let text = t

        // We strip ONE leading newline if it directly followed the header (common artifact),
        // but we do NOT trimStart() indiscriminately which kills indentation.
        if (text.startsWith("\n")) text = text.slice(1)
        if (text.startsWith("\r\n")) text = text.slice(2)

        // Structural Intent Shift Detection disabled. 
        // Content tools must only terminate on explicit closing tags.

        // Return raw text without final trim, preserving trailing newlines if they were inferred to be part of the edit
        return text
    }
}
