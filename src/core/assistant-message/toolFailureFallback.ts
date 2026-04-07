import type { ClineSay, ToolProgressStatus } from "@roo-code/types"

type ToolFailureTask = {
	say: (
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: ToolProgressStatus,
		options?: {
			isNonInteractive?: boolean
			skipSave?: boolean
			metadata?: Record<string, unknown>
		},
	) => Promise<unknown>
}

export async function surfaceToolFailureMessage(
	task: ToolFailureTask,
	errorMessage: string,
): Promise<void> {
	// Native tool failures can otherwise leave the last visible chat row as a
	// never-finalized partial tool shell, which keeps the UI stuck in a
	// streaming state. Emit a visible terminal error message so the last row
	// becomes non-partial and the composer unlocks.
	await task.say("error", errorMessage, undefined, false, undefined, undefined, {
		isNonInteractive: true,
	})
}
