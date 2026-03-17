
import React, { useEffect, useRef, useCallback, useMemo, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { sessionMessagesAtomFamily } from "../state/atoms/messages"
import { sessionInputAtomFamily, sessionsMapAtom } from "../state/atoms/sessions"
import {
	sessionMessageQueueAtomFamily,
	sessionSendingMessageIdAtomFamily,
	removeFromQueueAtom,
	retryFailedMessageAtom,
} from "../state/atoms/messageQueue"
import type { QueuedMessage } from "../state/atoms/messageQueue"
import type { ClineMessage, SuggestionItem } from "@roo-code/types"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { combineApiRequests } from "@roo/combineApiRequests"
import { SimpleMarkdown } from "./SimpleMarkdown"
import { vscode } from "../utils/vscode"
import {
	Clock,
	Loader,
	AlertCircle,
} from "lucide-react"
import { cn } from "../../../lib/utils"
// Use the main UI's ChatRow for consistent look and feel
import ChatRow from "../../../components/chat/ChatRow"
import { AgentManagerExtensionStateAdapter } from "./AgentManagerExtensionStateAdapter"

interface MessageListProps {
	sessionId: string
}

/**
 * Displays messages for a session using the shared ChatRow component.
 */
export function MessageList({ sessionId }: MessageListProps) {
	const { t } = useTranslation("agentManager")
	const messages = useAtomValue(sessionMessagesAtomFamily(sessionId))
	// Correctly retrieve session from map atom
	const sessions = useAtomValue(sessionsMapAtom)
	const session = sessions[sessionId]
	const queue = useAtomValue(sessionMessageQueueAtomFamily(sessionId))
	const sendingMessageId = useAtomValue(sessionSendingMessageIdAtomFamily(sessionId))
	const setInputValue = useSetAtom(sessionInputAtomFamily(sessionId))
	const retryFailedMessage = useSetAtom(retryFailedMessageAtom)
	const removeFromQueue = useSetAtom(removeFromQueueAtom)
	const virtuosoRef = useRef<VirtuosoHandle>(null)

	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

	// Combine command and command_output messages into single entries
	// Also combine API requests to match ChatView logic
	const combinedMessages = useMemo(() => {
		return combineApiRequests(combineCommandSequences(messages))
	}, [messages])

	// Auto-scroll to bottom when new messages arrive using Virtuoso API
	useEffect(() => {
		if (combinedMessages.length > 0) {
			virtuosoRef.current?.scrollToIndex({
				index: combinedMessages.length - 1,
				behavior: "smooth",
			})
		}
	}, [combinedMessages.length])

	const handleSuggestionClick = useCallback(
		(suggestion: SuggestionItem) => {
			vscode.postMessage({
				type: "agentManager.sendMessage",
				sessionId,
				content: suggestion.answer,
			})
		},
		[sessionId],
	)

	const onToggleExpand = useCallback((ts: number) => {
		setExpandedRows((prev) => ({
			...prev,
			[ts]: !prev[ts],
		}))
	}, [])

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (isTaller) {
				virtuosoRef.current?.autoscrollToBottom()
			}
		},
		[],
	)

	const handleRetryMessage = useCallback(
		(sessionId: string, messageId: string) => {
			retryFailedMessage({ sessionId, messageId })
		},
		[retryFailedMessage],
	)

	const handleDiscardMessage = useCallback(
		(sessionId: string, messageId: string) => {
			removeFromQueue({ sessionId, messageId })
		},
		[removeFromQueue],
	)

	// Combine messages and queued messages for virtualization
	const allItems = useMemo(() => {
		return [...combinedMessages, ...queue.map((q) => ({ type: "queued" as const, data: q }))]
	}, [combinedMessages, queue])

	// Calculate isStreaming based on session status
	const isStreaming = useMemo(() => {
		if (session?.status === "running") {
			// If running, assume streaming if the last message is partial or api_req_started
			const lastMsg = combinedMessages.at(-1)
			if (lastMsg?.partial) return true
			// More complex check can be added if needed, mirroring ChatView
			return true
		}
		return false
	}, [session?.status, combinedMessages])

	// Item content renderer for Virtuoso
	const itemContent = useCallback(
		(index: number, item: ClineMessage | { type: "queued"; data: QueuedMessage }) => {
			// Check if this is a queued message
			if ("type" in item && (item as any).type === "queued") {
				const queuedMsg = (item as any).data
				return (
					<QueuedMessageItem
						key={`queued-${queuedMsg.id}`}
						queuedMessage={queuedMsg}
						isSending={sendingMessageId === queuedMsg.id}
						onRetry={handleRetryMessage}
						onDiscard={handleDiscardMessage}
					/>
				)
			}

			// Regular message
			const msg = item as ClineMessage
			const isLast = index === combinedMessages.length - 1

			return (
				<ChatRow
					key={msg.ts}
					message={msg}
					isExpanded={expandedRows[msg.ts] || false}
					isLast={isLast}
					isStreaming={isStreaming}
					onToggleExpand={onToggleExpand}
					onHeightChange={handleRowHeightChange}
					onSuggestionClick={handleSuggestionClick}
				/>
			)
		},
		[
			combinedMessages.length,
			expandedRows,
			isStreaming,
			onToggleExpand,
			handleRowHeightChange,
			handleSuggestionClick,
			sendingMessageId,
			handleRetryMessage,
			handleDiscardMessage,
		],
	)

	if (messages.length === 0 && queue.length === 0) {
		// Use empty state or specific welcome message if needed
		return (
			<div className="am-messages-empty">
				<div className="codicon codicon-comment-discussion text-4xl mb-2 opacity-20"></div>
				<p>{t("messages.waiting")}</p>
			</div>
		)
	}

	return (
		<AgentManagerExtensionStateAdapter sessionId={sessionId}>
			<div className="am-messages-container">
				<Virtuoso
					ref={virtuosoRef}
					data={allItems}
					itemContent={itemContent}
					followOutput="smooth"
					increaseViewportBy={{ top: 1000, bottom: 1000 }} // Increased for smoother scrolling with heavy components
					className="am-messages-list"
				/>
			</div>
		</AgentManagerExtensionStateAdapter>
	)
}

