import { describe, expect, it } from "vitest"

import {
	extractTrackedReadLineRanges,
	hasExplicitTrackedReadSpec,
} from "../readTracking"

describe("extractTrackedReadLineRanges", () => {
	it("converts head reads into a concrete top-of-file range", () => {
		expect(
			extractTrackedReadLineRanges({
				head: 100,
			}),
		).toEqual([{ start: 1, end: 100 }])
	})

	it("extracts tail ranges from the rendered read result content", () => {
		expect(
			extractTrackedReadLineRanges(
				{ tail: 20 },
				undefined,
				{
					content: `<<<READ_RESULT path="thread_view.rs">>>
File: thread_view.rs
<<<READ_CONTENT>>>
Lines 7966-7985:
7966→fn example() {}
7985→}
<<<END_READ_CONTENT>>>
<<<END_READ_RESULT>>>`,
				},
			),
		).toEqual([{ start: 7966, end: 7985 }])
	})

	it("prefers explicit parsed line ranges when they already exist", () => {
		expect(
			extractTrackedReadLineRanges(
				{
					lineRanges: [{ start: 40, end: 80 }],
					head: 100,
				},
				undefined,
				{
					content: 'Lines 1-100:\n1→a',
				},
			),
		).toEqual([{ start: 40, end: 80 }])
	})

	it("treats plain colon range suffixes as explicit read specs", () => {
		expect(hasExplicitTrackedReadSpec("src/app.ts:10-20")).toBe(true)
	})

	it("treats compact line, head, and tail suffixes as explicit read specs", () => {
		expect(hasExplicitTrackedReadSpec("src/app.ts:L10-20")).toBe(true)
		expect(hasExplicitTrackedReadSpec("src/app.ts:H20")).toBe(true)
		expect(hasExplicitTrackedReadSpec("src/app.ts:T15")).toBe(true)
	})
})
