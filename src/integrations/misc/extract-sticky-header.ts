
import { isBinaryFile } from "isbinaryfile"

/**
 * Extracts "sticky scroll" context for a given line in a file.
 * This walks backwards from the target line to find lines with lower indentation,
 * building a hierarchy of "headers" (classes, functions, namespaces, loop blocks, etc.).
 *
 * @param fileContent - The full content of the file
 * @param targetLine - The 1-based line number to get context for (usually the start of a read range)
 * @returns A string representing the sticky context path, e.g. "class Dog > def eat", or null if none found
 */
export function extractStickyHeader(fileContent: string, targetLine: number): string | null {
    if (!fileContent || targetLine <= 1) return null

    const lines = fileContent.split(/\r?\n/)
    if (targetLine > lines.length) return null

    // 0-based index
    const targetIdx = targetLine - 1
    const targetLineContent = lines[targetIdx]

    // If target line is empty, it might be between blocks. 
    // We should probably look at the previous non-empty line to establish "current" indentation?
    // Or just use the target line's indentation if it has content.
    // If it's empty, we can assume it has the same indentation as the *following* line, 
    // or the *previous* line. Sticky scroll in VS Code usually sticks to the *scope* you are in.

    // Let's find the effective indentation of the target line.
    let currentIndent = getIndentation(targetLineContent)

    // If the target line is empty, try to find context from lines around it?
    // For simplicity, if the line is empty, we'll scan downwards to find the next content line 
    // to establish the "scope" we are about to enter/read, OR scan upwards to see what scope we just left.
    // Given we are "reading a range starting at X", if X is empty, we probably care about the scope of X+1.
    if (targetLineContent.trim().length === 0) {
        let found = false
        for (let i = targetIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().length > 0) {
                currentIndent = getIndentation(lines[i])
                found = true
                break
            }
        }
        if (!found) {
            // End of file or all empty? Scan upwards
            for (let i = targetIdx - 1; i >= 0; i--) {
                if (lines[i].trim().length > 0) {
                    currentIndent = getIndentation(lines[i])
                    found = true
                    break
                }
            }
        }
        // If still not found (empty file?), return null
        if (!found) return null
    }

    const headers: string[] = []

    // Scan backwards from the line *before* the target
    for (let i = targetIdx - 1; i >= 0; i--) {
        const line = lines[i]
        const trimmed = line.trim()

        // Skip empty lines
        if (trimmed.length === 0) continue

        const indent = getIndentation(line)

        // If this line is less indented than our current level, it's a candidate parent
        if (indent < currentIndent) {
            // Heuristic: Ignore lines that are likely just closing braces like "};" or ")" or "end"
            // specifically if they don't seem to contain definition keywords?
            // Actually, sticky scroll usually shows definitions. 
            // "}" at a lower indentation usually closes a *previous* block, not opens the one we are in.
            // Wait. If we are inside a block, the header of that block must be ABOVE us and LOWER indentation.
            // A closing brace "}" at lower indentation would mean we are *after* that block. 
            // BUT we are scanning *upwards*. 

            // Example:
            // 1: class A {
            // 2:    void foo() {
            // 3:    }
            // 4:    void bar() {  <-- We are here

            // At line 4 (indent 4). Scan up.
            // Line 3 "}" (indent 4). Not less.
            // Line 2 "void foo() {" (indent 4). Not less.
            // Line 1 "class A {" (indent 0). Less! Add "class A {".

            // Example 2:
            // 1: class A {
            // 2:    void foo() {
            // 3:       ...
            // 4:    }
            // 5: }
            // 6: <-- We are here (indent 0)
            // No strict parent.

            // Example 3: Nested
            // 1: function a() {
            // 2:    if (b) {  <-- target indentation 4
            // 3:       c(); <-- target line (indent 7)

            // At line 3 (indent 7).
            // Line 2 (indent 4). Less. Capture "if (b) {". Update curIndent = 4.
            // Line 1 (indent 0). Less. Capture "function a() {". Update curIndent = 0.

            // What about closing braces?
            // 1: if (a) {
            // 2: } else {  <-- 
            // 3:    b(); <-- target

            // At line 3 (indent 4).
            // Line 2 "} else {" (indent 0? depending on format). 
            // If K&R style: "} else {" is indent 0. Capture.

            // What if we encounter a closing brace?
            // 1: {
            // 2:    a;
            // 3: }
            // 4: b; <-- target (indent 0)
            // Line 3 "}" (indent 0). Not less. 
            // Line 1 "{" (indent 0). Not less.
            // No context. Correct.

            // So simpler heuristic: strictly less indentation.

            headers.unshift(cleanHeader(trimmed))
            currentIndent = indent
        }
    }

    if (headers.length === 0) return null

    return headers.join(" > ")
}

