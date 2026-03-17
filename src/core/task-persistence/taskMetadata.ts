import NodeCache from "node-cache"
import getFolderSize from "get-folder-size"

import type { ClineMessage, HistoryItem, ProviderSettings } from "@roo-code/types"

import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { findLastIndex } from "../../shared/array"
import { getTaskDirectoryPath } from "../../utils/storage"
import { t } from "../../i18n"

const taskSizeCache = new NodeCache({ stdTTL: 30, checkperiod: 5 * 60 })

export type TaskMetadataOptions = {
	taskId: string
	rootTaskId?: string
	parentTaskId?: string
	taskNumber: number
	messages: ClineMessage[]
	globalStoragePath: string
	workspace: string
	mode?: string
	/** Initial status for the task (e.g., "active" for child tasks) */
	initialStatus?: "active" | "delegated" | "completed"
	fileEditCounts?: Map<string, number>
	activeFileReads?: Record<string, { start: number; end: number }[] | null | undefined> | string[]
	systemPrompt?: string
	apiConfiguration?: ProviderSettings
}

export async function taskMetadata({
	taskId: id,
	rootTaskId,
	parentTaskId,
	taskNumber,
	messages,
	globalStoragePath,
	workspace,
	mode,
	initialStatus,
	fileEditCounts,
	activeFileReads,
	systemPrompt,
	apiConfiguration,
}: TaskMetadataOptions) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, id)

	// Determine message availability upfront
	const hasMessages = messages && messages.length > 0

	// Pre-calculate all values based on availability
	let timestamp: number
	let tokenUsage: ReturnType<typeof getApiMetrics>
	let taskDirSize: number
	let taskMessage: ClineMessage | undefined

	if (!hasMessages) {
		// Handle no messages case
		timestamp = Date.now()
		tokenUsage = {
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalCacheWrites: 0,
			totalCacheReads: 0,
			totalCost: 0,
			contextTokens: 0,
		}
		taskDirSize = 0
	} else {
		// Handle messages case
		taskMessage = messages[0] // First message is always the task say.

		const lastRelevantMessage =
			messages[findLastIndex(messages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))] ||
			taskMessage

		timestamp = lastRelevantMessage.ts

		tokenUsage = getApiMetrics(combineApiRequests(combineCommandSequences(messages.slice(1))))

		// Get task directory size
		const cachedSize = taskSizeCache.get<number>(taskDir)

		if (cachedSize === undefined) {
			try {
				taskDirSize = await getFolderSize.loose(taskDir)
				taskSizeCache.set<number>(taskDir, taskDirSize)
			} catch (error) {
				taskDirSize = 0
			}
		} else {
			taskDirSize = cachedSize
		}
	}

	// Create historyItem once with pre-calculated values.
	// initialStatus is included when provided (e.g., "active" for child tasks)
	// to ensure the status is set from the very first save, avoiding race conditions
	// where attempt_completion might run before a separate status update.
	const historyItem: HistoryItem = {
		id,
		rootTaskId,
		parentTaskId,
		number: taskNumber,
		ts: timestamp,
		task: (() => {
			if (!hasMessages) return t("common:tasks.no_messages", { taskNumber });

			// kilocode_change: Live Assistant Heartbeat logic in persistence layer
			// We want the latest assistant message that ISN'T a tool call (JSON) or an error key
			const assistantMessages = messages.filter(m =>
				m.type === "say" &&
				m.text &&
				!m.text.trim().startsWith('{') &&
				!m.text.trim().startsWith('errors.')
			);
			const latestAssistant = assistantMessages[assistantMessages.length - 1];

			if (latestAssistant?.text) {
				let clean = latestAssistant.text
					.replace(/```[\s\S]*?```/g, "")
					.replace(/<tool_code>[\s\S]*?<\/tool_code>/g, "")
					.replace(/[*_`~]/g, "") // Strip Markdown characters
					.replace(/\s+/g, " ")
					.trim();
				if (clean.length > 5) {
					return clean.substring(0, 40) + (clean.length > 40 ? "..." : "");
				}
			}

			return taskMessage!.text?.trim() || t("common:tasks.incomplete", { taskNumber });
		})(),
		tokensIn: tokenUsage.totalTokensIn,
		tokensOut: tokenUsage.totalTokensOut,
		cacheWrites: tokenUsage.totalCacheWrites,
		cacheReads: tokenUsage.totalCacheReads,
		totalCost: tokenUsage.totalCost,
		size: taskDirSize,
		workspace,
		mode,
		...(initialStatus && { status: initialStatus }),
		...(fileEditCounts && { fileEditCounts: Object.fromEntries(fileEditCounts) }),
		...(activeFileReads && { activeFileReads }),
		...(systemPrompt && { systemPrompt }),
		...(apiConfiguration && { apiConfiguration }),
	} as HistoryItem & { fileEditCounts?: Record<string, number>; activeFileReads?: Record<string, { start: number; end: number }[] | null | undefined> | string[] }

	return { historyItem, tokenUsage }
}
