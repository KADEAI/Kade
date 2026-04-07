import { describe, expect, it } from "vitest"

import { buildStreamingToolShell } from "../streamingToolShell"

describe("buildStreamingToolShell", () => {
	it("creates a write shell row payload", () => {
		expect(buildStreamingToolShell("call_write_1", "write")).toEqual({
			tool: "newFileCreated",
			path: "",
			content: "",
			isOutsideWorkspace: false,
			isProtected: false,
			id: "call_write_1",
		})
	})

	it("resolves edit aliases to an appliedDiff shell row", () => {
		expect(buildStreamingToolShell("call_edit_1", "edit_file")).toEqual({
			tool: "appliedDiff",
			path: "",
			diff: "",
			isOutsideWorkspace: false,
			edits: [],
			id: "call_edit_1",
		})
	})

	it("returns nothing for tools without a shell UI", () => {
		expect(buildStreamingToolShell("call_list_1", "list")).toBeUndefined()
	})
})