/**
 * Returns the sticky context stack (indentation levels and headers) up to a target line.
 * Useful for initializing a forward pass.
 */
export function getStickyContextStack(fileContent: string, targetLine: number): { text: string; indent: number }[] {
    if (!fileContent || targetLine <= 1) return []

    const lines = fileContent.split(/\r?\n/)
    if (targetLine > lines.length) return []

    const targetIdx = targetLine - 1
    const targetLineContent = lines[targetIdx]

    let currentIndent = getIndentation(targetLineContent)
    if (targetLineContent.trim().length === 0) {
        let found = false
        for (let i = targetIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().length > 0) {
                currentIndent = getIndentation(lines[i])
                found = true
                break
            }
        }
        if (!found) {
            for (let i = targetIdx - 1; i >= 0; i--) {
                if (lines[i].trim().length > 0) {
                    currentIndent = getIndentation(lines[i])
                    found = true
                    break
                }
            }
        }
        if (!found) return []
    }

    const stack: { text: string; indent: number; line: number }[] = []

    for (let i = targetIdx - 1; i >= 0; i--) {
        const line = lines[i]
        const trimmed = line.trim()
        if (trimmed.length === 0) continue

        const indent = getIndentation(line)
        if (indent < currentIndent) {
            if (isHeaderLine(line)) {
                stack.unshift({ text: cleanHeader(trimmed), indent, line: i + 1 })
                currentIndent = indent
            }
        }
    }
    return stack
}

/**
 * Determines if a line is likely a "header" that starts a new block context.
 * Heuristics:
 * - Ends with "{" or ":"
 * - Starts with known keywords (class, function, def, if, for, while, switch, do)
 */
/**
 * Semantic Header Detection: Returns true if the line is a structural definition.
 */
