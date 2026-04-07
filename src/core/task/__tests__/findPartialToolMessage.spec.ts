import { describe, expect, it } from "vitest"

import { findMatchingPartialToolMessage } from "../findPartialToolMessage"

describe("findMatchingPartialToolMessage", () => {
	it("matches the existing partial ask row with the same tool id", () => {
		const messages = [
			{
				ts: 1,
				type: "ask",
				ask: "tool",
				partial: true,
				text: JSON.stringify({
					tool: "newFileCreated",
					path: "src/first.ts",
					id: "tool-1",
				}),
			},
			{
				ts: 2,
				type: "ask",
				ask: "tool",
				partial: true,
				text: JSON.stringify({
					tool: "newFileCreated",
					path: "src/second.ts",
					id: "tool-2",
				}),
			},
		] as any

		const match = findMatchingPartialToolMessage(
			messages,
			"ask",
			"tool",
			JSON.stringify({
				tool: "newFileCreated",
				path: "src/first.ts",
				id: "tool-1",
			}),
		)

		expect(match.isUpdatingPreviousPartial).toBe(true)
		expect(match.targetMessage?.ts).toBe(1)
	})

	it("does not reuse the last partial ask row when the tool id differs", () => {
		const messages = [
			{
				ts: 1,
				type: "ask",
				ask: "tool",
				partial: true,
				text: JSON.stringify({
					tool: "newFileCreated",
					path: "src/first.ts",
					id: "tool-1",
				}),
			},
		] as any

		const match = findMatchingPartialToolMessage(
			messages,
			"ask",
			"tool",
			JSON.stringify({
				tool: "newFileCreated",
				path: "src/second.ts",
				id: "tool-2",
			}),
		)

		expect(match.isUpdatingPreviousPartial).toBe(false)
		expect(match.targetMessage?.ts).toBe(1)
	})
})
