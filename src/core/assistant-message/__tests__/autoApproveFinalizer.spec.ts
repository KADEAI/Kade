import { describe, expect, it, vi } from "vitest"

import { finalizeAutoApprovedAskMessage } from "../autoApproveFinalizer"

describe("finalizeAutoApprovedAskMessage", () => {
	it("finalizes partial tool shells for auto-approved tool asks", async () => {
		const say = vi.fn().mockResolvedValue(undefined)

		await finalizeAutoApprovedAskMessage(
			{ say },
			"tool",
			'{"tool":"grep","id":"call_123","content":"done"}',
			undefined,
			"yolo",
		)

		expect(say).toHaveBeenCalledWith(
			"tool",
			'{"tool":"grep","id":"call_123","content":"done"}',
			undefined,
			false,
			undefined,
			undefined,
			{
				isNonInteractive: true,
				metadata: {
					autoApproved: true,
					autoApproveSource: "yolo",
					autoApproveRecoveredPartial: true,
				},
			},
		)
	})

	it("ignores ask types that do not map to visible partial shells", async () => {
		const say = vi.fn().mockResolvedValue(undefined)

		await finalizeAutoApprovedAskMessage({ say }, "followup", "hello")

		expect(say).not.toHaveBeenCalled()
	})
})
