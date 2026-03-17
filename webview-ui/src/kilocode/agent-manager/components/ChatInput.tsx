
import React, { useState, useRef, useEffect, useCallback } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { vscode } from "../utils/vscode"
import { GitBranch, SendHorizontal, Square } from "lucide-react"
import { cn } from "../../../lib/utils"
// Use the main UI's ChatTextArea for consistent look and feel
import { ChatTextArea } from "../../../components/chat/ChatTextArea"
import { sessionInputAtomFamily } from "../state/atoms/sessions"
import { sessionTodoStatsAtomFamily } from "../state/atoms/todos"
import { AgentTodoList } from "./AgentTodoList"
import { addToQueueAtom } from "../state/atoms/messageQueue"
import { defaultModeSlug } from "@roo/modes"

interface ChatInputProps {
	sessionId: string
	sessionLabel?: string
	isActive?: boolean
	showCancel?: boolean
	showFinishToBranch?: boolean
	worktreeBranchName?: string
	sessionStatus?: "creating" | "running" | "done" | "error" | "stopped"
}

export const ChatInput: React.FC<ChatInputProps> = ({
	sessionId,
	sessionLabel,
	isActive = false,
	showCancel = false,
	showFinishToBranch = false,
	worktreeBranchName,
	sessionStatus,
}) => {
	const { t } = useTranslation("agentManager")
	const [messageText, setMessageText] = useAtom(sessionInputAtomFamily(sessionId))
	const todoStats = useAtomValue(sessionTodoStatsAtomFamily(sessionId))
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [isFocused, setIsFocused] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const addToQueue = useSetAtom(addToQueueAtom)

	// Unused but required props for ChatTextArea
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [mode, setMode] = useState(defaultModeSlug)

	// Auto-focus the textarea when the session changes (user selects a different session)
	useEffect(() => {
		textareaRef.current?.focus()
	}, [sessionId])

	const trimmedMessage = messageText.trim()
	const isEmpty = trimmedMessage.length === 0
	const isSessionCompleted = sessionStatus === "done" || sessionStatus === "error" || sessionStatus === "stopped"

	const handleSend = useCallback(() => {
		if (isEmpty && selectedImages.length === 0) return

		if (isSessionCompleted) {
			// Resume a completed session with a new message (sent directly, not queued)
			vscode.postMessage({
				type: "agentManager.resumeSession",
				sessionId,
				sessionLabel,
				content: trimmedMessage,
				images: selectedImages,
			})
			setMessageText("")
			setSelectedImages([])
		} else {
			// For running sessions, queue the message instead of sending directly
			const queuedMsg = addToQueue({ sessionId, content: trimmedMessage, images: selectedImages })

			if (queuedMsg) {
				// Notify the extension that a message has been queued
				vscode.postMessage({
					type: "agentManager.messageQueued",
					sessionId,
					messageId: queuedMsg.id,
					sessionLabel,
					content: trimmedMessage,
					images: selectedImages,
				})

				setMessageText("")
				setSelectedImages([])
			}
		}
	}, [isEmpty, isSessionCompleted, sessionId, sessionLabel, trimmedMessage, addToQueue, setMessageText, selectedImages, setSelectedImages])

	const handleCancel = useCallback(() => {
		vscode.postMessage({
			type: "agentManager.cancelSession",
			sessionId,
		})
	}, [sessionId])

	const handleFinishToBranch = useCallback(() => {
		vscode.postMessage({
			type: "agentManager.finishWorktreeSession",
			sessionId,
		})
	}, [sessionId])

	const hasTodos = todoStats.totalCount > 0

	return (
		<div className="am-chat-input-container">
			{/* Unified wrapper when todos present - handles border and focus state */}
			<div
				className={cn(
					"relative flex-1 flex flex-col min-h-0 overflow-visible rounded", // changed overflow to visible for popups
					hasTodos && [
						"border bg-vscode-input-background",
						// Border logic is handled inside ChatTextArea now, but we might want wrapper border for Todo integration
						// Keeping wrapper border for now if todos exist
						"border-vscode-input-border",
					],
				)}>
				{/* Todo list above input */}
				{hasTodos && <AgentTodoList stats={todoStats} isIntegrated />}

				<ChatTextArea
					ref={textareaRef}
					inputValue={messageText}
					setInputValue={setMessageText}
					onSend={handleSend}
					onCancel={showCancel ? handleCancel : undefined}
					placeholderText={t("chatInput.placeholderTypeTask")} // Use existing translation key
					selectedImages={selectedImages}
					setSelectedImages={setSelectedImages}
					onSelectImages={() => { }} // No-op for now
					shouldDisableImages={true} // Disable image support initially to simplify
					sendingDisabled={isEmpty}
					selectApiConfigDisabled={true} // Disable model selector for now
					mode={mode}
					setMode={setMode} // No-op really as mode selector handles it, but needed for prop type
					modeShortcutText="" // Not showing mode shortcut
					isEditMode={false}
					isStreaming={isActive} // Show stop button if active
					onStop={handleCancel} // Stop button action
				/>
			</div>
		</div>
	)
}
