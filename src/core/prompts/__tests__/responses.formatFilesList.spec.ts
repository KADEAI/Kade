import { describe, expect, it } from "vitest"

import {
	buildAppliedEditBlocksFromContents,
	formatEditHistoryPlaceholder,
	formatEditHistoryPlaceholderBody,
	formatNativeEditResult,
	formatNativeFileReadback,
	formatResponse,
	inferEditHistorySyntax,
	formatWriteHistoryPlaceholder,
	formatWriteHistoryPlaceholderBody,
	isEditHistoryPlaceholder,
	isWriteHistoryPlaceholder,
	redactEditHistoryBody,
} from "../responses"

describe("formatResponse.formatFilesList", () => {
	it("renders list_files output as an ASCII tree when requested", () => {
		const result = formatResponse.formatFilesList(
			"/workspace",
			[
				"/workspace/src/",
				"/workspace/src/index.ts",
				"/workspace/src/components/",
				"/workspace/src/components/Button.tsx",
				"/workspace/README.md",
			],
			false,
			undefined,
			false,
			undefined,
			new Map([
				["/workspace/src/index.ts", 12],
				["/workspace/src/components/Button.tsx", 34],
				["/workspace/README.md", 8],
			]),
			new Map([
				["src", { files: 2, folders: 1 }],
				["src/components", { files: 1, folders: 0 }],
			]),
			false,
			"tree",
		)

		expect(result).toBe(`Total files: 5, Total folders: 2
(file_name|L = line count)

.
|-- src/ (2 files)
|   |-- components/ (1 files)
|   |   \`-- Button.tsx|L34
|   \`-- index.ts|L12
\`-- README.md|L8`)
	})

	it("formats post-write readbacks using read-result sentinels", () => {
		const result = formatNativeFileReadback("src/app.ts", "const a = 1\nconst b = 2")

		expect(result).toContain("Read result for src/app.ts")
		expect(result).toContain("Read Content:")
		expect(result).toContain("Lines 1-2:")
		expect(result).toContain("1→const a = 1")
		expect(result).toContain("2→const b = 2")
		expect(result).toContain("EOF")
	})

	it("creates a write-history placeholder that points models at the readback", () => {
		expect(formatWriteHistoryPlaceholder("src/app.ts", "const a = 1\nconst b = 2")).toBe(
			["Write src/app.ts", "const a = ..... see result for rest of write", "EOF"].join("\n"),
		)
	})

	it("detects stripped write placeholders so they cannot be persisted as file content", () => {
		const placeholder = formatWriteHistoryPlaceholder("src/app.ts")

		expect(isWriteHistoryPlaceholder(placeholder)).toBe(true)
		expect(isWriteHistoryPlaceholder(placeholder, "src/app.ts")).toBe(true)
		expect(isWriteHistoryPlaceholder(placeholder, "src/other.ts")).toBe(false)
		expect(isWriteHistoryPlaceholder(formatWriteHistoryPlaceholderBody("const a = 1"))).toBe(true)
		expect(isWriteHistoryPlaceholder("const a = ..... see result for rest of write")).toBe(true)
		expect(isWriteHistoryPlaceholder("Content placed in paired result below")).toBe(true)
		expect(isWriteHistoryPlaceholder("const a = 1")).toBe(false)
	})

	it("formats edit results as stable historical blocks instead of refreshable reads", () => {
		const result = formatNativeEditResult("src/app.ts", [
			{
				index: 1,
				status: "applied",
				startLine: 10,
				endLine: 11,
				oldText: "const a = 1\nconst b = 2",
				newText: "const a = 3\nconst b = 4",
			},
			{
				index: 2,
				status: "failed",
				error: "Could not find a unique match.",
				oldTextPreview: "const missing = true",
			},
		], {
			editCount: 4,
		})

		expect(result).toContain("File: src/app.ts")
		expect(result).toContain('Index="1":')
		expect(result).toContain("Previous content (lines 10-11):")
		expect(result).toContain("10→const a = 1")
		expect(result).toContain("New content (lines 10-11):")
		expect(result).toContain("10→const a = 3")
		expect(result).toContain('Index="2" (failed):')
		expect(result).toContain("Error: Could not find a unique match.")
		expect(result).toContain("Previous content preview:")
		expect(result).toContain("EOF")
		expect(result).not.toContain("Read result for")
	})

	it("formats edit results with readable previous/new content labels even when unified syntax is provided", () => {
		const result = formatNativeEditResult(
			"src/app.ts",
			[
				{
					index: 1,
					status: "applied",
					startLine: 168,
					endLine: 168,
					oldText: `    useLocalStorage<HistoryViewType>("historyViewType", "dropdown-top"); // kade_change`,
					newText: `      useLocalStorage<HistoryViewType>("historyViewType", "dropdown"); // kade_change`,
				},
			],
			{
				syntax: inferEditHistorySyntax(
					'otxt[168]:     useLocalStorage<HistoryViewType>("historyViewType", "dropdown-top"); // kade_change\nntxt:       useLocalStorage<HistoryViewType>("historyViewType", "dropdown"); // kade_change',
					"etxt",
				),
			},
		)

		expect(result).toContain("Previous content (line 168):")
		expect(result).toContain(
			'168→    useLocalStorage<HistoryViewType>("historyViewType", "dropdown-top"); // kade_change',
		)
		expect(result).toContain("New content (line 168):")
		expect(result).toContain(
			'168→      useLocalStorage<HistoryViewType>("historyViewType", "dropdown"); // kade_change',
		)
		expect(result).toContain("EOF")
		expect(result).not.toContain("otxt[168]:")
		expect(result).not.toContain("ntxt:")
		expect(result).not.toContain("etxt")
	})

	it("derives applied edit blocks from the final formatted file diff", () => {
		const blocks = buildAppliedEditBlocksFromContents(
			`const config={title:"Agent Console"};\n`,
			`const config = {\n  title: "Agent Console",\n};\n`,
		)

		expect(blocks).toHaveLength(1)
		expect(blocks[0]).toMatchObject({
			index: 1,
			status: "applied",
			startLine: 1,
			endLine: 1,
			oldText: `const config={title:"Agent Console"};\n`,
			newText: `const config = {\n  title: "Agent Console",\n};\n`,
		})
	})

	it("creates an edit-history placeholder that points models at the structured result", () => {
		expect(formatEditHistoryPlaceholder("src/app.ts")).toBe(
			[
				"Edit src/app.ts",
				"Content placed in paired result below",
				"Search 1-6:",
				"Replace:",
				"EOF",
			].join("\n"),
		)
	})

	it("redacts edit placeholders while preserving the original block headers", () => {
		expect(
			formatEditHistoryPlaceholder(
				"src/app.ts",
				[
					"Search 10-12:",
					"const a = 1",
					"Replace:",
					"const a = 2",
					"Search 20:",
					"const b = 1",
					"Replace:",
					"const b = 2",
				].join("\n"),
			),
		).toBe(
			[
				"Edit src/app.ts",
				"Content placed in paired result below",
				"Search 10-12:",
				"Replace:",
				"Search 20:",
				"Replace:",
				"EOF",
			].join("\n"),
		)
	})

	it("preserves oldText/newText headers when redacting oldText/newText edit history", () => {
		expect(
			formatEditHistoryPlaceholder(
				"src/app.ts",
				[
					"oldText 10-12:",
					"const a = 1",
					"newText:",
					"const a = 2",
					"oldText 20:",
					"const b = 1",
					"newText:",
					"const b = 2",
				].join("\n"),
			),
		).toBe(
			[
				"Edit src/app.ts",
				"Content placed in paired result below",
				"oldText 10-12:",
				"newText:",
				"oldText 20:",
				"newText:",
				"EOF",
			].join("\n"),
		)
	})

	it("preserves otxt/ntxt headers and etxt when redacting inline unified edit history", () => {
		expect(
			formatEditHistoryPlaceholder(
				"src/app.ts",
				[
					"otxt[10-12]: const a = 1",
					"const b = 2",
					"ntxt: const a = 2",
					"const b = 3",
				].join("\n"),
				{ closer: "etxt" },
			),
		).toBe(
			[
				"Edit src/app.ts",
				"Content placed in paired result below",
				"otxt[10-12]:",
				"ntxt:",
				"etxt",
			].join("\n"),
		)
	})

	it("detects stripped edit placeholders for defensive parsing", () => {
		const placeholder = formatEditHistoryPlaceholder("src/app.ts")
		const structuredPlaceholder = formatEditHistoryPlaceholder(
			"src/app.ts",
			[
				"oldText 10-12:",
				"const a = 1",
				"newText:",
				"const a = 2",
			].join("\n"),
		)

		expect(isEditHistoryPlaceholder(placeholder)).toBe(true)
		expect(isEditHistoryPlaceholder(placeholder, "src/app.ts")).toBe(true)
		expect(isEditHistoryPlaceholder(placeholder, "src/other.ts")).toBe(false)
		expect(isEditHistoryPlaceholder(formatEditHistoryPlaceholderBody())).toBe(true)
		expect(isEditHistoryPlaceholder(redactEditHistoryBody("Search 10-12:\nfoo\nReplace:\nbar"))).toBe(true)
		expect(
			isEditHistoryPlaceholder(
				[
					"Search 10-12:",
					"Content placed in paired result below",
					"Replace:",
					"Content placed in paired result below",
				].join("\n"),
			),
		).toBe(true)
		expect(isEditHistoryPlaceholder(structuredPlaceholder, "src/app.ts")).toBe(true)
		expect(isEditHistoryPlaceholder("search:\nfoo\nreplace:\nbar")).toBe(false)
	})
})
