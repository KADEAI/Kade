import React, { useState, useEffect, useRef, useMemo } from "react"
import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import MarkdownBlock from "../common/MarkdownBlock"
import { Check, Circle, Loader2, Plus, Trash2, X, Edit2, CheckCircle2, CircleDashed } from "lucide-react"
import { cn } from "@/lib/utils"

interface TodoItem {
	id?: string
	content: string
	status?: "completed" | "in_progress" | string
}

interface UpdateTodoListToolBlockProps {
	todos?: TodoItem[]
	content?: string
	onChange: (todos: TodoItem[]) => void
	editable?: boolean
	userEdited?: boolean
}

const STATUS_OPTIONS = [
	{ value: "", label: "Not Started", icon: Circle, color: "text-vscode-descriptionForeground/60" },
	{ value: "in_progress", label: "In Progress", icon: Loader2, color: "text-vscode-charts-yellow" },
	{ value: "completed", label: "Completed", icon: CheckCircle2, color: "text-vscode-charts-green" },
]

const genId = () => Math.random().toString(36).slice(2, 10)

const UpdateTodoListToolBlock: React.FC<UpdateTodoListToolBlockProps> = ({
	todos = [],
	content,
	onChange,
	editable = true,
	userEdited = false,
}) => {
	const [editTodos, setEditTodos] = useState<TodoItem[]>(
		todos.length > 0 ? todos.map((todo) => ({ ...todo, id: todo.id || genId() })) : [],
	)
	const [adding, setAdding] = useState(false)
	const [newContent, setNewContent] = useState("")
	const newInputRef = useRef<HTMLInputElement>(null)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const [isEditing, setIsEditing] = useState(false)

	const completedCount = editTodos.filter((t) => t.status === "completed").length
	const totalCount = editTodos.length

	useEffect(() => {
		if (!editable && isEditing) {
			setIsEditing(false)
		}
	}, [editable, isEditing])

	useEffect(() => {
		if (typeof onChange !== "function") {
			console.warn("UpdateTodoListToolBlock: onChange callback not passed")
		}
	}, [])

	useEffect(() => {
		setEditTodos(todos.length > 0 ? todos.map((todo) => ({ ...todo, id: todo.id || genId() })) : [])
	}, [todos])

	useEffect(() => {
		if (adding && newInputRef.current) {
			newInputRef.current.focus()
		}
	}, [adding])

	const handleContentChange = (id: string, value: string) => {
		const newTodos = editTodos.map((todo) => (todo.id === id ? { ...todo, content: value } : todo))
		setEditTodos(newTodos)
		onChange?.(newTodos)
	}

	const handleStatusChange = (id: string, status: string) => {
		const newTodos = editTodos.map((todo) => (todo.id === id ? { ...todo, status } : todo))
		setEditTodos(newTodos)
		onChange?.(newTodos)
	}

	const handleDelete = (id: string) => setDeleteId(id)

	const confirmDelete = () => {
		if (!deleteId) return
		const newTodos = editTodos.filter((todo) => todo.id !== deleteId)
		setEditTodos(newTodos)
		onChange?.(newTodos)
		setDeleteId(null)
	}

	const cancelDelete = () => setDeleteId(null)

	const handleAdd = () => {
		if (!newContent.trim()) return
		const newTodo: TodoItem = {
			id: genId(),
			content: newContent.trim(),
			status: "",
		}
		const newTodos = [...editTodos, newTodo]
		setEditTodos(newTodos)
		onChange?.(newTodos)
		setNewContent("")
		setAdding(false)
	}

	const handleNewInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleAdd()
		} else if (e.key === "Escape") {
			setAdding(false)
			setNewContent("")
		}
	}

	if (userEdited) {
		return (
			<ToolUseBlock>
				<ToolUseBlockHeader>
					<div className="flex items-center w-full gap-2">
						<span className="codicon codicon-feedback text-vscode-charts-yellow" />
						<span className="font-bold">User Edit</span>
					</div>
				</ToolUseBlockHeader>
				<div className="py-2 text-vscode-descriptionForeground">{content || "User modified the todo list."}</div>
			</ToolUseBlock>
		)
	}

	return (
		<div className="select-none p-0 m-0 w-full">
			{/* Header outside - aligned to icons (12px) */}
			<div className="flex items-center justify-between px-2 py-0.5 mb-0 bg-vscode-input-background/40 border border-vscode-widget-border/60 rounded-t-xl">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-vscode-foreground opacity-90">
						{completedCount} / {totalCount} tasks done
					</span>
				</div>
				{editable && (
					<button
						onClick={() => setIsEditing(!isEditing)}
						className="text-[10px] font-bold tracking-widest text-vscode-descriptionForeground hover:text-vscode-foreground uppercase transition-colors px-1.5 py-0.5 rounded hover:bg-vscode-toolbar-hoverBackground">
						{isEditing ? "DONE" : "EDIT"}
					</button>
				)}
			</div>

			{/* List container - wrapped tightly around results */}
			<div className="bg-vscode-input-background/40 rounded-b-xl overflow-hidden border-x border-b border-vscode-widget-border/60 p-0 m-0">
				{Array.isArray(editTodos) && editTodos.length > 0 ? (
					<ul className="flex flex-col p-0 m-0">
						{editTodos.map((todo, idx) => {
							const currentStatus = STATUS_OPTIONS.find((s) => s.value === (todo.status || "")) || STATUS_OPTIONS[0]
							const StatusIcon = currentStatus.icon

							return (
								<li
									key={todo.id || idx}
									className={cn(
										"group flex items-start gap-1.5 px-2 py-0.5 text-sm transition-colors",
										isEditing ? "bg-vscode-editor-background py-1" : "hover:bg-vscode-list-hoverBackground/40"
									)}>
									{isEditing ? (
										<div className="flex flex-col flex-1 gap-1 py-0.5">
											<div className="flex items-start gap-2 w-full">
												<div className="relative pt-0.5 shrink-0">
													<select
														value={todo.status || ""}
														onChange={(e) => handleStatusChange(todo.id!, e.target.value)}
														className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
														title="Change Status"
													/>
													<StatusIcon
														className={cn(
															"w-3.5 h-3.5",
															currentStatus.color,
															todo.status === "in_progress" && "animate-spin-slow"
														)}
													/>
												</div>
												<input
													type="text"
													value={todo.content}
													onChange={(e) => handleContentChange(todo.id!, e.target.value)}
													className="flex-1 bg-transparent border-none outline-none text-vscode-input-foreground placeholder:text-vscode-descriptionForeground min-w-0 py-0 text-sm"
													placeholder="Task description..."
												/>
												<button
													onClick={() => handleDelete(todo.id!)}
													className="text-vscode-descriptionForeground hover:text-vscode-errorForeground p-0.5 transition-colors">
													<Trash2 className="w-3 h-3" />
												</button>
											</div>
										</div>
									) : (
										<>
											<div className="pt-0.5 shrink-0">
												<StatusIcon
													className={cn(
														"w-3.5 h-3.5",
														currentStatus.color,
														todo.status === "in_progress" && "text-vscode-charts-yellow"
													)}
												/>
											</div>
											<span
												className={cn(
													"flex-1 leading-snug break-words opacity-90",
													todo.status === "completed" && "text-vscode-descriptionForeground",
													todo.status === "in_progress" && "text-vscode-charts-yellow font-medium opacity-100"
												)}>
												{todo.content}
											</span>
										</>
									)}
								</li>
							)
						})}

						{adding ? (
							<li className="flex items-center gap-2 px-2 py-1 bg-vscode-editor-background rounded-sm mt-0.5 animate-in fade-in duration-200">
								<CircleDashed className="w-3.5 h-3.5 text-vscode-descriptionForeground shrink-0" />
								<input
									ref={newInputRef}
									type="text"
									value={newContent}
									onChange={(e) => setNewContent(e.target.value)}
									onKeyDown={handleNewInputKeyDown}
									placeholder="New task..."
									className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-vscode-descriptionForeground/50"
								/>
								<div className="flex gap-1">
									<button onClick={handleAdd} className="hover:text-vscode-charts-green p-0.5">
										<Check className="w-4 h-4" />
									</button>
									<button onClick={() => setAdding(false)} className="hover:text-vscode-errorForeground p-0.5">
										<X className="w-4 h-4" />
									</button>
								</div>
							</li>
						) : (
							isEditing && (
								<li className="mt-0.5 px-1">
									<button
										onClick={() => setAdding(true)}
										className="flex items-center gap-2 w-full px-2 py-1 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground rounded hover:bg-vscode-list-hoverBackground transition-colors">
										<Plus className="w-3.5 h-3.5" />
										<span>Add task</span>
									</button>
								</li>
							)
						)}
					</ul>
				) : (
					<div className="px-2 py-1 text-center text-vscode-descriptionForeground text-sm italic">
						No tasks yet.
					</div>
				)}
			</div>

			{deleteId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
					<div className="bg-vscode-editorWidget-background border border-vscode-editorWidget-border shadow-2xl rounded-lg p-3 max-w-[240px] w-full mx-4">
						<h3 className="text-sm font-semibold mb-3 text-center">Delete task?</h3>
						<div className="flex justify-center gap-2">
							<button
								onClick={cancelDelete}
								className="px-3 py-1 text-xs rounded border border-vscode-button-border hover:bg-vscode-button-secondaryHoverBackground">
								Cancel
							</button>
							<button
								onClick={confirmDelete}
								className="px-3 py-1 text-xs rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground">
								Delete
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default UpdateTodoListToolBlock
