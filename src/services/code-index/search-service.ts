import * as path from "path"
import { VectorStoreSearchResult } from "./interfaces"
import { IEmbedder } from "./interfaces/embedder"
import { IVectorStore } from "./interfaces/vector-store"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Service responsible for searching the code index using semantic vector embeddings.
 */
export class CodeIndexSearchService {
	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly stateManager: CodeIndexStateManager,
		private readonly embedder: IEmbedder,
		private readonly vectorStore: IVectorStore,
	) {}

	/**
	 * Searches the code index for relevant content.
	 * @param query The search query
	 * @param limit Maximum number of results to return
	 * @param directoryPrefix Optional directory path to filter results by
	 * @returns Array of search results
	 * @throws Error if the service is not properly configured or ready
	 */
	public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
	if (!this.configManager.isFeatureEnabled || !this.configManager.isFeatureConfigured) {
		throw new Error("Code index feature is disabled or not configured.")
	}

	const minScore = this.configManager.currentSearchMinScore
	const maxResults = this.configManager.currentSearchMaxResults

	try {
		const embeddingResponse = await this.embedder.createEmbeddings([query])
		const vector = embeddingResponse?.embeddings[0]

		if (!vector) {
			return []
		}
		const normalizedPrefix = directoryPrefix ? path.normalize(directoryPrefix) : undefined
		const results = await this.vectorStore.search(vector, normalizedPrefix, minScore, maxResults)

		// KILOCODE FIX: Search-time noise filter to prevent "token nukes" from reaching the context
		const toxicDirectories = ["dist", "build", "out", "assets", "node_modules", "vendor", "target"]
		return results.filter((result) => {
			const filePath = (result.payload?.filePath || "").toLowerCase()
			const fileName = path.basename(filePath)

			// Skip build artifacts and minified assets
			const isInToxicDir = filePath.split(path.sep).some((part: string) => toxicDirectories.includes(part))
			const isMinified = fileName.includes(".min.")
			const isHashedAsset = /-[a-z0-9]{8,}\.(js|css)$/.test(fileName)

			return !isInToxicDir && !isMinified && !isHashedAsset
		})
	} catch (error) {
		console.error("[CodeIndexSearchService] Error during search:", error)
		this.stateManager.setSystemState("Error", `Search failed: ${(error as Error).message}`)

		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: (error as Error).message,
			stack: (error as Error).stack,
			location: "searchIndex",
		})

		throw error
	}
}


}
