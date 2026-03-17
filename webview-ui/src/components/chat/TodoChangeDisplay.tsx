import { t } from "i18next"
import { CheckCircle2, Circle, ListChecks, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type TodoStatus = "completed" | "in_progress" | "pending"

interface TodoItem {
	id?: string
	content: string
	status?: TodoStatus | string
}

interface TodoChangeDisplayProps {
	previousTodos: TodoItem[]
	newTodos: TodoItem[]
}

function getTodoIcon(status: TodoStatus | string | null) {
	switch (status) {
		case "completed":
			return <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-vscode-charts-green" />
		case "in_progress":
			return <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-vscode-charts-yellow animate-spin-slow" />
		default:
			return <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-vscode-descriptionForeground/60" />
	}
}

export function TodoChangeDisplay({ previousTodos, newTodos }: TodoChangeDisplayProps) {
	const isInitialState = previousTodos.length === 0

	// Determine which todos to display
	let todosToDisplay: TodoItem[]

	if (isInitialState && newTodos.length > 0) {
		todosToDisplay = newTodos
	} else {
		todosToDisplay = newTodos.filter((newTodo) => {
			if (newTodo.status === "completed") {
				const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
				return !previousTodo || previousTodo.status !== "completed"
			}
			if (newTodo.status === "in_progress") {
				const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
				return !previousTodo || previousTodo.status !== "in_progress"
			}
			return false
		})
	}

	if (todosToDisplay.length === 0) {
		return null
	}

	return (
		<div data-todo-changes className="overflow-hidden px-1">
			<div className="flex items-center gap-2 mb-0.5 px-3 select-none opacity-80">
				<ListChecks className="w-4 h-4 shrink-0 text-vscode-foreground" />
				<span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-vscode-foreground">
					{t("chat:todo.updated")}
				</span>
			</div>

			<div className="bg-vscode-input-background/40 rounded-lg p-0.5">
				<ul className="list-none flex flex-col">
					{todosToDisplay.map((todo) => {
						const status = (todo.status || "pending") as TodoStatus
						const icon = getTodoIcon(status)
						const isCompleted = status === "completed"
						const isInProgress = status === "in_progress"

						return (
							<li
								key={todo.id || todo.content}
								className={cn(
									"flex items-start gap-3 px-2 py-0.5 rounded-sm transition-colors",
									isInProgress ? "bg-vscode-list-activeSelectionBackground/15" : "hover:bg-vscode-list-hoverBackground/40"
								)}>
								<div className="pt-0.5 shrink-0">{icon}</div>
								<span className={cn(
									"leading-snug break-words text-sm opacity-90",
									isCompleted && "text-vscode-descriptionForeground",
									isInProgress && "text-vscode-charts-yellow font-medium opacity-100",
									!isCompleted && !isInProgress && "text-vscode-foreground"
								)}>
									{todo.content}
								</span>
							</li>
						)
					})}
				</ul>
			</div>
		</div>
	)
}
