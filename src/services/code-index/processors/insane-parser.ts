import { createHash } from 'crypto'
import { CodeBlock, ICodeParser } from '../interfaces'
import { InsaneChunker } from './insane-chunker'

export class InsaneCodeParser implements ICodeParser {
    private chunker: InsaneChunker

    constructor() {
        this.chunker = new InsaneChunker()
    }

    async parseFile(
        filePath: string,
        options?: {
            content?: string
            fileHash?: string
        },
    ): Promise<CodeBlock[]> {
        const content = options?.content || ''
        const fileHash = options?.fileHash || this.createHash(content)

        const chunks = this.chunker.chunkCode(content, filePath)

        return chunks.map((chunk, index) => {
            const startLine = content.substring(0, content.indexOf(chunk)).split('\n').length
            const endLine = startLine + chunk.split('\n').length - 1
            const contentPreview = chunk.slice(0, 100)
            const segmentHash = this.createHash(`${filePath}-${startLine}-${endLine}-${chunk.length}-${contentPreview}`)

            return {
                file_path: filePath,
                identifier: null,
                type: 'insane_chunk',
                start_line: startLine,
                end_line: endLine,
                content: chunk,
                fileHash,
                segmentHash,
            }
        })
    }

    private createHash(content: string): string {
        return createHash('sha256').update(content).digest('hex')
    }
}
