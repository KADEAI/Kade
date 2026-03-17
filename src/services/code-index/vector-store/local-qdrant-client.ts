import * as fs from 'fs'
import * as path from 'path'

// Simple vector similarity search (cosine similarity)
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
    }
    // For normalized vectors (which we expect from most embedders), dot product is cosine similarity
    return dot
}

// Local collection interface
interface LocalCollection {
    vectors: Map<number, number[]>
    payloads: Map<number, any>
    vectorSize: number
    nextId: number
}

/**
 * Local Qdrant client - A lightweight, file-based vector store implementation.
 * Designed as a zero-dependency local alternative to a full Qdrant server.
 */
export class LocalQdrantClient {
    private collections: Map<string, LocalCollection> = new Map()
    private dataPath: string

    constructor(dataPath: string) {
        this.dataPath = dataPath
        this.ensureDataDirectory()
        this.loadCollections()
    }

    private ensureDataDirectory() {
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true })
        }
    }

    private loadCollections() {
        try {
            const collectionsFile = path.join(this.dataPath, 'collections.json')
            if (fs.existsSync(collectionsFile)) {
                const data = fs.readFileSync(collectionsFile, 'utf-8')
                const collections = JSON.parse(data)

                for (const [name, collection] of Object.entries(collections)) {
                    const col = collection as any
                    const localCollection: LocalCollection = {
                        vectors: new Map(col.vectors),
                        payloads: new Map(col.payloads),
                        vectorSize: col.vectorSize,
                        nextId: col.nextId,
                    }
                    this.collections.set(name, localCollection)
                }
            }
        } catch (e) {
            console.warn('[LocalQdrantClient] Failed to load collections:', e)
        }
    }

    private saveCollections() {
        try {
            const collections: any = {}
            for (const [name, collection] of this.collections) {
                collections[name] = {
                    vectors: Array.from(collection.vectors.entries()),
                    payloads: Array.from(collection.payloads.entries()),
                    vectorSize: collection.vectorSize,
                    nextId: collection.nextId,
                }
            }

            const collectionsFile = path.join(this.dataPath, 'collections.json')
            fs.writeFileSync(collectionsFile, JSON.stringify(collections, null, 2))
        } catch (e) {
            console.warn('[LocalQdrantClient] Failed to save collections:', e)
        }
    }

    async createCollection(name: string, config: { vectors: { size: number } }) {
        if (this.collections.has(name)) {
            // If it exists, we just reset it for a fresh index as per "insane" logic
            this.collections.delete(name)
        }

        const collection: LocalCollection = {
            vectors: new Map(),
            payloads: new Map(),
            vectorSize: config.vectors.size,
            nextId: 0,
        }

        this.collections.set(name, collection)
        this.saveCollections()
    }

    async deleteCollection(name: string) {
        if (this.collections.has(name)) {
            this.collections.delete(name)
            this.saveCollections()
        }
    }

    async upsert(name: string, { points }: { points: Array<{ id: number; vector: number[]; payload?: any }> }) {
        const collection = this.collections.get(name)
        if (!collection) {
            throw new Error(`Collection ${name} not found`)
        }

        for (const point of points) {
            if (point.vector.length !== collection.vectorSize) {
                throw new Error(`Vector size mismatch. Expected ${collection.vectorSize}, got ${point.vector.length}`)
            }

            collection.vectors.set(point.id, point.vector)
            if (point.payload) {
                collection.payloads.set(point.id, point.payload)
            }

            if (point.id >= collection.nextId) {
                collection.nextId = point.id + 1
            }
        }

        this.saveCollections()
    }

    async search(
        name: string,
        query: { vector: number[]; limit: number; filter?: any; with_payload?: boolean; search_params?: any },
    ) {
        const collection = this.collections.get(name)
        if (!collection) {
            throw new Error(`Collection ${name} not found`)
        }

        if (query.vector.length !== collection.vectorSize) {
            throw new Error(`Query vector size mismatch. Expected ${collection.vectorSize}, got ${query.vector.length}`)
        }

        // Simple linear search (can be optimized with HNSW later)
        const results: Array<{ id: number; score: number; payload?: any }> = []

        for (const [id, vector] of collection.vectors) {
            // Apply filter if provided
            if (query.filter) {
                const payload = collection.payloads.get(id)
                if (!this.matchesFilter(payload, query.filter)) {
                    continue
                }
            }

            const score = cosineSimilarity(query.vector, vector)
            results.push({
                id,
                score,
                payload: query.with_payload ? collection.payloads.get(id) : undefined,
            })
        }

        // Sort by score (descending) and limit
        results.sort((a, b) => b.score - a.score)
        return results.slice(0, query.limit)
    }

    private matchesFilter(payload: any, filter: any): boolean {
        if (!payload || !filter) return true

        // matches the filter logic in CLAUDIFY
        if (filter.must && Array.isArray(filter.must)) {
            for (const condition of filter.must) {
                if (condition.key && condition.match) {
                    if (payload[condition.key] !== condition.match.value) {
                        return false
                    }
                }
            }
        }

        return true
    }

    async getCollections() {
        const collections = Array.from(this.collections.keys()).map((name) => ({ name }))
        return { collections }
    }

    async getCollection(name: string) {
        const collection = this.collections.get(name)
        if (!collection) {
            throw new Error(`Collection ${name} not found`)
        }

        return {
            name,
            vectors_count: collection.vectors.size,
            vector_size: collection.vectorSize,
        }
    }
}
