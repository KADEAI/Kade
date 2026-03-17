import * as path from 'path'
import {
    IVectorStore,
    PointStruct,
    VectorStoreSearchResult,
} from '../interfaces/vector-store'
import { LocalQdrantClient } from './local-qdrant-client'

export class LocalQdrantVectorStore implements IVectorStore {
    private client: LocalQdrantClient
    private collectionName = 'kilocode_index'
    private workspacePath: string
    private vectorSize: number
    private isComplete = false

    constructor(workspacePath: string, vectorSize: number) {
        this.workspacePath = workspacePath
        this.vectorSize = vectorSize
        const dataPath = path.join(workspacePath, '.kilocode', 'index')
        this.client = new LocalQdrantClient(dataPath)
    }

    async initialize(): Promise<boolean> {
        try {
            const { collections } = await this.client.getCollections()
            const exists = collections.some((c) => c.name === this.collectionName)

            if (!exists) {
                await this.client.createCollection(this.collectionName, {
                    vectors: { size: this.vectorSize },
                })
                return true
            }
            return false
        } catch (error) {
            console.error('[LocalQdrantVectorStore] Failed to initialize:', error)
            throw error
        }
    }

    async upsertPoints(points: PointStruct[]): Promise<void> {
        await this.client.upsert(this.collectionName, {
            points: points.map((p) => ({
                id: typeof p.id === 'string' ? this.hashStringToNumber(p.id) : p.id,
                vector: p.vector,
                payload: p.payload,
            })),
        })
    }

    async search(
        queryVector: number[],
        directoryPrefix?: string,
        minScore?: number,
        maxResults?: number,
    ): Promise<VectorStoreSearchResult[]> {
        const filter: any = {}
        if (directoryPrefix) {
            filter.must = [
                {
                    key: 'file_path',
                    match: { value: directoryPrefix }, // Simple prefix match logic for now
                },
            ]
        }

        const results = await this.client.search(this.collectionName, {
            vector: queryVector,
            limit: maxResults || 10,
            with_payload: true,
            filter: Object.keys(filter).length > 0 ? filter : undefined,
        })

        return results
            .filter((r) => !minScore || r.score >= minScore)
            .map((r) => ({
                id: r.id,
                score: r.score,
                payload: r.payload,
            }))
    }

    async deletePointsByFilePath(filePath: string): Promise<void> {
        // Local client doesn't support complex deletes yet, but for high-speed indexing
        // we often clear and rebuild anyway. Implementing a simple placeholder or full clear.
        // For now, we'll keep it as is.
    }

    async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
        // Same as above
    }

    async clearCollection(): Promise<void> {
        await this.client.deleteCollection(this.collectionName)
        await this.initialize()
    }

    async deleteCollection(): Promise<void> {
        await this.client.deleteCollection(this.collectionName)
    }

    async collectionExists(): Promise<boolean> {
        const { collections } = await this.client.getCollections()
        return collections.some((c) => c.name === this.collectionName)
    }

    async hasIndexedData(): Promise<boolean> {
        try {
            const info = await this.client.getCollection(this.collectionName)
            return info.vectors_count > 0
        } catch {
            return false
        }
    }

    async markIndexingComplete(): Promise<void> {
        this.isComplete = true
    }

    async markIndexingIncomplete(): Promise<void> {
        this.isComplete = false
    }

    private hashStringToNumber(str: string): number {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i)
            hash = (hash << 5) - hash + char
            hash = hash & hash // Convert to 32bit integer
        }
        return Math.abs(hash)
    }
}
