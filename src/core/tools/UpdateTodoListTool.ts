import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import cloneDeep from "clone-deep"
import crypto from "crypto"
import { TodoItem, TodoStatus, todoStatusSchema } from "@roo-code/types"
import { getLatestTodo } from "../../shared/todo"

interface UpdateTodoListParams {
	todos: string
}

let approvedTodoList: TodoItem[] | undefined = undefined

export class UpdateTodoListTool extends BaseTool<"todo"> {
	readonly name = "todo" as const

	parseLegacy(params: Partial<Record<string, string>>): UpdateTodoListParams {
		return {
			todos: params.todos || "",
		}
	}

	async execute(params: UpdateTodoListParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError, askApproval, toolProtocol } = callbacks

		try {
			const todosRaw = params.todos

			let normalizedTodos: TodoItem[];

			// Check if this is a patch update (only numbers and status)
			const lines = todosRaw?.split(/\r?\n/).map(l => l.trim()).filter(Boolean) || [];
			const isPatch = lines.length > 0 && lines.every(l => parseTodoPatch(l) !== null);
			const currentTodos = getTodoListForTask(task) || [];

			if (isPatch && currentTodos.length > 0) {
				normalizedTodos = cloneDeep(currentTodos);
				lines.forEach(line => {
					const patch = parseTodoPatch(line);
					if (patch && normalizedTodos[patch.index]) {
						normalizedTodos[patch.index].status = patch.status;
						// Update ID to match new state
						const t = normalizedTodos[patch.index];
						t.id = crypto.createHash("md5").update(t.content + t.status).digest("hex");
					}
				});
			} else {
				// Full list replacement/creation
				let todos: TodoItem[]
				try {
					todos = parseMarkdownChecklist(todosRaw || "")
				} catch {
					task.consecutiveMistakeCount++
					task.recordToolError("todo")
					task.didToolFailInCurrentTurn = true
					pushToolResult(formatResponse.toolError("The todos parameter is not valid markdown checklist or JSON"))
					return
				}

				normalizedTodos = todos.map((t) => ({
					id: t.id,
					content: t.content,
					status: normalizeStatus(t.status),
				}))
			}

			const { valid, error } = validateTodos(normalizedTodos)
			if (!valid) {
				task.consecutiveMistakeCount++
				task.recordToolError("todo")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(error || "todos parameter validation failed"))
				return
			}

			const approvalMsg = JSON.stringify({
				tool: "updateTodoList",
				todos: normalizedTodos,
			})

			approvedTodoList = cloneDeep(normalizedTodos)
			const didApprove = await askApproval("tool", approvalMsg)
			if (!didApprove) {
				pushToolResult("User declined to update the todoList.")
				return
			}

			const isTodoListChanged =
				approvedTodoList !== undefined && JSON.stringify(normalizedTodos) !== JSON.stringify(approvedTodoList)
			if (isTodoListChanged) {
				normalizedTodos = approvedTodoList ?? []
				task.say(
					"user_edit_todos",
					JSON.stringify({
						tool: "updateTodoList",
						todos: normalizedTodos,
					}),
				)
			}

			await setTodoListForTask(task, normalizedTodos)

			const total = normalizedTodos.length
			const completed = normalizedTodos.filter((t) => t.status === "completed").length
			const inProgress = normalizedTodos.filter((t) => t.status === "in_progress").length
			const pending = total - completed - inProgress

			const statusSummary = ""

			const isComplete = completed === total && total > 0
			const reminder = isComplete
				? "TODO list complete. Do not call this tool again for this list. If you have new tasks, start a new list."
				: "MAKE SURE TO NOT FORGET ABOUT THIS TODO LIST AND UPDATE IT! It's easy to lose track during complex tasks – keep it alive!"

			const summary = `TODO list updated!
Current Status: ${total} total tasks: ${completed} completed, ${inProgress} in progress, ${pending} pending.
${todoListToMarkdown(normalizedTodos)}

${reminder}`

			if (isTodoListChanged) {
				pushToolResult(formatResponse.toolResult("User edits todo:\n\n" + summary))
			} else {
				pushToolResult(formatResponse.toolResult(summary))
			}
		} catch (error) {
			await handleError("update todo list", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"todo">): Promise<void> {
		// Partial handling is tricky with patch vs full logic, so we'll just try to parse as full list for now
		// or ignore since patch detection requires full lines.
		// For simplicity, we keep legacy partial behavior but it might be slightly inaccurate during typing of a patch.
		const todosRaw = block.params.todos

		let todos: TodoItem[]
		try {
			todos = parseMarkdownChecklist(todosRaw || "")
		} catch {
			todos = []
		}

		const approvalMsg = JSON.stringify({
			tool: "updateTodoList",
			todos: todos,
		})
		await task.say("tool", approvalMsg, undefined, block.partial).catch(() => { })
	}
}