interface QueuedMessageItemProps {
	queuedMessage: QueuedMessage
	isSending: boolean
	onRetry: (sessionId: string, messageId: string) => void
	onDiscard: (sessionId: string, messageId: string) => void
}

function QueuedMessageItem({ queuedMessage, isSending: _isSending, onRetry, onDiscard }: QueuedMessageItemProps) {
	const { t } = useTranslation("agentManager")

	let icon = <Clock size={16} className="opacity-70" />
	let statusText = t("chatInput.messageSending")
	let statusColor = "text-vscode-descriptionForeground"

	if (queuedMessage.status === "sending") {
		icon = <Loader size={16} className="animate-spin opacity-70" />
		statusText = t("chatInput.messageSending")
		statusColor = "text-vscode-descriptionForeground"
	} else if (queuedMessage.status === "failed") {
		icon = <AlertCircle size={16} className="text-vscode-errorForeground" />
		statusText = queuedMessage.error || "Failed to send message"
		statusColor = "text-vscode-errorForeground"
	} else {
		icon = <Clock size={16} className="opacity-70" />
		statusText = t("chatInput.messageSending")
		statusColor = "text-vscode-descriptionForeground"
	}

	const handleRetry = () => {
		onRetry(queuedMessage.sessionId, queuedMessage.id)
	}

	const handleDiscard = () => {
		onDiscard(queuedMessage.sessionId, queuedMessage.id)
	}

	const canRetry = queuedMessage.retryCount < queuedMessage.maxRetries

	return (
		<div className={cn("am-message-item", queuedMessage.status === "failed" && "opacity-75")}>
			<div className="am-message-icon">{icon}</div>
			<div className="am-message-content-wrapper">
				<div className="am-message-header">
					<span className="am-message-author text-vscode-descriptionForeground">{t("messages.youSaid")}</span>
					<span className={cn("am-message-ts text-xs", statusColor)}>{statusText}</span>
				</div>
				<div className="am-message-body">
					<SimpleMarkdown content={queuedMessage.content} />
				</div>
				{queuedMessage.status === "failed" && (
					<div className="mt-2 space-y-2">
						{queuedMessage.error && (
							<p className="text-xs text-vscode-errorForeground">Error: {queuedMessage.error}</p>
						)}
						{queuedMessage.retryCount > 0 && (
							<p className="text-xs text-vscode-descriptionForeground">
								Retry attempt {queuedMessage.retryCount} of {queuedMessage.maxRetries}
							</p>
						)}
						<div className="flex gap-2">
							{canRetry && (
								<button
									onClick={handleRetry}
									className="text-xs px-2 py-1 rounded bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground">
									Retry
								</button>
							)}
							<button
								onClick={handleDiscard}
								className="text-xs px-2 py-1 rounded bg-vscode-errorBackground hover:opacity-80 text-vscode-errorForeground">
								Discard
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
