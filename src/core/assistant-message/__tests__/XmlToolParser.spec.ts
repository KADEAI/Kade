import { describe, expect, it } from "vitest"

import { convertFileEntries } from "../XmlToolParser"

describe("convertFileEntries", () => {
	it("parses string file targets with inline line ranges", () => {
		expect(convertFileEntries(["src/app.ts:L10-20", "package.json"])).toEqual([
			{
				path: "src/app.ts",
				lineRanges: [{ start: 10, end: 20 }],
			},
			{
				path: "package.json",
			},
		])
	})

	it("parses plain colon line ranges without requiring an L prefix", () => {
		expect(convertFileEntries(["src/app.ts:10-20"])).toEqual([
			{
				path: "src/app.ts",
				lineRanges: [{ start: 10, end: 20 }],
			},
		])
	})

	it("parses compact head and tail suffixes", () => {
		expect(convertFileEntries(["src/app.ts:H20", "src/routes.ts:T15"])).toEqual([
			{
				path: "src/app.ts",
				head: 20,
			},
			{
				path: "src/routes.ts",
				tail: 15,
			},
		])
	})

	it("preserves object-based file targets for backward compatibility", () => {
		expect(
			convertFileEntries([
				{
					path: "src/routes.ts",
					line_ranges: ["1-5"],
				},
			]),
		).toEqual([
			{
				path: "src/routes.ts",
				lineRanges: [{ start: 1, end: 5 }],
			},
		])
	})

	it("parses inline suffixes when object-based file targets use path shorthand", () => {
		expect(
			convertFileEntries([
				{ path: "fifty_lines.txt:L1-5" },
				{ path: "head.txt:H10" },
				{ path: "tail.txt:T3" },
			]),
		).toEqual([
			{
				path: "fifty_lines.txt",
				lineRanges: [{ start: 1, end: 5 }],
			},
			{
				path: "head.txt",
				head: 10,
			},
			{
				path: "tail.txt",
				tail: 3,
			},
		])
	})
})
