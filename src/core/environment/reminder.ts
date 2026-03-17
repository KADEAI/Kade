import { TodoItem, TodoStatus } from "@roo-code/types"

/**
 * Format the reminders section as a markdown block in English, with basic instructions.
 */
export function formatReminderSection(
	todoList?: TodoItem[],
	systemReminders?: string[],
	activeFileReads?: Map<string, { start: number, end: number }[] | undefined> | Set<string>, // kade_change: Accept Map
	todoListEnabled?: boolean
): string {
	const lines: string[] = ["====", ""]

	// 1. Tool-Specific Dynamic Reminders (Luxury Spa Suite)
	if (systemReminders && systemReminders.length > 0) {
		lines.push("## Recent Workspace Actions")
		systemReminders.forEach(r => lines.push(`- ${r}`))
		lines.push("")
	}

	// 2. Active File Contexts
	if (activeFileReads && activeFileReads.size > 0) {
		lines.push("## Active File Contexts (Latest Versions in History)")

		// Handle both Map (new) and Set (legacy)
		if (activeFileReads instanceof Map) {
			Array.from(activeFileReads.entries()).forEach(([f, ranges]) => {
				if (ranges && ranges.length > 0) {
					const rangeStr = ranges.map(r => `${r.start}-${r.end}`).join(', ')
					lines.push(`- ${f} (lines ${rangeStr})`)
				} else {
					lines.push(`- ${f}`)
				}
			})
		} else {
			Array.from(activeFileReads).forEach(f => lines.push(`- ${f}`))
		}
		lines.push("")
	}

	// 3. Todo List (only show if enabled)
	if (todoListEnabled !== false) {
		if (todoList && todoList.length > 0) {
			lines.push("## Task Todo List")
			const statusMap: Record<TodoStatus, string> = {
				pending: "Pending",
				in_progress: "In Progress",
				completed: "Completed",
			}

			lines.push("| # | Content | Status |")
			lines.push("|---|---------|--------|")
			todoList.forEach((item, idx) => {
				const escapedContent = item.content.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")
				lines.push(`| ${idx + 1} | ${escapedContent} | ${statusMap[item.status] || item.status} |`)
			})
			lines.push("IMPORTANT: Keep your todo list updated with `todo` as you progress.")
		} else if (!todoList || todoList.length === 0) {
			lines.push("You have not created a todo list yet. Create one with `todo` if the task is complex.")
		}
	}

	return lines.join("\n")
}
