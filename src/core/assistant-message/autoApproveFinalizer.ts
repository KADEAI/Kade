import type { ClineAsk, ClineSay, ToolProgressStatus } from "@roo-code/types"

type AutoApproveTask = {
	say: (
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: ToolProgressStatus,
		options?: {
			isNonInteractive?: boolean
			metadata?: Record<string, unknown>
		},
	) => Promise<unknown>
}

const FINALIZABLE_ASK_TYPES = [
	"tool",
	"command",
	"use_mcp_server",
	"browser_action_launch",
] as const

type FinalizableAskType = (typeof FINALIZABLE_ASK_TYPES)[number]

const FINALIZABLE_ASK_TYPE_SET = new Set<FinalizableAskType>(FINALIZABLE_ASK_TYPES)

function isFinalizableAskType(type: ClineAsk): type is FinalizableAskType {
	return FINALIZABLE_ASK_TYPE_SET.has(type as FinalizableAskType)
}

export async function finalizeAutoApprovedAskMessage(
	task: AutoApproveTask,
	type: ClineAsk,
	partialMessage?: string,
	progressStatus?: ToolProgressStatus,
	source: "yolo" | "gatekeeper" | "auto_approval" = "auto_approval",
): Promise<void> {
	if (!partialMessage || !isFinalizableAskType(type)) {
		return
	}

	await task.say(type, partialMessage, undefined, false, undefined, progressStatus, {
		isNonInteractive: true,
		metadata: {
			autoApproved: true,
			autoApproveSource: source,
			autoApproveRecoveredPartial: true,
		},
	})
}
