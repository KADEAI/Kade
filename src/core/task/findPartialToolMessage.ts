import type { ClineMessage } from "@roo-code/types"

type MessageKind = "ask" | "say"

function parseToolPayload(text?: string) {
	if (!text) {
		return null
	}

	try {
		return JSON.parse(text) as {
			id?: string
			tool?: string
			path?: string
		}
	} catch {
		return null
	}
}

export function findMatchingPartialToolMessage(
	messages: ClineMessage[],
	kind: MessageKind,
	type: string,
	text?: string,
): {
	targetMessage?: ClineMessage
	isUpdatingPreviousPartial: boolean
} {
	const field = kind === "ask" ? "ask" : "say"
	const lastMessage = messages.at(-1)
	let targetMessage = lastMessage
	let isUpdatingPreviousPartial = Boolean(
		lastMessage &&
			lastMessage.partial &&
			lastMessage.type === kind &&
			lastMessage[field] === type,
	)

	if (type !== "tool" || !text) {
		return { targetMessage, isUpdatingPreviousPartial }
	}

	const currentTool = parseToolPayload(text)
	const currentToolId = currentTool?.id
	const currentToolName = currentTool?.tool
	const currentToolPath = currentTool?.path

	if (!currentToolId && !currentToolName) {
		return { targetMessage, isUpdatingPreviousPartial }
	}

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (
			message.type !== kind ||
			message[field] !== type ||
			message.partial !== true ||
			!message.text
		) {
			continue
		}

		const candidateTool = parseToolPayload(message.text)
		if (!candidateTool) {
			continue
		}

		const sameToolId =
			!!currentToolId &&
			!!candidateTool.id &&
			candidateTool.id === currentToolId

		const legacySameTool =
			!currentToolId &&
			!!currentToolName &&
			(currentToolName === "newFileCreated" ||
				currentToolName === "appliedDiff" ||
				currentToolName === "editedExistingFile") &&
			candidateTool.tool === currentToolName &&
			candidateTool.path === currentToolPath

		if (!sameToolId && !legacySameTool) {
			continue
		}

		targetMessage = message
		isUpdatingPreviousPartial = true
		return { targetMessage, isUpdatingPreviousPartial }
	}

	if (isUpdatingPreviousPartial && lastMessage?.text) {
		const lastToolId = parseToolPayload(lastMessage.text)?.id
		if (currentToolId && lastToolId && lastToolId !== currentToolId) {
			isUpdatingPreviousPartial = false
		}
	}

	return { targetMessage, isUpdatingPreviousPartial }
}