function isHeaderLine(line: string): boolean {
    const trimmed = line.trim()
    
    // 1. Major structural keywords (Explicit definitions)
    const majorStructural = /^(class|function|def|fn|func|type|interface|struct|enum|module|namespace|async\s+function|export\s+class|export\s+function|trait|impl|protocol|extension|mod|macro_rules|constructor|abstract\s+class)\b/i
    if (majorStructural.test(trimmed)) {
        // Suppress return/yield/type-cast false positives
        if (trimmed.startsWith("return") || trimmed.startsWith("yield")) return false
        return true
    }

    // 2. HTML/XML Tags (Semantic Identity)
    // We prioritize Identity (id/class) or Major structural roles.
    if (trimmed.startsWith("<")) {
        const hasIdentity = trimmed.includes("class=") || trimmed.includes("id=")
        const majorTags = /^(html|head|body|script|style|template|main|header|footer|section|nav|aside|article)\b/i
        const tagMatch = trimmed.match(/^<([a-zA-Z0-9]+)\b/)
        if (tagMatch) {
            const tagName = tagMatch[1]
            // We count it as a structural header if it has a class/id OR is a major tag
            if (hasIdentity || majorTags.test(tagName)) return true
        }
    }

    // 3. Complex definitions (Assignments, CSS, heuristics)
    if (trimmed.endsWith("{") || trimmed.endsWith(":")) {
        // A. Filter out control flow even if it starts with '}' (e.g. "} catch (e) {", "} else {")
        const superClean = trimmed.replace(/^[}\s]+/, "")
        const controlFlow = /^(if|for|while|else|elif|switch|case|default|try|catch|finally|with|do)\b/
        if (controlFlow.test(superClean)) return false
        
        // B. Filter out returns, new instantiations, and common non-header assignments
        if (/^\s*(return|yield|throw|new)\b/.test(line)) return false
        
        // C. Detect CSS Selectors (heuristic: no parentheses or assignment, ends in {)
        if (trimmed.endsWith("{") && !trimmed.includes("(") && !trimmed.includes("=") && !/^\s*(const|let|var)\b/.test(trimmed) && /^[.#a-zA-Z0-9]/.test(trimmed)) return true

        // D. Detect Arrow Functions (const/let Name = (...) => {)
        // Must look like an assignment to a function
        if (/\s*=\s*(async\s+)?\(?.*\)?\s*=>\s*[{:]?$/.test(trimmed)) return true

        // E. Detect Functions with Parentheses (ReturnType Name(Args) {)
        if (/\(.*\).*[{:]?$/.test(trimmed)) return true
    }

    return false
}

/**
 * Interleaves sticky headers into a list of lines.
 * 
 * @param lines - The lines to process (the read chunk)
 * @param startLine - The 1-based line number of the first line in `lines`
 * @param initialContext - The context stack active *before* startLine
 * @returns Array of strings where sticky headers are inserted as comments
 */
/**
 * Interleaves sticky headers into a list of lines.
 * Optimized for AI Digestibility: Only marks major section boundaries.
 */
export function interleaveStickyHeaders(
    lines: string[],
    startLine: number,
    initialContext: { text: string; indent: number; line: number }[]
): string[] {
    const result: string[] = []
    const stack = [...initialContext]

    // 1. Emit starting context once if we are mid-file (Crucial for AI to know where it is)
    if (stack.length > 0) {
        const initialContextText = stack.map(s => s.text).join(" > ")
        result.push(`# [Sticky context]: ${initialContextText}`)
    }

    lines.forEach((line, index) => {
        const currentLineNum = startLine + index
        const trimmed = line.trim()
        
        if (trimmed.length === 0) {
            result.push(line)
            return
        }

        const indent = getIndentation(line)
        const isHeader = isHeaderLine(line)

        // 2. Context boundary tracking
        if (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
            while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
                stack.pop()
            }
        }

        // 3. Emit structural metadata
        if (isHeader) {
            const headerText = cleanHeader(trimmed)
            const parentContext = stack.map(s => s.text).join(" > ")
            
            // Adaptive Promotion: 
            // We only emit a SECTION divider for major architectural leaps:
            // 1. Top-level definitions (indent 0)
            // 2. Major structural tags (even if indented) that define a huge scope shift (like <script> or <style>)
            const isMajorScopeShift = /^(script|style|template|main|body)$/i.test(headerText.replace(/[<>]/g, ""))
            
            if (indent === 0 || isMajorScopeShift) {
                result.push("# [\u2591]") // Minimal semantic divider
                if (parentContext) {
                    result.push(`# [SECTION]: ${parentContext} > ${headerText}`)
                } else {
                    result.push(`# [SECTION]: ${headerText}`)
                }
            }
            
            stack.push({ text: headerText, indent, line: currentLineNum })
        }

        result.push(line)
    })

    return result
}

function getIndentation(line: string): number {
    const match = line.match(/^(\s*)/)
    return match ? match[1].length : 0
}

function cleanHeader(line: string): string {
    let cleaned = line.trim()
    
    // 1. Handle HTML tags (Extract Class or ID)
    if (cleaned.startsWith("<")) {
        const idMatch = cleaned.match(/id=["']([^"']+)["']/)
        if (idMatch) return `#${idMatch[1]}`
        
        const classMatch = cleaned.match(/class=["']([^"']+)["']/)
        if (classMatch) {
            // Convert "base class-name other" to ".base.class-name.other"
            const classes = classMatch[1].trim().split(/\s+/).join(".")
            return `.${classes}`
        }

        // Fallback to tag name if no identity is found
        const tagMatch = cleaned.match(/^<([a-zA-Z0-9]+)\b/)
        return tagMatch ? `<${tagMatch[1]}>` : cleaned
    }

    // 2. Handle standard code headers (Remove block openers)
    // Remove trailing { or : (Python/JS/C++)
    if (cleaned.endsWith("{")) cleaned = cleaned.slice(0, -1).trim()
    if (cleaned.endsWith(":")) cleaned = cleaned.slice(0, -1).trim()
    
    // 3. Clean up JS assignments/exports
    cleaned = cleaned.replace(/^export\s+(default\s+)?/, "")
    cleaned = cleaned.replace(/^(const|let|var)\s+/, "")
    // Extract name before = in assignments
    if (cleaned.includes("=")) {
        const parts = cleaned.split("=")
        if (parts[0].trim()) cleaned = parts[0].trim()
    }

    return cleaned
}
