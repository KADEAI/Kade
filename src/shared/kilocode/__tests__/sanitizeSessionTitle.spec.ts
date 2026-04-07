import { describe, expect, it } from "vitest"

import {
	createSessionTitlePreview,
	sanitizeSessionTitle,
	stripInlineVibes,
} from "../sanitizeSessionTitle"

describe("sanitizeSessionTitle", () => {
	it("removes recognized vibe markers while keeping content", () => {
		expect(sanitizeSessionTitle("~cool:pro Exactly, bro.~")).toBe("Exactly, bro.")
	})

	it("keeps unknown tags untouched", () => {
		expect(sanitizeSessionTitle("~madeup keep this~")).toBe("~madeup keep this~")
	})

	it("normalizes whitespace after stripping vibes", () => {
		expect(sanitizeSessionTitle("  ~terminal:quiet npm install complete~  ")).toBe("npm install complete")
	})

	it("supports multiple vibe segments in one title", () => {
		expect(stripInlineVibes("~cool smooth~ and ~spooky odd~")).toBe("smooth and odd")
	})

	it("sanitizes before truncating previews", () => {
		expect(createSessionTitlePreview("before ~neon:smooth as butter now~ after", 20)).toBe("before as butter now...")
	})
})
