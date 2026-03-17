import * as path from 'path'

export class InsaneChunker {
    private readonly SMART_CHUNK_SIZE = 2048
    private readonly OVERLAP_SIZE = 512
    private readonly MIN_CHUNK_SIZE = 100
    private readonly MAX_CHUNK_SIZE = 4096

    private readonly LANGUAGE_PATTERNS = {
    typescript: {
        function: /(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>|\w+\s*\([^)]*\)\s*[{:])/g,
        class: /(?:class|interface|type)\s+\w+/g,
        import: /import\s+.*?from\s+['"][^'"]+['"]/gs,
        export: /export\s+(?:default\s+)?(?:class|interface|function|const|let|var)\s+\w+/g,
        comment: /\/\*\*[\s\S]*?\*\//g
    },
    vue: {
        template: /<template[^>]*>[\s\S]*?<\/template>/g,
        script: /<script[^>]*>[\s\S]*?<\/script>/g,
        setup: /<script[^>]*setup[^>]*>/g
    },
    javascript: {
        function: /(?:async\s+)?function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/g,
        class: /class\s+\w+/g,
        arrow: /\w+\s*=\s*\([^)]*\)\s*=>/g
    },
}

    chunkCode(content: string, filePath: string): string[] {
        const ext = path.extname(filePath)
        const language = this.detectLanguage(ext)

        if (language === 'typescript' || language === 'javascript') {
            const smartChunks = this.smartCodeChunking(content, language)
            if (smartChunks.length > 0) return smartChunks
        }

        if (language === 'vue') {
            const vueChunks = this.vueChunking(content)
            if (vueChunks.length > 0) return vueChunks
        }

        return this.advancedSemanticChunking(content)
    }

    private detectLanguage(ext: string): string {
        switch (ext) {
            case '.ts':
            case '.tsx':
                return 'typescript'
            case '.js':
            case '.jsx':
                return 'javascript'
            case '.vue':
                return 'vue'
            default:
                return 'unknown'
        }
    }

    private smartCodeChunking(content: string, language: string): string[] {
        const patterns = this.LANGUAGE_PATTERNS[language as keyof typeof this.LANGUAGE_PATTERNS]
        if (!patterns) return []

        const chunks: string[] = []
        const processed = new Set<number>()

        const patternsGroup = patterns as any
        const functionPattern = patternsGroup.function || patternsGroup.class
        if (functionPattern) {
            const matches = Array.from(content.matchAll(functionPattern))

            for (const match of matches) {
                const startIndex = this.findCodeBlockStart(content, match.index!)
                const endIndex = this.findCodeBlockEnd(content, startIndex)

                if (!processed.has(startIndex) && endIndex - startIndex > this.MIN_CHUNK_SIZE) {
                    const chunk = content.substring(startIndex, endIndex).trim()
                    if (chunk.length <= this.MAX_CHUNK_SIZE) {
                        chunks.push(chunk)
                        processed.add(startIndex)
                    }
                }
            }
        }

        const remainingContent = this.getRemainingContent(content, processed)
        if (remainingContent.length > this.MIN_CHUNK_SIZE) {
            chunks.push(...this.advancedSemanticChunking(remainingContent))
        }

        return chunks
    }

    private vueChunking(content: string): string[] {
        const chunks: string[] = []
        const patterns = this.LANGUAGE_PATTERNS.vue

        const templateMatch = content.match(patterns.template)
        if (templateMatch) {
            chunks.push(templateMatch[0])
        }

        const scriptMatch = content.match(patterns.script)
        if (scriptMatch) {
            const scriptContent = scriptMatch[0]
            chunks.push(...this.smartCodeChunking(scriptContent, 'typescript'))
        }

        return chunks
    }

    private findCodeBlockStart(content: string, index: number): number {
        let start = index
        while (start > 0 && content[start - 1] !== '\n') {
            start--
        }
        return start
    }

    private findCodeBlockEnd(content: string, startIndex: number): number {
        let braceCount = 0
        let inString = false
        let stringChar = ''

        for (let i = startIndex; i < content.length; i++) {
            const char = content[i]
            const prevChar = i > 0 ? content[i - 1] : ''

            if (!inString && (char === '"' || char === "'" || char === '`')) {
                if (char !== stringChar || prevChar !== '\\') {
                    inString = !inString
                    if (inString) stringChar = char
                }
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false
                stringChar = ''
            }

            if (!inString) {
                if (char === '{') braceCount++
                else if (char === '}') {
                    braceCount--
                    if (braceCount === 0) {
                        return i + 1
                    }
                }
            }
        }

        return Math.min(startIndex + this.MAX_CHUNK_SIZE, content.length)
    }

    private getRemainingContent(content: string, processed: Set<number>): string {
        const parts: string[] = []
        let lastEnd = 0

        const sortedIndices = Array.from(processed).sort((a, b) => a - b)

        for (const index of sortedIndices) {
            if (index > lastEnd) {
                parts.push(content.substring(lastEnd, index))
            }
            lastEnd = index
        }

        if (lastEnd < content.length) {
            parts.push(content.substring(lastEnd))
        }

        return parts.join('\n')
    }

    private advancedSemanticChunking(content: string): string[] {
        const chunks: string[] = []
        const lines = content.split('\n')

        let currentChunk = ''
        let currentLines = 0

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            currentChunk += line + '\n'
            currentLines++

            const shouldBreak =
                currentChunk.length >= this.SMART_CHUNK_SIZE ||
                (currentLines >= 50 && this.isGoodBreakPoint(line)) ||
                (this.isFunctionEnd(line) && currentChunk.length >= this.MIN_CHUNK_SIZE) ||
                (this.isCommentBlock(line) && currentChunk.length >= this.MIN_CHUNK_SIZE)

            if (shouldBreak && currentChunk.length >= this.MIN_CHUNK_SIZE) {
                chunks.push(currentChunk.trim())

                const overlapLines = Math.min(Math.floor(this.OVERLAP_SIZE / 50), Math.floor(currentLines / 2))
                currentChunk = lines.slice(Math.max(0, i - overlapLines + 1), i + 1).join('\n') + '\n'
                currentLines = overlapLines + 1
            }
        }

        if (currentChunk.length >= this.MIN_CHUNK_SIZE) {
            chunks.push(currentChunk.trim())
        }

        return chunks
    }

    private isGoodBreakPoint(line: string): boolean {
        return (
            /^\s*(?:export\s+)?(?:interface|type|class|function|const|let|var)\s+\w/.test(line) ||
            /^\s*}\s*$/.test(line) ||
            /^\s*\/\*\*/.test(line) ||
            /^\s*\/\//.test(line) ||
            /^\s*#\s*\w+/.test(line)
        )
    }

    private isFunctionEnd(line: string): boolean {
        return /^\s*}\s*$/.test(line)
    }

    private isCommentBlock(line: string): boolean {
        return /^\s*\/\*\*/.test(line) || /^\s*\*\//.test(line)
    }
}
