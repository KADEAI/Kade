import { useMemo } from "react"
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Lazy-loading version of usePromptHistory that only fetches when needed
 * Use this for autocomplete/suggestions that don't need to load immediately
 */
export function usePromptHistoryLazy(enabled: boolean = true) {
	const { taskHistoryVersion } = useExtensionState()
	
	const { data } = useTaskHistory(
		{
			workspace: "current",
			sort: "newest",
			favoritesOnly: false,
			pageIndex: 0,
			search: "",
			pageSize: 20, // Only fetch 20 most recent for autocomplete
		},
		taskHistoryVersion,
	)

	const prompts = useMemo(() => {
		if (!enabled || !data?.historyItems) return []
		// Just return the task titles - messages would require separate loading
		return data.historyItems.map((item) => item.task).filter((task): task is string => !!task)
	}, [data, enabled])

	return prompts
}