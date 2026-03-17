import { HistoryItem } from "@roo-code/types"
import { TaskHistoryRequestPayload, TaskHistoryResponsePayload } from "../WebviewMessage"

interface CacheEntry {
	result: TaskHistoryResponsePayload
	timestamp: number
}

const CACHE_TTL = 30000 // 30 seconds
const cache = new Map<string, CacheEntry>()

function getCacheKey(taskHistory: HistoryItem[], cwd: string, request: TaskHistoryRequestPayload): string {
	// Create a cache key based on request params and task history length/timestamp
	const latestTs = taskHistory.length > 0 ? Math.max(...taskHistory.map(t => t.ts || 0)) : 0
	return JSON.stringify({
		workspace: request.workspace,
		sort: request.sort,
		favoritesOnly: request.favoritesOnly,
		pageIndex: request.pageIndex,
		search: request.search,
		pageSize: request.pageSize,
		cwd: request.workspace === "current" ? cwd : "all",
		historyLength: taskHistory.length,
		latestTs,
	})
}

export function getCachedTaskHistory(
	taskHistory: HistoryItem[],
	cwd: string,
	request: TaskHistoryRequestPayload,
	computeFn: () => TaskHistoryResponsePayload
): TaskHistoryResponsePayload {
	const key = getCacheKey(taskHistory, cwd, request)
	const now = Date.now()
	
	const cached = cache.get(key)
	if (cached && (now - cached.timestamp) < CACHE_TTL) {
		return cached.result
	}
	
	const result = computeFn()
	cache.set(key, { result, timestamp: now })
	
	// Clean up old entries
	if (cache.size > 100) {
		const entries = Array.from(cache.entries())
		entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
		entries.slice(0, 50).forEach(([k]) => cache.delete(k))
	}
	
	return result
}

export function clearTaskHistoryCache(): void {
	cache.clear()
}