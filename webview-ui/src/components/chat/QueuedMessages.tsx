import { useState } from "react"
import { useTranslation } from "react-i18next"

import { QueuedMessage } from "@roo-code/types"

import { Button } from "@src/components/ui"



import { Mention } from "./Mention"

interface QueuedMessagesProps {
	queue: QueuedMessage[]
	onRemove: (index: number) => void
	onUpdate: (index: number, newText: string) => void
}

export const QueuedMessages = ({ queue, onRemove, onUpdate }: QueuedMessagesProps) => {
	const { t } = useTranslation("chat")
	const [editingStates, setEditingStates] = useState<Record<string, { isEditing: boolean; value: string }>>({})

	if (queue.length === 0) {
		return null
	}

	const getEditState = (messageId: string, currentText: string) => {
		return editingStates[messageId] || { isEditing: false, value: currentText }
	}

	const setEditState = (messageId: string, isEditing: boolean, value?: string) => {
		setEditingStates((prev) => ({
			...prev,
			[messageId]: { isEditing, value: value ?? prev[messageId]?.value ?? "" },
		}))
	}

	const handleSaveEdit = (index: number, messageId: string, newValue: string) => {
		onUpdate(index, newValue)
		setEditState(messageId, false)
	}

	return (
		<div className="px-[15px] pb-2" data-testid="queued-messages">
			<div className="text-vscode-descriptionForeground text-xs mb-1 ml-1">
				{queue.length} {queue.length === 1 ? "message" : "messages"} queued
			</div>
			<div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto">
				{queue.map((message, index) => {
					const editState = getEditState(message.id, message.text)

					return (
						<div
							key={message.id}
							className="group flex items-start gap-2 px-1 py-0.5 rounded overflow-hidden whitespace-pre-wrap shrink-0 min-h-[24px]">
							<span className="text-vscode-descriptionForeground select-none mt-0.5">::</span>
							<div className="flex-grow min-w-0">
								{editState.isEditing ? (
									<textarea
										ref={(textarea) => {
											if (textarea) {
												// Set cursor at the end
												textarea.setSelectionRange(textarea.value.length, textarea.value.length)
											}
										}}
										value={editState.value}
										onChange={(e) => setEditState(message.id, true, e.target.value)}
										onBlur={() => handleSaveEdit(index, message.id, editState.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault()
												handleSaveEdit(index, message.id, editState.value)
											}
											if (e.key === "Escape") {
												setEditState(message.id, false, message.text)
											}
										}}
										className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1 resize-none focus:outline-0 focus:ring-1 focus:ring-vscode-focusBorder text-sm"
										placeholder={t("chat:editMessage.placeholder")}
										autoFocus
										rows={Math.min(editState.value.split("\n").length, 10)}
									/>
								) : (
									<div
										onClick={() => setEditState(message.id, true, message.text)}
										className="cursor-pointer hover:underline text-vscode-foreground break-all"
										title={t("queuedMessages.clickToEdit")}>
										<Mention text={message.text} />
									</div>
								)}
							</div>
							<div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5 hover:bg-vscode-list-hoverBackground"
									onClick={(e) => {
										e.stopPropagation()
										onRemove(index)
									}}>
									<span className="codicon codicon-trash text-xs" />
								</Button>
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
