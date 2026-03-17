import { describe, expect, it } from "vitest"

import { buildGrepIgnoreGlobs } from "../searchFilesIgnoreGlobs"

describe("buildGrepIgnoreGlobs", () => {
	it("filters noisy non-code files by default", () => {
		const globs = buildGrepIgnoreGlobs()

		expect(globs).toContain("!**/*.md")
		expect(globs).toContain("!**/package.nls*.json")
		expect(globs).toContain("!**/locales/**")
		expect(globs).toContain("!**/*.spec.*")
		expect(globs).toContain("!**/__tests__/**")
	})

	it("keeps tests when explicitly requested but still filters other noise", () => {
		const globs = buildGrepIgnoreGlobs({ includeTests: true })

		expect(globs).toContain("!**/*.md")
		expect(globs).toContain("!**/package.nls*.json")
		expect(globs).not.toContain("!**/*.spec.*")
		expect(globs).not.toContain("!**/__tests__/**")
	})

	it("returns no ignore globs when include_all is enabled", () => {
		expect(buildGrepIgnoreGlobs({ includeAll: true })).toEqual([])
	})
})