function parseTodoPatch(line: string): { index: number, status: TodoStatus } | null {
	// Matches: "1: [x]", "1. [ ]", "1 completed", "1 [x]"
	const match = line.match(/^\s*(\d+)[:\.\)]?\s*(?:\[\s*([ xX\-~])\s*\]|\b(completed|in_progress|pending)\b)\s*$/i);
	if (!match) return null;

	const index = parseInt(match[1]) - 1; // 1-based to 0-based
	if (index < 0) return null;

	let status: TodoStatus = 'pending';
	const mark = match[2];
	const word = match[3]?.toLowerCase();

	if (mark) {
		if (mark.toLowerCase() === 'x') status = 'completed';
		else if (mark === '-' || mark === '~') status = 'in_progress';
	} else if (word) {
		status = word as TodoStatus;
	}

	return { index, status };
}

export function addTodoToTask(cline: Task, content: string, status: TodoStatus = "pending", id?: string): TodoItem {
	const todo: TodoItem = {
		id: id ?? crypto.randomUUID(),
		content,
		status,
	}
	if (!cline.todoList) cline.todoList = []
	cline.todoList.push(todo)
	return todo
}

export function updateTodoStatusForTask(cline: Task, id: string, nextStatus: TodoStatus): boolean {
	if (!cline.todoList) return false
	const idx = cline.todoList.findIndex((t) => t.id === id)
	if (idx === -1) return false
	const current = cline.todoList[idx]
	if (
		(current.status === "pending" && nextStatus === "in_progress") ||
		(current.status === "in_progress" && nextStatus === "completed") ||
		current.status === nextStatus
	) {
		cline.todoList[idx] = { ...current, status: nextStatus }
		return true
	}
	return false
}

export function removeTodoFromTask(cline: Task, id: string): boolean {
	if (!cline.todoList) return false
	const idx = cline.todoList.findIndex((t) => t.id === id)
	if (idx === -1) return false
	cline.todoList.splice(idx, 1)
	return true
}

export function getTodoListForTask(cline: Task): TodoItem[] | undefined {
	return cline.todoList?.slice()
}

export async function setTodoListForTask(cline?: Task, todos?: TodoItem[]) {
	if (cline === undefined) return
	cline.todoList = Array.isArray(todos) ? todos : []
}

export function restoreTodoListForTask(cline: Task, todoList?: TodoItem[]) {
	if (todoList) {
		cline.todoList = Array.isArray(todoList) ? todoList : []
		return
	}
	cline.todoList = getLatestTodo(cline.clineMessages)
}

function todoListToMarkdown(todos: TodoItem[]): string {
	return todos
		.map((t) => {
			let box = "[ ]"
			if (t.status === "completed") box = "[x]"
			else if (t.status === "in_progress") box = "[-]"
			return `${box} ${t.content}`
		})
		.join("\n")
}

function normalizeStatus(status: string | undefined): TodoStatus {
	if (status === "completed") return "completed"
	if (status === "in_progress") return "in_progress"
	return "pending"
}

export function parseMarkdownChecklist(md: string): TodoItem[] {
	if (typeof md !== "string") return []
	const lines = md
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
	const todos: TodoItem[] = []
	for (const line of lines) {
		// Regex to capture:
		// 1. Optional Prefix: Bullet (-*+) or Number (1. 1)
		// 2. Optional Bracket: [ ] [x] ( ) (x)
		// 3. Content
		const match = line.match(/^\s*([-*+]|\d+[\.:\)]?)?\s*(?:\[\s*([ xX\-~])\s*\]|\(\s*([ xX\-~]?)\s*\))?\s*(.+)$/)
		if (!match) continue

		const prefix = match[1]
		const bracket = match[2] ?? match[3]
		const content = match[4]

		// Must have either a bracket OR be a numbered list to be considered a todo
		// Plain text or standard bullet points (without whitespace/brackets) are skipped
		if (bracket === undefined) {
			if (!prefix) continue // Plain text
			if (!/^\d/.test(prefix)) continue // Bullet point without bracket -> standard list, skip
		}

		let status: TodoStatus = "pending"
		if (bracket) {
			const b = bracket.toLowerCase()
			if (b === "x") status = "completed"
			else if (b === "-" || b === "~") status = "in_progress"
		}

		const id = crypto
			.createHash("md5")
			.update(content + status)
			.digest("hex")
		todos.push({
			id,
			content,
			status,
		})
	}
	return todos
}

export function setPendingTodoList(todos: TodoItem[]) {
	approvedTodoList = todos
}

function validateTodos(todos: any[]): { valid: boolean; error?: string } {
	if (!Array.isArray(todos)) return { valid: false, error: "todos must be an array" }
	for (const [i, t] of todos.entries()) {
		if (!t || typeof t !== "object") return { valid: false, error: `Item ${i + 1} is not an object` }
		if (!t.id || typeof t.id !== "string") return { valid: false, error: `Item ${i + 1} is missing id` }
		if (!t.content || typeof t.content !== "string")
			return { valid: false, error: `Item ${i + 1} is missing content` }
		if (t.status && !todoStatusSchema.options.includes(t.status as TodoStatus))
			return { valid: false, error: `Item ${i + 1} has invalid status` }
	}
	return { valid: true }
}

export const updateTodoListTool = new UpdateTodoListTool()
