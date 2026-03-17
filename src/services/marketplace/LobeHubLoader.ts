
import { MarketplaceItem } from "@roo-code/types"

interface LobeHubPluginItem {
    author?: string
    category?: string
    createdAt?: string
    description?: string
    homepage?: string
    identifier: string
    installCount?: number
    isFeatured?: boolean
    manifestUrl?: string
    manifest?: string
    name?: string
    meta?: {
        title?: string
        description?: string
        avatar?: string
        tags?: string[]
    }
    tags?: string[]
}

interface LobeHubApiResponse {
    items: LobeHubPluginItem[]
    totalCount: number
}

export class LobeHubLoader {
    private static API_URL = "https://market.lobehub.com/api/v1/plugins"
    private cache: { data: MarketplaceItem[]; timestamp: number } | null = null
    private searchCache: Map<string, { data: MarketplaceItem[]; timestamp: number }> = new Map()
    private cacheDuration = 5 * 60 * 1000 // 5 minutes

    async loadMcps(search?: string): Promise<MarketplaceItem[]> {
        if (search) {
            const cachedSearch = this.searchCache.get(search)
            if (cachedSearch && Date.now() - cachedSearch.timestamp < this.cacheDuration) {
                return cachedSearch.data
            }
        } else if (this.cache && Date.now() - this.cache.timestamp < this.cacheDuration) {
            return this.cache.data
        }

        try {
            if (search) {
                // Perform a remote search on the full LobeHub database
                const url = new URL(LobeHubLoader.API_URL)
                url.searchParams.append("q", search)
                url.searchParams.append("pageSize", "40") // Return more results for search, but 40 is the API limit

                const response = await fetch(url.toString(), {
                    method: "GET",
                    headers: { "Content-Type": "application/json" }
                })

                if (!response.ok) {
                    // Handle auth errors silently - LobeHub API may require authentication
                    if (response.status === 401 || response.status === 403) {
                        console.warn("LobeHub API requires authentication - marketplace unavailable")
                        return []
                    }
                    throw new Error(`Status ${response.status}`)
                }
                const data = await response.json() as LobeHubApiResponse
                const items = data.items.map((plugin) => this.mapToMarketplaceItem(plugin))

                this.searchCache.set(search, {
                    data: items,
                    timestamp: Date.now()
                })

                return items
            }

            // Fetch first 10 pages (200 items) to populate the marketplace
            const pagesToFetch = 10
            const pagePromises = []

            for (let i = 1; i <= pagesToFetch; i++) {
                const url = new URL(LobeHubLoader.API_URL)
                url.searchParams.append("current", i.toString())

                pagePromises.push(
                    fetch(url.toString(), {
                        method: "GET",
                        headers: { "Content-Type": "application/json" }
                    })
                        .then(async res => {
                            if (!res.ok) {
                                // Handle auth errors silently
                                if (res.status === 401 || res.status === 403) {
                                    return { items: [], totalCount: 0 } as LobeHubApiResponse
                                }
                                throw new Error(`Status ${res.status}`)
                            }
                            return await res.json() as LobeHubApiResponse
                        })
                        .then(data => data.items)
                        .catch(e => {
                            // Only log non-auth errors
                            if (!e.message?.includes("401") && !e.message?.includes("403")) {
                                console.error(`Failed to fetch LobeHub page ${i}:`, e)
                            }
                            return [] as LobeHubPluginItem[]
                        })
                )
            }

            const pagesResults = await Promise.all(pagePromises)
            const allPluginItems = pagesResults.flat()

            // Deduplicate by identifier
            const seen = new Set()
            const uniquePluginItems = allPluginItems.filter(item => {
                if (!item.identifier || seen.has(item.identifier)) return false
                seen.add(item.identifier)
                return true
            })

            const items: MarketplaceItem[] = uniquePluginItems.map((plugin) => this.mapToMarketplaceItem(plugin))

            if (!search) {
                this.cache = {
                    data: items,
                    timestamp: Date.now(),
                }
            }

            return items
        } catch (error) {
            // Only log non-auth errors
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (!errorMsg.includes("401") && !errorMsg.includes("403")) {
                console.error("Failed to load LobeHub MCPs:", error)
            }
            return []
        }
    }

    private mapToMarketplaceItem(plugin: LobeHubPluginItem): MarketplaceItem {
        // LobeHub API can return flat (v1/plugins) or nested (index.json) structures
        const name = plugin.meta?.title || plugin.name || plugin.identifier
        const description = plugin.meta?.description || plugin.description || ""
        const tags = plugin.meta?.tags || plugin.tags || (plugin.category ? [plugin.category] : [])
        const downloadUrl = plugin.manifestUrl || plugin.manifest
        const homepage = plugin.homepage

        return {
            id: plugin.identifier,
            type: "mcp",
            name,
            author: plugin.author || "Unknown",
            description,
            tags,
            icon: plugin.meta?.avatar,
            downloadUrl,
            homepage,
            // Additional metadata stored in the item for display purposes
            isFeatured: plugin.isFeatured,
            installCount: plugin.installCount,
        } as any as MarketplaceItem
    }

    clearCache() {
        this.cache = null
        this.searchCache.clear()
    }
}
